import { DateTime } from "luxon";
import { RRule } from "rrule";

/**
 * Recurrence is evaluated in *wall-clock time* of the event's timezone, then
 * converted to real instants. That is what makes "every Monday at 9:00"
 * stay at 9:00 across daylight-saving changes in America/Toronto.
 *
 * Technique: rrule.js works in UTC, so we feed it "floating" dates whose UTC
 * fields hold the local wall-clock values, and map results back through Luxon.
 */

const MAX_OCCURRENCES = 1500;

function toFloating(dt: DateTime): Date {
  return new Date(Date.UTC(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second));
}

function fromFloating(d: Date, zone: string): DateTime {
  return DateTime.fromObject(
    {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
    },
    { zone },
  );
}

function normaliseRule(rule: string): string {
  return rule.replace(/^RRULE:/, "").trim();
}

export function buildRule(rrule: string, start: Date, zone: string): RRule {
  const opts = RRule.parseString(normaliseRule(rrule));
  // UNTIL written as a date-time is interpreted as local wall-clock time too.
  return new RRule({ ...opts, dtstart: toFloating(DateTime.fromJSDate(start, { zone })), tzid: undefined });
}

export function isValidRule(rrule: string): boolean {
  try {
    const opts = RRule.parseString(normaliseRule(rrule));
    return opts.freq !== undefined;
  } catch {
    return false;
  }
}

export type SeriesLike = {
  start_at: string | Date;
  end_at: string | Date;
  all_day: boolean;
  timezone: string;
  rrule: string;
  exdates?: (string | Date)[] | null;
};

export type Occurrence = { start: Date; end: Date };

/** Occurrences of a series overlapping [rangeStart, rangeEnd). */
export function expandSeries(series: SeriesLike, rangeStart: Date, rangeEnd: Date): Occurrence[] {
  const zone = series.timezone || "America/Toronto";
  const start = DateTime.fromJSDate(new Date(series.start_at), { zone });
  const end = DateTime.fromJSDate(new Date(series.end_at), { zone });
  // Duration expressed in wall-clock units so an all-day / multi-day event keeps its shape.
  const duration = series.all_day
    ? { days: Math.max(1, Math.round(end.startOf("day").diff(start.startOf("day"), "days").days)) }
    : { milliseconds: end.toMillis() - start.toMillis() };
  const durationMs = end.toMillis() - start.toMillis();

  const rule = buildRule(series.rrule, start.toJSDate(), zone);
  const lookback = DateTime.fromJSDate(rangeStart, { zone }).minus({ milliseconds: durationMs }).minus({ days: 1 });
  const lookahead = DateTime.fromJSDate(rangeEnd, { zone }).plus({ days: 1 });

  const excluded = new Set((series.exdates ?? []).map((d) => new Date(d).getTime()));
  const out: Occurrence[] = [];
  const candidates = rule.between(toFloating(lookback), toFloating(lookahead), true, (_d, i) => i < MAX_OCCURRENCES);
  for (const f of candidates) {
    const s = fromFloating(f, zone);
    const e = s.plus(duration);
    const sJs = s.toJSDate();
    const eJs = e.toJSDate();
    if (excluded.has(sJs.getTime())) continue;
    if (sJs < rangeEnd && eJs > rangeStart) out.push({ start: sJs, end: eJs });
  }
  return out;
}

/** Real instant of the last occurrence start (for indexing), or null when open-ended. */
export function seriesUntil(rrule: string, start: Date, zone: string): Date | null {
  const rule = buildRule(rrule, start, zone);
  const o = rule.origOptions;
  if (!o.until && !o.count) return null;
  const all = rule.all((_d, i) => i < MAX_OCCURRENCES);
  const last = all[all.length - 1];
  return last ? fromFloating(last, zone).toJSDate() : start;
}

/** Rule truncated so the series ends right before `occurrenceStart` (for "this and following"). */
export function truncateRuleBefore(rrule: string, seriesStart: Date, occurrenceStart: Date, zone: string): string | null {
  const opts = RRule.parseString(normaliseRule(rrule));
  const local = DateTime.fromJSDate(occurrenceStart, { zone }).minus({ seconds: 1 });
  if (local.toJSDate() < seriesStart) return null; // nothing left
  delete opts.count;
  opts.until = toFloating(local);
  return RRule.optionsToString(opts).replace(/^RRULE:/, "");
}

/** Short French description of a rule, for the UI. */
export function describeRule(rrule: string | null): string | null {
  if (!rrule) return null;
  try {
    const o = RRule.parseString(normaliseRule(rrule));
    const n = o.interval && o.interval > 1 ? o.interval : 1;
    const days = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
    let base: string;
    switch (o.freq) {
      case RRule.DAILY:
        base = n === 1 ? "Tous les jours" : `Tous les ${n} jours`;
        break;
      case RRule.WEEKLY: {
        const by = Array.isArray(o.byweekday) ? o.byweekday : o.byweekday != null ? [o.byweekday] : [];
        const names = by.map((w) => days[typeof w === "number" ? w : (w as { weekday: number }).weekday]);
        base = n === 1 ? "Chaque semaine" : `Toutes les ${n} semaines`;
        if (names.length) base += ` (${names.join(", ")})`;
        break;
      }
      case RRule.MONTHLY:
        base = n === 1 ? "Chaque mois" : `Tous les ${n} mois`;
        break;
      case RRule.YEARLY:
        base = "Chaque année";
        break;
      default:
        base = "Récurrent";
    }
    if (o.count) base += `, ${o.count} fois`;
    return base;
  } catch {
    return "Récurrent";
  }
}
