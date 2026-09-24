"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { PropertySwitcher } from "@/components/property-switcher";
import {
  buildUnifiedStays,
  type CalendarEvent as SyncedCalendarEvent,
  type UnifiedStay,
} from "@/components/dashboard";
import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/translations";
import type { Property } from "@/lib/types";

interface CopyShape {
  dateLocale: string;
  calendarTitle: string;
  acrossAllProperties: (count: number) => string;
  emptyState: string;
  propertyColumn: string;
  prevMonth: string;
  nextMonth: string;
  today: string;
  legend: string;
  openProperty: (name: string) => string;
  weekdays: string[];
}

const COPY: Record<Locale, CopyShape> = {
  en: {
    dateLocale: "en-GB",
    calendarTitle: "Calendar",
    acrossAllProperties: (count) =>
      `Comparing all ${count} ${count === 1 ? "property" : "properties"} — click a name to open it`,
    emptyState: "Add a property to see the portfolio calendar.",
    propertyColumn: "Property",
    prevMonth: "Previous month",
    nextMonth: "Next month",
    today: "Today",
    legend: "Legend",
    openProperty: (name) => `Open ${name}'s calendar`,
    weekdays: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
  },
  ru: {
    dateLocale: "ru-RU",
    calendarTitle: "Календарь",
    acrossAllProperties: (count) =>
      `Сравнение всех объектов (${count}) — нажмите на название, чтобы открыть`,
    emptyState: "Добавьте объект, чтобы увидеть общий календарь.",
    propertyColumn: "Объект",
    prevMonth: "Предыдущий месяц",
    nextMonth: "Следующий месяц",
    today: "Сегодня",
    legend: "Легенда",
    openProperty: (name) => `Открыть календарь «${name}»`,
    weekdays: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
  },
  de: {
    dateLocale: "de-DE",
    calendarTitle: "Kalender",
    acrossAllProperties: (count) =>
      `Vergleich aller ${count} ${count === 1 ? "Unterkunft" : "Unterkünfte"} — Namen anklicken, um zu öffnen`,
    emptyState: "Fügen Sie eine Unterkunft hinzu, um den Portfolio-Kalender zu sehen.",
    propertyColumn: "Unterkunft",
    prevMonth: "Vorheriger Monat",
    nextMonth: "Nächster Monat",
    today: "Heute",
    legend: "Legende",
    openProperty: (name) => `Kalender von ${name} öffnen`,
    weekdays: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"],
  },
  fr: {
    dateLocale: "fr-FR",
    calendarTitle: "Calendrier",
    acrossAllProperties: (count) =>
      `Comparaison des ${count} logements — cliquez sur un nom pour l’ouvrir`,
    emptyState: "Ajoutez un logement pour voir le calendrier du portefeuille.",
    propertyColumn: "Logement",
    prevMonth: "Mois précédent",
    nextMonth: "Mois suivant",
    today: "Aujourd’hui",
    legend: "Légende",
    openProperty: (name) => `Ouvrir le calendrier de ${name}`,
    weekdays: ["Lu", "Ma", "Me", "Je", "Ve", "Sa", "Di"],
  },
  es: {
    dateLocale: "es-ES",
    calendarTitle: "Calendario",
    acrossAllProperties: (count) =>
      `Comparando los ${count} alojamientos — haga clic en un nombre para abrirlo`,
    emptyState: "Añada un alojamiento para ver el calendario del portafolio.",
    propertyColumn: "Alojamiento",
    prevMonth: "Mes anterior",
    nextMonth: "Mes siguiente",
    today: "Hoy",
    legend: "Leyenda",
    openProperty: (name) => `Abrir el calendario de ${name}`,
    weekdays: ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"],
  },
};

// Bundled platform presets — kept inline rather than imported from
// @/lib/platforms because that module's lazy `import("@/lib/prisma")`
// gets traced into the client bundle by Turbopack and breaks the
// build (matches the reports-panel.tsx / dashboard.tsx approach).
const FALLBACK_PLATFORM_COLOR = "#6B7280";
const PLATFORM_PRESETS: ReadonlyArray<{ slug: string; displayName: string; color: string }> = [
  { slug: "airbnb", displayName: "Airbnb", color: "#FF385C" },
  { slug: "booking", displayName: "Booking.com", color: "#003580" },
  { slug: "vrbo", displayName: "Vrbo", color: "#245ABC" },
  { slug: "expedia", displayName: "Expedia", color: "#FFC72C" },
  { slug: "hostaway", displayName: "Hostaway", color: "#2E5BFF" },
  { slug: "lodgify", displayName: "Lodgify", color: "#00B5AD" },
  { slug: "hospitable", displayName: "Hospitable", color: "#1B5E20" },
  { slug: "smoobu", displayName: "Smoobu", color: "#4A148C" },
  { slug: "houfy", displayName: "Houfy", color: "#D84315" },
  { slug: "plumguide", displayName: "Plum Guide", color: "#2E1065" },
  { slug: "whimstay", displayName: "Whimstay", color: "#FF7043" },
  { slug: "direct", displayName: "Direct", color: FALLBACK_PLATFORM_COLOR },
];

function platformPreset(slug: string) {
  return PLATFORM_PRESETS.find((p) => p.slug === slug.toLowerCase());
}

/** For each day 1..daysInMonth, the UnifiedStay covering that local
 *  calendar day (half-open: start <= day < end), or null if free. */
function buildDayStays(
  stays: UnifiedStay[],
  year: number,
  monthIndex: number,
  daysInMonth: number,
): (UnifiedStay | null)[] {
  const result: (UnifiedStay | null)[] = new Array(daysInMonth).fill(null);
  for (let day = 1; day <= daysInMonth; day++) {
    const dayTime = new Date(year, monthIndex, day).getTime();
    result[day - 1] =
      stays.find((s) => s.start.getTime() <= dayTime && s.end.getTime() > dayTime) ?? null;
  }
  return result;
}

interface GlobalCalendarViewProps {
  properties: Property[];
}

/**
 * Cross-property calendar rendered when activeView === "calendar" AND
 * no property is selected. Every property gets one compact row on a
 * shared date axis so occupancy can be compared at a glance ("all
 * properties in the same row"); clicking a property's name opens its
 * full single-property calendar ("each one separately").
 *
 * Reuses buildUnifiedStays from dashboard.tsx so the exact same
 * dedup/claim/extension rules that drive the single-property
 * calendar and the dashboard's occupancy cards apply here too.
 */
export function GlobalCalendarView({ properties }: GlobalCalendarViewProps) {
  const { locale } = useI18n();
  const c = COPY[locale];
  const [monthOffset, setMonthOffset] = useState(0);
  const [syncedEvents, setSyncedEvents] = useState<Record<number, SyncedCalendarEvent[]>>({});
  const [loading, setLoading] = useState(true);

  const fetchSyncedEvents = useCallback(async () => {
    if (properties.length === 0) {
      setSyncedEvents({});
      setLoading(false);
      return;
    }
    const results = await Promise.all(
      properties.map(async (p) => {
        try {
          const res = await fetch(`/api/calendar/sync?propertyId=${p.id}&limit=200`);
          const data = await res.json();
          return { id: p.id, events: (data.events || []) as SyncedCalendarEvent[] };
        } catch {
          return { id: p.id, events: [] as SyncedCalendarEvent[] };
        }
      })
    );
    const map: Record<number, SyncedCalendarEvent[]> = {};
    for (const r of results) map[r.id] = r.events;
    setSyncedEvents(map);
    setLoading(false);
  }, [properties]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- legitimate fetch-on-mount pattern; setState happens inside the async callback
    fetchSyncedEvents();
  }, [fetchSyncedEvents]);

  // Multi-manager visibility — see use-live-refresh.ts for rationale.
  useLiveRefresh(fetchSyncedEvents);

  // Frozen at mount, matching the same pattern dashboard.tsx uses for
  // its own `todayStr` — a dashboard session doesn't need to notice
  // the clock ticking over midnight while it's open.
  const today = useMemo(() => new Date(), []);
  const viewDate = useMemo(
    () => new Date(today.getFullYear(), today.getMonth() + monthOffset, 1),
    [today, monthOffset]
  );

  const monthData = useMemo(() => {
    const year = viewDate.getFullYear();
    const monthIndex = viewDate.getMonth();
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const legendSlugs = new Set<string>();
    const rows = properties.map((property) => {
      const stays = buildUnifiedStays(property, syncedEvents[property.id] || []);
      const dayStays = buildDayStays(stays, year, monthIndex, daysInMonth);
      for (const stay of dayStays) {
        if (stay) legendSlugs.add(stay.platform.toLowerCase());
      }
      return { property, dayStays };
    });
    return { year, monthIndex, daysInMonth, rows, legendSlugs };
  }, [properties, syncedEvents, viewDate]);

  if (properties.length === 0) {
    return (
      <div className="-mx-3 sm:-mx-6 lg:-mx-8">
        <div className="mx-auto max-w-[1760px] px-3 sm:px-5">
          <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-2)] p-6 text-center text-xs text-[var(--ink-4)]">
            {c.emptyState}
          </div>
        </div>
      </div>
    );
  }

  const monthLabel = viewDate.toLocaleDateString(c.dateLocale, { month: "long", year: "numeric" });

  return (
    <div className="-mx-3 sm:-mx-6 lg:-mx-8 pt-3 sm:pt-6 lg:pt-8">
      <div className="mx-auto max-w-[1760px] px-3 sm:px-5 space-y-4">
        {properties.length > 1 && (
          <PropertySwitcher
            properties={properties}
            selectedPropertyId={null}
            view="calendar"
            showAllOption
          />
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--ink)]">{c.calendarTitle}</h1>
            <p className="mt-1 text-xs text-[var(--ink-3)]">{c.acrossAllProperties(properties.length)}</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMonthOffset((v) => v - 1)}
              aria-label={c.prevMonth}
              className="rounded-md p-1.5 text-[var(--ink-3)] hover:bg-[var(--bg-3)] hover:text-[var(--ink)]"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>
            <div className="min-w-[130px] text-center text-sm font-medium text-[var(--ink)] capitalize">
              {monthLabel}
            </div>
            <button
              type="button"
              onClick={() => setMonthOffset((v) => v + 1)}
              aria-label={c.nextMonth}
              className="rounded-md p-1.5 text-[var(--ink-3)] hover:bg-[var(--bg-3)] hover:text-[var(--ink)]"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
            {monthOffset !== 0 && (
              <button
                type="button"
                onClick={() => setMonthOffset(0)}
                className="ml-1 rounded-md border border-[var(--line-2)] px-2.5 py-1 text-xs font-medium text-[var(--ink-2)] hover:bg-[var(--bg-3)]"
              >
                {c.today}
              </button>
            )}
          </div>
        </div>

        <div className={`overflow-x-auto rounded-xl border border-[var(--line)] transition-opacity ${loading ? "opacity-60" : ""}`}>
          <div
            className="grid"
            style={{ gridTemplateColumns: `152px repeat(${monthData.daysInMonth}, minmax(28px, 1fr))` }}
          >
            {/* header row */}
            <div className="sticky left-0 z-10 flex items-center border-b border-r border-[var(--line)] bg-[var(--bg-2)] px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-[var(--ink-4)]">
              {c.propertyColumn}
            </div>
            {Array.from({ length: monthData.daysInMonth }, (_, i) => i + 1).map((day) => {
              const dow = (new Date(monthData.year, monthData.monthIndex, day).getDay() + 6) % 7;
              const isToday = monthOffset === 0 && day === today.getDate();
              return (
                <div
                  key={`h-${day}`}
                  className={`border-b border-r border-[var(--line)] last:border-r-0 py-1.5 text-center ${isToday ? "bg-[var(--m-accent)]/10" : "bg-[var(--bg-2)]"}`}
                >
                  <div className={`text-[11px] font-semibold ${isToday ? "text-[var(--m-accent)]" : "text-[var(--ink-2)]"}`}>
                    {day}
                  </div>
                  <div className="text-[9px] leading-tight text-[var(--ink-4)]">{c.weekdays[dow]}</div>
                </div>
              );
            })}

            {/* one row per property */}
            {monthData.rows.map(({ property, dayStays }) => (
              <Fragment key={property.id}>
                <Link
                  href={`/dashboard?property=${property.id}&view=calendar`}
                  title={c.openProperty(property.name)}
                  className="sticky left-0 z-10 flex h-9 sm:h-10 items-center border-b border-r border-[var(--line)] bg-[var(--bg)] px-3 text-sm font-medium text-[var(--ink)] transition-colors hover:bg-[var(--bg-3)] hover:text-[var(--m-accent)]"
                >
                  <span className="truncate">{property.name}</span>
                </Link>
                {dayStays.map((stay, i) => {
                  const day = i + 1;
                  const prev = i > 0 ? dayStays[i - 1] : null;
                  const next = i < dayStays.length - 1 ? dayStays[i + 1] : null;
                  const isStart = stay !== null && prev !== stay;
                  const isEnd = stay !== null && next !== stay;
                  const isToday = monthOffset === 0 && day === today.getDate();
                  const preset = stay ? platformPreset(stay.platform) : undefined;
                  const color = preset?.color ?? FALLBACK_PLATFORM_COLOR;
                  const displayName = preset?.displayName ?? stay?.platform ?? "";
                  return (
                    <div
                      key={`d-${property.id}-${day}`}
                      className={`relative h-9 sm:h-10 border-b border-r border-[var(--line)] last:border-r-0 ${isToday ? "bg-[var(--m-accent)]/5" : ""}`}
                      title={stay ? `${stay.name} · ${displayName}` : undefined}
                    >
                      {stay && (
                        <div
                          className={`absolute inset-y-1.5 ${isStart ? "left-0.5 rounded-l-full" : "left-0"} ${isEnd ? "right-0.5 rounded-r-full" : "right-0"}`}
                          style={{ backgroundColor: color }}
                        />
                      )}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>

        {monthData.legendSlugs.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--ink-3)]">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--ink-4)]">{c.legend}</span>
            {Array.from(monthData.legendSlugs).map((slug) => {
              const preset = platformPreset(slug);
              return (
                <span key={slug} className="inline-flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: preset?.color ?? FALLBACK_PLATFORM_COLOR }}
                  />
                  {preset?.displayName ?? slug}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
