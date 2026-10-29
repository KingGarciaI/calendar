import { DateTime } from "luxon";

export const LOCALE = "fr-CA";

export function dt(iso: string, tz: string) {
  return DateTime.fromISO(iso, { zone: tz }).setLocale(LOCALE);
}

export function fmtTime(iso: string, tz: string, h12 = false) {
  const d = dt(iso, tz);
  if (h12) return d.toFormat("h:mm a");
  return d.minute === 0 ? d.toFormat("H 'h'") : d.toFormat("H 'h' mm");
}

export function fmtRange(start: string, end: string, tz: string, h12 = false) {
  return `${fmtTime(start, tz, h12)} – ${fmtTime(end, tz, h12)}`;
}

export function fmtMinutes(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

export function todayISO(tz: string) {
  return DateTime.now().setZone(tz).toISODate()!;
}

/** "Aujourd'hui", "Demain", "Hier", "jeu. 5 nov." */
export function relDay(date: string, tz: string) {
  const d = DateTime.fromISO(date, { zone: tz }).startOf("day");
  const today = DateTime.now().setZone(tz).startOf("day");
  const diff = Math.round(d.diff(today, "days").days);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return "Demain";
  if (diff === -1) return "Hier";
  return d.setLocale(LOCALE).toFormat(d.year === today.year ? "ccc d LLL" : "d LLL yyyy");
}

export function dueLabel(due: string | null, tz: string) {
  if (!due) return null;
  const today = todayISO(tz);
  const days = Math.round(DateTime.fromISO(due).diff(DateTime.fromISO(today), "days").days);
  if (days < 0) return { text: days === -1 ? "Hier" : `En retard de ${-days} j`, tone: "danger" as const };
  if (days === 0) return { text: "Aujourd'hui", tone: "warning" as const };
  if (days === 1) return { text: "Demain", tone: "default" as const };
  if (days < 7) return { text: DateTime.fromISO(due).setLocale(LOCALE).toFormat("cccc"), tone: "default" as const };
  return { text: relDay(due, tz), tone: "muted" as const };
}

/** Value for <input type="datetime-local"> in tz */
export function toLocalInput(iso: string, tz: string) {
  return DateTime.fromISO(iso, { zone: tz }).toFormat("yyyy-LL-dd'T'HH:mm");
}
export function fromLocalInput(value: string, tz: string) {
  return DateTime.fromISO(value, { zone: tz }).toUTC().toISO()!;
}

export function greeting(tz: string) {
  const h = DateTime.now().setZone(tz).hour;
  if (h < 5) return "Bonne nuit";
  if (h < 12) return "Bonjour";
  if (h < 18) return "Bon après-midi";
  return "Bonsoir";
}
