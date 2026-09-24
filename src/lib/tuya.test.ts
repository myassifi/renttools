import { describe, it, expect, vi } from "vitest";
import { createCipheriv, createDecipheriv, createHmac } from "node:crypto";
import { TuyaClient, generatePin, TuyaError } from "./tuya";

const SECRET = "0123456789abcdef0123456789abcdef"; // 32 bytes -> AES-256-ECB
const CREDS = { region: "eu", clientId: "cid", clientSecret: SECRET, uid: "uid1" };

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Fetch stub: token call succeeds, other paths answered per-path. */
function mockFetch(map: Record<string, (init: RequestInit) => unknown>) {
  return vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname + new URL(url).search;
    if (path.startsWith("/v1.0/token")) {
      return jsonRes({ success: true, result: { access_token: "tok", expire_time: 7200 } });
    }
    const handler = Object.entries(map).find(([p]) => path.startsWith(p));
    if (!handler) return jsonRes({ success: false, code: 999, msg: "unmocked " + path });
    return jsonRes(handler[1](init));
  });
}

describe("TuyaClient signing", () => {
  it("sends a valid HMAC-SHA256 sign header", async () => {
    const f = mockFetch({
      "/v1.0/users/uid1/devices": () => ({ success: true, result: [] }),
    });
    const client = new TuyaClient(CREDS, f as unknown as typeof fetch);
    await client.listDevices();

    const init = f.mock.calls[1][1] as RequestInit;
    const h = init.headers as Record<string, string>;
    expect(h.client_id).toBe("cid");
    expect(h.sign_method).toBe("HMAC-SHA256");
    expect(h.access_token).toBe("tok");

    const content = ["GET", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "", "/v1.0/users/uid1/devices"].join("\n");
    const toSign = "cid" + "tok" + h.t + h.nonce + content;
    const expected = createHmac("sha256", SECRET).update(toSign, "utf8").digest("hex").toUpperCase();
    expect(h.sign).toBe(expected);
  });

  it("rejects unknown regions", () => {
    expect(() => new TuyaClient({ ...CREDS, region: "mars" })).toThrow(TuyaError);
  });

  it("surfaces Tuya error codes", async () => {
    const f = mockFetch({
      "/v1.0/users": () => ({ success: false, code: 1008, msg: "permission denied" }),
    });
    const client = new TuyaClient(CREDS, f as unknown as typeof fetch);
    await expect(client.listDevices()).rejects.toMatchObject({ code: 1008 });
  });
});

describe("temp-password flow", () => {
  // ticket_key the way Tuya returns it: hex AES-ECB(secret, ticketKeyHex)
  const ticketKeyHex = "aabbccddeeff00112233445566778899";
  const ticketKeyEnc = (() => {
    const c = createCipheriv("aes-256-ecb", Buffer.from(SECRET, "utf8"), null);
    return Buffer.concat([c.update(Buffer.from(ticketKeyHex, "utf8")), c.final()]).toString("hex");
  })();

  it("creates a temp password with AES-encrypted PIN and epoch-second window", async () => {
    const calls: { path: string; body?: unknown }[] = [];
    const f = mockFetch({
      "/v1.0/devices/dev1/door-lock/password-ticket": () => {
        calls.push({ path: "ticket" });
        return { success: true, result: { ticket_id: "T1", ticket_key: ticketKeyEnc, expire_time: 600 } };
      },
      "/v1.0/devices/dev1/door-lock/temp-password": (init) => {
        calls.push({ path: "create", body: JSON.parse(String(init.body)) });
        return { success: true, result: { id: 555 } };
      },
    });
    const client = new TuyaClient(CREDS, f as unknown as typeof fetch);
    const from = new Date("2026-08-25T14:00:00Z");
    const until = new Date("2026-09-01T12:00:00Z");
    const out = await client.createTempPassword({ deviceId: "dev1", name: "RT-1", pin: "1234567", validFrom: from, validUntil: until });
    expect(out.passwordId).toBe("555");

    const body = calls[1].body as Record<string, unknown>;
    expect(body.ticket_id).toBe("T1");
    expect(body.password_type).toBe("ticket");
    expect(body.type).toBe(0);
    expect(body.effective_time).toBe(Math.floor(from.getTime() / 1000));
    expect(body.invalid_time).toBe(Math.floor(until.getTime() / 1000));
    // decrypt the posted PIN with the ticket key to verify round-trip
    const d = createDecipheriv("aes-128-ecb", Buffer.from(ticketKeyHex, "hex"), null);
    const pin = Buffer.concat([d.update(Buffer.from(String(body.password), "hex")), d.final()]).toString("utf8");
    expect(pin).toBe("1234567");
  });

  it("reads back a temp password for verification", async () => {
    const f = mockFetch({
      "/v1.0/devices/dev1/door-lock/temp-password/555": () => ({
        success: true,
        result: { id: 555, name: "RT-1", phase: 1 },
      }),
    });
    const client = new TuyaClient(CREDS, f as unknown as typeof fetch);
    const rec = await client.getTempPassword("dev1", "555");
    expect(rec.id).toBe(555);
  });

  it("deletes a temp password", async () => {
    let deleted = "";
    const f = mockFetch({
      "/v1.0/devices/dev1/door-lock/temp-passwords/": (init) => {
        deleted = (init as { method?: string }).method ?? "";
        return { success: true, result: true };
      },
    });
    const client = new TuyaClient(CREDS, f as unknown as typeof fetch);
    await client.deleteTempPassword("dev1", "555");
    expect(deleted).toBe("DELETE");
  });
});

describe("generatePin", () => {
  it("makes 7- and 6-digit numeric PINs", () => {
    expect(generatePin(7)).toMatch(/^\d{7}$/);
    expect(generatePin(6)).toMatch(/^\d{6}$/);
    expect(generatePin()).toMatch(/^\d{7}$/);
  });
});
