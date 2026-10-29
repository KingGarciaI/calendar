"use client";
import { useState } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Download, LogOut, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Segmented, Skeleton, SWATCHES } from "@/components/ui/misc";
import { ConfirmDialog, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlay";
import { useCategories, useCategoryMutations, useMe, useUpdateSettings } from "@/lib/client/hooks";
import type { Me } from "@/lib/types";
import { cn } from "@/lib/utils";
import { fmtMinutes } from "@/lib/format";
import { PushSetup } from "@/components/settings/push-setup";

const DAYS = [
  { v: 1, l: "L" },
  { v: 2, l: "M" },
  { v: 3, l: "M" },
  { v: 4, l: "J" },
  { v: 5, l: "V" },
  { v: 6, l: "S" },
  { v: 0, l: "D" },
];
const TIMEZONES = ["America/Toronto", "America/Montreal", "America/Halifax", "America/Winnipeg", "America/Edmonton", "America/Vancouver", "America/New_York", "Europe/Paris", "UTC"];

function Group({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="grid grid-cols-1 gap-4 border-t border-line py-8 md:grid-cols-[220px_1fr] md:gap-10">
      <div>
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {description ? <p className="mt-1 text-sm text-ink-3">{description}</p> : null}
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function Line({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div>
        <p className="text-sm font-semibold">{label}</p>
        {hint ? <p className="text-xs text-ink-3">{hint}</p> : null}
      </div>
      <div className="sm:w-[280px] sm:shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn("relative h-6 w-10 rounded-full transition-colors", checked ? "bg-accent" : "bg-line-strong")}
    >
      <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
    </button>
  );
}

export default function SettingsPage() {
  const { data: me } = useMe();
  if (!me)
    return (
      <div className="mx-auto max-w-[880px] space-y-4 px-4 pt-4 md:px-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40" />
      </div>
    );
  return <SettingsForm me={me} />;
}

function SettingsForm({ me }: { me: Me }) {
  const save = useUpdateSettings();
  const { setTheme } = useTheme();
  const [name, setName] = useState(me.profile.full_name ?? "");
  const s = me.settings;
  const n = me.notifications;
  const saved = () => toast.success("Préférences enregistrées");
  const setS = (patch: Partial<Me["settings"]>) => save.mutate({ settings: patch }, { onSuccess: saved });
  const setN = (patch: Partial<Me["notifications"]>) => save.mutate({ notifications: patch }, { onSuccess: saved });

  return (
    <div className="mx-auto w-full max-w-[880px] px-4 pb-16 pt-2 md:px-8 md:pt-4">
      <h1 className="mb-6 text-[28px] font-semibold tracking-[-0.02em]">Paramètres</h1>

      <Group title="Profil">
        <Line label="Nom">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name !== (me.profile.full_name ?? "") && save.mutate({ profile: { full_name: name || null } }, { onSuccess: saved })}
            placeholder="Ton nom"
          />
        </Line>
        <Line label="Courriel">
          <p className="text-sm text-ink-2">{me.user.email}</p>
        </Line>
        <Line label="Fuseau horaire" hint="Toutes les heures sont affichées dans ce fuseau.">
          <Select value={me.profile.timezone} onChange={(e) => save.mutate({ profile: { timezone: e.target.value } }, { onSuccess: saved })}>
            {[...new Set([me.profile.timezone, ...TIMEZONES])].map((t) => (
              <option key={t} value={t}>
                {t.replace("_", " ")}
              </option>
            ))}
          </Select>
        </Line>
        <Line label="Langue">
          <Select value={me.profile.locale} onChange={(e) => save.mutate({ profile: { locale: e.target.value as "fr-CA" } }, { onSuccess: saved })}>
            <option value="fr-CA">Français (Canada)</option>
            <option value="en-CA" disabled>
              English — bientôt
            </option>
          </Select>
        </Line>
      </Group>

      <Group title="Affichage">
        <Line label="Thème">
          <Segmented
            value={s.theme}
            onChange={(v) => {
              setTheme(v);
              setS({ theme: v });
            }}
            options={[
              { value: "system", label: "Système" },
              { value: "light", label: "Clair" },
              { value: "dark", label: "Sombre" },
            ]}
          />
        </Line>
        <Line label="Premier jour de la semaine">
          <Segmented
            value={String(s.week_start)}
            onChange={(v) => setS({ week_start: Number(v) })}
            options={[
              { value: "1", label: "Lundi" },
              { value: "0", label: "Dimanche" },
            ]}
          />
        </Line>
        <Line label="Format horaire">
          <Segmented
            value={s.time_format}
            onChange={(v) => setS({ time_format: v })}
            options={[
              { value: "24h", label: "14 h 30" },
              { value: "12h", label: "2:30 PM" },
            ]}
          />
        </Line>
      </Group>

      <Group title="Heures de travail" description="Utilisées pour les disponibilités, la planification et le résumé du jour.">
        <Line label="Plage horaire">
          <div className="flex items-center gap-2">
            <Input type="time" defaultValue={s.work_start} onBlur={(e) => e.target.value !== s.work_start && setS({ work_start: e.target.value })} aria-label="Début de journée" />
            <span className="text-ink-3">–</span>
            <Input type="time" defaultValue={s.work_end} onBlur={(e) => e.target.value !== s.work_end && setS({ work_end: e.target.value })} aria-label="Fin de journée" />
          </div>
        </Line>
        <Line label="Jours travaillés">
          <div className="flex gap-1.5">
            {DAYS.map((d) => {
              const on = s.work_days.includes(d.v);
              return (
                <button
                  key={d.v}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setS({ work_days: on ? s.work_days.filter((x) => x !== d.v) : [...s.work_days, d.v].sort() })}
                  className={cn("h-8 w-8 rounded-full text-xs font-semibold", on ? "bg-accent text-accent-fg" : "bg-surface-2 text-ink-3 hover:text-ink")}
                >
                  {d.l}
                </button>
              );
            })}
          </div>
        </Line>
        <Line label="Durée par défaut d'un événement">
          <Select value={s.default_event_minutes} onChange={(e) => setS({ default_event_minutes: Number(e.target.value) })}>
            {[15, 30, 45, 60, 90, 120].map((m) => (
              <option key={m} value={m}>
                {fmtMinutes(m)}
              </option>
            ))}
          </Select>
        </Line>
        <Line label="Marge entre deux rendez-vous" hint="Respectée quand l'assistant cherche un créneau.">
          <Select value={s.buffer_minutes} onChange={(e) => setS({ buffer_minutes: Number(e.target.value) })}>
            {[0, 5, 10, 15, 30].map((m) => (
              <option key={m} value={m}>
                {m ? `${m} min` : "Aucune"}
              </option>
            ))}
          </Select>
        </Line>
      </Group>

      <Group title="Catégories" description="Couleurs utilisées dans le calendrier.">
        <CategoriesEditor />
      </Group>

      <Group title="Notifications" description="Rappels de rendez-vous, d'échéances et résumé du matin.">
        <Line label="Notifications sur cet appareil" hint="Chaque appareil s'active séparément.">
          <PushSetup />
        </Line>
        <Line label="Activer les rappels">
          <Toggle checked={n.enabled} onChange={(v) => setN({ enabled: v })} label="Activer les rappels" />
        </Line>
        <Line label="Rappel par défaut avant un rendez-vous">
          <Select value={n.event_lead_minutes} onChange={(e) => setN({ event_lead_minutes: Number(e.target.value) })}>
            {[5, 10, 15, 30, 60].map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} min avant` : "1 h avant"}
              </option>
            ))}
          </Select>
        </Line>
        <Line label="Résumé du jour">
          <div className="flex items-center gap-3">
            <Toggle checked={n.daily_summary_enabled} onChange={(v) => setN({ daily_summary_enabled: v })} label="Résumé du jour" />
            <Input type="time" defaultValue={n.daily_summary_time} onBlur={(e) => e.target.value !== n.daily_summary_time && setN({ daily_summary_time: e.target.value })} aria-label="Heure du résumé" className="w-[120px]" />
          </div>
        </Line>
        <Line label="Ne pas déranger" hint="Aucune notification pendant cette plage.">
          <div className="flex items-center gap-2">
            <Input type="time" defaultValue={n.quiet_start ?? ""} onBlur={(e) => setN({ quiet_start: e.target.value || null })} aria-label="Début" />
            <span className="text-ink-3">–</span>
            <Input type="time" defaultValue={n.quiet_end ?? ""} onBlur={(e) => setN({ quiet_end: e.target.value || null })} aria-label="Fin" />
          </div>
        </Line>
        <Line label="Alertes d'échéance">
          <Toggle checked={n.deadline_alerts} onChange={(v) => setN({ deadline_alerts: v })} label="Alertes d'échéance" />
        </Line>
        <Line label="Alertes de conflit">
          <Toggle checked={n.conflict_alerts} onChange={(v) => setN({ conflict_alerts: v })} label="Alertes de conflit" />
        </Line>
      </Group>

      <Group title="Assistant">
        <Line label="Fournisseur d'IA" hint="La clé API est configurée sur le serveur, jamais dans le navigateur.">
          <Select value={s.ai_provider} onChange={(e) => setS({ ai_provider: e.target.value as "anthropic" })}>
            <option value="anthropic">Claude (Anthropic)</option>
            <option value="openai">OpenAI</option>
          </Select>
        </Line>
        <Line label="Confirmer chaque modification" hint="Sinon, l'assistant demande seulement avant une suppression ou un déplacement de rendez-vous.">
          <Toggle checked={s.ai_confirm_writes} onChange={(v) => setS({ ai_confirm_writes: v })} label="Confirmer chaque modification" />
        </Line>
      </Group>

      <Group title="Données">
        <Line label="Exporter mes tâches">
          <a href="/api/export?what=tasks" className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-ctl)] border border-line px-3.5 text-sm font-semibold hover:bg-surface-hover">
            <Download className="h-4 w-4" /> Tâches (JSON)
          </a>
        </Line>
        <Line label="Exporter mes événements">
          <a href="/api/export?what=events" className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-ctl)] border border-line px-3.5 text-sm font-semibold hover:bg-surface-hover">
            <Download className="h-4 w-4" /> Événements (JSON)
          </a>
        </Line>
        <Line label="Session">
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="secondary">
              <LogOut className="h-4 w-4" /> Se déconnecter
            </Button>
          </form>
        </Line>
      </Group>
    </div>
  );
}

function CategoriesEditor() {
  const { data: categories = [] } = useCategories();
  const { create, update, remove } = useCategoryMutations();
  const [newName, setNewName] = useState("");
  const [toDelete, setToDelete] = useState<string | null>(null);
  return (
    <div>
      <ul className="divide-y divide-line rounded-[10px] border border-line">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-3 py-2">
            <Popover>
              <PopoverTrigger asChild>
                <button className="h-5 w-5 shrink-0 rounded-full ring-offset-2 ring-offset-surface hover:ring-2 hover:ring-line-strong" style={{ background: c.color }} aria-label={`Couleur de ${c.name}`} />
              </PopoverTrigger>
              <PopoverContent className="p-2.5">
                <div className="grid grid-cols-5 gap-1.5">
                  {SWATCHES.concat(["#F76B15", "#0090FF"]).map((sw) => (
                    <button key={sw} className="h-6 w-6 rounded-full hover:scale-110" style={{ background: sw }} onClick={() => update.mutate({ id: c.id, color: sw })} aria-label={sw} />
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <input
              defaultValue={c.name}
              onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && update.mutate({ id: c.id, name: e.target.value.trim() })}
              className="h-8 flex-1 bg-transparent text-sm focus:outline-none"
              aria-label="Nom de la catégorie"
            />
            <button onClick={() => setToDelete(c.id)} className="rounded p-1 text-ink-3 hover:text-danger" aria-label={`Supprimer ${c.name}`}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newName.trim()) return;
          create.mutate({ name: newName.trim(), color: SWATCHES[categories.length % SWATCHES.length] }, { onSuccess: () => setNewName("") });
        }}
      >
        <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nouvelle catégorie" />
        <Button type="submit" disabled={!newName.trim()}>
          <Plus className="h-4 w-4" /> Ajouter
        </Button>
      </form>
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Supprimer cette catégorie ?"
        body="Les événements et tâches concernés resteront, sans catégorie."
        confirmLabel="Supprimer"
        onConfirm={() => toDelete && remove.mutate(toDelete)}
      />
    </div>
  );
}
