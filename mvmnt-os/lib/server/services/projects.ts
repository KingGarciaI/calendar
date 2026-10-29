import "server-only";
import { notFound, AppError, type Ctx } from "@/lib/server/context";
import { getOccurrences } from "@/lib/server/services/events";
import { listTasks } from "@/lib/server/services/tasks";
import type { ProjectCreateInput } from "@/lib/schemas";
import type { Category, EventOccurrence, Project, ProjectSummary, Task } from "@/lib/types";

const iso = (d: Date | string | null) => (d == null ? null : new Date(d).toISOString());

function mapProject(r: Record<string, unknown>): ProjectSummary {
  return {
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string) ?? null,
    notes: (r.notes as string) ?? null,
    color: r.color as string,
    status: r.status as Project["status"],
    start_date: (r.start_date as string) ?? null,
    due_date: (r.due_date as string) ?? null,
    created_at: iso(r.created_at as Date)!,
    updated_at: iso(r.updated_at as Date)!,
    tasks_total: Number(r.tasks_total ?? 0),
    tasks_done: Number(r.tasks_done ?? 0),
    tasks_open: Number(r.tasks_open ?? 0),
    next_due_date: (r.next_due_date as string) ?? null,
    next_event_at: iso(r.next_event_at as Date),
  };
}

const SELECT = `
  select p.*,
         coalesce(t.total, 0) as tasks_total, coalesce(t.done, 0) as tasks_done, coalesce(t.open, 0) as tasks_open,
         t.next_due_date, ev.next_event_at
    from public.projects p
    left join lateral (
      select count(*) filter (where status <> 'cancelled') as total,
             count(*) filter (where status = 'done') as done,
             count(*) filter (where status in ('todo','in_progress')) as open,
             min(due_date) filter (where status in ('todo','in_progress')) as next_due_date
        from public.tasks where project_id = p.id) t on true
    left join lateral (
      select min(start_at) as next_event_at from public.events
       where project_id = p.id and start_at > now() and rrule is null) ev on true`;

export async function listProjects(ctx: Ctx, opts: { includeArchived?: boolean } = {}): Promise<ProjectSummary[]> {
  const rows = await ctx.tx.unsafe(
    `${SELECT} where p.user_id = $1 ${opts.includeArchived ? "" : "and p.status <> 'archived'"}
     order by case p.status when 'active' then 0 when 'paused' then 1 when 'completed' then 2 else 3 end, p.due_date nulls last, p.name`,
    [ctx.userId],
  );
  return rows.map(mapProject);
}

export async function getProject(
  ctx: Ctx,
  id: string,
): Promise<ProjectSummary & { tasks: Task[]; upcoming_events: EventOccurrence[]; recent_events: EventOccurrence[] }> {
  const rows = await ctx.tx.unsafe(`${SELECT} where p.id = $1 and p.user_id = $2`, [id, ctx.userId]);
  if (!rows[0]) throw notFound("Projet");
  const now = ctx.now();
  const [tasks, upcoming, recent] = await Promise.all([
    listTasks(ctx, { project_id: id }),
    getOccurrences(ctx, now, new Date(now.getTime() + 90 * 86400_000), { projectId: id }),
    getOccurrences(ctx, new Date(now.getTime() - 30 * 86400_000), now, { projectId: id }),
  ]);
  return { ...mapProject(rows[0]), tasks, upcoming_events: upcoming.slice(0, 20), recent_events: recent.slice(-10).reverse() };
}

export async function createProject(ctx: Ctx, input: ProjectCreateInput): Promise<ProjectSummary> {
  const [row] = await ctx.tx`insert into public.projects ${ctx.tx({
    user_id: ctx.userId,
    name: input.name,
    description: input.description ?? null,
    notes: input.notes ?? null,
    color: input.color ?? "#5E17EB",
    status: input.status ?? "active",
    start_date: input.start_date ?? null,
    due_date: input.due_date ?? null,
  })} returning id`;
  const [p] = await ctx.tx.unsafe(`${SELECT} where p.id = $1`, [row.id]);
  return mapProject(p);
}

export async function updateProject(ctx: Ctx, id: string, patch: Partial<ProjectCreateInput>): Promise<ProjectSummary> {
  const values = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  if (Object.keys(values).length) {
    const res = await ctx.tx`update public.projects set ${ctx.tx(values)} where id = ${id} and user_id = ${ctx.userId} returning id`;
    if (!res.length) throw notFound("Projet");
  }
  const [p] = await ctx.tx.unsafe(`${SELECT} where p.id = $1 and p.user_id = $2`, [id, ctx.userId]);
  if (!p) throw notFound("Projet");
  return mapProject(p);
}

export async function deleteProject(ctx: Ctx, id: string) {
  const res = await ctx.tx`delete from public.projects where id = ${id} and user_id = ${ctx.userId} returning id`;
  if (!res.length) throw notFound("Projet");
  return { deleted: true };
}

// ------------------------------------------------------------ categories
export async function listCategories(ctx: Ctx): Promise<Category[]> {
  const rows = await ctx.tx`select id, name, color, slug, sort_order from public.categories where user_id = ${ctx.userId} order by sort_order, name`;
  return rows as unknown as Category[];
}

export async function createCategory(ctx: Ctx, input: { name: string; color: string }): Promise<Category> {
  const [{ max }] = await ctx.tx`select coalesce(max(sort_order), 0) as max from public.categories where user_id = ${ctx.userId}`;
  try {
    const [row] = await ctx.tx`insert into public.categories (user_id, name, color, sort_order)
      values (${ctx.userId}, ${input.name}, ${input.color}, ${Number(max) + 10}) returning id, name, color, slug, sort_order`;
    return row as unknown as Category;
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new AppError("conflict", "Une catégorie porte déjà ce nom");
    throw e;
  }
}

export async function updateCategory(ctx: Ctx, id: string, patch: { name?: string; color?: string; sort_order?: number }): Promise<Category> {
  const values = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  if (!Object.keys(values).length) throw new AppError("invalid", "Rien à modifier");
  const [row] = await ctx.tx`update public.categories set ${ctx.tx(values)} where id = ${id} and user_id = ${ctx.userId}
    returning id, name, color, slug, sort_order`;
  if (!row) throw notFound("Catégorie");
  return row as unknown as Category;
}

export async function deleteCategory(ctx: Ctx, id: string) {
  const res = await ctx.tx`delete from public.categories where id = ${id} and user_id = ${ctx.userId} returning id`;
  if (!res.length) throw notFound("Catégorie");
  return { deleted: true };
}
