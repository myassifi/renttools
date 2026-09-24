"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import type { Reservation } from "@/lib/types";
import { parseMoneyInput, centsToInput, formatCents, DEFAULT_CURRENCY } from "@/lib/finance";

type MoneyKey = "grossCents" | "hostFeeCents" | "cleaningFeeCents" | "payoutCents";

interface Props {
  reservation: Reservation;
  propertyName?: string;
  /** Lead guest's first name for the review-request message. */
  guestName?: string;
  onUpdate: (
    id: number,
    data: Partial<Record<MoneyKey, number | null>>,
  ) => void | Promise<{ ok: true } | { ok: false; error: string }>;
}

/**
 * Per-reservation money fields — gross / platform fee / cleaning fee /
 * payout, each auto-saving on blur through the reservation PATCH
 * channel. Empty input clears the field (null), matching how the rest
 * of the view handles optional values.
 */
export function ReservationMoney({ reservation, propertyName, guestName, onUpdate }: Props) {
  const { t: tr } = useI18n();
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [reviewCopied, setReviewCopied] = useState(false);
  const [drafts, setDrafts] = useState<Record<MoneyKey, string>>({
    grossCents: reservation.grossCents != null ? centsToInput(reservation.grossCents) : "",
    hostFeeCents: reservation.hostFeeCents != null ? centsToInput(reservation.hostFeeCents) : "",
    cleaningFeeCents: reservation.cleaningFeeCents != null ? centsToInput(reservation.cleaningFeeCents) : "",
    payoutCents: reservation.payoutCents != null ? centsToInput(reservation.payoutCents) : "",
  });
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- drafts must resync when a PATCH refetch lands; same pattern as the other draft/saved fields in reservation-view
    setDrafts({
      grossCents: reservation.grossCents != null ? centsToInput(reservation.grossCents) : "",
      hostFeeCents: reservation.hostFeeCents != null ? centsToInput(reservation.hostFeeCents) : "",
      cleaningFeeCents: reservation.cleaningFeeCents != null ? centsToInput(reservation.cleaningFeeCents) : "",
      payoutCents: reservation.payoutCents != null ? centsToInput(reservation.payoutCents) : "",
    });
  }, [
    reservation.grossCents,
    reservation.hostFeeCents,
    reservation.cleaningFeeCents,
    reservation.payoutCents,
  ]);

  const save = async (key: MoneyKey) => {
    const raw = drafts[key].trim();
    const cents = raw === "" ? null : parseMoneyInput(raw);
    if (raw !== "" && cents === null) {
      setState("error");
      return;
    }
    if (cents === reservation[key]) return;
    setState("saving");
    const result = await Promise.resolve(onUpdate(reservation.id, { [key]: cents }));
    if (result && typeof result === "object" && "ok" in result && !result.ok) {
      setState("error");
      return;
    }
    setState("saved");
    setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 1500);
  };

  const fields: { key: MoneyKey; label: string }[] = [
    { key: "grossCents", label: tr("reservation.gross") },
    { key: "hostFeeCents", label: tr("reservation.hostFee") },
    { key: "cleaningFeeCents", label: tr("reservation.cleaningFee") },
    { key: "payoutCents", label: tr("reservation.payout") },
  ];

  const payout = reservation.payoutCents ?? reservation.grossCents;

  // Review-request message — localized, personalised with the lead
  // guest's first name and the property. Copied to clipboard or sent
  // straight to WhatsApp when the reservation has a phone.
  const reviewMessage = tr("reservation.reviewRequest", {
    name: guestName || reservation.name,
    property: propertyName || "",
  });
  const waDigits = (reservation.phone ?? "").replace(/^\+/, "");
  const waEnabled = /^\d{7,15}$/.test(waDigits);

  const copyReview = async () => {
    try {
      await navigator.clipboard.writeText(reviewMessage);
      setReviewCopied(true);
      setTimeout(() => setReviewCopied(false), 1500);
    } catch {
      /* clipboard unavailable — leave button state unchanged */
    }
  };

  return (
    <div className="rounded-xl border border-border/60 bg-card/40 px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{tr("reservation.money")}</p>
        <span className="text-[11px] text-muted-foreground">
          {state === "saving"
            ? tr("reservation.saving")
            : state === "saved"
              ? tr("reservation.moneySaved")
              : state === "error"
                ? tr("reservation.moneyInvalid")
                : currency}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {fields.map((f) => (
          <label key={f.key} className="text-[11px] text-muted-foreground">
            {f.label}
            <input
              inputMode="decimal"
              value={drafts[f.key]}
              placeholder="0.00"
              onChange={(e) => {
                setDrafts((d) => ({ ...d, [f.key]: e.target.value }));
                setState("idle");
              }}
              onBlur={() => save(f.key)}
              className="mt-0.5 h-9 w-full rounded-md border border-border/60 bg-background px-2 text-sm text-foreground"
            />
          </label>
        ))}
      </div>
      {payout != null && (
        <p className="mt-2 text-xs text-muted-foreground">
          {tr("reservation.payoutSummary")}{" "}
          <span className="font-semibold text-foreground">
            {formatCents(payout, currency)}
          </span>
        </p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <a
          href={`/api/reservations/${reservation.id}/receipt`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-7 items-center rounded-md border border-border/60 bg-background px-2.5 text-[11px] font-medium text-foreground hover:bg-muted"
        >
          {tr("reservation.receipt")}
        </a>
        <button
          type="button"
          onClick={copyReview}
          className="inline-flex h-7 items-center rounded-md border border-border/60 bg-background px-2.5 text-[11px] font-medium text-foreground hover:bg-muted"
        >
          {reviewCopied ? tr("common.copied") : tr("reservation.copyReview")}
        </button>
        {waEnabled && (
          <>
            <a
              href={`https://wa.me/${waDigits}?text=${encodeURIComponent(reviewMessage)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-7 items-center rounded-md bg-emerald-600/90 px-2.5 text-[11px] font-medium text-white hover:bg-emerald-600"
            >
              WhatsApp
            </a>
            <a
              href={`sms:${reservation.phone}?&body=${encodeURIComponent(reviewMessage)}`}
              className="inline-flex h-7 items-center rounded-md border border-border/60 bg-background px-2.5 text-[11px] font-medium text-foreground hover:bg-muted"
            >
              SMS
            </a>
          </>
        )}
      </div>
    </div>
  );
}
