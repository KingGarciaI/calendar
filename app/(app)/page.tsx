"use client";
import Link from "next/link";
import { DateTime } from "luxon";
import { CalendarDays, CheckCircle2, FolderKanban, Lock, Repeat } from "lucide-react";
import { useInspector } from "@/components/shell/inspector";
import { DayStrip } from "@/components/dashboard/day-strip";
import { AskBar } from "@/components/assistant/ask-bar";
import { TaskRow } from "@/components/tasks/task-list";
import { Dot, EmptyState, Skeleton } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { useCategories, useDay, useEvents, useMe, useProjects } from "@/lib/client/hooks";
import { fmtMinutes, fmtRange, greeting, relDay } from "@/lib/format";
import type { EventOccurrence } from "@/lib/types";
import { useMemo } from "react";

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[13px] font-semibold text-ink-2">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function DashboardPage() {
  const { data: me } = useMe();
  const tz = me?.profile.timezone ?? "America/Toronto";
  const { data: day, isLoading } = useDay();
  const { data: categories = [] } = useCategories();
  const { data: projects = [] } = useProjects();
  const { open } = useInspector();
  const now = DateTime.now().setZone(tz);
  const upcomingRange = useMemo(() => {
    const n = DateTime.now().setZone(tz);
    return { start: n.startOf("hour").toUTC().toISO()!, end: n.plus({ days: 8 }).startOf("day").toUTC().toISO()! };
  }, [tz]);
  const { data: upcoming = [] } = useEvents(upcomingRange.start, upcomingRange.end);

  const colorFor = (o: EventOccurrence) =>
    o.color ?? categories.find((c) => c.id === o.category_id)?.color ?? projects.find((p) => p.id === o.project_id)?.color ?? "#5E17EB";

  const timedToday = day?.events.filter((e) => !e.all_day) ?? [];
  const remainingToday = timedToday.filter((e) => new Date(e.occurrence_end) > new Date());
  const nextEvents = upcoming.filter((e) => !e.all_day && new Date(e.occurrence_end) > new Date()).slice(0, 6);
  const active = projects.filter((p) => p.status === "active").slice(0, 6);
  const firstName = me?.profile.full_name?.split(" ")[0];

  const summary = day
    ? [
        remainingToday.length ? `${remainingToday.length} rendez-vous à venir` : timedToday.length ? "Plus de rendez-vous aujourd'hui" : "Aucun rendez-vous",
        `${day.tasks_due.length + day.tasks_planned.length} tâche${day.tasks_due.length + day.tasks_planned.length > 1 ? "s" : ""} prévue${day.tasks_due.length + day.tasks_planned.length > 1 ? "s" : ""}`,
        day.work_minutes ? `${fmtMinutes(day.free_minutes)} de libre` : "Jour hors horaire de travail",
      ]
    : [];

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 pb-10 pt-2 md:px-8 md:pt-4">
      <header className="mb-7">
        <p className="text-sm text-ink-3">
          {greeting(tz)}
          {firstName ? `, ${firstName}` : ""}
        </p>
        <h1 className="mt-1 text-[28px] font-semibold capitalize leading-tight tracking-[-0.02em] md:text-[34px]">
          {now.setLocale("fr-CA").toFormat("cccc d LLLL")}
        </h1>
        {isLoading ? <Skeleton className="mt-3 h-4 w-72" /> : <p className="mt-2 text-[15px] text-ink-2">{summary.join(" · ")}</p>}
      </header>

      {/* Day ribbon */}
      <section className="mb-8">
        {day && me ? (
          day.work_minutes || timedToday.length ? (
            <DayStrip day={day} settings={me.settings} tz={tz} colorFor={colorFor} />
          ) : (
            <p className="rounded-[10px] bg-surface-2 px-4 py-4 text-sm text-ink-2">Journée libre selon tes heures de travail.</p>
          )
        ) : (
          <Skeleton className="h-14 w-full rounded-[10px]" />
        )}
        {day?.next_event ? (
          <button
            onClick={() =>
              open({
                kind: "event",
                id: day.next_event!.id,
                occurrence: { instance_id: day.next_event!.instance_id, start: day.next_event!.occurrence_start, end: day.next_event!.occurrence_end, recurring: day.next_event!.is_recurring_instance },
              })
            }
            className="mt-3 flex items-center gap-2 text-sm text-ink-2 hover:text-ink"
          >
            <span className="h-2 w-2 rounded-full" style={{ background: colorFor(day.next_event) }} />
            Prochain :<span className="font-semibold text-ink">{day.next_event.title}</span>
            <span className="tabular">{fmtRange(day.next_event.occurrence_start, day.next_event.occurrence_end, tz, me?.settings.time_format === "12h")}</span>
            {DateTime.fromISO(day.next_event.occurrence_start) > DateTime.now() ? (
              <span className="text-ink-3">· dans {fmtMinutes(Math.max(1, Math.round((new Date(day.next_event.occurrence_start).getTime() - Date.now()) / 60_000)))}</span>
            ) : (
              <span className="text-ink-3">· en cours</span>
            )}
          </button>
        ) : null}
      </section>

      <AskBar className="mb-10" />

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1.25fr_1fr] lg:gap-12">
        <div className="space-y-9">
          <Section title="Priorités" action={<Link href="/tasks" className="text-xs text-ink-3 hover:text-ink">Toutes les tâches</Link>}>
            {isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : day?.priorities.length ? (
              <div className="-mx-2.5 space-y-px">
                {day.priorities.map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={CheckCircle2}
                title="Aucune tâche ouverte"
                body="Note ce qui doit avancer cette semaine : l'assistant pourra ensuite te proposer des créneaux."
                action={
                  <Button size="sm" variant="primary" onClick={() => open({ kind: "new-task" })}>
                    Ajouter une tâche
                  </Button>
                }
              />
            )}
          </Section>

          {day?.overdue.length ? (
            <Section title={`En retard · ${day.overdue.length}`}>
              <div className="-mx-2.5 space-y-px">
                {day.overdue.slice(0, 6).map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </div>
            </Section>
          ) : null}
        </div>

        <div className="space-y-9">
          <Section title="À venir" action={<Link href="/calendar" className="text-xs text-ink-3 hover:text-ink">Calendrier</Link>}>
            {nextEvents.length ? (
              <ol className="space-y-0.5">
                {nextEvents.map((e) => {
                  const d = DateTime.fromISO(e.occurrence_start, { zone: tz });
                  return (
                    <li key={e.instance_id}>
                      <button
                        onClick={() => open({ kind: "event", id: e.id, occurrence: { instance_id: e.instance_id, start: e.occurrence_start, end: e.occurrence_end, recurring: e.is_recurring_instance } })}
                        className="-mx-2.5 grid w-[calc(100%+20px)] grid-cols-[88px_1fr] items-baseline gap-3 rounded-[8px] px-2.5 py-2 text-left hover:bg-surface-hover"
                      >
                        <span className="text-xs text-ink-3">
                          <span className="block font-semibold text-ink-2">{relDay(d.toISODate()!, tz)}</span>
                          <span className="tabular">{d.toFormat(me?.settings.time_format === "12h" ? "h:mm a" : "H'h'mm")}</span>
                        </span>
                        <span className="min-w-0">
                          <span className="flex items-center gap-2 text-sm font-semibold">
                            <Dot color={colorFor(e)} />
                            <span className="truncate">{e.title}</span>
                            {e.locked ? <Lock className="h-3 w-3 shrink-0 text-ink-3" /> : null}
                            {e.rrule ? <Repeat className="h-3 w-3 shrink-0 text-ink-3" /> : null}
                          </span>
                          {e.location ? <span className="mt-0.5 block truncate pl-4 text-xs text-ink-3">{e.location}</span> : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <EmptyState icon={CalendarDays} title="Rien de prévu cette semaine" body="Ajoute un rendez-vous ou bloque du temps pour un tournage." />
            )}
          </Section>

          <Section title="Projets actifs" action={<Link href="/projects" className="text-xs text-ink-3 hover:text-ink">Tous</Link>}>
            {active.length ? (
              <ul className="space-y-0.5">
                {active.map((p) => {
                  const pct = p.tasks_total ? Math.round((p.tasks_done / p.tasks_total) * 100) : 0;
                  return (
                    <li key={p.id}>
                      <Link href={`/projects/${p.id}`} className="-mx-2.5 block rounded-[8px] px-2.5 py-2 hover:bg-surface-hover">
                        <span className="flex items-center justify-between gap-3">
                          <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                            <Dot color={p.color} />
                            <span className="truncate">{p.name}</span>
                          </span>
                          <span className="shrink-0 text-xs text-ink-3 tabular">
                            {p.tasks_open ? `${p.tasks_open} ouverte${p.tasks_open > 1 ? "s" : ""}` : "À jour"}
                          </span>
                        </span>
                        <span className="mt-2 block h-1 overflow-hidden rounded-full bg-surface-2">
                          <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: p.color }} />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState
                icon={FolderKanban}
                title="Aucun projet actif"
                body="Regroupe les tâches et rendez-vous d'un client au même endroit."
                action={
                  <Link href="/projects?new=1" className="text-sm font-semibold text-accent-text hover:underline">
                    Créer un projet
                  </Link>
                }
              />
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
