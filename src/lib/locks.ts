// Lock-provider plumbing: load a user's stored credentials and hand
// back a ready client. Provider abstraction stays thin for now —
// "tuya" is the only implementation, but AccessCode rows record the
// provider so a Seam/Nuki adapter can slot in without a data migration.

import { prisma } from "@/lib/prisma";
import { TuyaClient, type TuyaCredentials } from "@/lib/tuya";
import { decryptGuestData, encryptGuestData } from "@/lib/precheckin-crypto";

export interface StoredLockCredential {
  id: number;
  provider: string;
  region: string;
  clientId: string;
  uid: string;
}

export async function loadLockCredential(
  userId: number,
): Promise<{ row: StoredLockCredential; client: TuyaClient } | null> {
  const row = await prisma.lockCredential.findUnique({ where: { userId } });
  if (!row) return null;
  const clientSecret = decryptGuestData<string>(row.clientSecretEnc);
  const creds: TuyaCredentials = {
    region: row.region,
    clientId: row.clientId,
    clientSecret,
    uid: row.uid,
  };
  return {
    row: {
      id: row.id,
      provider: row.provider,
      region: row.region,
      clientId: row.clientId,
      uid: row.uid,
    },
    client: new TuyaClient(creds),
  };
}

export function encryptClientSecret(secret: string): string {
  return encryptGuestData(secret);
}
