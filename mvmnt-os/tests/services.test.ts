/**
 * Integration tests: real services against a real Postgres with RLS.
 * Requires TEST_DATABASE_URL (a disposable database with migrations + test shim applied).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

let A = "";
let B = "";
const NOW = new Date("2026-10-29T14:00:00.000Z"); // Thu 10:00 Toronto

async function as<T>(userId: string, fn: (ctx: import("@/lib/server/context").Ctx) => Promise<T>, actor: "user" | "assistant" = "user") {
  const { withUser } = await import("@/lib/server/db");
  const { loadContext } = await import("@/lib/server/context");
  return withUser(userId, async (tx) => {
    const ctx = await loadContext(tx, userId, actor);
    ctx.now = () => NOW;
    return fn(ctx);
  });
}

d("services against Postgres + RLS", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    const admin = postgres(url!, { max: 1, onnotice: () => {} });
    const stamp = Date.now();
    [{ id: A }] = await admin`insert into auth.users (email) values (${`a${stamp}@test.local`}) returning id`;
    [{ id: B }] = await admin`insert into auth.users (email) values (${`b${stamp}@test.local`}) returning id`;
    await admin.end();
  });
  afterAll(async () => {
    const admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin`delete from auth.users where id in (${A}, ${B})`;
    await admin.end();
    const { sql } = await import("@/lib/server/db");
    await sql().end();
  });

  it("creates, reads, moves and resizes a single event; detects conflicts", async () => {
    const ev = await import("@/lib/server/services/events");
    const first = await as(A, (ctx) => ev.createEvent(ctx, { title: "Rendez-vous Georgio", start_at: "2026-10-30T14:00:00.000Z", end_at: "2026-10-30T15:00:00.000Z", reminder_offsets: [15] }));
    expect(first.conflicts).toEqual([]);
    expect(first.event.timezone).toBe("America/Toronto");
    expect(first.event.reminder_offsets).toEqual([15]);

    const overlapping = await as(A, (ctx) => ev.createEvent(ctx, { title: "Tournage", start_at: "2026-10-30T14:30:00.000Z", end_at: "2026-10-30T16:00:00.000Z" }));
    expect(overlapping.conflicts.map((c) => c.title)).toEqual(["Rendez-vous Georgio"]);

    // move (drag) + resize
    const moved = await as(A, (ctx) => ev.updateEvent(ctx, overlapping.event.id, { patch: { start_at: "2026-10-30T16:00:00.000Z", end_at: "2026-10-30T18:30:00.000Z" } }));
    expect(moved.conflicts).toEqual([]);
    expect(moved.event.end_at).toBe("2026-10-30T18:30:00.000Z");

    const occ = await as(A, (ctx) => ev.getOccurrences(ctx, new Date("2026-10-30T04:00:00Z"), new Date("2026-10-31T04:00:00Z")));
    expect(occ.map((o) => o.title)).toEqual(["Rendez-vous Georgio", "Tournage"]);

    // B sees nothing and cannot touch A's event
    const bOcc = await as(B, (ctx) => ev.getOccurrences(ctx, new Date("2026-10-30T04:00:00Z"), new Date("2026-10-31T04:00:00Z")));
    expect(bOcc).toEqual([]);
    await expect(as(B, (ctx) => ev.getEvent(ctx, first.event.id))).rejects.toThrow(/introuvable/);
    await expect(as(B, (ctx) => ev.deleteEvent(ctx, first.event.id))).rejects.toThrow(/introuvable/);

    await as(A, (ctx) => ev.deleteEvent(ctx, first.event.id));
    await as(A, (ctx) => ev.deleteEvent(ctx, moved.event.id));
  });

  it("handles recurring series: occurrence edit, following split, series shift, deletes", async () => {
    const ev = await import("@/lib/server/services/events");
    const range = [new Date("2026-11-01T00:00:00Z"), new Date("2026-11-30T00:00:00Z")] as const;
    const { event: series } = await as(A, (ctx) =>
      ev.createEvent(ctx, { title: "Stand-up", start_at: "2026-11-02T14:00:00.000Z", end_at: "2026-11-02T14:30:00.000Z", rrule: "FREQ=WEEKLY;BYDAY=MO" }),
    );
    let occ = await as(A, (ctx) => ev.getOccurrences(ctx, ...range));
    expect(occ.map((o) => o.occurrence_start)).toEqual(["2026-11-02T14:00:00.000Z", "2026-11-09T14:00:00.000Z", "2026-11-16T14:00:00.000Z", "2026-11-23T14:00:00.000Z"]);

    // move only Nov 9 to 15:00 local (20:00Z)
    await as(A, (ctx) => ev.updateEvent(ctx, series.id, { scope: "occurrence", occurrence_start: "2026-11-09T14:00:00.000Z", patch: { start_at: "2026-11-09T20:00:00.000Z", end_at: "2026-11-09T20:30:00.000Z" } }));
    occ = await as(A, (ctx) => ev.getOccurrences(ctx, ...range));
    expect(occ.map((o) => o.occurrence_start)).toEqual(["2026-11-02T14:00:00.000Z", "2026-11-09T20:00:00.000Z", "2026-11-16T14:00:00.000Z", "2026-11-23T14:00:00.000Z"]);
    expect(occ[1].recurrence_parent_id).toBe(series.id);

    // delete only Nov 16
    await as(A, (ctx) => ev.deleteEvent(ctx, series.id, { scope: "occurrence", occurrence_start: "2026-11-16T14:00:00.000Z" }));
    occ = await as(A, (ctx) => ev.getOccurrences(ctx, ...range));
    expect(occ).toHaveLength(3);

    // shift the whole series one hour later by dragging the Nov 2 instance
    await as(A, (ctx) => ev.updateEvent(ctx, series.id, { scope: "series", occurrence_start: "2026-11-02T14:00:00.000Z", patch: { start_at: "2026-11-02T15:00:00.000Z", end_at: "2026-11-02T15:30:00.000Z" } }));
    occ = await as(A, (ctx) => ev.getOccurrences(ctx, ...range));
    expect(occ.map((o) => o.occurrence_start)).toEqual(["2026-11-02T15:00:00.000Z", "2026-11-09T20:00:00.000Z", "2026-11-23T15:00:00.000Z"]);

    // rename this and following from Nov 23
    const split = await as(A, (ctx) => ev.updateEvent(ctx, series.id, { scope: "following", occurrence_start: "2026-11-23T15:00:00.000Z", patch: { title: "Stand-up v2" } }));
    occ = await as(A, (ctx) => ev.getOccurrences(ctx, new Date("2026-11-01T00:00:00Z"), new Date("2026-12-08T00:00:00Z")));
    expect(occ.map((o) => o.title)).toEqual(["Stand-up", "Stand-up", "Stand-up v2", "Stand-up v2", "Stand-up v2"]);

    // delete everything
    await as(A, (ctx) => ev.deleteEvent(ctx, split.event.id));
    await as(A, (ctx) => ev.deleteEvent(ctx, series.id));
    occ = await as(A, (ctx) => ev.getOccurrences(ctx, new Date("2026-11-01T00:00:00Z"), new Date("2026-12-08T00:00:00Z")));
    expect(occ).toEqual([]);
  });

  it("refuses to let the assistant move a locked event", async () => {
    const ev = await import("@/lib/server/services/events");
    const { event } = await as(A, (ctx) => ev.createEvent(ctx, { title: "Client important", locked: true, start_at: "2026-11-05T14:00:00.000Z", end_at: "2026-11-05T15:00:00.000Z" }));
    await expect(as(A, (ctx) => ev.updateEvent(ctx, event.id, { patch: { start_at: "2026-11-05T16:00:00.000Z", end_at: "2026-11-05T17:00:00.000Z" } }), "assistant")).rejects.toThrow(/verrouillé/);
    await as(A, (ctx) => ev.deleteEvent(ctx, event.id));
  });

  it("tasks: CRUD, subtasks, scheduling on the calendar, completion syncs everywhere", async () => {
    const t = await import("@/lib/server/services/tasks");
    const p = await import("@/lib/server/services/projects");
    const ev = await import("@/lib/server/services/events");
    const project = await as(A, (ctx) => p.createProject(ctx, { name: "Restaurant Georgio" }));
    const task = await as(A, (ctx) =>
      t.createTask(ctx, { title: "Monter la vidéo Georgio", estimated_minutes: 120, priority: "high", due_date: "2026-11-03", project_id: project.id, subtasks: ["Dérusher", "Couleur"] }),
    );
    expect(task.subtasks.map((s) => s.title)).toEqual(["Dérusher", "Couleur"]);

    // drag to Tuesday 13:00 local → 13:00-15:00 block
    const { event } = await as(A, (ctx) => t.scheduleTask(ctx, task.id, { start_at: "2026-11-03T18:00:00.000Z" }));
    expect(event.end_at).toBe("2026-11-03T20:00:00.000Z");
    expect(event.task_id).toBe(task.id);
    expect(event.project_id).toBe(project.id);

    await as(A, (ctx) => t.updateSubtask(ctx, task.subtasks[0].id, { done: true }));
    await as(A, (ctx) => t.completeTask(ctx, task.id));
    const occ = await as(A, (ctx) => ev.getOccurrences(ctx, new Date("2026-11-03T00:00:00Z"), new Date("2026-11-04T00:00:00Z")));
    expect(occ[0].task_status).toBe("done");

    const detail = await as(A, (ctx) => t.getTask(ctx, task.id));
    expect(detail.subtasks_done).toBe(1);
    expect(detail.scheduled_minutes).toBe(120);
    expect(detail.completed_at).not.toBeNull();

    const summary = await as(A, (ctx) => p.getProject(ctx, project.id));
    expect(summary.tasks_done).toBe(1);

    // B cannot see or modify
    await expect(as(B, (ctx) => t.getTask(ctx, task.id))).rejects.toThrow(/introuvable/);
    await expect(as(B, (ctx) => t.updateTask(ctx, task.id, { title: "x" }))).rejects.toThrow(/introuvable/);
    expect(await as(B, (ctx) => t.listTasks(ctx))).toEqual([]);

    await as(A, (ctx) => t.deleteTask(ctx, task.id, { deleteBlocks: true }));
    await as(A, (ctx) => p.deleteProject(ctx, project.id));
  });

  it("recurring tasks roll forward when completed", async () => {
    const t = await import("@/lib/server/services/tasks");
    const task = await as(A, (ctx) => t.createTask(ctx, { title: "Facturation", due_date: "2026-11-02", recurrence_rule: "FREQ=WEEKLY" }));
    await as(A, (ctx) => t.completeTask(ctx, task.id));
    const open = await as(A, (ctx) => t.listTasks(ctx, { status: ["todo"], search: "Facturation" }));
    expect(open.map((x) => x.due_date)).toEqual(["2026-11-09"]);
    for (const x of await as(A, (ctx) => t.listTasks(ctx, { search: "Facturation" }))) await as(A, (ctx) => t.deleteTask(ctx, x.id));
  });

  it("finds free slots and builds a day summary from real data only", async () => {
    const ev = await import("@/lib/server/services/events");
    const s = await import("@/lib/server/services/schedule");
    const t = await import("@/lib/server/services/tasks");
    // Friday Oct 30, work 9-17 local (13:00Z-21:00Z), meeting 10-11, buffer 10 min
    const { event } = await as(A, (ctx) => ev.createEvent(ctx, { title: "Appel", start_at: "2026-10-30T14:00:00.000Z", end_at: "2026-10-30T15:00:00.000Z" }));
    const slots = await as(A, (ctx) => s.findAvailableSlots(ctx, { start: "2026-10-30T04:00:00.000Z", end: "2026-10-31T04:00:00.000Z", duration_minutes: 120 }));
    expect(slots).toEqual([{ start: "2026-10-30T15:15:00.000Z", end: "2026-10-30T21:00:00.000Z", minutes: 345 }]);

    const overdue = await as(A, (ctx) => t.createTask(ctx, { title: "Proposition en retard", due_date: "2026-10-27", priority: "urgent" }));
    const day = await as(A, (ctx) => s.getDaySchedule(ctx)); // "today" = Thu Oct 29
    expect(day.date).toBe("2026-10-29");
    expect(day.overdue.map((x) => x.title)).toContain("Proposition en retard");
    expect(day.priorities[0].title).toBe("Proposition en retard");
    expect(day.events).toEqual([]);
    expect(day.free_minutes).toBe(7 * 60); // 10:00 → 17:00

    const fri = await as(A, (ctx) => s.getDaySchedule(ctx, "2026-10-30"));
    expect(fri.events.map((e) => e.title)).toEqual(["Appel"]);
    expect(fri.busy_minutes).toBe(60);
    expect(fri.next_event?.title).toBe("Appel");

    await as(A, (ctx) => ev.deleteEvent(ctx, event.id));
    await as(A, (ctx) => t.deleteTask(ctx, overdue.id));
  });
});
