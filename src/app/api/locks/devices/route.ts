import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { loadLockCredential } from "@/lib/locks";
import { TuyaError } from "@/lib/tuya";

export const dynamic = "force-dynamic";

/** Devices on the host's linked Tuya app account, for the property's
 *  lock-picker. Locks surface first (category "ms"/"jtmspro"). */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (session.role === "cleaner") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const loaded = await loadLockCredential(session.userId);
    if (!loaded) {
      return NextResponse.json({ configured: false, devices: [] });
    }

    const devices = await loaded.client.listDevices();
    // Tuya lock categories: "ms" (BLE/Wi-Fi lock), "mspro" (pro locks
    // like the K1-Pro Max), "jtmspro" (hotel lock), "dl" (door lock).
    const isLock = (c: string) => c === "ms" || c === "mspro" || c === "jtmspro" || c === "dl";
    const sorted = [...devices].sort(
      (a, b) => Number(isLock(b.category)) - Number(isLock(a.category)),
    );
    return NextResponse.json({
      configured: true,
      devices: sorted.map((d) => ({
        id: d.id,
        name: d.name,
        category: d.category,
        online: d.online ?? null,
        isLock: isLock(d.category),
      })),
    });
  } catch (err) {
    if (err instanceof TuyaError) {
      return NextResponse.json({ error: `Tuya: ${err.message}` }, { status: 502 });
    }
    console.error("Route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
