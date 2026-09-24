import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { encryptClientSecret } from "@/lib/locks";
import { guestDataEncryptionReady } from "@/lib/precheckin-crypto";

export const dynamic = "force-dynamic";

const REGIONS = new Set(["eu", "us", "cn", "in", "we"]);

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const row = await prisma.lockCredential.findUnique({
      where: { userId: session.userId },
      select: { provider: true, region: true, clientId: true, uid: true },
    });
    return NextResponse.json({
      configured: !!row,
      provider: row?.provider ?? "tuya",
      region: row?.region ?? null,
      clientId: row?.clientId ?? null,
      uid: row?.uid ?? null,
      encryptionReady: guestDataEncryptionReady(),
    });
  } catch (err) {
    console.error("Route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!guestDataEncryptionReady()) {
      return NextResponse.json(
        { error: "Server encryption key is not configured" },
        { status: 503 },
      );
    }

    const body = await request.json();
    const { region, clientId, clientSecret, uid } = body ?? {};
    if (
      typeof region !== "string" ||
      !REGIONS.has(region) ||
      typeof clientId !== "string" ||
      !clientId.trim() ||
      typeof clientSecret !== "string" ||
      !clientSecret.trim() ||
      typeof uid !== "string" ||
      !uid.trim()
    ) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 400 });
    }

    const row = await prisma.lockCredential.upsert({
      where: { userId: session.userId },
      create: {
        userId: session.userId,
        provider: "tuya",
        region,
        clientId: clientId.trim(),
        clientSecretEnc: encryptClientSecret(clientSecret.trim()),
        uid: uid.trim(),
      },
      update: {
        region,
        clientId: clientId.trim(),
        clientSecretEnc: encryptClientSecret(clientSecret.trim()),
        uid: uid.trim(),
        updatedAt: new Date(),
      },
    });
    await logAudit(session.userId, "update", "lockCredential", row.id, { region });
    return NextResponse.json({ configured: true, region, clientId: row.clientId, uid: row.uid });
  } catch (err) {
    console.error("Route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const row = await prisma.lockCredential.findUnique({ where: { userId: session.userId } });
    if (row) {
      await prisma.lockCredential.delete({ where: { id: row.id } });
      await logAudit(session.userId, "delete", "lockCredential", row.id);
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
