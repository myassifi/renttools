"use client";

// "Door access" card on the reservation detail page — generates a
// time-limited PIN on the property's Tuya smart lock, valid for the
// stay window (check-in time → check-out time). Renders nothing when
// the property has no lock bound, so non-lock hosts never see it.

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/context";

interface DoorCode {
  pin: string;
  name: string;
  validFrom: string;
  validUntil: string;
  status: string;
}

export function ReservationAccess({
  reservationId,
  hasLock,
  lockName,
  onCodeChange,
}: {
  reservationId: number;
  hasLock: boolean;
  lockName?: string | null;
  onCodeChange?: (pin: string | null) => void;
}) {
  const { t } = useI18n();
  const [code, setCode] = useState<DoorCode | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/reservations/${reservationId}/access-code`);
      if (res.ok) {
        const data = await res.json();
        setCode(data.code);
        onCodeChange?.(data.code?.pin ?? null);
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservationId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    if (hasLock) load();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLock]);

  if (!hasLock) return null;

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/reservations/${reservationId}/access-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || t("access.generateFailed"));
        return;
      }
      const next: DoorCode = {
        pin: data.pin,
        name: "",
        validFrom: data.validFrom,
        validUntil: data.validUntil,
        status: data.status,
      };
      setCode(next);
      onCodeChange?.(next.pin);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/reservations/${reservationId}/access-code`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || t("access.revokeFailed"));
        return;
      }
      setCode(null);
      onCodeChange?.(null);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!code) return;
    await navigator.clipboard.writeText(code.pin).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 space-y-3">
      <h2 className="text-sm font-semibold text-[var(--ink)]">
        {t("access.title")}
      </h2>

      {loading ? (
        <p className="text-xs text-[var(--ink-4)]">{t("access.loading")}</p>
      ) : code ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={copy}
            title={t("access.copy")}
            className="flex w-full items-center justify-center rounded-lg border border-dashed border-[var(--line)] bg-[var(--bg)] px-3 py-2.5 font-mono text-2xl font-bold tracking-[0.3em] text-[var(--ink)]"
          >
            {code.pin}
          </button>
          <p className="text-center text-[11px] text-[var(--ink-4)]">
            {copied ? t("access.copied") : t("access.copyHint")}
          </p>
          <p className="text-xs text-[var(--ink-3)]">
            {t("access.valid")}: {fmt(code.validFrom)} → {fmt(code.validUntil)}
          </p>
          {lockName && (
            <p className="text-xs text-[var(--ink-4)]">{lockName}</p>
          )}
          <button
            type="button"
            onClick={revoke}
            disabled={busy}
            className="w-full rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            {busy ? t("access.working") : t("access.revoke")}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-[var(--ink-3)]">{t("access.none")}</p>
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            className="w-full rounded-lg bg-[var(--ink)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? t("access.working") : t("access.generate")}
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </section>
  );
}
