"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { DateTime } from "luxon";
import { FolderKanban, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, Segmented, Skeleton } from "@/components/ui/misc";
import { ProjectFormDialog, PROJECT_STATUS } from "@/components/projects/project-form";
import { useProjects } from "@/lib/client/hooks";
import { cn } from "@/lib/utils";

function ProjectsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [showArchived, setShowArchived] = useState<"current" | "archived">("current");
  const { data: projects = [], isLoading } = useProjects(showArchived === "archived");
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (params.get("new") === "1") setCreating(true);
  }, [params]);
  const list = showArchived === "archived" ? projects.filter((p) => p.status === "archived") : projects;

  return (
    <div className="mx-auto w-full max-w-[920px] px-4 pb-10 pt-2 md:px-8 md:pt-4">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Projets</h1>
          <Segmented
            className="mt-4"
            value={showArchived}
            onChange={setShowArchived}
            options={[
              { value: "current", label: "En cours" },
              { value: "archived", label: "Archivés" },
            ]}
          />
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Projet
        </Button>
      </header>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : list.length ? (
        <ul className="divide-y divide-line border-y border-line">
          {list.map((p) => {
            const pct = p.tasks_total ? Math.round((p.tasks_done / p.tasks_total) * 100) : 0;
            return (
              <li key={p.id}>
                <Link href={`/projects/${p.id}`} className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 px-1 py-4 hover:bg-surface-hover md:grid-cols-[1fr_160px_120px] md:px-3">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2.5">
                      <span className="h-3 w-3 shrink-0 rounded-[4px]" style={{ background: p.color }} />
                      <span className="truncate text-[15px] font-semibold">{p.name}</span>
                      {p.status !== "active" ? <span className="text-xs text-ink-3">{PROJECT_STATUS[p.status]}</span> : null}
                    </span>
                    {p.description ? <span className="mt-1 block truncate pl-[22px] text-sm text-ink-2">{p.description}</span> : null}
                  </span>
                  <span className="hidden md:block">
                    <span className="flex items-center justify-between text-xs text-ink-3 tabular">
                      <span>
                        {p.tasks_done}/{p.tasks_total} tâches
                      </span>
                      <span>{pct} %</span>
                    </span>
                    <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-surface-2">
                      <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: p.color }} />
                    </span>
                  </span>
                  <span className={cn("text-right text-xs tabular", p.due_date && p.due_date < DateTime.now().toISODate()! && p.status === "active" ? "font-semibold text-danger" : "text-ink-3")}>
                    {p.due_date ? `Échéance ${DateTime.fromISO(p.due_date).setLocale("fr-CA").toFormat("d LLL")}` : p.next_due_date ? `Prochaine tâche ${DateTime.fromISO(p.next_due_date).setLocale("fr-CA").toFormat("d LLL")}` : ""}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          icon={FolderKanban}
          title={showArchived === "archived" ? "Aucun projet archivé" : "Aucun projet pour l'instant"}
          body={showArchived === "archived" ? undefined : "Un projet regroupe les tâches et les rendez-vous d'un client ou d'un chantier interne."}
          action={showArchived === "archived" ? undefined : <Button variant="primary" size="sm" onClick={() => setCreating(true)}>Créer un projet</Button>}
        />
      )}
      {creating ? (
        <ProjectFormDialog
          open
          onOpenChange={(o) => {
            setCreating(o);
            if (!o && params.get("new")) router.replace("/projects");
          }}
          onCreated={(p) => router.push(`/projects/${p.id}`)}
        />
      ) : null}
    </div>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense>
      <ProjectsInner />
    </Suspense>
  );
}
