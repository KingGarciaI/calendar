/**
 * Assistant loop with a scripted model: verifies that tools read real data,
 * write real data, and that sensitive actions wait for confirmation.
 * (The real Claude/OpenAI call needs an API key and is not exercised here.)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { Block, Msg, Provider } from "@/lib/server/ai/providers";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const NOW = new Date("2026-10-29T13:00:00.000Z"); // Thu 09:00 Toronto
let U = "";

/** A fake model that plays a fixed script, one reply per call, and records what it saw. */
function scripted(steps: ((seen: Msg[]) => Block[])[]): Provider & { seen: Msg[][]; systems: string[] } {
  let i = 0;
  const p = {
    name: "mock" as const,
    seen: [] as Msg[][],
    systems: [] as string[],
    async complete({ system, messages }: { system: string; messages: Msg[] }) {
      p.seen.push(JSON.parse(JSON.stringify(messages)));
      p.systems.push(system);
      const blocks = steps[Math.min(i++, steps.length - 1)](messages);
      return { blocks, stop: blocks.some((b) => b.type === "tool_call") ? ("tool_use" as const) : ("end" as const) };
    },
  };
  return p;
}
const lastToolResults = (msgs: Msg[]) => msgs[msgs.length - 1].content.filter((b) => b.type === "tool_result") as Extract<Block, { type: "tool_result" }>[];

d("assistant (scripted model, real DB)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    const admin = postgres(url!, { max: 1, onnotice: () => {} });
    [{ id: U }] = await admin`insert into auth.users (email) values (${`ai${Date.now()}@test.local`}) returning id`;
    await admin.end();
  });
  afterAll(async () => {
    const admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin`delete from auth.users where id = ${U}`;
    await admin.end();
    const { sql } = await import("@/lib/server/db");
    await sql().end();
  });

  it("system prompt pins today/tomorrow in the user's timezone", async () => {
    const { withUser } = await import("@/lib/server/db");
    const { loadContext } = await import("@/lib/server/context");
    const { systemPrompt } = await import("@/lib/server/ai/agent");
    const s = await withUser(U, async (tx) => systemPrompt(await loadContext(tx, U), NOW));
    expect(s).toContain("jeudi 29 octobre 2026 = 2026-10-29 (aujourd'hui)");
    expect(s).toContain("vendredi 30 octobre 2026 = 2026-10-30 (demain)");
    expect(s).toContain("America/Toronto");
  });

  let eventId = "";
  let convId = "";

  it("creates a real event from 'demain à 10 h pour une heure' and reports it", async () => {
    const { runChat } = await import("@/lib/server/ai/agent");
    const model = scripted([
      () => [{ type: "tool_call", id: "c1", name: "create_event", args: { title: "Rendez-vous avec Georgio", start: "2026-10-30T10:00", end: "2026-10-30T11:00" } }],
      (m) => {
        const r = lastToolResults(m)[0].result as { status: string; event: { start: string } };
        return [{ type: "text", text: `C'est fait : ${r.event.start}` }];
      },
    ]);
    const out = await runChat(U, { message: "Ajoute un rendez-vous avec Georgio demain à 10 h pour une heure." }, { provider: model, now: () => NOW });
    convId = out.conversation_id;
    const final = out.messages[out.messages.length - 1].content[0] as { text: string };
    expect(final.text).toBe("C'est fait : 2026-10-30T10:00");
    const admin = postgres(url!, { max: 1, onnotice: () => {} });
    const [ev] = await admin`select id, start_at, created_by from public.events where user_id = ${U}`;
    const [act] = await admin`select status, tool from public.ai_actions where user_id = ${U}`;
    await admin.end();
    eventId = ev.id;
    expect(new Date(ev.start_at).toISOString()).toBe("2026-10-30T14:00:00.000Z"); // 10:00 EDT
    expect(ev.created_by).toBe("assistant");
    expect(act).toMatchObject({ status: "executed", tool: "create_event" });
    // the UI receives an "executed" card
    expect(out.messages.some((m) => m.content.some((b) => b.type === "action" && b.status === "executed"))).toBe(true);
  });

  it("reads the real schedule (no invention) for 'j'ai quoi demain ?'", async () => {
    const { runChat } = await import("@/lib/server/ai/agent");
    let seenEvents: { title: string; start: string }[] = [];
    const model = scripted([
      () => [{ type: "tool_call", id: "r1", name: "get_day_schedule", args: { date: "2026-10-30" } }],
      (m) => {
        seenEvents = (lastToolResults(m)[0].result as { events: { title: string; start: string }[] }).events;
        return [{ type: "text", text: "ok" }];
      },
    ]);
    await runChat(U, { conversation_id: convId, message: "J'ai quoi demain ?" }, { provider: model, now: () => NOW });
    expect(seenEvents).toEqual([expect.objectContaining({ title: "Rendez-vous avec Georgio", start: "2026-10-30T10:00" })]);
    // history includes the earlier turn, starting with a user message
    expect(model.seen[0][0].role).toBe("user");
  });

  it("moving an event waits for confirmation, then executes on approval", async () => {
    const { runChat, decideAction } = await import("@/lib/server/ai/agent");
    const model = scripted([
      () => [{ type: "tool_call", id: "m1", name: "update_event", args: { event_id: eventId, start: "2026-10-30T14:00" } }],
      (m) => {
        expect((lastToolResults(m)[0].result as { status: string }).status).toBe("pending_confirmation");
        return [{ type: "text", text: "J'attends ta confirmation." }];
      },
    ]);
    const out = await runChat(U, { conversation_id: convId, message: "Déplace-le à 14 h." }, { provider: model, now: () => NOW });
    const card = out.messages.flatMap((m) => m.content).find((b) => b.type === "action") as Extract<Block, { type: "action" }>;
    expect(card.status).toBe("proposed");
    expect(card.summary).toContain("Déplacer « Rendez-vous avec Georgio »");
    const admin = postgres(url!, { max: 1, onnotice: () => {} });
    let [ev] = await admin`select start_at from public.events where id = ${eventId}`;
    expect(new Date(ev.start_at).toISOString()).toBe("2026-10-30T14:00:00.000Z"); // unchanged
    const r = await decideAction(U, card.action_id, "approve", { now: () => NOW });
    expect(r.status).toBe("executed");
    [ev] = await admin`select start_at, end_at from public.events where id = ${eventId}`;
    expect(new Date(ev.start_at).toISOString()).toBe("2026-10-30T18:00:00.000Z");
    expect(new Date(ev.end_at).toISOString()).toBe("2026-10-30T19:00:00.000Z"); // duration kept
    await expect(decideAction(U, card.action_id, "approve")).rejects.toThrow(/déjà été traitée/);
    await admin.end();
  });

  it("deleting waits for confirmation; rejecting keeps the event", async () => {
    const { runChat, decideAction } = await import("@/lib/server/ai/agent");
    const model = scripted([() => [{ type: "tool_call", id: "d1", name: "delete_event", args: { event_id: eventId } }], () => [{ type: "text", text: "En attente." }]]);
    const out = await runChat(U, { conversation_id: convId, message: "Annule-le." }, { provider: model, now: () => NOW });
    const card = out.messages.flatMap((m) => m.content).find((b) => b.type === "action") as Extract<Block, { type: "action" }>;
    expect(card.status).toBe("proposed");
    const r = await decideAction(U, card.action_id, "reject");
    expect(r.status).toBe("rejected");
    expect(r.message?.content[0]).toMatchObject({ type: "action", status: "rejected" });
    const admin = postgres(url!, { max: 1, onnotice: () => {} });
    expect((await admin`select count(*)::int as n from public.events where id = ${eventId}`)[0].n).toBe(1);
    await admin.end();
  });

  it("a locked event cannot be moved even after approval; failure is reported, not hidden", async () => {
    const { runChat, decideAction } = await import("@/lib/server/ai/agent");
    const admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin`update public.events set locked = true where id = ${eventId}`;
    const model = scripted([() => [{ type: "tool_call", id: "l1", name: "update_event", args: { event_id: eventId, start: "2026-10-30T16:00" } }], () => [{ type: "text", text: "…" }]]);
    const out = await runChat(U, { conversation_id: convId, message: "Mets-le à 16 h." }, { provider: model, now: () => NOW });
    const card = out.messages.flatMap((m) => m.content).find((b) => b.type === "action") as Extract<Block, { type: "action" }>;
    const r = await decideAction(U, card.action_id, "approve");
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/verrouillé/);
    const [ev] = await admin`select start_at from public.events where id = ${eventId}`;
    expect(new Date(ev.start_at).toISOString()).toBe("2026-10-30T18:00:00.000Z");
    await admin.end();
  });

  it("invalid arguments come back to the model as an error, nothing is written", async () => {
    const { runChat } = await import("@/lib/server/ai/agent");
    const model = scripted([
      () => [{ type: "tool_call", id: "x1", name: "create_task", args: { title: "" } }],
      (m) => {
        const r = lastToolResults(m)[0];
        expect(r.is_error).toBe(true);
        return [{ type: "text", text: "Quel titre ?" }];
      },
    ]);
    await runChat(U, { conversation_id: convId, message: "Ajoute une tâche" }, { provider: model, now: () => NOW });
    const admin = postgres(url!, { max: 1, onnotice: () => {} });
    expect((await admin`select count(*)::int as n from public.tasks where user_id = ${U}`)[0].n).toBe(0);
    await admin.end();
  });

  it("finds free time and schedules a task block", async () => {
    const { runChat } = await import("@/lib/server/ai/agent");
    let slots: { start: string }[] = [];
    const model = scripted([
      () => [{ type: "tool_call", id: "t1", name: "create_task", args: { title: "Travailler sur le site Web", estimated_minutes: 120 } }],
      () => [{ type: "tool_call", id: "s1", name: "find_available_slots", args: { start: "2026-10-30T00:00", end: "2026-10-31T00:00", duration_minutes: 120 } }],
      (m) => {
        slots = lastToolResults(m)[0].result as { start: string }[];
        const taskId = (m[m.length - 3].content.find((b) => b.type === "tool_result") as { result: { id: string } }).result.id;
        return [{ type: "tool_call", id: "p1", name: "schedule_task", args: { task_id: taskId, start: slots[0].start } }];
      },
      () => [{ type: "text", text: "Planifié." }],
    ]);
    await runChat(U, { conversation_id: convId, message: "Trouve-moi deux heures vendredi pour le site Web et bloque-les." }, { provider: model, now: () => NOW });
    // Friday: meeting 14:00–15:00 local (locked), work 9–17, buffer 10 → first 2 h slot is 09:00
    expect(slots[0].start).toBe("2026-10-30T09:00");
    const admin = postgres(url!, { max: 1, onnotice: () => {} });
    const [blk] = await admin`select e.start_at, e.end_at from public.events e join public.tasks t on t.id = e.task_id where t.user_id = ${U}`;
    expect(new Date(blk.start_at).toISOString()).toBe("2026-10-30T13:00:00.000Z");
    expect(new Date(blk.end_at).toISOString()).toBe("2026-10-30T15:00:00.000Z");
    const audit = await admin`select tool, status from public.ai_actions where user_id = ${U} order by created_at`;
    await admin.end();
    expect(audit.map((a) => `${a.tool}:${a.status}`)).toEqual([
      "create_event:executed",
      "update_event:executed",
      "delete_event:rejected",
      "update_event:failed",
      "create_task:executed",
      "schedule_task:executed",
    ]);
  });

  it("converts history to valid Anthropic and OpenAI message shapes", async () => {
    const { _toAnthropic, _toOpenAI } = await import("@/lib/server/ai/providers");
    const msgs: Msg[] = [
      { role: "user", content: [{ type: "text", text: "Salut" }] },
      { role: "assistant", content: [{ type: "text", text: "Je regarde." }, { type: "tool_call", id: "a", name: "get_day_schedule", args: {} }] },
      { role: "user", content: [{ type: "tool_result", call_id: "a", name: "get_day_schedule", result: { events: [] } }, { type: "action", action_id: "x", tool: "t", summary: "S", status: "proposed" }] },
      { role: "assistant", content: [{ type: "text", text: "Rien." }] },
      { role: "user", content: [{ type: "action", action_id: "x", tool: "t", summary: "S", status: "executed" }] },
      { role: "user", content: [{ type: "text", text: "Merci" }] },
    ];
    const a = _toAnthropic(msgs);
    expect(a.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
    expect((a[2].content[0] as { type: string }).type).toBe("tool_result");
    expect(a[4].content).toHaveLength(2);
    const o = _toOpenAI("sys", msgs);
    expect(o.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "user", "assistant", "user", "user"]);
    expect((o[2] as { tool_calls: unknown[] }).tool_calls).toHaveLength(1);
  });
});
