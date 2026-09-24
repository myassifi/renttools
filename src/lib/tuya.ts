// Tuya OpenAPI client — minimal surface for smart-lock temp passwords.
// Request signing is HMAC-SHA256 per Tuya's spec:
//   sign = HMAC_SHA256(secret, client_id + [access_token] + t + nonce + content).toUpperCase()
//   content = METHOD + "\n" + sha256hex(body) + "\n" + "" + "\n" + path_with_query
//
// PIN encryption for door locks uses the password-ticket flow:
//   1. POST .../door-lock/password-ticket  -> ticket_id + ticket_key
//   2. ticket_key is AES-ECB-encrypted with the project's access secret;
//      decrypt it to get the ticket key (hex string)
//   3. encrypt the PIN with that key (AES-ECB, PKCS7) -> hex ciphertext
//   4. POST .../door-lock/temp-password with the encrypted PIN
// Tuya secrets are 32-char strings -> a 32-byte key -> AES-256-ECB; the
// helper picks 128/256 by key length so both shapes work.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
} from "node:crypto";

const REGION_HOSTS: Record<string, string> = {
  eu: "https://openapi.tuyaeu.com",
  us: "https://openapi.tuyaus.com",
  cn: "https://openapi.tuyacn.com",
  in: "https://openapi.tuyain.com",
  we: "https://openapi-we.tuyaus.com",
};

export interface TuyaCredentials {
  region: string;
  clientId: string;
  clientSecret: string;
  uid: string;
}

export class TuyaError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
  ) {
    super(message);
    this.name = "TuyaError";
  }
}

type FetchLike = typeof fetch;

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function aesEcb(keyLen: number): { enc: string; dec: string } {
  if (keyLen === 16) return { enc: "aes-128-ecb", dec: "aes-128-ecb" };
  if (keyLen === 32) return { enc: "aes-256-ecb", dec: "aes-256-ecb" };
  throw new TuyaError(`Unexpected Tuya key length ${keyLen}`);
}

function aesEcbEncryptHex(key: Buffer, plaintext: Buffer): string {
  const { enc } = aesEcb(key.length);
  const cipher = createCipheriv(enc, key, null); // ECB: no IV
  return Buffer.concat([cipher.update(plaintext), cipher.final()]).toString("hex");
}

function aesEcbDecryptToUtf8(key: Buffer, hexCiphertext: string): string {
  const { dec } = aesEcb(key.length);
  const decipher = createDecipheriv(dec, key, null);
  return Buffer.concat([
    decipher.update(Buffer.from(hexCiphertext, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

export class TuyaClient {
  private token: { accessToken: string; expiresAt: number } | null = null;

  constructor(
    private creds: TuyaCredentials,
    private fetchImpl: FetchLike = fetch,
  ) {
    if (!REGION_HOSTS[creds.region]) {
      throw new TuyaError(`Unknown Tuya region "${creds.region}"`);
    }
  }

  private get host(): string {
    return REGION_HOSTS[this.creds.region];
  }

  private async call<T>(
    method: string,
    pathWithQuery: string,
    body?: unknown,
    withToken = true,
  ): Promise<T> {
    const t = Date.now().toString();
    const nonce = randomBytes(16).toString("hex");
    const bodyStr = body === undefined ? "" : JSON.stringify(body);
    const content = [method, sha256Hex(bodyStr), "", pathWithQuery].join("\n");
    const accessToken = withToken ? (await this.getToken()) : "";
    const toSign = this.creds.clientId + accessToken + t + nonce + content;
    const sign = createHmac("sha256", this.creds.clientSecret)
      .update(toSign, "utf8")
      .digest("hex")
      .toUpperCase();

    const headers: Record<string, string> = {
      client_id: this.creds.clientId,
      sign,
      t,
      nonce,
      sign_method: "HMAC-SHA256",
    };
    if (accessToken) headers.access_token = accessToken;

    const res = await this.fetchImpl(`${this.host}${pathWithQuery}`, {
      method,
      headers: body === undefined ? headers : { ...headers, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: bodyStr }),
    });
    const json = (await res.json().catch(() => null)) as {
      success?: boolean;
      code?: number;
      msg?: string;
      result?: T;
    } | null;
    if (!res.ok || !json || json.success === false) {
      throw new TuyaError(json?.msg || `Tuya request failed (${res.status})`, json?.code);
    }
    return json.result as T;
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) {
      return this.token.accessToken;
    }
    const result = await this.call<{ access_token: string; expire_time: number }>(
      "GET",
      "/v1.0/token?grant_type=1",
      undefined,
      false,
    );
    this.token = {
      accessToken: result.access_token,
      expiresAt: Date.now() + result.expire_time * 1000,
    };
    return this.token.accessToken;
  }

  /** Devices on the linked app account (locks have category "ms" / "jtmspro"). */
  async listDevices(): Promise<
    { id: string; name: string; category: string; online?: boolean }[]
  > {
    const res = await this.call<
      { id: string; name: string; category: string; online?: boolean }[]
    >("GET", `/v1.0/users/${encodeURIComponent(this.creds.uid)}/devices`);
    return Array.isArray(res) ? res : [];
  }

  private async passwordTicket(deviceId: string): Promise<{ ticketId: string; key: Buffer }> {
    const res = await this.call<{
      ticket_id: string;
      ticket_key: string;
      expire_time: number;
    }>("POST", `/v1.0/devices/${encodeURIComponent(deviceId)}/door-lock/password-ticket`);
    // ticket_key is AES-ECB-encrypted with the access secret; the
    // plaintext is itself a hex string -> decode to bytes for round 2.
    const keyHex = aesEcbDecryptToUtf8(Buffer.from(this.creds.clientSecret, "utf8"), res.ticket_key);
    return { ticketId: res.ticket_id, key: Buffer.from(keyHex, "hex") };
  }

  /**
   * Create a temporary PIN valid from validFrom to validUntil.
   * Wi-Fi locks take 7-digit PINs; Zigbee/Bluetooth take 6 — we default
   * to 7 and let the caller retry with 6 on Tuya's error if needed.
   * Returns the provider's password id for later revoke/modify.
   */
  async createTempPassword(params: {
    deviceId: string;
    name: string;
    pin: string;
    validFrom: Date;
    validUntil: Date;
    phone?: string;
  }): Promise<{ passwordId: string }> {
    const { ticketId, key } = await this.passwordTicket(params.deviceId);
    const encPin = aesEcbEncryptHex(key, Buffer.from(params.pin, "utf8"));
    const res = await this.call<{ id?: number | string; password_id?: number | string }>(
      "POST",
      `/v1.0/devices/${encodeURIComponent(params.deviceId)}/door-lock/temp-password`,
      {
        name: params.name,
        password: encPin,
        password_type: "ticket",
        ticket_id: ticketId,
        // Required for Zigbee locks; harmless elsewhere. 0 = reusable
        // within the validity window (1 = one-time use).
        type: 0,
        // Tuya temp-password API uses 10-digit epoch seconds.
        effective_time: Math.floor(params.validFrom.getTime() / 1000),
        invalid_time: Math.floor(params.validUntil.getTime() / 1000),
        ...(params.phone ? { phone: params.phone } : {}),
      },
    );
    const id = res.password_id ?? res.id;
    if (id == null) throw new TuyaError("Tuya returned no password id");
    return { passwordId: String(id) };
  }

  /** Read back a temp password — used to confirm the cloud actually
   *  registered it before we mark our record active. */
  async getTempPassword(deviceId: string, passwordId: string): Promise<Record<string, unknown>> {
    return this.call<Record<string, unknown>>(
      "GET",
      `/v1.0/devices/${encodeURIComponent(deviceId)}/door-lock/temp-password/${encodeURIComponent(passwordId)}`,
    );
  }

  async deleteTempPassword(deviceId: string, passwordId: string): Promise<void> {
    await this.call(
      "DELETE",
      `/v1.0/devices/${encodeURIComponent(deviceId)}/door-lock/temp-passwords/${encodeURIComponent(passwordId)}`,
    );
  }
}

/** Random numeric PIN. 7 digits for Wi-Fi locks, 6 for Zigbee/BT. */
export function generatePin(digits: 6 | 7 = 7): string {
  let out = "";
  for (let i = 0; i < digits; i++) out += randomInt(0, 10).toString();
  return out;
}
