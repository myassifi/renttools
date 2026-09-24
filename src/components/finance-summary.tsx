"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import type { Property, Expense } from "@/lib/types";
import { aggregateFinance, formatCents, monthKey, DEFAULT_CURRENCY } from "@/lib/finance";

interface Props {
  /** Properties in scope — all of them in portfolio mode, the single
   *  selected one in per-property mode. */
  properties: Property[];
  /** When set, the "details" link scopes Reports to this property. */
  propertyId?: number | null;
}

/**
 * Slim finance strip for the dashboard: this month's payout, expenses
 * and net, plus next month's pipeline. Hidden entirely when the account
 * has no money data yet (no priced reservations, no expenses) so a
 * fresh install isn't nagged with a row of €0.00.
 */
export function FinanceSummary({ properties, propertyId }: Props) {
  const { t, locale } = useI18n();
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [fetched, setFetched] = useState(false);

  const idsKey = properties.map((p) => p.id).sort((a, b) => a - b).join(",");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const cur = d?.user?.currency;
        if (typeof cur === "string" && cur) setCurrency(cur);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const url = propertyId ? `/api/expenses?propertyId=${propertyId}` : "/api/expenses";
    fetch(url)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        setExpenses(Array.isArray(rows) ? rows : []);
        setFetched(true);
      })
      .catch(() => setFetched(true));
  }, [propertyId, idsKey]);

  const months = useMemo(() => {
    const stays = properties.flatMap((p) =>
      (p.reservations ?? [])
        .filter(
          (r) =>
            r.grossCents != null ||
            r.payoutCents != null ||
            r.hostFeeCents != null ||
            r.cleaningFeeCents != null,
        )
        .map((r) => ({
          checkIn: r.checkIn,
          propertyId: p.id,
          grossCents: r.grossCents,
          hostFeeCents: r.hostFeeCents,
          cleaningFeeCents: r.cleaningFeeCents,
          payoutCents: r.payoutCents,
        })),
    );
    const propIds = new Set(properties.map((p) => p.id));
    return aggregateFinance(
      stays,
      expenses.filter((e) => propIds.has(e.propertyId)),
    );
  }, [properties, expenses]);

  const now = new Date();
  const thisKey = monthKey(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`,
  );
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextKey = monthKey(
    `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`,
  );

  const cur = months.get(thisKey);
  const upcoming = months.get(nextKey);
  const hasData =
    fetched && (expenses.length > 0 || months.size > 0);

  if (!hasData) return null;

  const fmt = (cents: number) => formatCents(cents, currency, locale);
  const monthName = now.toLocaleDateString(locale, { month: "long" });

  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-2)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-3)]">
          {t("finance.thisMonth")}
          <span className="ml-1.5 font-normal normal-case text-[var(--ink-4)]">{monthName}</span>
        </h2>
        <Link
          href={propertyId ? `/dashboard?property=${propertyId}&view=reports` : "/dashboard?view=reports"}
          className="text-[11px] font-medium text-[var(--m-accent)] hover:underline"
        >
          {t("finance.viewReports")}
        </Link>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
        <span className="text-[var(--ink-3)]">
          {t("finance.payout")}{" "}
          <span className="font-semibold tabular-nums text-[var(--ink)]">
            {fmt(cur?.payoutCents ?? 0)}
          </span>
        </span>
        <span className="text-[var(--ink-3)]">
          {t("finance.expenses")}{" "}
          <span className="font-semibold tabular-nums text-rose-500">
            {fmt(cur?.expenseCents ?? 0)}
          </span>
        </span>
        <span className="text-[var(--ink-3)]">
          {t("finance.net")}{" "}
          <span
            className={`font-semibold tabular-nums ${
              (cur?.netCents ?? 0) >= 0 ? "text-emerald-600" : "text-rose-500"
            }`}
          >
            {fmt(cur?.netCents ?? 0)}
          </span>
        </span>
        {upcoming && upcoming.payoutCents > 0 && (
          <span className="text-[var(--ink-4)]">
            {t("finance.nextMonth")}{" "}
            <span className="tabular-nums">{fmt(upcoming.payoutCents)}</span>
          </span>
        )}
      </div>
    </div>
  );
}
