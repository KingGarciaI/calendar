"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import { AlertTriangle, Bell, CalendarDays, CheckSquare, FolderKanban, Lock, MapPin, Repeat, Tag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea, TitleInput } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/overlay";
import { Skeleton, Spinner, SwatchPicker } from "@/components/ui/misc";
import { useInspector, type EventDraft } from "@/components/shell/inspector";
import {
  checkConflicts,
  conflictToast,
  useCategories,
  useCreateEvent,
  useDeleteEvent,
  useEvent,
  useMe,
  useProjects,
  useUpdateEvent,
} from "@/lib/client/hooks";
import { fmtRange, relDay } from "@/lib/format";
import { describeRule } from "@/lib/recurrence";
import type { Conflict, EventDetail, Slot } from "@/lib/types";
import type { EventCreateInput } from "@/lib/schemas";
import { cn } from "@/lib/utils";

const REMINDER_OPTIONS = [
  { v: 5, l: "5 min" },
  { v: 15, l: "15 min" },
  { v: 30, l: "30 min" },
  { v: 60, l: "1 h" },
  { v: 1440, l: "1 jour" },
];

type Occ = { instance_id: string; start: string; end: string; recurring: boolean };

type Form = {
  title: string;
  all_day: boolean;
  startLocal: string; // yyyy-MM-ddTHH:mm or yyyy-MM-dd (all day)
  endLocal: string;
  rrule: string;
  category_id: string;
  project_id: string;
  location: string;
  description: string;
  notes: string;
  color: string | null;
  busy: boolean;
  locked: boolean;
  reminder_offsets: number[];
};

function recurrenceOptions(startLocal: string, tz: string) {
  const d = DateTime.fromISO(startLocal, { zone: tz });
  const days = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
  const wd = days[(d.isValid ? d.weekday : 1) - 1];
  const dayName = d.isValid ? d.setLocale("fr-CA").toFormat("cccc") : "";
  return [
    { v: "", l: "Ne se répète pas" },
    { v: "FREQ=DAILY", l: "Tous les jours" },
    { v: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", l: "Jours de semaine (lun.–ven.)" },
    { v: `FREQ=WEEKLY;BYDAY=${wd}`, l: `Chaque semaine le ${dayName}` },
    { v: `FREQ=WEEKLY;INTERVAL=2;BYDAY=${wd}`, l: `Toutes les 2 semaines le ${dayName}` },
    { v: "FREQ=MONTHLY", l: `Chaque mois le ${d.isValid ? d.day : ""}` },
    { v: "FREQ=YEARLY", l: "Chaque année" },
  ];
}

function toIsoPair(f: Form, tz: string) {
  if (f.all_day) {
    const s = DateTime.fromISO(f.startLocal.slice(0, 10), { zone: tz }).startOf("day");
    let e = DateTime.fromISO(f.endLocal.slice(0, 10), { zone: tz }).startOf("day").plus({ days: 1 });
    if (e <= s) e = s.plus({ days: 1 });
    return { start_at: s.toUTC().toISO()!, end_at: e.toUTC().toISO()! };
  }
  return {
    start_at: DateTime.fromISO(f.startLocal, { zone: tz }).toUTC().toISO()!,
    end_at: DateTime.fromISO(f.endLocal, { zone: tz }).toUTC().toISO()!,
  };
}

export function EventEditor({ id, occurrence, draft }: { id?: string; occurrence?: Occ; draft?: EventDraft }) {
  const { data: event, isLoading } = useEvent(id ?? null);
  if (id && isLoading)
    return (
      <div className="space-y-4 p-5">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  if (id && !event) return <p className="p-5 text-sm text-ink-2">Cet événement n&apos;existe plus.</p>;
  return <EventForm key={(event?.id ?? "new") + (occurrence?.instance_id ?? "")} event={event} occurrence={occurrence} draft={draft} />;
}

function EventForm({ event, occurrence, draft }: { event?: EventDetail; occurrence?: Occ; draft?: EventDraft }) {
  const isNew = !event;
  const { close } = useInspector();
  const { data: me } = useMe();
  const tz = me?.profile.timezone ?? "America/Toronto";
  const h12 = me?.settings.time_format === "12h";
  const { data: categories = [] } = useCategories();
  const { data: projects = [] } = useProjects();
  const create = useCreateEvent();
  const update = useUpdateEvent();
  const del = useDeleteEvent();
  const titleRef = useRef<HTMLInputElement>(null);

  const initial: Form = useMemo(() => {
    const start = occurrence?.start ?? event?.start_at ?? draft!.start_at;
    const end = occurrence?.end ?? event?.end_at ?? draft!.end_at;
    const allDay = event?.all_day ?? draft?.all_day ?? false;
    const fmt = allDay ? "yyyy-LL-dd" : "yyyy-LL-dd'T'HH:mm";
    const endShown = allDay ? DateTime.fromISO(end, { zone: tz }).minus({ days: 1 }) : DateTime.fromISO(end, { zone: tz });
    return {
      title: event?.title ?? draft?.title ?? "",
      all_day: allDay,
      startLocal: DateTime.fromISO(start, { zone: tz }).toFormat(fmt),
      endLocal: endShown.toFormat(fmt),
      rrule: event?.rrule ?? "",
      category_id: event?.category_id ?? "",
      project_id: event?.project_id ?? draft?.project_id ?? "",
      location: event?.location ?? "",
      description: event?.description ?? "",
      notes: event?.notes ?? "",
      color: event?.color ?? null,
      busy: event?.busy ?? true,
      locked: event?.locked ?? false,
      reminder_offsets: event?.reminder_offsets ?? (isNew ? [me?.notifications.event_lead_minutes ?? 15] : []),
    };
  }, [event, occurrence, draft, tz, isNew, me?.notifications.event_lead_minutes]);

  const [f, setF] = useState<Form>(initial);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [suggestions, setSuggestions] = useState<Slot[]>([]);
  const [scopeFor, setScopeFor] = useState<null | "save" | "delete">(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (isNew) titleRef.current?.focus();
  }, [isNew]);

  // Live conflict check while the user edits the time.
  const valid = useMemo(() => {
    try {
      const p = toIsoPair(f, tz);
      return new Date(p.end_at) > new Date(p.start_at) ? p : null;
    } catch {
      return null;
    }
  }, [f, tz]);
  useEffect(() => {
    if (!valid || f.all_day || !f.busy) {
      setConflicts([]);
      setSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await checkConflicts({
          ...valid,
          rrule: f.rrule || null,
          exclude_event_id: event?.id,
          suggest: true,
        });
        setConflicts(r.conflicts);
        setSuggestions(r.suggestions);
      } catch {
        /* non-blocking */
      }
    }, 300);
    return () => clearTimeout(t);
  }, [valid, f.rrule, f.all_day, f.busy, event?.id]);

  const changedTime = !isNew && (f.startLocal !== initial.startLocal || f.endLocal !== initial.endLocal || f.all_day !== initial.all_day);

  const buildPatch = () => {
    const pair = valid!;
    const patch: Record<string, unknown> = {};
    const strField = (k: "title" | "location" | "description" | "notes") => {
      const v = f[k].trim();
      if (isNew || v !== (initial[k] ?? "")) patch[k] = k === "title" ? v : v || null;
    };
    strField("title");
    strField("location");
    strField("description");
    strField("notes");
    if (isNew || changedTime) {
      patch.start_at = pair.start_at;
      patch.end_at = pair.end_at;
      patch.all_day = f.all_day;
    }
    if (isNew || f.rrule !== initial.rrule) patch.rrule = f.rrule || null;
    if (isNew || f.category_id !== initial.category_id) patch.category_id = f.category_id || null;
    if (isNew || f.project_id !== initial.project_id) patch.project_id = f.project_id || null;
    if (isNew || f.color !== initial.color) patch.color = f.color;
    if (isNew || f.busy !== initial.busy) patch.busy = f.busy;
    if (isNew || f.locked !== initial.locked) patch.locked = f.locked;
    if (isNew || f.reminder_offsets.join() !== initial.reminder_offsets.join()) patch.reminder_offsets = f.reminder_offsets;
    return patch;
  };

  const doSave = async (scope?: "occurrence" | "following" | "series") => {
    if (!f.title.trim()) {
      titleRef.current?.focus();
      toast.error("Donne un titre à l'événement");
      return;
    }
    if (!valid) {
      toast.error("La fin doit suivre le début");
      return;
    }
    const patch = buildPatch();
    if (isNew) {
      const r = await create.mutateAsync({ ...(patch as unknown as EventCreateInput), task_id: draft?.task_id ?? null });
      toast.success("Événement créé");
      conflictToast(r.conflicts, tz);
      close();
      return;
    }
    if (!Object.keys(patch).length) {
      close();
      return;
    }
    const r = await update.mutateAsync({
      id: event!.id,
      patch,
      scope: scope ?? "series",
      occurrence_start: occurrence?.recurring ? occurrence.start : undefined,
    });
    toast.success("Modifications enregistrées");
    conflictToast(r.conflicts, tz);
    close();
  };

  const save = () => {
    if (!isNew && occurrence?.recurring && event?.rrule) {
      // a rule change only makes sense for the series
      if (f.rrule !== initial.rrule) return doSave("series");
      setScopeFor("save");
      return;
    }
    void doSave();
  };

  const doDelete = (scope?: "occurrence" | "following" | "series") =>
    del.mutate(
      { id: event!.id, scope, occurrence_start: occurrence?.recurring ? occurrence.start : undefined },
      { onSuccess: () => (toast.success("Événement supprimé"), close()) },
    );

  const recOptions = recurrenceOptions(f.startLocal, tz);
  const ruleKnown = !f.rrule || recOptions.some((o) => o.v === f.rrule);
  const category = categories.find((c) => c.id === f.category_id);
  const pending = create.isPending || update.isPending;

  return (
    <div className="flex h-full flex-col">
      <form
        className="scroll-thin flex-1 space-y-5 overflow-y-auto px-5 pb-6 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="flex items-center gap-3">
          <span className="h-5 w-1.5 shrink-0 rounded-full" style={{ background: f.color ?? category?.color ?? "var(--accent)" }} />
          <TitleInput ref={titleRef} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Nouvel événement" aria-label="Titre" />
        </div>

        {event?.task_id || draft?.task_id ? (
          <p className="flex items-center gap-2 rounded-md bg-accent-soft px-3 py-2 text-xs font-semibold text-accent-text">
            <CheckSquare className="h-3.5 w-3.5" /> Bloc de travail lié à une tâche
          </p>
        ) : null}

        {/* When */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-semibold text-ink-3">
              <CalendarDays className="h-3.5 w-3.5" /> Quand
            </span>
            <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-ink-2">
              <input
                type="checkbox"
                checked={f.all_day}
                onChange={(e) => {
                  const allDay = e.target.checked;
                  setF((p) => ({
                    ...p,
                    all_day: allDay,
                    startLocal: allDay ? p.startLocal.slice(0, 10) : `${p.startLocal.slice(0, 10)}T09:00`,
                    endLocal: allDay ? p.endLocal.slice(0, 10) : `${p.endLocal.slice(0, 10)}T10:00`,
                  }));
                }}
                className="h-3.5 w-3.5 accent-[var(--accent)]"
              />
              Toute la journée
            </label>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input
              type={f.all_day ? "date" : "datetime-local"}
              value={f.startLocal}
              aria-label="Début"
              onChange={(e) => {
                const v = e.target.value;
                // keep duration when moving the start
                const fmt = f.all_day ? "yyyy-LL-dd" : "yyyy-LL-dd'T'HH:mm";
                const oldS = DateTime.fromISO(f.startLocal);
                const oldE = DateTime.fromISO(f.endLocal);
                const newS = DateTime.fromISO(v);
                if (newS.isValid && oldS.isValid && oldE.isValid) setF((p) => ({ ...p, startLocal: v, endLocal: newS.plus(oldE.diff(oldS)).toFormat(fmt) }));
                else set("startLocal", v);
              }}
            />
            <Input type={f.all_day ? "date" : "datetime-local"} value={f.endLocal} aria-label="Fin" onChange={(e) => set("endLocal", e.target.value)} />
          </div>
          {!valid ? <p className="text-xs text-danger">La fin doit suivre le début.</p> : null}
        </div>

        {conflicts.length ? (
          <div className="rounded-[10px] border border-warning/40 bg-warning-soft px-3.5 py-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-warning">
              <AlertTriangle className="h-4 w-4" />
              Ce créneau est déjà occupé
            </p>
            <ul className="mt-1.5 space-y-0.5 text-xs text-ink-2">
              {conflicts.slice(0, 3).map((c) => (
                <li key={c.instance_id}>
                  {c.title} · {relDay(DateTime.fromISO(c.start, { zone: tz }).toISODate()!, tz)} {fmtRange(c.start, c.end, tz, h12)}
                </li>
              ))}
            </ul>
            {suggestions.length ? (
              <>
                <p className="mt-2.5 text-xs text-ink-2">Disponible à la place :</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {suggestions.map((s) => {
                    const dur = valid ? new Date(valid.end_at).getTime() - new Date(valid.start_at).getTime() : 3600_000;
                    const st = DateTime.fromISO(s.start, { zone: tz });
                    return (
                      <button
                        key={s.start}
                        type="button"
                        onClick={() =>
                          setF((p) => ({ ...p, startLocal: st.toFormat("yyyy-LL-dd'T'HH:mm"), endLocal: st.plus({ milliseconds: dur }).toFormat("yyyy-LL-dd'T'HH:mm") }))
                        }
                        className="h-7 rounded-full border border-line bg-surface px-2.5 text-xs font-semibold hover:border-accent hover:text-accent-text"
                      >
                        {relDay(st.toISODate()!, tz)} · {st.toFormat("H'h'mm")}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="flex items-center gap-2 text-xs font-semibold text-ink-3">
              <Repeat className="h-3.5 w-3.5" /> Répétition
            </span>
            <Select value={f.rrule} onChange={(e) => set("rrule", e.target.value)} aria-label="Répétition">
              {!ruleKnown ? <option value={f.rrule}>{describeRule(f.rrule)}</option> : null}
              {recOptions.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.l}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1.5">
            <span className="flex items-center gap-2 text-xs font-semibold text-ink-3">
              <Tag className="h-3.5 w-3.5" /> Catégorie
            </span>
            <Select value={f.category_id} onChange={(e) => set("category_id", e.target.value)} aria-label="Catégorie">
              <option value="">Aucune</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1.5">
            <span className="flex items-center gap-2 text-xs font-semibold text-ink-3">
              <FolderKanban className="h-3.5 w-3.5" /> Projet
            </span>
            <Select value={f.project_id} onChange={(e) => set("project_id", e.target.value)} aria-label="Projet">
              <option value="">Aucun projet</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1.5">
            <span className="flex items-center gap-2 text-xs font-semibold text-ink-3">
              <MapPin className="h-3.5 w-3.5" /> Lieu
            </span>
            <Input value={f.location} onChange={(e) => set("location", e.target.value)} placeholder="Adresse ou lien" aria-label="Lieu" />
          </label>
        </div>

        <div className="space-y-1.5">
          <span className="flex items-center gap-2 text-xs font-semibold text-ink-3">
            <Bell className="h-3.5 w-3.5" /> Rappels
          </span>
          <div className="flex flex-wrap gap-1.5">
            {REMINDER_OPTIONS.map((r) => {
              const on = f.reminder_offsets.includes(r.v);
              return (
                <button
                  key={r.v}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set("reminder_offsets", on ? f.reminder_offsets.filter((x) => x !== r.v) : [...f.reminder_offsets, r.v].sort((a, b) => a - b))}
                  className={cn("h-7 rounded-full border px-2.5 text-xs font-semibold", on ? "border-accent bg-accent-soft text-accent-text" : "border-line text-ink-2 hover:border-line-strong")}
                >
                  {r.l} avant
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="text-xs font-semibold text-ink-3">Couleur</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => set("color", null)}
              className={cn("h-6 rounded-full border px-2.5 text-xs font-semibold", f.color === null ? "border-ink text-ink" : "border-line text-ink-3")}
            >
              Catégorie
            </button>
            <SwatchPicker value={f.color} onChange={(c) => set("color", c)} />
          </div>
        </div>

        <Textarea value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Description" aria-label="Description" rows={2} />
        <Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Notes" aria-label="Notes" rows={2} />

        <div className="space-y-2.5 rounded-[10px] border border-line px-3.5 py-3">
          <label className="flex cursor-pointer items-start justify-between gap-4">
            <span>
              <span className="block text-sm font-semibold">Bloque mon temps</span>
              <span className="block text-xs text-ink-3">Compte dans les conflits et les disponibilités.</span>
            </span>
            <input type="checkbox" checked={f.busy} onChange={(e) => set("busy", e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--accent)]" />
          </label>
          <label className="flex cursor-pointer items-start justify-between gap-4">
            <span>
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <Lock className="h-3.5 w-3.5" /> Rendez-vous ferme
              </span>
              <span className="block text-xs text-ink-3">L&apos;assistant ne pourra jamais le déplacer ni le supprimer.</span>
            </span>
            <input type="checkbox" checked={f.locked} onChange={(e) => set("locked", e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--accent)]" />
          </label>
        </div>

        {event?.rrule ? <p className="text-xs text-ink-3">Série : {describeRule(event.rrule)}</p> : null}
        {event?.created_by === "assistant" ? <p className="text-xs text-ink-3">Créé par l&apos;assistant.</p> : null}
        <button type="submit" className="hidden" />
      </form>

      <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
        {isNew ? (
          <Button variant="ghost" onClick={close}>
            Annuler
          </Button>
        ) : (
          <Button
            variant="ghost"
            className="text-danger hover:bg-danger-soft hover:text-danger"
            onClick={() => (occurrence?.recurring && event?.rrule ? setScopeFor("delete") : setConfirmDelete(true))}
          >
            <Trash2 className="h-4 w-4" /> Supprimer
          </Button>
        )}
        <Button variant="primary" onClick={save} disabled={pending}>
          {pending ? <Spinner className="h-3.5 w-3.5" /> : null}
          {isNew ? "Créer l'événement" : "Enregistrer"}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Supprimer cet événement ?"
        body={event ? `${event.title} sera retiré de ton calendrier.` : undefined}
        confirmLabel="Supprimer"
        onConfirm={() => doDelete()}
      />
      <ConfirmDialog
        open={scopeFor !== null}
        onOpenChange={(o) => !o && setScopeFor(null)}
        title={scopeFor === "delete" ? "Supprimer un événement récurrent" : "Modifier un événement récurrent"}
        body="Cet événement fait partie d'une série."
        options={[
          { label: "Cette occurrence", tone: scopeFor === "delete" ? "danger" : "primary", onSelect: () => (scopeFor === "delete" ? doDelete("occurrence") : doSave("occurrence")) },
          { label: "Celle-ci et les suivantes", tone: "secondary", onSelect: () => (scopeFor === "delete" ? doDelete("following") : doSave("following")) },
          { label: "Toute la série", tone: "secondary", onSelect: () => (scopeFor === "delete" ? doDelete("series") : doSave("series")) },
        ]}
      />
    </div>
  );
}
