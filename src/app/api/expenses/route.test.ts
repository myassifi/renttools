import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  canManageProperty: vi.fn(),
  listAccessiblePropertyIds: vi.fn(),
  logAudit: vi.fn(),
  expenseFindMany: vi.fn(),
  expenseCreate: vi.fn(),
  reservationFindFirst: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/ownership", () => ({
  canManageProperty: mocks.canManageProperty,
  listAccessiblePropertyIds: mocks.listAccessiblePropertyIds,
}));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.logAudit }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    expense: {
      findMany: mocks.expenseFindMany,
      create: mocks.expenseCreate,
    },
    reservation: { findFirst: mocks.reservationFindFirst },
    $transaction: mocks.transaction,
  },
}));

import { GET, POST } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSession.mockResolvedValue({ userId: 3, role: "user" });
  mocks.canManageProperty.mockResolvedValue(true);
  mocks.listAccessiblePropertyIds.mockResolvedValue([12, 13]);
  mocks.expenseFindMany.mockResolvedValue([]);
  mocks.expenseCreate.mockImplementation(async ({ data }) => ({ id: 1, ...data }));
  mocks.transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
  mocks.reservationFindFirst.mockResolvedValue({ id: 5 });
  mocks.logAudit.mockResolvedValue(undefined);
});

describe("GET /api/expenses", () => {
  it("scopes to accessible properties", async () => {
    await GET(new NextRequest("http://localhost/api/expenses"));
    expect(mocks.expenseFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ propertyId: { in: [12, 13] } }),
      }),
    );
  });

  it("applies property + date filters", async () => {
    await GET(
      new NextRequest(
        "http://localhost/api/expenses?propertyId=12&from=2026-01-01&to=2026-01-31",
      ),
    );
    const call = mocks.expenseFindMany.mock.calls[0][0];
    expect(call.where.propertyId).toBe(12);
    expect(call.where.date).toEqual({ gte: "2026-01-01", lte: "2026-01-31" });
  });

  it("rejects a bad propertyId", async () => {
    const res = await GET(new NextRequest("http://localhost/api/expenses?propertyId=abc"));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/expenses", () => {
  const body = {
    propertyId: 12,
    date: "2026-08-15",
    category: "cleaning",
    amountCents: 4500,
    note: "Deep clean",
  };
  const req = (overrides: Record<string, unknown> = {}) =>
    new NextRequest("http://localhost/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, ...overrides }),
    });

  it("creates a single expense", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    const data = await res.json();
    expect(data.amountCents).toBe(4500);
    expect(data.recurGroup).toBeNull();
  });

  it("materializes a recurring series with a shared recurGroup", async () => {
    const res = await POST(req({ repeatMonths: 3 }));
    const rows = await res.json();
    expect(rows).toHaveLength(3);
    expect(rows.map((r: { date: string }) => r.date)).toEqual([
      "2026-08-15",
      "2026-09-15",
      "2026-10-15",
    ]);
    expect(new Set(rows.map((r: { recurGroup: string }) => r.recurGroup)).size).toBe(1);
  });

  it("clamps recurring dates to short months", async () => {
    const res = await POST(req({ date: "2026-01-31", repeatMonths: 2 }));
    const rows = await res.json();
    expect(rows.map((r: { date: string }) => r.date)).toEqual([
      "2026-01-31",
      "2026-02-28",
    ]);
  });

  it("rejects invalid input", async () => {
    for (const bad of [
      { category: "not-a-category" },
      { amountCents: 0 },
      { amountCents: -5 },
      { amountCents: 12.5 },
      { date: "15/08/2026" },
      { propertyId: 0 },
      { repeatMonths: 200 },
    ]) {
      const res = await POST(req(bad));
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("404s when the property is not manageable", async () => {
    mocks.canManageProperty.mockResolvedValue(false);
    const res = await POST(req());
    expect(res.status).toBe(404);
  });

  it("404s when the linked reservation is on another property", async () => {
    mocks.reservationFindFirst.mockResolvedValue(null);
    const res = await POST(req({ reservationId: 99 }));
    expect(res.status).toBe(404);
  });
});
