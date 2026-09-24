"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/translations";
import type { CalendarBar } from "./types";

export type CancelExtensionResult =
  | { ok: true }
  | { ok: false; error?: string };

export interface ExtensionActionBar extends CalendarBar {
  reservationId: number;
}

interface CopyShape {
  direct: string;
  heading: string;
  connectedTo: (platform: string) => string;
  body: (platform: string) => string;
  openDetails: string;
  cancelExtension: string;
  confirmHeading: string;
  confirmBody: (range: string, platform: string) => string;
  keepExtension: string;
  removeDirectDates: string;
  removing: string;
  failed: string;
  close: string;
  dateLocale: string;
}

const COPY: Record<Locale, CopyShape> = {
  en: {
    direct: "Direct",
    heading: "Direct extension",
    connectedTo: (platform) => `Connected to ${platform}`,
    body: (platform) =>
      `These nights were added directly in RentTools to the ${platform} reservation.`,
    openDetails: "Open reservation details",
    cancelExtension: "Cancel direct extension",
    confirmHeading: "Remove this Direct segment?",
    confirmBody: (range, platform) =>
      `${range} and any details attached to this Direct segment will be removed. The original ${platform} reservation will remain on the calendar.`,
    keepExtension: "Keep extension",
    removeDirectDates: "Remove Direct dates",
    removing: "Removing…",
    failed: "Couldn’t cancel the Direct extension. Try again.",
    close: "Close",
    dateLocale: "en-GB",
  },
  ru: {
    direct: "Напрямую",
    heading: "Прямое продление",
    connectedTo: (platform) => `Связано с ${platform}`,
    body: (platform) =>
      `Эти ночи добавлены напрямую в RentTools к брони из ${platform}.`,
    openDetails: "Открыть детали брони",
    cancelExtension: "Отменить прямое продление",
    confirmHeading: "Удалить этот сегмент Direct?",
    confirmBody: (range, platform) =>
      `${range} и данные, прикреплённые к этому сегменту Direct, будут удалены. Исходная бронь ${platform} останется в календаре.`,
    keepExtension: "Оставить продление",
    removeDirectDates: "Удалить прямые даты",
    removing: "Удаляю…",
    failed: "Не удалось отменить прямое продление. Попробуйте ещё раз.",
    close: "Закрыть",
    dateLocale: "ru-RU",
  },
  de: {
    direct: "Direkt",
    heading: "Direkte Verlängerung",
    connectedTo: (platform) => `Mit ${platform} verbunden`,
    body: (platform) =>
      `Diese Nächte wurden in RentTools direkt zur ${platform}-Buchung hinzugefügt.`,
    openDetails: "Buchungsdetails öffnen",
    cancelExtension: "Direkte Verlängerung stornieren",
    confirmHeading: "Diesen Direct-Abschnitt entfernen?",
    confirmBody: (range, platform) =>
      `${range} und alle Details dieses Direct-Abschnitts werden entfernt. Die ursprüngliche ${platform}-Buchung bleibt im Kalender.`,
    keepExtension: "Verlängerung behalten",
    removeDirectDates: "Direkte Daten entfernen",
    removing: "Wird entfernt…",
    failed: "Die direkte Verlängerung konnte nicht storniert werden. Bitte erneut versuchen.",
    close: "Schließen",
    dateLocale: "de-DE",
  },
  fr: {
    direct: "Direct",
    heading: "Prolongation directe",
    connectedTo: (platform) => `Liée à ${platform}`,
    body: (platform) =>
      `Ces nuits ont été ajoutées directement dans RentTools à la réservation ${platform}.`,
    openDetails: "Ouvrir les détails",
    cancelExtension: "Annuler la prolongation directe",
    confirmHeading: "Supprimer ce segment Direct ?",
    confirmBody: (range, platform) =>
      `${range} et les informations liées à ce segment Direct seront supprimés. La réservation ${platform} d’origine restera dans le calendrier.`,
    keepExtension: "Garder la prolongation",
    removeDirectDates: "Supprimer les dates directes",
    removing: "Suppression…",
    failed: "Impossible d’annuler la prolongation directe. Réessayez.",
    close: "Fermer",
    dateLocale: "fr-FR",
  },
  es: {
    direct: "Directa",
    heading: "Ampliación directa",
    connectedTo: (platform) => `Conectada con ${platform}`,
    body: (platform) =>
      `Estas noches se añadieron directamente en RentTools a la reserva de ${platform}.`,
    openDetails: "Abrir detalles de la reserva",
    cancelExtension: "Cancelar ampliación directa",
    confirmHeading: "¿Quitar este segmento Direct?",
    confirmBody: (range, platform) =>
      `Se eliminarán ${range} y los datos asociados a este segmento Direct. La reserva original de ${platform} seguirá en el calendario.`,
    keepExtension: "Mantener ampliación",
    removeDirectDates: "Quitar fechas directas",
    removing: "Quitando…",
    failed: "No se pudo cancelar la ampliación directa. Inténtalo de nuevo.",
    close: "Cerrar",
    dateLocale: "es-ES",
  },
};

function platformName(platform: string): string {
  if (platform === "booking") return "Booking.com";
  if (platform === "airbnb") return "Airbnb";
  if (platform === "vrbo") return "Vrbo";
  return platform || "iCal";
}

function platformColor(platform: string): string {
  if (platform === "booking") return "#003580";
  if (platform === "airbnb") return "#ff385c";
  if (platform === "vrbo") return "#2c5da9";
  return "#64748b";
}

interface ExtensionActionsPopoverProps {
  bar: ExtensionActionBar;
  anchorRect: DOMRect;
  onClose: () => void;
  onOpenReservation: (reservationId: number) => void;
  onCancelExtension: (reservationId: number) => Promise<CancelExtensionResult>;
}

export function ExtensionActionsPopover({
  bar,
  anchorRect,
  onClose,
  onOpenReservation,
  onCancelExtension,
}: ExtensionActionsPopoverProps) {
  const { locale } = useI18n();
  const c = COPY[locale];
  const panelRef = useRef<HTMLDivElement>(null);
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const confirmActionRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const outside = (event: MouseEvent) => {
      if (!removing && panelRef.current && !panelRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !removing) onClose();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", keyboard);
    const timer = window.setTimeout(() => firstActionRef.current?.focus(), 30);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", keyboard);
    };
  }, [onClose, removing]);

  useEffect(() => {
    if (confirming) confirmActionRef.current?.focus();
  }, [confirming]);

  const sourcePlatform = bar.linkedEventPlatform || bar.platform;
  const sourceName = platformName(sourcePlatform);
  const formatDate = (date: string) =>
    new Date(`${date}T12:00:00`).toLocaleDateString(c.dateLocale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  const range = `${formatDate(bar.startDate)} → ${formatDate(bar.endDate)}`;

  const popWidth = Math.min(344, window.innerWidth - 16);
  const estimatedHeight = confirming ? 330 : 300;
  const margin = 8;
  let left = anchorRect.left;
  if (left + popWidth + margin > window.innerWidth) left = window.innerWidth - popWidth - margin;
  if (left < margin) left = margin;
  let top = anchorRect.bottom + 6;
  if (top + estimatedHeight > window.innerHeight && anchorRect.top - estimatedHeight - 6 > margin) {
    top = anchorRect.top - estimatedHeight - 6;
  }
  top = Math.max(margin, Math.min(top, Math.max(margin, window.innerHeight - estimatedHeight - margin)));

  const removeExtension = async () => {
    if (removing) return;
    setRemoving(true);
    setError(null);
    try {
      const result = await onCancelExtension(bar.reservationId);
      if (!result.ok) {
        setError(result.error || c.failed);
        setRemoving(false);
      }
    } catch {
      setError(c.failed);
      setRemoving(false);
    }
  };

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-labelledby={headingId}
      aria-busy={removing}
      className="editorial fixed z-[100] max-h-[calc(100vh-16px)] overflow-y-auto rounded-xl border border-slate-300/60 bg-[var(--bg)] shadow-2xl shadow-black/30 dark:border-slate-600/70"
      style={{ top, left, width: popWidth }}
    >
      <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
        <div className="min-w-0">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-4)]">
            {c.heading}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-md bg-slate-600 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-white">
              {c.direct}
            </span>
            <span aria-hidden="true" className="text-slate-400">→</span>
            <span
              className="rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide text-white"
              style={{ backgroundColor: platformColor(sourcePlatform) }}
            >
              {sourceName}
            </span>
          </div>
          <h2 id={headingId} className="mt-2 truncate text-sm font-semibold text-[var(--ink)]">
            {bar.name}
          </h2>
          <p className="mt-0.5 text-xs text-[var(--ink-3)]">{range}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={removing}
          aria-label={c.close}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--ink-3)] transition-colors hover:bg-[var(--bg-3)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:cursor-wait disabled:opacity-50"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="space-y-3 px-4 py-4">
        {!confirming ? (
          <>
            <div className="rounded-lg border border-slate-300/60 bg-slate-500/5 px-3 py-2.5 dark:border-slate-600/60">
              <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                {c.connectedTo(sourceName)}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--ink-3)]">
                {c.body(sourceName)}
              </p>
            </div>
            <button
              ref={firstActionRef}
              type="button"
              onClick={() => {
                onClose();
                onOpenReservation(bar.reservationId);
              }}
              className="flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--line-2)] bg-[var(--bg-2)] px-4 py-2.5 text-sm font-medium text-[var(--ink)] transition-colors hover:bg-[var(--bg-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            >
              {c.openDetails}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(true);
                setError(null);
              }}
              className="flex min-h-11 w-full items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/5 px-4 py-2.5 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:text-rose-400"
            >
              {c.cancelExtension}
            </button>
          </>
        ) : (
          <>
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-3">
              <p className="text-sm font-semibold text-[var(--ink)]">{c.confirmHeading}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-[var(--ink-3)]">
                {c.confirmBody(range, sourceName)}
              </p>
            </div>
            {error && (
              <p role="alert" className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">
                {error}
              </p>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                ref={firstActionRef}
                type="button"
                onClick={() => {
                  setConfirming(false);
                  setError(null);
                }}
                disabled={removing}
                className="min-h-11 rounded-lg border border-[var(--line-2)] bg-[var(--bg-2)] px-3 py-2.5 text-sm font-medium text-[var(--ink-2)] transition-colors hover:bg-[var(--bg-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:cursor-wait disabled:opacity-50"
              >
                {c.keepExtension}
              </button>
              <button
                ref={confirmActionRef}
                type="button"
                onClick={removeExtension}
                disabled={removing}
                className="min-h-11 rounded-lg bg-rose-600 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
              >
                {removing ? c.removing : c.removeDirectDates}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
