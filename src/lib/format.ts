export function formatCurrency(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatPercent(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(n)) return "—";
  return `${n}%`;
}

export function formatDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v.length <= 10 ? v + "T00:00:00" : v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

export function formatDateTime(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / 86400000);
}

export const BADGE_CLASSES: Record<string, string> = {
  green: "bg-green-100 text-green-700 ring-green-600/20",
  blue: "bg-blue-100 text-blue-700 ring-blue-600/20",
  amber: "bg-amber-100 text-amber-700 ring-amber-600/20",
  orange: "bg-orange-100 text-orange-700 ring-orange-600/20",
  red: "bg-red-100 text-red-700 ring-red-600/20",
  purple: "bg-purple-100 text-purple-700 ring-purple-600/20",
  gray: "bg-gray-100 text-gray-600 ring-gray-500/20",
};
