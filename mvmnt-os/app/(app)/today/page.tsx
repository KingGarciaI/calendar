"use client";
import { useState } from "react";
import { DateTime } from "luxon";
import { ChevronLeft, ChevronRight, MapPin, Plus, Sun } from "lucide-react";
import { useInspector } from "@/components/shell/inspector";
import { QuickAddTask, TaskGroup } from "@/components/tasks/task-list";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { useCategories, useDay, useMe, useProjects } from "@/lib/client/hooks";
import { fmtMinutes, fmtTime, relDay, todayISO } from "@/lib/format";
import type { EventOccurrence, Slot } from "@/lib/types";
import { cn } from "@/lib/utils";

type Item = { kind: "event"; at: string; ev: EventOccurrence } | { kind: "free"; at: string; slot: Slot };

export default function TodayPage() {
  const { data: me } = useMe();
  const tz = me?.profile.timezone ?? "America/Toronto";
  const h12 = me?.settings.time_format === "12h";
  const [date, setDate] = useState<string | null>(null);
  const current = date ?? todayISO(tz);
  const isToday = current === todayISO(tz);
  const { data: day, isLoading } = useDay(date ?? undefined);
  const { data: categories = [] } = useCategories();
  const { data: projects = [] } = useProjects();
  const { open } = useInspector();
  const colorFor = (o: EventOccurrence) =>
    o.color ?? categories.find((c) => c.id === o.category_id)?.color ?? projects.find((p) => p.id === o.project_id)?.color ?? "#5E17EB";

  const shift = (days: number) => setDate(DateTime.fromISO(current).plus({ days }).toISODate()!);
  const allDay = day?.events.filter((e) => e.all_day) ?? [];
  const items: Item[] = [
    ...(day?.events.filter((e) => !e.all_day).map((ev) => ({ kind: "event" as const, at: ev.occurrence_start, ev })) ?? []),
    ...(day?.free_slots.filter((s) => s.minutes >= 30).map((slot) => ({ kind: "free" as const, at: slot.start, slot })) ?? []),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const now = Date.now();
  const d = DateTime.fromISO(current, { zone: tz }).setLocale("fr-CA");

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 pb-10 pt-2 md:px-8 md:pt-4">
      <header className="mb-7 flex items-end justify-between gap-4">
        <div>
          <p className="text-sm text-ink-3">{relDay(current, tz)}</p>
          <h1 className="mt-1 text-[28px] font-semibold capitalize leading-tight tracking-[-0.02em]">{d.toFormat("cccc d LLLL")}</h1>
          {day ? (
            <p className="mt-2 text-sm text-ink-2">
              {day.work_minutes ? `${fmtMinutes(day.busy_minutes)} occupées · ${fmtMinutes(day.free_minutes)} libres${isToday ? " d'ici la fin de journée" : ""}` : "Hors de tes jours de travail"}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {!isToday ? (
            <Button size="sm" onClick={() => setDate(null)}>
              Aujourd&apos;hui
            </Button>
          ) : null}
          <Button size="icon-sm" variant="ghost" onClick={() => shift(-1)} aria-label="Jour précédent">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => shift(1)} aria-label="Jour suivant">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {allDay.length ? (
        <div className="mb-5 flex flex-wrap gap-2">
          {allDay.map((e) => (
            <button
              key={e.instance_id}
              onClick={() => open({ kind: "event", id: e.id, occurrence: { instance_id: e.instance_id, start: e.occurrence_start, end: e.occurrence_end, recurring: e.is_recurring_instance } })}
              className="rounded-full px-3 py-1 text-xs font-semibold"
              style={{ background: `color-mix(in oklab, ${colorFor(e)} 16%, var(--surface))` }}
            >
              {e.title}
            </button>
          ))}
        </div>
      ) : null}

      <section className="mb-10">
        <h2 className="mb-3 text-[13px] font-semibold text-ink-2">Agenda</h2>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : items.length ? (
          <ol className="relative">
            {items.map((it) => {
              if (it.kind === "free") {
                return (
                  <li key={`f-${it.at}`} className="grid grid-cols-[64px_1fr] gap-4">
                    <span className="pt-2.5 text-right text-xs text-ink-3 tabular">{fmtTime(it.slot.start, tz, h12)}</span>
                    <button
                      onClick={() => open({ kind: "new-event", draft: { start_at: it.slot.start, end_at: new Date(Math.min(new Date(it.slot.end).getTime(), new Date(it.slot.start).getTime() + (me?.settings.default_event_minutes ?? 60) * 60_000)).toISOString() } })}
                      className="group my-1 flex items-center justify-between rounded-[8px] border border-dashed border-line px-3 py-2 text-left text-xs text-ink-3 hover:border-accent hover:text-accent-text"
                    >
                      <span>Libre · {fmtMinutes(it.slot.minutes)}</span>
                      <Plus className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100" />
                    </button>
                  </li>
                );
              }
              const e = it.ev;
              const past = new Date(e.occurrence_end).getTime() < now;
              const live = new Date(e.occurrence_start).getTime() <= now && !past;
              const c = colorFor(e);
              return (
                <li key={e.instance_id} className="grid grid-cols-[64px_1fr] gap-4">
                  <span className={cn("pt-3 text-right text-xs tabular", live ? "font-semibold text-ink" : "text-ink-3")}>{fmtTime(e.occurrence_start, tz, h12)}</span>
                  <button
                    onClick={() => open({ kind: "event", id: e.id, occurrence: { instance_id: e.instance_id, start: e.occurrence_start, end: e.occurrence_end, recurring: e.is_recurring_instance } })}
                    className={cn("relative my-1 rounded-[10px] py-2.5 pl-4 pr-3 text-left transition-colors hover:brightness-[0.98]", past && "opacity-55")}
                    style={{ background: `color-mix(in oklab, ${c} 13%, var(--surface))`, boxShadow: `inset 3px 0 0 ${c}` }}
                  >
                    {live ? <span className="absolute -left-[13px] top-3.5 h-2 w-2 rounded-full bg-now" aria-label="En cours" /> : null}
                    <span className={cn("block text-sm font-semibold", e.task_status === "done" && "line-through")}>{e.title}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-ink-2">
                      <span className="tabular">
                        {fmtTime(e.occurrence_start, tz, h12)} – {fmtTime(e.occurrence_end, tz, h12)}
                      </span>
                      {e.location ? (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {e.location}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        ) : (
          <EmptyState
            icon={Sun}
            title={isToday ? "Aucun rendez-vous aujourd'hui" : "Aucun rendez-vous ce jour-là"}
            body="Bloque du temps pour ce qui compte : un tournage, une session de montage, de la prospection."
            action={
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  const s = DateTime.fromISO(current, { zone: tz }).set({ hour: Number(me?.settings.work_start.slice(0, 2) ?? 9) });
                  open({ kind: "new-event", draft: { start_at: s.toUTC().toISO()!, end_at: s.plus({ minutes: me?.settings.default_event_minutes ?? 60 }).toUTC().toISO()! } });
                }}
              >
                Bloquer du temps
              </Button>
            }
          />
        )}
      </section>

      <div className="-mx-2.5">
        <TaskGroup title="En retard" tone="danger" tasks={day?.overdue ?? []} />
        <TaskGroup title={isToday ? "À rendre aujourd'hui" : "À rendre ce jour-là"} tasks={day?.tasks_due ?? []}>
          <QuickAddTask defaults={{ due_date: current }} placeholder={isToday ? "Ajouter une tâche pour aujourd'hui" : "Ajouter une tâche pour ce jour"} />
        </TaskGroup>
        <TaskGroup title="Planifiées" tasks={day?.tasks_planned ?? []} />
      </div>
    </div>
  );
}
