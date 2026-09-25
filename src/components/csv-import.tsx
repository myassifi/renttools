"use client";

import { useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/translations";
import type { Property } from "@/lib/types";

interface CopyShape {
  title: string;
  subtitle: string;
  chooseFile: string;
  reading: string;
  mapHint: string;
  property: string;
  skip: string;
  importCta: (n: number) => string;
  importing: string;
  result: (created: number, updated: number, skipped: number, coHost: number) => string;
  rowsFound: (n: number, currencies: string) => string;
  error: string;
  reset: string;
}

const COPY: Record<Locale, CopyShape> = {
  en: {
    title: "Import Airbnb CSV",
    subtitle: "Transaction history export (Hosting → Earnings → Download CSV). Fills in prices on existing bookings and adds missing ones.",
    chooseFile: "Choose CSV file",
    reading: "Reading…",
    mapHint: "Match each Airbnb listing to a property:",
    property: "Property",
    skip: "Skip",
    importCta: (n) => `Import ${n} reservation${n === 1 ? "" : "s"}`,
    importing: "Importing…",
    result: (c, u, s, ch) => `Done: ${c} added, ${u} updated${s ? `, ${s} skipped` : ""}${ch ? `, ${ch} co-host cleaning expenses` : ""}.`,
    rowsFound: (n, cur) => `${n} reservation rows · currency: ${cur}`,
    error: "Import failed — is this the Airbnb transaction-history CSV?",
    reset: "Import another file",
  },
  fr: {
    title: "Importer un CSV Airbnb",
    subtitle: "Export « Historique des transactions » (Hôte → Revenus → Télécharger le CSV). Renseigne les prix des réservations existantes et ajoute les manquantes.",
    chooseFile: "Choisir le fichier CSV",
    reading: "Lecture…",
    mapHint: "Associez chaque annonce Airbnb à un logement :",
    property: "Logement",
    skip: "Ignorer",
    importCta: (n) => `Importer ${n} réservation${n === 1 ? "" : "s"}`,
    importing: "Import en cours…",
    result: (c, u, s, ch) => `Terminé : ${c} ajoutées, ${u} mises à jour${s ? `, ${s} ignorées` : ""}${ch ? `, ${ch} dépenses ménage co-host` : ""}.`,
    rowsFound: (n, cur) => `${n} lignes de réservation · devise : ${cur}`,
    error: "Import impossible — est-ce bien le CSV « historique des transactions » Airbnb ?",
    reset: "Importer un autre fichier",
  },
  de: {
    title: "Airbnb-CSV importieren",
    subtitle: "Transaktionsverlauf-Export (Hosting → Einnahmen → CSV herunterladen). Ergänzt Preise bei vorhandenen Buchungen und legt fehlende an.",
    chooseFile: "CSV-Datei wählen",
    reading: "Wird gelesen…",
    mapHint: "Ordne jedes Airbnb-Inserat einer Unterkunft zu:",
    property: "Unterkunft",
    skip: "Überspringen",
    importCta: (n) => `${n} Buchung${n === 1 ? "" : "en"} importieren`,
    importing: "Importiert…",
    result: (c, u, s, ch) => `Fertig: ${c} hinzugefügt, ${u} aktualisiert${s ? `, ${s} übersprungen` : ""}${ch ? `, ${ch} Co-Host-Reinigungskosten` : ""}.`,
    rowsFound: (n, cur) => `${n} Buchungszeilen · Währung: ${cur}`,
    error: "Import fehlgeschlagen — ist das der Airbnb-Transaktionsverlauf?",
    reset: "Weitere Datei importieren",
  },
  es: {
    title: "Importar CSV de Airbnb",
    subtitle: "Exportación «Historial de transacciones» (Anfitrión → Ingresos → Descargar CSV). Rellena precios en reservas existentes y añade las que falten.",
    chooseFile: "Elegir archivo CSV",
    reading: "Leyendo…",
    mapHint: "Asocia cada anuncio de Airbnb a un alojamiento:",
    property: "Alojamiento",
    skip: "Omitir",
    importCta: (n) => `Importar ${n} reserva${n === 1 ? "" : "s"}`,
    importing: "Importando…",
    result: (c, u, s, ch) => `Listo: ${c} añadidas, ${u} actualizadas${s ? `, ${s} omitidas` : ""}${ch ? `, ${ch} gastos de limpieza co-host` : ""}.`,
    rowsFound: (n, cur) => `${n} filas de reserva · moneda: ${cur}`,
    error: "Importación fallida — ¿es el CSV de historial de transacciones de Airbnb?",
    reset: "Importar otro archivo",
  },
  ru: {
    title: "Импорт CSV Airbnb",
    subtitle: "Выгрузка «История транзакций» (Хостинг → Доходы → Скачать CSV). Заполнит цены в существующих бронях и добавит отсутствующие.",
    chooseFile: "Выбрать CSV-файл",
    reading: "Чтение…",
    mapHint: "Сопоставьте каждое объявление Airbnb с объектом:",
    property: "Объект",
    skip: "Пропустить",
    importCta: (n) => `Импортировать броней: ${n}`,
    importing: "Импорт…",
    result: (c, u, s, ch) => `Готово: добавлено ${c}, обновлено ${u}${s ? `, пропущено ${s}` : ""}${ch ? `, расходов на уборку ко-хоста: ${ch}` : ""}.`,
    rowsFound: (n, cur) => `${n} строк броней · валюта: ${cur}`,
    error: "Не удалось импортировать — это CSV истории транзакций Airbnb?",
    reset: "Импортировать другой файл",
  },
};

interface PreviewListing { listing: string; count: number }
interface Preview {
  listings: PreviewListing[];
  currencies: string[];
  reservationRows: number;
  suggestedMapping?: Record<string, number>;
}

export function CsvImport({ properties, onDone }: { properties: Property[]; onDone?: () => void }) {
  const { locale } = useI18n();
  const c = COPY[locale] ?? COPY.en;
  const fileRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [csvText, setCsvText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [doneMsg, setDoneMsg] = useState("");

  async function pickFile(file: File) {
    setErr("");
    setDoneMsg("");
    setBusy(true);
    try {
      const text = await file.text();
      const res = await fetch("/api/import/airbnb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "preview failed");
      setCsvText(text);
      setPreview(data);
      // Auto-map: server-remembered listing→property pairs first, then
      // exact property-name matches; host reviews the rest.
      const auto: Record<string, number> = { ...(data.suggestedMapping ?? {}) };
      for (const l of data.listings as PreviewListing[]) {
        if (auto[l.listing]) continue;
        const hit = properties.find(
          (p) => p.name.trim().toLowerCase() === l.listing.trim().toLowerCase(),
        );
        if (hit) auto[l.listing] = hit.id;
      }
      setMapping(auto);
    } catch {
      setErr(c.error);
      setPreview(null);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function commit() {
    if (!csvText) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/import/airbnb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvText, commit: true, mapping }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "import failed");
      setDoneMsg(c.result(data.created ?? 0, data.updated ?? 0, data.skippedNoMapping ?? 0, data.coHostExpenses ?? 0));
      setPreview(null);
      setCsvText("");
      onDone?.();
    } catch {
      setErr(c.error);
    } finally {
      setBusy(false);
    }
  }

  const mappedCount = preview
    ? preview.listings.filter((l) => mapping[l.listing]).reduce((n, l) => n + l.count, 0)
    : 0;

  return (
    <div className="rounded-2xl bg-[var(--bg)] shadow-[0_1px_3px_-1px_rgba(0,0,0,0.04),0_4px_16px_-8px_rgba(0,0,0,0.06)] [overflow:clip]">
      <div className="border-b border-[var(--line)] px-5 py-4">
        <div className="text-base font-semibold text-[var(--ink)]">{c.title}</div>
        <div className="mt-0.5 text-[12px] text-[var(--ink-3)]">{c.subtitle}</div>
      </div>
      <div className="px-5 py-4 space-y-3">
        {!preview && !doneMsg && (
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void pickFile(f);
              }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="rounded-lg bg-[var(--m-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--m-accent-2)] disabled:opacity-50 transition-colors"
            >
              {busy ? c.reading : c.chooseFile}
            </button>
          </div>
        )}

        {preview && (
          <>
            <div className="text-[12px] text-[var(--ink-3)]">
              {c.rowsFound(preview.reservationRows, preview.currencies.join(", ") || "—")}
            </div>
            <div className="text-[13px] font-medium text-[var(--ink)]">{c.mapHint}</div>
            <div className="space-y-2">
              {preview.listings.map((l) => (
                <div key={l.listing} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1 truncate text-[13px] text-[var(--ink)]" title={l.listing}>
                    {l.listing} <span className="text-[var(--ink-4)]">({l.count})</span>
                  </div>
                  <select
                    value={mapping[l.listing] ?? ""}
                    onChange={(e) =>
                      setMapping((m) => {
                        const next = { ...m };
                        if (e.target.value) next[l.listing] = Number(e.target.value);
                        else delete next[l.listing];
                        return next;
                      })
                    }
                    className="rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2 py-1.5 text-[13px] text-[var(--ink)]"
                  >
                    <option value="">{c.skip}</option>
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy || mappedCount === 0}
                onClick={() => void commit()}
                className="rounded-lg bg-[var(--m-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--m-accent-2)] disabled:opacity-50 transition-colors"
              >
                {busy ? c.importing : c.importCta(mappedCount)}
              </button>
              <button
                type="button"
                onClick={() => { setPreview(null); setCsvText(""); }}
                className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm text-[var(--ink-2)]"
              >
                {c.reset}
              </button>
            </div>
          </>
        )}

        {doneMsg && (
          <div className="space-y-2">
            <div className="text-[13px] font-medium text-emerald-700">{doneMsg}</div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm text-[var(--ink-2)]"
            >
              {c.chooseFile}
            </button>
          </div>
        )}

        {err && <div className="text-[13px] text-red-600">{err}</div>}
      </div>
    </div>
  );
}
