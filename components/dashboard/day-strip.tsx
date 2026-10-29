"use client";
import { useEffect, useState } from "react";
import { DateTime } from "luxon";
import { useInspector } from "@/components/shell/inspector";
import type { DaySchedule, UserSettings } from "@/lib/types";
import { fmtRange } from "@/lib/format";

/**
 * Horizontal ribbon of the working day: blocks for what is booked, open
 * track for what is free, and a single yellow line for "now".
 */
export function DayStrip({ day, settings, tz, colorFor }: { day: DaySchedule; settings: UserSettings; tz: string; colorFor: (o: DaySchedule["events"][number]) => string }) {
  const { open } = useInspector();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const base = DateTime.fromISO(day.date, { zone: tz });
  const timed = day.events.filter((e) => !e.all_day);
  // Show working hours, stretched to include anything booked outside them.
  const [wsH, wsM] = settings.work_start.split(":").map(Number);
  const [weH, weM] = settings.work_end.split(":").map(Number);
  let start = base.set({ hour: wsH, minute: wsM }).toMillis();
  let end = base.set({ hour: weH, minute: weM }).toMillis();
  for (const e of timed) {
    start = Math.min(start, DateTime.fromISO(e.occurrence_start).startOf("hour").toMillis());
    end = Math.max(end, DateTime.fromISO(e.occurrence_end).plus({ minutes: 59 }).startOf("hour").toMillis());
  }
  start = Math.max(start, base.startOf("day").toMillis());
  end = Math.min(end, base.endOf("day").toMillis());
  const span = end - start;
  const pct = (ms: number) => `${Math.max(0, Math.min(100, ((ms - start) / span) * 100))}%`;
  const hours: number[] = [];
  for (let t = DateTime.fromMillis(start, { zone: tz }).startOf("hour"); t.toMillis() <= end; t = t.plus({ hours: 1 })) {
    if (t.toMillis() >= start) hours.push(t.toMillis());
  }
  const showNow = now >= start && now <= end;

  return (
    <div className="select-none">
      <div className="relative h-14 rounded-[10px] bg-surface-2">
        {/* hour ticks */}
        {hours.map((h) => (
          <span key={h} className="absolute inset-y-0 w-px bg-line" style={{ left: pct(h) }} />
        ))}
        {/* free gaps */}
        {day.free_slots.map((s) => (
          <span
            key={s.start}
            className="absolute inset-y-[18px] rounded-full border border-dashed border-line-strong"
            style={{ left: pct(new Date(s.start).getTime()), width: `calc(${pct(new Date(s.end).getTime())} - ${pct(new Date(s.start).getTime())})` }}
            title={`Libre ${fmtRange(s.start, s.end, tz)}`}
          />
        ))}
        {/* booked blocks */}
        {timed.map((e) => {
          const s = new Date(e.occurrence_start).getTime();
          const f = new Date(e.occurrence_end).getTime();
          const c = colorFor(e);
          const past = f < now;
          return (
            <button
              key={e.instance_id}
              onClick={() => open({ kind: "event", id: e.id, occurrence: { instance_id: e.instance_id, start: e.occurrence_start, end: e.occurrence_end, recurring: e.is_recurring_instance } })}
              className="absolute inset-y-1.5 overflow-hidden rounded-[7px] px-2 text-left transition-opacity hover:opacity-90 focus-visible:z-10"
              style={{
                left: pct(s),
                width: `max(6px, calc(${pct(f)} - ${pct(s)} - 2px))`,
                background: `color-mix(in oklab, ${c} ${past ? 10 : 22}%, var(--surface))`,
                boxShadow: `inset 3px 0 0 ${c}`,
              }}
              title={`${e.title} · ${fmtRange(e.occurrence_start, e.occurrence_end, tz)}`}
            >
              <span className={`block truncate pt-1 text-[11.5px] font-semibold ${past ? "text-ink-3" : "text-ink"}`}>{e.title}</span>
              <span className="block truncate text-[10.5px] text-ink-3 tabular">{fmtRange(e.occurrence_start, e.occurrence_end, tz)}</span>
            </button>
          );
        })}
        {showNow ? (
          <span className="pointer-events-none absolute -inset-y-1.5 z-20 w-[2px] rounded-full bg-now" style={{ left: pct(now) }}>
            <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-now" />
          </span>
        ) : null}
      </div>
      <div className="relative mt-1.5 h-4">
        {hours.map((h, i) =>
          i % (hours.length > 12 ? 2 : 1) === 0 ? (
            <span key={h} className="absolute -translate-x-1/2 text-[10.5px] text-ink-3 tabular" style={{ left: pct(h) }}>
              {DateTime.fromMillis(h, { zone: tz }).toFormat("H")}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}
