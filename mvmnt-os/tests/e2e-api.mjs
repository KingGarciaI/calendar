// End-to-end API test against a running server (local dev-auth mode).
// Usage: BASE_URL=http://localhost:3000 node tests/e2e-api.mjs
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log("  ✓", msg);
  else {
    failures++;
    console.log("  ✗", msg);
  }
};

async function login(email) {
  const r = await fetch(`${BASE}/auth/dev`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
  const cookie = r.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("login failed " + r.status);
  return (method, path, body, extraHeaders = {}) =>
    fetch(`${BASE}${path}`, {
      method,
      headers: { cookie, ...(body ? { "content-type": "application/json" } : {}), ...extraHeaders },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    }).then(async (res) => ({ status: res.status, json: await res.json().catch(() => null), headers: res.headers }));
}

const stamp = Date.now();
const A = await login(`e2e-a-${stamp}@test.local`);
const B = await login(`e2e-b-${stamp}@test.local`);

console.log("Auth");
{
  const r = await fetch(`${BASE}/api/tasks`);
  ok(r.status === 401, "API refuses anonymous requests (401)");
  const p = await fetch(`${BASE}/calendar`, { redirect: "manual" });
  ok(p.status === 307 && p.headers.get("location")?.includes("/login"), "pages redirect anonymous users to /login");
  const page = await A("GET", "/calendar");
  ok(page.status === 200, "authenticated page renders");
  const forged = await A("POST", "/api/tasks", { title: "csrf" }, { origin: "https://evil.example" });
  ok(forged.status === 403, "cross-origin write is rejected");
}

console.log("Settings & categories");
const me = (await A("GET", "/api/me")).json.data;
ok(me.profile.timezone === "America/Toronto", "default timezone America/Toronto");
const cats = (await A("GET", "/api/categories")).json.data;
ok(cats.length === 8 && cats[0].name === "Rendez-vous", "8 default categories");

console.log("Projects & tasks");
const project = (await A("POST", "/api/projects", { name: "Restaurant Georgio", color: "#E5484D" })).json.data;
ok(project?.id, "project created");
const bad = await A("POST", "/api/tasks", { title: "" });
ok(bad.status === 400 && /Titre requis/.test(bad.json.error.message), "validation error is readable");
const task = (await A("POST", "/api/tasks", { title: "Monter la vidéo Georgio", estimated_minutes: 120, priority: "high", project_id: project.id, due_date: "2026-11-04", subtasks: ["Dérusher"] })).json.data;
ok(task.subtasks.length === 1, "task created with subtask");
const upd = (await A("PATCH", `/api/tasks/${task.id}`, { status: "in_progress", description: "Version 30 s" })).json.data;
ok(upd.status === "in_progress" && upd.description === "Version 30 s", "task updated");
const sub = (await A("POST", `/api/tasks/${task.id}/subtasks`, { title: "Musique" })).json.data;
ok((await A("PATCH", `/api/subtasks/${sub.id}`, { done: true })).json.data.done === true, "subtask toggled");
const unscheduled = (await A("GET", "/api/tasks?status=todo,in_progress&unscheduled=1")).json.data;
ok(unscheduled.some((t) => t.id === task.id), "task listed as unscheduled");

console.log("Calendar");
const ev = await A("POST", "/api/events", { title: "Rendez-vous Georgio", start_at: "2026-11-03T15:00:00-05:00", end_at: "2026-11-03T16:00:00-05:00", category_id: cats[0].id, project_id: project.id, reminder_offsets: [15] });
ok(ev.status === 200 && ev.json.data.conflicts.length === 0, "event created without conflict");
const sched = await A("POST", `/api/tasks/${task.id}/schedule`, { start_at: "2026-11-03T13:30:00-05:00" });
ok(sched.json.data.event.end_at === "2026-11-03T20:30:00.000Z", "task dragged to Tue 13:30 → 2 h block 13:30–15:30");
ok(sched.json.data.conflicts.length === 1 && sched.json.data.conflicts[0].title === "Rendez-vous Georgio", "conflict with the 15:00 meeting reported");
const pre = (await A("POST", "/api/events/conflicts", { start_at: "2026-11-03T15:30:00-05:00", end_at: "2026-11-03T16:30:00-05:00", suggest: true })).json.data;
ok(pre.conflicts.length === 1 && pre.suggestions.length > 0, "pre-flight conflict check proposes alternatives");
const moved = await A("PATCH", `/api/events/${sched.json.data.event.id}`, { patch: { start_at: "2026-11-03T10:00:00-05:00", end_at: "2026-11-03T12:30:00-05:00" } });
ok(moved.json.data.conflicts.length === 0 && moved.json.data.event.end_at === "2026-11-03T17:30:00.000Z", "block moved & resized, conflict gone");
const range = (await A("GET", "/api/events?start=2026-11-03T05:00:00Z&end=2026-11-04T05:00:00Z")).json.data;
ok(range.length === 2 && range[0].task_id === task.id, "range query returns both, block first");
const rec = (await A("POST", "/api/events", { title: "Stand-up", start_at: "2026-11-02T09:00:00-05:00", end_at: "2026-11-02T09:15:00-05:00", rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR" })).json.data;
const week = (await A("GET", "/api/events?start=2026-11-02T05:00:00Z&end=2026-11-09T05:00:00Z")).json.data;
ok(week.filter((e) => e.id === rec.event.id).length === 3, "recurring series expanded (3 occurrences this week)");
const occDel = await A("DELETE", `/api/events/${rec.event.id}?scope=occurrence&occurrence_start=2026-11-04T14:00:00.000Z`);
ok(occDel.status === 200, "single occurrence deleted");
const week2 = (await A("GET", "/api/events?start=2026-11-02T05:00:00Z&end=2026-11-09T05:00:00Z")).json.data;
ok(week2.filter((e) => e.id === rec.event.id).length === 2, "occurrence removed from series");

console.log("Completion sync");
await A("PATCH", `/api/tasks/${task.id}`, { status: "done" });
const after = (await A("GET", "/api/events?start=2026-11-03T05:00:00Z&end=2026-11-04T05:00:00Z")).json.data;
ok(after.find((e) => e.task_id === task.id)?.task_status === "done", "calendar block reflects task completion");
const proj = (await A("GET", `/api/projects/${project.id}`)).json.data;
ok(proj.tasks_done === 1 && proj.upcoming_events.length >= 1, "project progress & linked events");

console.log("Day summary & availability");
const day = (await A("GET", "/api/schedule/day?date=2026-11-03")).json.data;
ok(day.events.length === 2 && day.busy_minutes === 210, "day summary counts 3 h 30 busy");
const slots = (await A("POST", "/api/slots", { start: "2026-11-03T05:00:00Z", end: "2026-11-04T05:00:00Z", duration_minutes: 60, within_work_hours: true })).json.data;
ok(slots.every((s) => s.minutes >= 60), "slots respect requested duration");
const search = (await A("GET", "/api/search?q=georgio")).json.data;
ok(search.projects.length === 1 && search.events.length >= 1, "global search");

console.log("Isolation between users");
ok((await B("GET", `/api/tasks/${task.id}`)).status === 404, "B cannot read A's task");
ok((await B("PATCH", `/api/events/${ev.json.data.event.id}`, { patch: { title: "x" } })).status === 404, "B cannot edit A's event");
ok((await B("DELETE", `/api/projects/${project.id}`)).status === 404, "B cannot delete A's project");
ok((await B("POST", "/api/tasks", { title: "leech", project_id: project.id })).status === 400, "B cannot attach a task to A's project");
ok((await B("GET", "/api/events?start=2026-11-01T00:00:00Z&end=2026-11-30T00:00:00Z")).json.data.length === 0, "B sees no events");

console.log("Persistence (fresh request)");
const again = (await A("GET", `/api/tasks/${task.id}`)).json.data;
ok(again.status === "done" && again.subtasks_done === 1 && again.subtasks_total === 2, "data persisted in Postgres");

console.log("Cleanup");
ok((await A("DELETE", `/api/tasks/${task.id}?blocks=1`)).status === 200, "task + blocks deleted");
ok((await A("DELETE", `/api/events/${ev.json.data.event.id}`)).status === 200, "event deleted");
ok((await A("DELETE", `/api/events/${rec.event.id}`)).status === 200, "series deleted");
ok((await A("DELETE", `/api/projects/${project.id}`)).status === 200, "project deleted");

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL E2E API CHECKS PASSED");
process.exit(failures ? 1 : 0);
