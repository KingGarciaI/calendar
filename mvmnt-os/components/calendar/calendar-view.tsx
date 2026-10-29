"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import type { DateSelectArg, DatesSetArg, EventClickArg, EventContentArg, EventDropArg, EventInput } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin, { Draggable, type EventReceiveArg, type EventResizeDoneArg } from "@fullcalendar/interaction";
import luxonPlugin from "@fullcalendar/luxon3";
import frLocale from "@fullcalendar/core/locales/fr";
import { DateTime } from "luxon";
import { ChevronLeft, ChevronRight, GripVertical, Lock, PanelLeftClose, PanelLeftOpen, Repeat, Check } from "lucide-react";
import { toast } from "sonner";
import { useInspector, useHotkeys, useMediaQuery } from "@/components/shell/inspector";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/overlay";
import { PriorityIcon, Segmented, Spinner } from "@/components/ui/misc";
import { api } from "@/lib/client/api";
import { conflictToast, errorToast, useCategories, useEvents, useInvalidateData, useMe, useProjects, useScheduleTask, useTasks } from "@/lib/client/hooks";
import { fmtMinutes } from "@/lib/format";
import type { Conflict, EventDetail, EventOccurrence } from "@/lib/types";
import { cn } from "@/lib/utils";

type ViewKey = "timeGridDay" | "timeGrid3" | "timeGridWeek" | "dayGridMonth" | "listWeek";

const VIEW_LABELS: Record<ViewKey, string> = {
  timeGridDay: "Jour",
  timeGrid3: "3 jours",
  timeGridWeek: "Semaine",
  dayGridMonth: "Mois",
  listWeek: "Agenda",
};

type PendingChange = {
  occ: EventOccurrence;
  patch: { start_at: string; end_at: string; all_day?: boolean };
  revert: () => void;
};

function toUtc(str: string, allDay: boolean, tz: string) {
  if (allDay) return DateTime.fromISO(str.slice(0, 10), { zone: tz }).startOf("day").toUTC().toISO()!;
  return new Date(str).toISOString();
}

export function CalendarView() {
  const calRef = useRef<FullCalendar>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const isMobile = useMediaQuery("(max-width: 767px)");
  const { open, panel } = useInspector();
  const { data: me } = useMe();
  const tz = me?.profile.timezone ?? "America/Toronto";
  const settings = me?.settings;
  const h12 = settings?.time_format === "12h";
  const { data: categories = [] } = useCategories();
  const { data: projects = [] } = useProjects();
  const [range, setRange] = useState<{ start: string; end: string }>({ start: "", end: "" });
  const [title, setTitle] = useState("");
  const [view, setView] = useState<ViewKey>("timeGridWeek");
  const [railOpen, setRailOpen] = useState(true);
  const [pending, setPending] = useState<PendingChange | null>(null);
  const handledRef = useRef(false);
  const { data: occurrences = [], isFetching } = useEvents(range.start, range.end);
  const { data: unscheduled = [] } = useTasks({ status: "todo,in_progress", unscheduled: 1 });
  const invalidate = useInvalidateData();
  const schedule = useScheduleTask();

  // Pick a sensible initial view per device, remember the user's choice.
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("mvmnt.calendar.view");
    } catch {}
    const initial = (saved && saved in VIEW_LABELS ? saved : isMobile ? "timeGrid3" : "timeGridWeek") as ViewKey;
    const v = isMobile && (initial === "timeGridWeek" || initial === "timeGrid3") ? "timeGrid3" : initial;
    setView(v);
    calRef.current?.getApi().changeView(v);
  }, [isMobile]);

  const changeView = (v: ViewKey) => {
    setView(v);
    calRef.current?.getApi().changeView(v);
    try {
      localStorage.setItem("mvmnt.calendar.view", v);
    } catch {}
  };

  // Resize FullCalendar when the side panel opens/closes.
  useEffect(() => {
    const t = setTimeout(() => calRef.current?.getApi().updateSize(), 200);
    return () => clearTimeout(t);
  }, [panel, railOpen]);

  // Make unscheduled tasks draggable onto the calendar.
  useEffect(() => {
    if (!railRef.current) return;
    const d = new Draggable(railRef.current, {
      itemSelector: "[data-task-id]",
      eventData: (el) => ({
        title: el.getAttribute("data-title") ?? "",
        duration: { minutes: Number(el.getAttribute("data-minutes") || settings?.default_event_minutes || 60) },
        create: true,
        extendedProps: { taskId: el.getAttribute("data-task-id") },
      }),
    });
    return () => d.destroy();
  }, [settings?.default_event_minutes, railOpen]);

  const colorFor = useCallback(
    (o: EventOccurrence) =>
      o.color ?? categories.find((c) => c.id === o.category_id)?.color ?? projects.find((p) => p.id === o.project_id)?.color ?? "#5E17EB",
    [categories, projects],
  );

  const events: EventInput[] = useMemo(
    () =>
      occurrences.map((o) => ({
        id: o.instance_id,
        title: o.title,
        start: o.all_day ? DateTime.fromISO(o.occurrence_start, { zone: tz }).toISODate()! : o.occurrence_start,
        end: o.all_day ? DateTime.fromISO(o.occurrence_end, { zone: tz }).toISODate()! : o.occurrence_end,
        allDay: o.all_day,
        extendedProps: { occ: o, color: colorFor(o) },
      })),
    [occurrences, tz, colorFor],
  );

  const onDatesSet = (arg: DatesSetArg) => {
    setTitle(arg.view.title);
    setRange({ start: arg.start.toISOString(), end: arg.end.toISOString() });
  };

  const onSelect = (arg: DateSelectArg) => {
    const start = toUtc(arg.startStr, arg.allDay, tz);
    let end = toUtc(arg.endStr, arg.allDay, tz);
    // A single click in month view selects a whole day: make it a timed default instead.
    if (arg.allDay && arg.view.type === "dayGridMonth") {
      const s = DateTime.fromISO(arg.startStr, { zone: tz }).set({ hour: 9 });
      open({ kind: "new-event", draft: { start_at: s.toUTC().toISO()!, end_at: s.plus({ minutes: settings?.default_event_minutes ?? 60 }).toUTC().toISO()! } });
    } else {
      if (!arg.allDay && new Date(end).getTime() - new Date(start).getTime() <= 30 * 60_000 && settings) {
        end = new Date(new Date(start).getTime() + settings.default_event_minutes * 60_000).toISOString();
      }
      open({ kind: "new-event", draft: { start_at: start, end_at: end, all_day: arg.allDay } });
    }
    calRef.current?.getApi().unselect();
  };

  const onClick = (arg: EventClickArg) => {
    arg.jsEvent.preventDefault();
    const o = arg.event.extendedProps.occ as EventOccurrence;
    open({
      kind: "event",
      id: o.id,
      occurrence: { instance_id: o.instance_id, start: o.occurrence_start, end: o.occurrence_end, recurring: o.is_recurring_instance },
    });
  };

  const commit = async (change: PendingChange, scope?: "occurrence" | "following" | "series") => {
    const { occ, patch } = change;
    try {
      const r = await api.patch<{ event: EventDetail; conflicts: Conflict[] }>(`/api/events/${occ.id}`, {
        patch,
        scope: scope ?? "series",
        occurrence_start: occ.is_recurring_instance ? occ.occurrence_start : undefined,
      });
      await invalidate();
      const moved = DateTime.fromISO(patch.start_at, { zone: tz }).setLocale("fr-CA");
      const undo =
        !occ.is_recurring_instance && !occ.rrule
          ? async () => {
              await api.patch(`/api/events/${occ.id}`, { patch: { start_at: occ.occurrence_start, end_at: occ.occurrence_end, all_day: occ.all_day } });
              await invalidate();
            }
          : undefined;
      if (r.conflicts.length) conflictToast(r.conflicts, tz, undo);
      else toast.success(`${occ.title} · ${moved.toFormat(patch.all_day ? "cccc d LLL" : "ccc d LLL, H'h'mm")}`, { action: undo ? { label: "Annuler", onClick: undo } : undefined });
    } catch (e) {
      change.revert();
      errorToast(e);
    }
  };

  const onMove = (arg: EventDropArg | EventResizeDoneArg) => {
    const o = arg.event.extendedProps.occ as EventOccurrence;
    const allDay = arg.event.allDay;
    const start = toUtc(arg.event.startStr, allDay, tz);
    const endStr = arg.event.endStr || arg.event.startStr;
    let end = toUtc(endStr, allDay, tz);
    if (allDay && end <= start) end = DateTime.fromISO(start).plus({ days: 1 }).toUTC().toISO()!;
    if (!allDay && !arg.event.endStr) {
      const dur = new Date(o.occurrence_end).getTime() - new Date(o.occurrence_start).getTime();
      end = new Date(new Date(start).getTime() + (o.all_day ? (settings?.default_event_minutes ?? 60) * 60_000 : dur)).toISOString();
    }
    const change: PendingChange = { occ: o, patch: { start_at: start, end_at: end, all_day: allDay }, revert: arg.revert };
    if (o.is_recurring_instance) {
      handledRef.current = false;
      setPending(change);
    }
    else void commit(change);
  };

  const onReceive = async (arg: EventReceiveArg) => {
    const taskId = arg.event.extendedProps.taskId as string;
    const start = arg.event.allDay
      ? DateTime.fromISO(arg.event.startStr.slice(0, 10), { zone: tz }).set({ hour: Number(settings?.work_start.slice(0, 2) ?? 9) }).toUTC().toISO()!
      : new Date(arg.event.startStr).toISOString();
    arg.event.remove();
    try {
      const r = await schedule.mutateAsync({ id: taskId, start_at: start });
      toast.success(`Planifiée · ${DateTime.fromISO(r.event.start_at, { zone: tz }).setLocale("fr-CA").toFormat("ccc d LLL, H'h'mm")}`);
      conflictToast(r.conflicts, tz);
    } catch {
      /* toast already shown */
    }
  };

  const api_ = () => calRef.current?.getApi();
  const hotkeys = useMemo(
    () => ({
      t: () => api_()?.today(),
      arrowleft: () => api_()?.prev(),
      arrowright: () => api_()?.next(),
      d: () => changeView("timeGridDay"),
      w: () => changeView(isMobile ? "timeGrid3" : "timeGridWeek"),
      m: () => changeView("dayGridMonth"),
      l: () => changeView("listWeek"),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isMobile],
  );
  useHotkeys(hotkeys);

  const scrollTime = useMemo(() => {
    const now = DateTime.now().setZone(tz);
    return `${String(Math.max(0, Math.min(now.hour - 1, 15))).padStart(2, "0")}:00:00`;
  }, [tz]);

  const renderEvent = (arg: EventContentArg) => {
    const o = arg.event.extendedProps.occ as EventOccurrence | undefined;
    const color = (arg.event.extendedProps.color as string) ?? "var(--accent)";
    const done = o?.task_status === "done";
    const past = arg.isPast;
    const icons = (
      <>
        {o?.locked ? <Lock className="h-2.5 w-2.5 shrink-0 opacity-70" /> : null}
        {o?.rrule || o?.recurrence_parent_id ? <Repeat className="h-2.5 w-2.5 shrink-0 opacity-60" /> : null}
        {done ? <Check className="h-3 w-3 shrink-0" style={{ color }} /> : null}
      </>
    );
    if (arg.view.type === "listWeek") {
      return (
        <span className={cn("flex items-center gap-2", done && "text-ink-3 line-through")}>
          {arg.event.title}
          {icons}
        </span>
      );
    }
    if (arg.view.type === "dayGridMonth" && !arg.event.allDay) {
      return (
        <div className={cn("flex w-full min-w-0 items-center gap-1.5 text-[11.5px]", past && "opacity-55")}>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
          <span className="tabular text-ink-3">{arg.timeText}</span>
          <span className={cn("truncate font-semibold text-ink", done && "line-through")}>{arg.event.title}</span>
        </div>
      );
    }
    const short = arg.event.end && arg.event.start ? arg.event.end.getTime() - arg.event.start.getTime() <= 35 * 60_000 : false;
    return (
      <div
        className={cn("relative h-full w-full overflow-hidden rounded-[6px] pl-2.5 pr-1.5 text-ink", short ? "py-0.5" : "py-1", past && "opacity-60")}
        style={{
          background: `color-mix(in oklab, ${color} ${o?.busy === false ? 8 : 16}%, var(--surface))`,
          boxShadow: `inset 3px 0 0 ${color}`,
          border: o?.busy === false ? `1px dashed color-mix(in oklab, ${color} 50%, transparent)` : undefined,
        }}
      >
        <div className={cn("flex min-w-0 items-center gap-1", short ? "text-[11px]" : "text-[12px]")}>
          <span className={cn("truncate font-semibold leading-tight", done && "text-ink-3 line-through")}>{arg.event.title}</span>
          {icons}
          {short && !arg.event.allDay ? <span className="ml-auto shrink-0 text-[10.5px] text-ink-2 tabular">{arg.timeText.split(" – ")[0]}</span> : null}
        </div>
        {!short && !arg.event.allDay ? <div className="mt-0.5 truncate text-[11px] text-ink-2 tabular">{arg.timeText}</div> : null}
        {!short && o?.location && arg.event.end && arg.event.start && arg.event.end.getTime() - arg.event.start.getTime() >= 75 * 60_000 ? (
          <div className="truncate text-[11px] text-ink-3">{o.location}</div>
        ) : null}
      </div>
    );
  };

  const hidden = !settings;
  const workDays = settings?.work_days ?? [1, 2, 3, 4, 5];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3 md:px-6">
        <div className="flex items-center gap-2">
          {!isMobile ? (
            <button
              onClick={() => setRailOpen((o) => !o)}
              className="hidden rounded-md p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink lg:block"
              aria-label={railOpen ? "Masquer les tâches à planifier" : "Afficher les tâches à planifier"}
            >
              {railOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
            </button>
          ) : null}
          <h1 className="min-w-0 text-lg font-semibold capitalize tracking-[-0.01em] md:text-xl">{title}</h1>
          {isFetching ? <Spinner className="ml-1 h-3 w-3 text-ink-3" /> : null}
        </div>
        <div className="flex w-full items-center justify-between gap-2 md:w-auto">
          <div className="flex items-center gap-1">
            <Button size="sm" variant="secondary" onClick={() => api_()?.today()} title="Aujourd'hui (T)">
              Aujourd&apos;hui
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => api_()?.prev()} aria-label="Période précédente">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => api_()?.next()} aria-label="Période suivante">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <Segmented
            value={view}
            onChange={changeView}
            options={(isMobile ? (["timeGridDay", "timeGrid3", "dayGridMonth", "listWeek"] as ViewKey[]) : (["timeGridDay", "timeGridWeek", "dayGridMonth", "listWeek"] as ViewKey[])).map((v) => ({
              value: v,
              label: VIEW_LABELS[v],
            }))}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-4 px-0 md:px-6 md:pb-6">
        {/* Unscheduled tasks rail */}
        {!isMobile && railOpen ? (
          <div className="hidden w-[220px] shrink-0 flex-col lg:flex">
            <p className="px-1 pb-2 text-xs font-semibold text-ink-2">
              À planifier <span className="font-normal text-ink-3">{unscheduled.length || ""}</span>
            </p>
            <div ref={railRef} className="scroll-thin min-h-0 flex-1 space-y-1.5 overflow-y-auto pb-2 pr-1">
              {unscheduled.length === 0 ? (
                <p className="rounded-[10px] border border-dashed border-line px-3 py-4 text-xs text-ink-3">
                  Toutes tes tâches ouvertes ont une place dans ton calendrier.
                </p>
              ) : (
                unscheduled.map((t) => (
                  <div
                    key={t.id}
                    data-task-id={t.id}
                    data-title={t.title}
                    data-minutes={t.estimated_minutes ?? ""}
                    onClick={() => open({ kind: "task", id: t.id })}
                    className="group flex cursor-grab items-start gap-2 rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[12.5px] shadow-[0_1px_0_rgb(0_0_0/0.02)] hover:border-line-strong active:cursor-grabbing"
                  >
                    <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-3 opacity-40 group-hover:opacity-100" />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 font-semibold leading-snug">{t.title}</p>
                      <p className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-3">
                        <PriorityIcon priority={t.priority} className="h-3 w-3" />
                        {t.estimated_minutes ? fmtMinutes(t.estimated_minutes) : "Durée ?"}
                        {t.due_date ? ` · ${DateTime.fromISO(t.due_date).setLocale("fr-CA").toFormat("d LLL")}` : ""}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
            <p className="px-1 pt-2 text-[11px] leading-snug text-ink-3">Glisse une tâche sur le calendrier pour lui réserver du temps.</p>
          </div>
        ) : null}

        <div className={cn("mv-cal min-h-0 min-w-0 flex-1 overflow-hidden border-line bg-surface md:rounded-[var(--radius-panel)] md:border", hidden && "invisible")}>
          <FullCalendar
            ref={calRef}
            plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, luxonPlugin]}
            initialView="timeGridWeek"
            views={{ timeGrid3: { type: "timeGrid", duration: { days: 3 }, dateIncrement: { days: 1 } } }}
            headerToolbar={false}
            locale={frLocale}
            timeZone={tz}
            firstDay={settings?.week_start ?? 1}
            height="100%"
            events={events}
            editable
            eventStartEditable
            eventDurationEditable
            droppable
            selectable
            selectMirror
            unselectAuto
            nowIndicator
            dayMaxEvents={3}
            longPressDelay={350}
            eventLongPressDelay={350}
            selectLongPressDelay={350}
            snapDuration="00:15:00"
            slotDuration="00:30:00"
            scrollTime={scrollTime}
            scrollTimeReset={false}
            allDayText="Journée"
            noEventsText="Rien de prévu sur cette période."
            businessHours={settings ? { daysOfWeek: workDays, startTime: settings.work_start, endTime: settings.work_end } : undefined}
            slotLabelFormat={h12 ? { hour: "numeric", meridiem: "short" } : { hour: "2-digit", minute: "2-digit", hour12: false }}
            eventTimeFormat={h12 ? { hour: "numeric", minute: "2-digit", meridiem: "short" } : { hour: "2-digit", minute: "2-digit", hour12: false }}
            dayHeaderContent={(arg) => {
              if (arg.view.type === "dayGridMonth") return <span className="text-[11px] font-semibold capitalize text-ink-3">{arg.date.toLocaleDateString("fr-CA", { weekday: "short", timeZone: "UTC" })}</span>;
              if (arg.view.type.startsWith("list")) return undefined;
              const d = DateTime.fromJSDate(arg.date, { zone: "utc" }).setLocale("fr-CA");
              return (
                <span className="flex flex-col items-center gap-1">
                  <span className="text-[11px] font-semibold capitalize text-ink-3">{d.toFormat("ccc")}</span>
                  <span
                    className={cn(
                      "flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-[15px] font-semibold tabular",
                      arg.isToday ? "bg-accent text-accent-fg" : "text-ink",
                    )}
                  >
                    {d.day}
                  </span>
                </span>
              );
            }}
            eventContent={renderEvent}
            datesSet={onDatesSet}
            select={onSelect}
            eventClick={onClick}
            eventDrop={onMove}
            eventResize={onMove}
            eventReceive={onReceive}
          />
        </div>
      </div>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => {
          if (!o && pending) {
            if (!handledRef.current) pending.revert();
            setPending(null);
          }
        }}
        title="Déplacer un événement récurrent"
        body={pending ? `« ${pending.occ.title} » fait partie d'une série.` : undefined}
        options={[
          { label: "Cette occurrence", tone: "primary", onSelect: () => { handledRef.current = true; if (pending) void commit(pending, "occurrence"); } },
          { label: "Celle-ci et les suivantes", tone: "secondary", onSelect: () => { handledRef.current = true; if (pending) void commit(pending, "following"); } },
          { label: "Toute la série", tone: "secondary", onSelect: () => { handledRef.current = true; if (pending) void commit(pending, "series"); } },
        ]}
      />
    </div>
  );
}
