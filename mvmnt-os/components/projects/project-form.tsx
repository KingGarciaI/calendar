"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Dialog } from "@/components/ui/overlay";
import { Spinner, SwatchPicker } from "@/components/ui/misc";
import { useProjectMutations } from "@/lib/client/hooks";
import type { ProjectStatus, ProjectSummary } from "@/lib/types";

export const PROJECT_STATUS: Record<ProjectStatus, string> = { active: "Actif", paused: "En pause", completed: "Terminé", archived: "Archivé" };

export function ProjectFormDialog({
  open,
  onOpenChange,
  project,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  project?: ProjectSummary;
  onCreated?: (p: ProjectSummary) => void;
}) {
  const { create, update } = useProjectMutations();
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [color, setColor] = useState(project?.color ?? "#5E17EB");
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? "active");
  const [start, setStart] = useState(project?.start_date ?? "");
  const [due, setDue] = useState(project?.due_date ?? "");
  const [error, setError] = useState<string | null>(null);
  const pending = create.isPending || update.isPending;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("Donne un nom au projet");
    if (start && due && due < start) return setError("L'échéance doit suivre le début");
    const body = { name: name.trim(), description: description.trim() || null, color, status, start_date: start || null, due_date: due || null };
    if (project) {
      await update.mutateAsync({ id: project.id, patch: body });
      toast.success("Projet mis à jour");
    } else {
      const p = await create.mutateAsync(body);
      toast.success("Projet créé");
      onCreated?.(p);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={project ? "Modifier le projet" : "Nouveau projet"}>
      <form onSubmit={submit} className="space-y-4 px-5 pb-5 pt-2">
        <Field label="Nom" error={error}>
          {(id) => <Input id={id} value={name} onChange={(e) => (setName(e.target.value), setError(null))} placeholder="Restaurant Georgio" autoFocus />}
        </Field>
        <Field label="Description">{(id) => <Textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />}</Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Statut">
            {(id) => (
              <Select id={id} value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
                {Object.entries(PROJECT_STATUS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Début">{(id) => <Input id={id} type="date" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
          <Field label="Échéance">{(id) => <Input id={id} type="date" value={due} onChange={(e) => setDue(e.target.value)} />}</Field>
        </div>
        <div className="space-y-1.5">
          <span className="text-xs font-semibold text-ink-2">Couleur</span>
          <SwatchPicker value={color} onChange={setColor} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? <Spinner className="h-3.5 w-3.5" /> : null}
            {project ? "Enregistrer" : "Créer le projet"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
