"use client";

// Smart-lock section in Sync settings: connect a Tuya Cloud account
// (credentials saved server-side, secret encrypted) and bind one of
// the account's lock devices to this property. Reservations can then
// generate stay-window PINs from the "Door access" card.

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/context";

interface LockDevice {
  id: string;
  name: string;
  category: string;
  online: boolean | null;
  isLock: boolean;
}

export function LockSettings({
  propertyId,
  lockDeviceId,
  lockDeviceName,
  onUpdateProperty,
}: {
  propertyId: number;
  lockDeviceId?: string | null;
  lockDeviceName?: string | null;
  onUpdateProperty: (id: number, data: { lockDeviceId?: string | null; lockDeviceName?: string | null }) => void;
}) {
  const { t } = useI18n();
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [region, setRegion] = useState("eu");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [uid, setUid] = useState("");
  const [savedClientId, setSavedClientId] = useState<string | null>(null);
  const [devices, setDevices] = useState<LockDevice[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/locks/credentials")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setConfigured(!!d.configured);
        if (d.region) setRegion(d.region);
        if (d.clientId) setSavedClientId(d.clientId);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/locks/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ region, clientId, clientSecret, uid }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Failed");
        return;
      }
      setConfigured(true);
      setSavedClientId(data.clientId);
      setClientSecret("");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await fetch("/api/locks/credentials", { method: "DELETE" });
      setConfigured(false);
      setDevices(null);
      setSavedClientId(null);
    } finally {
      setBusy(false);
    }
  };

  const loadDevices = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/locks/devices");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Failed");
        return;
      }
      setDevices(data.devices ?? []);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-prop-change
    if (configured && devices === null) loadDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured]);

  if (loading) return null;

  const inputCls =
    "w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-1.5 text-sm text-[var(--ink)]";

  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 space-y-3">
      <h2 className="text-sm font-semibold text-[var(--ink)]">{t("lock.title")}</h2>
      <p className="text-xs text-[var(--ink-4)]">{t("lock.help")}</p>

      {lockDeviceId && (
        <p className="text-xs text-[var(--ink-3)]">
          {t("lock.bound")}: <span className="font-medium text-[var(--ink)]">{lockDeviceName || lockDeviceId}</span>{" "}
          <button
            type="button"
            onClick={() => onUpdateProperty(propertyId, { lockDeviceId: null, lockDeviceName: null })}
            className="text-red-600 hover:underline"
          >
            {t("lock.unbind")}
          </button>
        </p>
      )}

      {!configured ? (
        <div className="space-y-2">
          <select value={region} onChange={(e) => setRegion(e.target.value)} className={inputCls}>
            <option value="eu">Europe</option>
            <option value="us">US (West)</option>
            <option value="cn">China</option>
            <option value="in">India</option>
            <option value="we">US (East)</option>
          </select>
          <input className={inputCls} placeholder={t("lock.clientId")} value={clientId} onChange={(e) => setClientId(e.target.value)} />
          <input className={inputCls} type="password" placeholder={t("lock.clientSecret")} value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
          <input className={inputCls} placeholder={t("lock.uid")} value={uid} onChange={(e) => setUid(e.target.value)} />
          <button
            type="button"
            onClick={connect}
            disabled={busy || !clientId.trim() || !clientSecret.trim() || !uid.trim()}
            className="w-full rounded-lg bg-[var(--ink)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {t("lock.connect")}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-[var(--ink-3)]">
            {t("lock.connected")}: <span className="font-mono">{savedClientId}</span>{" "}
            <button type="button" onClick={disconnect} disabled={busy} className="text-red-600 hover:underline">
              {t("lock.disconnect")}
            </button>
          </p>

          {devices === null ? (
            <button
              type="button"
              onClick={loadDevices}
              disabled={busy}
              className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] hover:bg-[var(--bg)] disabled:opacity-50"
            >
              {t("lock.loadDevices")}
            </button>
          ) : devices.length === 0 ? (
            <p className="text-xs text-[var(--ink-4)]">{t("lock.noDevices")}</p>
          ) : (
            <ul className="space-y-1">
              {devices.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-[var(--ink)]">
                    {d.name}
                    <span className="ml-1 text-[var(--ink-4)]">
                      {d.category}
                      {d.online === false ? " · offline" : ""}
                    </span>
                  </span>
                  {d.id === lockDeviceId ? null : (
                    <button
                      type="button"
                      onClick={() => onUpdateProperty(propertyId, { lockDeviceId: d.id, lockDeviceName: d.name })}
                      className="shrink-0 rounded-md border border-[var(--line)] px-2 py-0.5 font-medium text-[var(--ink-3)] hover:bg-[var(--bg)]"
                    >
                      {t("lock.bind")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
