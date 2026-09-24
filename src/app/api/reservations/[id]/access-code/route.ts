import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { canManageProperty } from "@/lib/ownership";
import { loadLockCredential } from "@/lib/locks";
import { generatePin, TuyaError } from "@/lib/tuya";
import { encryptGuestData, decryptGuestData } from "@/lib/precheckin-crypto";

export const dynamic = "force-dynamic";

/**
 * Validity window = check-in day at property.checkInTime through
 * check-out day at property.checkOutTime, interpreted in the server's
 * local timezone (host and property are assumed co-located — the
 * schema has no per-property timezone yet).
 */
function stayWindow(
  checkIn: Date,
  checkOut: Date,
  checkInTime: string,
  checkOutTime: string,
): { from: Date; until: Date } {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const mk = (dayStr: string, hm: string) => {
    const [y, m, dd] = dayStr.split("-").map(Number);
    const [hh, mm] = (hm || "14:00").split(":").map(Number);
    return new Date(y, m - 1, dd, hh || 0, mm || 0, 0, 0);
  };
  return {
    from: mk(day(checkIn), checkInTime),
    until: mk(day(checkOut), checkOutTime),
  };
}

async function loadReservationContext(reservationId: number, userId: number, role: string) {
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      property: {
        select: {
          id: true,
          name: true,
          userId: true,
          checkInTime: true,
          checkOutTime: true,
          lockDeviceId: true,
        },
      },
      accessCode: true,
    },
  });
  if (!reservation) return null;
  if (!(await canManageProperty(reservation.propertyId, userId, role))) return null;
  return reservation;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const numId = parseInt(id);
    if (isNaN(numId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

    const reservation = await loadReservationContext(numId, session.userId, session.role);
    if (!reservation) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const code = reservation.accessCode;
    if (!code) {
      return NextResponse.json({
        hasLock: !!reservation.property.lockDeviceId,
        code: null,
      });
    }
    return NextResponse.json({
      hasLock: !!reservation.property.lockDeviceId,
      code: {
        pin: decryptGuestData<string>(code.codeEnc),
        name: code.name,
        validFrom: code.validFrom,
        validUntil: code.validUntil,
        status: code.status,
      },
    });
  } catch (err) {
    console.error("Route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const numId = parseInt(id);
    if (isNaN(numId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

    const reservation = await loadReservationContext(numId, session.userId, session.role);
    if (!reservation) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const deviceId = reservation.property.lockDeviceId;
    if (!deviceId) {
      return NextResponse.json(
        { error: "No smart lock is linked to this property" },
        { status: 409 },
      );
    }
    if (reservation.accessCode && reservation.accessCode.status === "active") {
      return NextResponse.json({ error: "A door code already exists" }, { status: 409 });
    }

    const loaded = await loadLockCredential(reservation.property.userId);
    if (!loaded) {
      return NextResponse.json(
        { error: "Smart lock account is not connected" },
        { status: 409 },
      );
    }

    // Optional caller-chosen PIN; default to generated. Wi-Fi locks take
    // 7 digits, Zigbee/Bluetooth 6 — we try 7, then fall back to 6 once.
    const body = await request.json().catch(() => ({}));
    const requestedPin = typeof body?.pin === "string" ? body.pin : null;
    if (requestedPin !== null && !/^\d{6,7}$/.test(requestedPin)) {
      return NextResponse.json({ error: "PIN must be 6–7 digits" }, { status: 400 });
    }

    const { from, until } = stayWindow(
      new Date(reservation.checkIn),
      new Date(reservation.checkOut),
      reservation.property.checkInTime,
      reservation.property.checkOutTime,
    );
    const name = `RT-${numId} ${reservation.name}`.slice(0, 50);

    const create = async (pin: string) => {
      const { passwordId } = await loaded.client.createTempPassword({
        deviceId, name, pin, validFrom: from, validUntil: until,
      });
      // Read-back: a successful create only proves the cloud accepted
      // the request — verify the record exists before marking active.
      const check = await loaded.client.getTempPassword(deviceId, passwordId);
      if (!check || Object.keys(check).length === 0) {
        throw new TuyaError("Tuya accepted the code but did not register it");
      }
      return passwordId;
    };

    const pin = requestedPin ?? generatePin(7);
    let remoteId: string;
    try {
      remoteId = await create(pin);
    } catch (err) {
      if (!(err instanceof TuyaError) || requestedPin !== null) throw err;
      const retry = generatePin(6);
      remoteId = await create(retry);
      await persist(numId, reservation.propertyId, remoteId, retry, name, from, until);
      await logAudit(session.userId, "create", "accessCode", numId, { propertyId: reservation.propertyId });
      return NextResponse.json({ pin: retry, validFrom: from, validUntil: until, status: "active" });
    }

    await persist(numId, reservation.propertyId, remoteId, pin, name, from, until);
    await logAudit(session.userId, "create", "accessCode", numId, { propertyId: reservation.propertyId });
    return NextResponse.json({ pin, validFrom: from, validUntil: until, status: "active" });
  } catch (err) {
    if (err instanceof TuyaError) {
      return NextResponse.json({ error: `Tuya: ${err.message}` }, { status: 502 });
    }
    console.error("Route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function persist(
  reservationId: number,
  propertyId: number,
  remoteId: string,
  pin: string,
  name: string,
  from: Date,
  until: Date,
) {
  await prisma.accessCode.upsert({
    where: { reservationId },
    create: {
      reservationId,
      propertyId,
      remotePasswordId: remoteId,
      codeEnc: encryptGuestData(pin),
      name,
      validFrom: from,
      validUntil: until,
      status: "active",
    },
    update: {
      remotePasswordId: remoteId,
      codeEnc: encryptGuestData(pin),
      name,
      validFrom: from,
      validUntil: until,
      status: "active",
      updatedAt: new Date(),
    },
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const numId = parseInt(id);
    if (isNaN(numId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

    const reservation = await loadReservationContext(numId, session.userId, session.role);
    if (!reservation) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const code = reservation.accessCode;
    if (!code) return NextResponse.json({ error: "No door code" }, { status: 404 });

    // Best-effort remote revoke — a provider outage must not trap the
    // host; the row is marked revoked either way so the PIN stops
    // being shown in messages and the guest form.
    const deviceId = reservation.property.lockDeviceId;
    if (deviceId && code.remotePasswordId) {
      try {
        const loaded = await loadLockCredential(reservation.property.userId);
        if (loaded) {
          await loaded.client.deleteTempPassword(deviceId, code.remotePasswordId);
        }
      } catch (err) {
        console.error("Remote revoke failed:", err);
      }
    }

    await prisma.accessCode.update({
      where: { id: code.id },
      data: { status: "revoked", updatedAt: new Date() },
    });
    await logAudit(session.userId, "delete", "accessCode", code.id, { reservationId: numId });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
