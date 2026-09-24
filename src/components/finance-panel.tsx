"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/translations";
import type { Property, Expense, ExpenseCategory } from "@/lib/types";
import { EXPENSE_CATEGORIES } from "@/lib/types";
import {
  aggregateFinance,
  financeTotals,
  formatCents,
  parseMoneyInput,
  centsToInput,
  DEFAULT_CURRENCY,
} from "@/lib/finance";

export interface FinanceMonthBucket {
  key: string; // "YYYY-MM"
  label: string;
  isPast: boolean;
  totalDays: number;
  perPlatform: Record<string, number>;
}

interface CopyShape {
  title: string;
  subtitle: (currency: string) => string;
  payout: string;
  expenses: string;
  net: string;
  adr: string;
  adrHelp: string;
  revpar: string;
  revparHelp: string;
  gross: string;
  hostFee: string;
  unpriced: (n: number) => string;
  chartTitle: string;
  income: string;
  expenseSingular: string;
  netLabel: string;
  categoryBreakdown: string;
  listTitle: string;
  addExpense: string;
  editExpense: string;
  colDate: string;
  colProperty: string;
  colCategory: string;
  colNote: string;
  colAmount: string;
  actions: string;
  edit: string;
  del: string;
  delSeries: string;
  save: string;
  cancel: string;
  date: string;
  amount: string;
  note: string;
  category: string;
  repeatMonthly: string;
  months: string;
  submit: string;
  saving: string;
  invalidAmount: string;
  noExpenses: string;
  recurringBadge: string;
  exportCsv: string;
  catLabel: (cat: string) => string;
}

const CATEGORY_LABELS: Record<ExpenseCategory, Record<Locale, string>> = {
  cleaning: { en: "Cleaning", ru: "Уборка", de: "Reinigung", fr: "Ménage", es: "Limpieza" },
  supplies: { en: "Supplies", ru: "Расходники", de: "Verbrauchsmaterial", fr: "Fournitures", es: "Suministros" },
  utilities: { en: "Utilities", ru: "Коммунальные", de: "Nebenkosten", fr: "Charges", es: "Suministros" },
  maintenance: { en: "Maintenance", ru: "Обслуживание", de: "Instandhaltung", fr: "Maintenance", es: "Mantenimiento" },
  "platform-fees": { en: "Platform fees", ru: "Комиссии платформ", de: "Plattformgebühren", fr: "Frais de plateforme", es: "Comisiones" },
  taxes: { en: "Taxes", ru: "Налоги", de: "Steuern", fr: "Impôts", es: "Impuestos" },
  rent: { en: "Rent", ru: "Аренда", de: "Miete", fr: "Loyer", es: "Alquiler" },
  insurance: { en: "Insurance", ru: "Страховка", de: "Versicherung", fr: "Assurance", es: "Seguro" },
  other: { en: "Other", ru: "Прочее", de: "Sonstiges", fr: "Autre", es: "Otros" },
};

const COPY: Record<Locale, CopyShape> = {
  en: {
    title: "Income & expenses",
    subtitle: (cur) => `All amounts in ${cur}. Income is bucketed by check-in month.`,
    payout: "Payout",
    expenses: "Expenses",
    net: "Net",
    adr: "ADR",
    adrHelp: "avg daily rate",
    revpar: "RevPAR",
    revparHelp: "revenue / available night",
    gross: "Gross",
    hostFee: "Platform fees",
    unpriced: (n) => `${n} ${n === 1 ? "booking" : "bookings"} without a price`,
    chartTitle: "Income vs expenses per month",
    income: "Income",
    expenseSingular: "Expenses",
    netLabel: "Net",
    categoryBreakdown: "By category",
    listTitle: "Expenses",
    addExpense: "Add expense",
    editExpense: "Edit expense",
    colDate: "Date",
    colProperty: "Property",
    colCategory: "Category",
    colNote: "Note",
    colAmount: "Amount",
    actions: "",
    edit: "Edit",
    del: "Delete",
    delSeries: "Delete series",
    save: "Save",
    cancel: "Cancel",
    date: "Date",
    amount: "Amount",
    note: "Note (optional)",
    category: "Category",
    repeatMonthly: "Repeat monthly",
    months: "months",
    submit: "Add",
    saving: "Saving…",
    invalidAmount: "Enter a positive amount, e.g. 45.90",
    noExpenses: "No expenses recorded yet.",
    recurringBadge: "monthly",
    exportCsv: "Export CSV",
    catLabel: (cat) =>
      CATEGORY_LABELS[cat as ExpenseCategory]?.en ?? cat,
  },
  ru: {
    title: "Доходы и расходы",
    subtitle: (cur) => `Все суммы в ${cur}. Доход привязан к месяцу заезда.`,
    payout: "Выплаты",
    expenses: "Расходы",
    net: "Чистыми",
    adr: "ADR",
    adrHelp: "средняя цена за ночь",
    revpar: "RevPAR",
    revparHelp: "доход на доступную ночь",
    gross: "Итого гостем",
    hostFee: "Комиссии платформ",
    unpriced: (n) => `${n} броней без цены`,
    chartTitle: "Доходы и расходы по месяцам",
    income: "Доход",
    expenseSingular: "Расходы",
    netLabel: "Чистыми",
    categoryBreakdown: "По категориям",
    listTitle: "Расходы",
    addExpense: "Добавить расход",
    editExpense: "Изменить расход",
    colDate: "Дата",
    colProperty: "Объект",
    colCategory: "Категория",
    colNote: "Заметка",
    colAmount: "Сумма",
    actions: "",
    edit: "Изм.",
    del: "Удалить",
    delSeries: "Удалить серию",
    save: "Сохранить",
    cancel: "Отмена",
    date: "Дата",
    amount: "Сумма",
    note: "Заметка (необязательно)",
    category: "Категория",
    repeatMonthly: "Повторять ежемесячно",
    months: "мес.",
    submit: "Добавить",
    saving: "Сохраняю…",
    invalidAmount: "Введите положительную сумму, напр. 45.90",
    noExpenses: "Расходов пока нет.",
    recurringBadge: "ежемесячно",
    exportCsv: "Экспорт CSV",
    catLabel: (cat) =>
      CATEGORY_LABELS[cat as ExpenseCategory]?.ru ?? cat,
  },
  de: {
    title: "Einnahmen & Ausgaben",
    subtitle: (cur) => `Alle Beträge in ${cur}. Einnahmen werden dem Check-in-Monat zugeordnet.`,
    payout: "Auszahlung",
    expenses: "Ausgaben",
    net: "Netto",
    adr: "ADR",
    adrHelp: "Ø Tagesrate",
    revpar: "RevPAR",
    revparHelp: "Umsatz / verfügbare Nacht",
    gross: "Brutto",
    hostFee: "Plattformgebühren",
    unpriced: (n) => `${n} ${n === 1 ? "Buchung" : "Buchungen"} ohne Preis`,
    chartTitle: "Einnahmen vs. Ausgaben pro Monat",
    income: "Einnahmen",
    expenseSingular: "Ausgaben",
    netLabel: "Netto",
    categoryBreakdown: "Nach Kategorie",
    listTitle: "Ausgaben",
    addExpense: "Ausgabe hinzufügen",
    editExpense: "Ausgabe bearbeiten",
    colDate: "Datum",
    colProperty: "Unterkunft",
    colCategory: "Kategorie",
    colNote: "Notiz",
    colAmount: "Betrag",
    actions: "",
    edit: "Bearb.",
    del: "Löschen",
    delSeries: "Serie löschen",
    save: "Speichern",
    cancel: "Abbrechen",
    date: "Datum",
    amount: "Betrag",
    note: "Notiz (optional)",
    category: "Kategorie",
    repeatMonthly: "Monatlich wiederholen",
    months: "Monate",
    submit: "Hinzufügen",
    saving: "Speichern…",
    invalidAmount: "Positiven Betrag eingeben, z. B. 45.90",
    noExpenses: "Noch keine Ausgaben erfasst.",
    recurringBadge: "monatlich",
    exportCsv: "CSV exportieren",
    catLabel: (cat) =>
      CATEGORY_LABELS[cat as ExpenseCategory]?.de ?? cat,
  },
  fr: {
    title: "Revenus & dépenses",
    subtitle: (cur) => `Montants en ${cur}. Les revenus sont rattachés au mois d'arrivée.`,
    payout: "Versements",
    expenses: "Dépenses",
    net: "Net",
    adr: "ADR",
    adrHelp: "tarif journalier moyen",
    revpar: "RevPAR",
    revparHelp: "revenu / nuit dispo",
    gross: "Brut",
    hostFee: "Frais de plateforme",
    unpriced: (n) => `${n} ${n === 1 ? "réservation" : "réservations"} sans prix`,
    chartTitle: "Revenus et dépenses par mois",
    income: "Revenus",
    expenseSingular: "Dépenses",
    netLabel: "Net",
    categoryBreakdown: "Par catégorie",
    listTitle: "Dépenses",
    addExpense: "Ajouter une dépense",
    editExpense: "Modifier la dépense",
    colDate: "Date",
    colProperty: "Logement",
    colCategory: "Catégorie",
    colNote: "Note",
    colAmount: "Montant",
    actions: "",
    edit: "Modif.",
    del: "Suppr.",
    delSeries: "Suppr. la série",
    save: "Enregistrer",
    cancel: "Annuler",
    date: "Date",
    amount: "Montant",
    note: "Note (optionnel)",
    category: "Catégorie",
    repeatMonthly: "Répéter chaque mois",
    months: "mois",
    submit: "Ajouter",
    saving: "Enregistrement…",
    invalidAmount: "Saisissez un montant positif, ex. 45.90",
    noExpenses: "Aucune dépense enregistrée.",
    recurringBadge: "mensuel",
    exportCsv: "Exporter CSV",
    catLabel: (cat) =>
      CATEGORY_LABELS[cat as ExpenseCategory]?.fr ?? cat,
  },
  es: {
    title: "Ingresos y gastos",
    subtitle: (cur) => `Importes en ${cur}. Los ingresos se asignan al mes de entrada.`,
    payout: "Cobros",
    expenses: "Gastos",
    net: "Neto",
    adr: "ADR",
    adrHelp: "tarifa media por noche",
    revpar: "RevPAR",
    revparHelp: "ingreso / noche disponible",
    gross: "Bruto",
    hostFee: "Comisiones",
    unpriced: (n) => `${n} ${n === 1 ? "reserva" : "reservas"} sin precio`,
    chartTitle: "Ingresos y gastos por mes",
    income: "Ingresos",
    expenseSingular: "Gastos",
    netLabel: "Neto",
    categoryBreakdown: "Por categoría",
    listTitle: "Gastos",
    addExpense: "Añadir gasto",
    editExpense: "Editar gasto",
    colDate: "Fecha",
    colProperty: "Propiedad",
    colCategory: "Categoría",
    colNote: "Nota",
    colAmount: "Importe",
    actions: "",
    edit: "Editar",
    del: "Borrar",
    delSeries: "Borrar serie",
    save: "Guardar",
    cancel: "Cancelar",
    date: "Fecha",
    amount: "Importe",
    note: "Nota (opcional)",
    category: "Categoría",
    repeatMonthly: "Repetir mensualmente",
    months: "meses",
    submit: "Añadir",
    saving: "Guardando…",
    invalidAmount: "Introduce un importe positivo, p. ej. 45.90",
    noExpenses: "Aún no hay gastos registrados.",
    recurringBadge: "mensual",
    exportCsv: "Exportar CSV",
    catLabel: (cat) =>
      CATEGORY_LABELS[cat as ExpenseCategory]?.es ?? cat,
  },
};

interface FinancePanelProps {
  property: Property | null;
  targetProperties: Property[];
  buckets: FinanceMonthBucket[];
}

export function FinancePanel({ property, targetProperties, buckets }: FinancePanelProps) {
  const { locale } = useI18n();
  const c = COPY[locale];
  const isMulti = !property;

  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Add/edit form fields
  const [fPropertyId, setFPropertyId] = useState<number>(0);
  const [fDate, setFDate] = useState("");
  const [fCategory, setFCategory] = useState<ExpenseCategory>("other");
  const [fAmount, setFAmount] = useState("");
  const [fNote, setFNote] = useState("");
  const [fRepeat, setFRepeat] = useState(false);
  const [fMonths, setFMonths] = useState("12");

  const targetIdsKey = targetProperties.map((p) => p.id).sort((a, b) => a - b).join(",");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const cur = d?.user?.currency;
        if (typeof cur === "string" && cur) setCurrency(cur);
      })
      .catch(() => {});
  }, []);

  const reloadExpenses = () => {
    const url = property
      ? `/api/expenses?propertyId=${property.id}`
      : "/api/expenses";
    fetch(url)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setExpenses(Array.isArray(rows) ? rows : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-prop-change; loading must flip on the same render that kicks the request (same pattern as reports-panel)
    setLoading(true);
    reloadExpenses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [property?.id, targetIdsKey]);

  // All money stays within the target properties.
  const moneyStays = useMemo(() => {
    const out: {
      checkIn: string;
      propertyId: number;
      grossCents?: number | null;
      hostFeeCents?: number | null;
      cleaningFeeCents?: number | null;
      payoutCents?: number | null;
    }[] = [];
    let unpriced = 0;
    for (const p of targetProperties) {
      for (const r of p.reservations ?? []) {
        const hasMoney =
          r.grossCents != null || r.payoutCents != null ||
          r.hostFeeCents != null || r.cleaningFeeCents != null;
        if (hasMoney) {
          out.push({
            checkIn: r.checkIn,
            propertyId: p.id,
            grossCents: r.grossCents,
            hostFeeCents: r.hostFeeCents,
            cleaningFeeCents: r.cleaningFeeCents,
            payoutCents: r.payoutCents,
          });
        } else {
          unpriced++;
        }
      }
    }
    return { stays: out, unpriced };
  }, [targetProperties]);

  const propFilter = useMemo(() => new Set(targetProperties.map((p) => p.id)), [targetProperties]);
  const scopedExpenses = useMemo(
    () => expenses.filter((e) => propFilter.has(e.propertyId)),
    [expenses, propFilter],
  );

  const monthsMap = useMemo(
    () => aggregateFinance(moneyStays.stays, scopedExpenses),
    [moneyStays, scopedExpenses],
  );

  const chartData = useMemo(
    () =>
      buckets.map((b) => {
        const m = monthsMap.get(b.key);
        return {
          label: b.label,
          isPast: b.isPast,
          income: (m?.payoutCents ?? 0) / 100,
          expense: (m?.expenseCents ?? 0) / 100,
          net: (m?.netCents ?? 0) / 100,
        };
      }),
    [buckets, monthsMap],
  );

  const totals = useMemo(() => {
    const visible = buckets
      .map((b) => monthsMap.get(b.key))
      .filter((m): m is NonNullable<typeof m> => !!m);
    const occupiedNights = buckets.reduce(
      (sum, b) => sum + Object.values(b.perPlatform).reduce((a, n) => a + n, 0),
      0,
    );
    const pastDays = buckets.filter((b) => b.isPast).reduce((s, b) => s + b.totalDays, 0);
    return financeTotals(visible, occupiedNights, pastDays);
  }, [buckets, monthsMap]);

  const categoryTotals = useMemo(() => {
    const visible = new Set(buckets.map((b) => b.key));
    const map = new Map<string, number>();
    for (const e of scopedExpenses) {
      if (!visible.has(e.date.substring(0, 7))) continue;
      map.set(e.category, (map.get(e.category) ?? 0) + e.amountCents);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [scopedExpenses, buckets]);

  const fmt = (cents: number) => formatCents(cents, currency, locale);

  const resetForm = () => {
    setEditingId(null);
    setFDate("");
    setFCategory("other");
    setFAmount("");
    setFNote("");
    setFRepeat(false);
    setFMonths("12");
    setFormError(null);
    if (targetProperties.length > 0) setFPropertyId(property?.id ?? targetProperties[0].id);
  };

  const openAdd = () => {
    resetForm();
    setFormOpen(true);
  };

  const openEdit = (e: Expense) => {
    setEditingId(e.id);
    setFPropertyId(e.propertyId);
    setFDate(e.date);
    setFCategory(e.category);
    setFAmount(centsToInput(e.amountCents));
    setFNote(e.note);
    setFRepeat(false);
    setFormError(null);
    setFormOpen(true);
  };

  const submitForm = async () => {
    const cents = parseMoneyInput(fAmount);
    if (cents === null || cents <= 0) {
      setFormError(c.invalidAmount);
      return;
    }
    if (!fDate) {
      setFormError(c.invalidAmount);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (editingId !== null) {
        const res = await fetch(`/api/expenses/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: fDate,
            category: fCategory,
            amountCents: cents,
            note: fNote,
          }),
        });
        if (!res.ok) throw new Error();
      } else {
        const res = await fetch("/api/expenses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            propertyId: fPropertyId,
            date: fDate,
            category: fCategory,
            amountCents: cents,
            note: fNote,
            repeatMonths: fRepeat ? Math.max(1, Math.min(120, parseInt(fMonths) || 1)) : undefined,
          }),
        });
        if (!res.ok) throw new Error();
      }
      setFormOpen(false);
      resetForm();
      reloadExpenses();
    } catch {
      setFormError(c.invalidAmount);
    } finally {
      setSaving(false);
    }
  };

  const deleteExpense = async (e: Expense, series: boolean) => {
    const url = series && e.recurGroup ? `/api/expenses/${e.id}?series=1` : `/api/expenses/${e.id}`;
    await fetch(url, { method: "DELETE" });
    reloadExpenses();
  };

  const exportCsv = () => {
    const header = "date,property,category,amount,note";
    const propName = (id: number) => targetProperties.find((p) => p.id === id)?.name ?? String(id);
    const rows = scopedExpenses.map((e) =>
      [e.date, `"${propName(e.propertyId).replace(/"/g, '""')}"`, e.category, centsToInput(e.amountCents), `"${e.note.replace(/"/g, '""')}"`].join(","),
    );
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "expenses.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const inputCls =
    "h-8 rounded-md border border-[var(--line-2)] bg-[var(--bg-2)] px-2 text-xs text-[var(--ink)] outline-none focus:border-[var(--ink)]";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="pt-2 border-t border-[var(--line)]">
        <h2 className="text-base font-semibold text-[var(--ink)]">{c.title}</h2>
        <p className="mt-0.5 text-xs text-[var(--ink-3)]">{c.subtitle(currency)}</p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-2)] px-3.5 py-3">
          <div className="text-[10px] uppercase tracking-wider text-[var(--ink-4)]">{c.payout}</div>
          <div className="mt-1 text-lg font-bold tabular-nums text-[var(--ink)]">{fmt(totals.payoutCents)}</div>
          <div className="text-[10px] text-[var(--ink-4)]">
            {c.gross} {fmt(totals.grossCents)} · {c.hostFee} {fmt(totals.hostFeeCents)}
          </div>
        </div>
        <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-2)] px-3.5 py-3">
          <div className="text-[10px] uppercase tracking-wider text-[var(--ink-4)]">{c.expenses}</div>
          <div className="mt-1 text-lg font-bold tabular-nums text-rose-500">{fmt(totals.expenseCents)}</div>
        </div>
        <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-2)] px-3.5 py-3">
          <div className="text-[10px] uppercase tracking-wider text-[var(--ink-4)]">{c.net}</div>
          <div className={`mt-1 text-lg font-bold tabular-nums ${totals.netCents >= 0 ? "text-emerald-600" : "text-rose-500"}`}>
            {fmt(totals.netCents)}
          </div>
        </div>
        <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-2)] px-3.5 py-3">
          <div className="text-[10px] uppercase tracking-wider text-[var(--ink-4)]">{c.adr}</div>
          <div className="mt-1 text-lg font-bold tabular-nums text-[var(--ink)]">{fmt(totals.adrCents)}</div>
          <div className="text-[10px] text-[var(--ink-4)]">{c.adrHelp}</div>
        </div>
        <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-2)] px-3.5 py-3">
          <div className="text-[10px] uppercase tracking-wider text-[var(--ink-4)]">{c.revpar}</div>
          <div className="mt-1 text-lg font-bold tabular-nums text-[var(--ink)]">{fmt(totals.revparCents)}</div>
          <div className="text-[10px] text-[var(--ink-4)]">{c.revparHelp}</div>
        </div>
      </div>

      {moneyStays.unpriced > 0 && (
        <p className="text-[11px] text-[var(--ink-4)]">{c.unpriced(moneyStays.unpriced)}</p>
      )}

      {/* Income vs expense chart */}
      <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-2)] p-4 text-[var(--ink-3)]">
        <div className="mb-3 text-xs text-[var(--ink-3)]">{c.chartTitle}</div>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
              <CartesianGrid stroke="currentColor" strokeOpacity={0.16} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "currentColor", fontSize: 11 }} axisLine={{ stroke: "currentColor", strokeOpacity: 0.18 }} tickLine={false} />
              <YAxis tick={{ fill: "currentColor", fontSize: 11 }} axisLine={{ stroke: "currentColor", strokeOpacity: 0.18 }} tickLine={false} />
              <Tooltip
                cursor={{ fill: "var(--m-accent)", fillOpacity: 0.06 }}
                contentStyle={{
                  background: "var(--bg)",
                  border: "1px solid var(--line-2)",
                  borderRadius: 10,
                  color: "var(--ink)",
                  fontSize: 12,
                  boxShadow: "0 4px 16px -8px rgba(0,0,0,0.18)",
                }}
                formatter={(value, name) => {
                  const label =
                    name === "income" ? c.income : name === "expense" ? c.expenseSingular : c.netLabel;
                  return [fmt(Math.round(Number(value) * 100)), label];
                }}
              />
              <Bar dataKey="income" fill="var(--m-accent)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expense" fill="#f43f5e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className="inline-flex items-center rounded-full bg-[var(--m-accent)] px-2.5 py-0.5 text-[11px] font-semibold text-white">
            {c.income}
          </span>
          <span className="inline-flex items-center rounded-full bg-rose-500 px-2.5 py-0.5 text-[11px] font-semibold text-white">
            {c.expenseSingular}
          </span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        {/* Category breakdown */}
        <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-2)] p-4">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--ink-4)]">
            {c.categoryBreakdown}
          </div>
          {categoryTotals.length === 0 ? (
            <p className="text-xs text-[var(--ink-4)]">{c.noExpenses}</p>
          ) : (
            <ul className="space-y-1.5">
              {categoryTotals.map(([cat, cents]) => (
                <li key={cat} className="flex items-center justify-between text-xs">
                  <span className="text-[var(--ink-2)]">{c.catLabel(cat)}</span>
                  <span className="tabular-nums text-[var(--ink)]">{fmt(cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Expense list + add/edit form */}
        <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-2)] overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
            <h3 className="text-sm font-semibold text-[var(--ink)]">{c.listTitle}</h3>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={exportCsv}
                disabled={scopedExpenses.length === 0}
                className="h-7 rounded-md bg-[var(--bg-3)] px-2.5 text-[11px] font-medium text-[var(--ink-2)] hover:opacity-80 disabled:opacity-40"
              >
                {c.exportCsv}
              </button>
              <button
                type="button"
                onClick={formOpen ? () => { setFormOpen(false); resetForm(); } : openAdd}
                className="h-7 rounded-md bg-[var(--m-accent)] px-2.5 text-[11px] font-medium text-white hover:bg-[var(--m-accent-2)]"
              >
                {formOpen ? c.cancel : c.addExpense}
              </button>
            </div>
          </div>

          {formOpen && (
            <div className="border-b border-[var(--line)] bg-[var(--bg-3)]/40 px-4 py-3">
              <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--ink-4)]">
                {editingId !== null ? c.editExpense : c.addExpense}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {isMulti && (
                  <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-[var(--ink-4)]">
                    {c.colProperty}
                    <select
                      value={fPropertyId}
                      onChange={(e) => setFPropertyId(Number(e.target.value))}
                      disabled={editingId !== null}
                      className={inputCls}
                    >
                      {targetProperties.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-[var(--ink-4)]">
                  {c.date}
                  <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} className={inputCls} />
                </label>
                <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-[var(--ink-4)]">
                  {c.category}
                  <select value={fCategory} onChange={(e) => setFCategory(e.target.value as ExpenseCategory)} className={inputCls}>
                    {EXPENSE_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>{c.catLabel(cat)}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-[var(--ink-4)]">
                  {c.amount} ({currency})
                  <input inputMode="decimal" value={fAmount} onChange={(e) => setFAmount(e.target.value)} placeholder="45.90" className={inputCls} />
                </label>
                <label className="col-span-2 flex flex-col gap-1 text-[10px] uppercase tracking-wider text-[var(--ink-4)] sm:col-span-4">
                  {c.note}
                  <input value={fNote} onChange={(e) => setFNote(e.target.value)} className={inputCls} />
                </label>
              </div>
              {editingId === null && (
                <div className="mt-2 flex items-center gap-2 text-xs text-[var(--ink-2)]">
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={fRepeat} onChange={(e) => setFRepeat(e.target.checked)} />
                    {c.repeatMonthly}
                  </label>
                  {fRepeat && (
                    <span className="flex items-center gap-1">
                      <input
                        type="number"
                        min={2}
                        max={120}
                        value={fMonths}
                        onChange={(e) => setFMonths(e.target.value)}
                        className={`${inputCls} w-16`}
                      />
                      {c.months}
                    </span>
                  )}
                </div>
              )}
              {formError && <p className="mt-2 text-[11px] text-rose-500">{formError}</p>}
              <button
                type="button"
                onClick={submitForm}
                disabled={saving}
                className="mt-3 h-8 rounded-md bg-[var(--m-accent)] px-3 text-xs font-medium text-white hover:bg-[var(--m-accent-2)] disabled:opacity-40"
              >
                {saving ? c.saving : editingId !== null ? c.save : c.submit}
              </button>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--line)] text-[10px] uppercase tracking-wider text-[var(--ink-4)]">
                <tr>
                  <th className="px-3 py-2 text-left font-medium sm:px-4">{c.colDate}</th>
                  {isMulti && <th className="px-3 py-2 text-left font-medium sm:px-4">{c.colProperty}</th>}
                  <th className="px-3 py-2 text-left font-medium sm:px-4">{c.colCategory}</th>
                  <th className="px-3 py-2 text-left font-medium sm:px-4 hidden sm:table-cell">{c.colNote}</th>
                  <th className="px-3 py-2 text-right font-medium sm:px-4">{c.colAmount}</th>
                  <th className="px-3 py-2 text-right font-medium sm:px-4">{c.actions}</th>
                </tr>
              </thead>
              <tbody>
                {scopedExpenses.length === 0 && !loading && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-xs text-[var(--ink-4)]">
                      {c.noExpenses}
                    </td>
                  </tr>
                )}
                {scopedExpenses.map((e) => (
                  <tr key={e.id} className="border-b border-[var(--line)]/50 last:border-0 hover:bg-[var(--bg-3)]">
                    <td className="px-3 py-2 text-[var(--ink-2)] tabular-nums sm:px-4">{e.date}</td>
                    {isMulti && (
                      <td className="px-3 py-2 text-[var(--ink-2)] sm:px-4">
                        {targetProperties.find((p) => p.id === e.propertyId)?.name ?? e.propertyId}
                      </td>
                    )}
                    <td className="px-3 py-2 text-[var(--ink-2)] sm:px-4">
                      {c.catLabel(e.category)}
                      {e.recurGroup && (
                        <span className="ml-1.5 rounded-full bg-[var(--bg-3)] px-1.5 py-0.5 text-[10px] text-[var(--ink-4)]">
                          {c.recurringBadge}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[var(--ink-3)] sm:px-4 hidden sm:table-cell max-w-[180px] truncate">
                      {e.note}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-[var(--ink)] sm:px-4">
                      {fmt(e.amountCents)}
                    </td>
                    <td className="px-3 py-2 text-right sm:px-4 whitespace-nowrap">
                      <button type="button" onClick={() => openEdit(e)} className="text-[11px] text-[var(--m-accent)] hover:underline">
                        {c.edit}
                      </button>
                      <button type="button" onClick={() => deleteExpense(e, false)} className="ml-2 text-[11px] text-rose-500 hover:underline">
                        {c.del}
                      </button>
                      {e.recurGroup && (
                        <button type="button" onClick={() => deleteExpense(e, true)} className="ml-2 text-[11px] text-rose-500/70 hover:underline">
                          {c.delSeries}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
