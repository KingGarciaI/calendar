import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
let U = "";

d("reminder engine", () => {
  const sent: { endpoint: string; title: string; body: string }[] = [];
  const send = async (s: { endpoint: string }, p: { title: string; body: string }) => {
    sent.push({ endpoint: s.endpoint, title: p.title, body: p.body });
    return { ok: true, gone: s.endpoint.includes("gone") };
  };
  let admin: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    [{ id: U }] = await admin`insert into auth.users (email) values (${`rem${Date.now()}@test.local`}) returning id`;
    await admin`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values
      (${U}, ${"https://push.test/ok-" + U}, ${"k".repeat(20)}, ${"a".repeat(10)}),
      (${U}, ${"https://push.test/gone-" + U}, ${"k".repeat(20)}, ${"a".repeat(10)})`;
    await admin`update public.notification_preferences set daily_summary_time = '07:00', quiet_start = '22:00', quiet_end = '07:00' where user_id = ${U}`;
  });
  afterAll(async () => {
    await admin`delete from auth.users where id = ${U}`;
    await admin.end();
    const { sql } = await import("@/lib/server/db");
    await sql().end();
  });

  it("fires an event reminder once, at the right time, even for recurring events across DST", async () => {
    const { withUser } = await import("@/lib/server/db");
    const { loadContext } = await import("@/lib/server/context");
    const { createEvent } = await import("@/lib/server/services/events");
    const { runReminders } = await import("@/lib/server/reminders");
    // weekly Monday 09:00 local starting Oct 26 (EDT); Nov 2 is EST → 14:00Z, reminder 15 min before → 13:45Z
    await withUser(U, async (tx) =>
      createEvent(await loadContext(tx, U), { title: "Stand-up", start_at: "2026-10-26T13:00:00.000Z", end_at: "2026-10-26T13:30:00.000Z", rrule: "FREQ=WEEKLY;BYDAY=MO", reminder_offsets: [15] }),
    );
    let r = await runReminders({ now: new Date("2026-11-02T13:40:00Z"), send, userIds: [U] });
    expect(r.notifications).toBe(0);
    r = await runReminders({ now: new Date("2026-11-02T13:46:00Z"), send, userIds: [U] });
    expect(r.notifications).toBe(1);
    expect(sent.at(-1)).toMatchObject({ title: "Stand-up", body: "Dans 15 min · 9 h – 9 h 30" });
    expect(sent).toHaveLength(2); // two devices
    // the dead subscription was removed
    expect((await admin`select count(*)::int as n from public.push_subscriptions where user_id = ${U}`)[0].n).toBe(1);
    // a second run in the same window does not notify again
    r = await runReminders({ now: new Date("2026-11-02T13:48:00Z"), send, userIds: [U] });
    expect(r.notifications).toBe(0);
  });

  it("sends the daily summary at the chosen time, built from real data", async () => {
    const { runReminders } = await import("@/lib/server/reminders");
    const before = sent.length;
    // Nov 2, 07:01 EST = 12:01Z
    const r = await runReminders({ now: new Date("2026-11-02T12:01:00Z"), send, userIds: [U] });
    expect(r.notifications).toBe(1);
    expect(sent.slice(before)[0]).toMatchObject({ title: "Ta journée", body: "1 rendez-vous · 0 tâche. Premier : Stand-up à 9 h." });
  });

  it("respects quiet hours: in-app notification only, no push", async () => {
    const { withUser } = await import("@/lib/server/db");
    const { loadContext } = await import("@/lib/server/context");
    const { createEvent } = await import("@/lib/server/services/events");
    const { runReminders } = await import("@/lib/server/reminders");
    await withUser(U, async (tx) =>
      createEvent(await loadContext(tx, U), { title: "Vol tôt", start_at: "2026-11-04T11:00:00.000Z", end_at: "2026-11-04T12:00:00.000Z", reminder_offsets: [60] }),
    ); // 06:00 EST, reminder at 05:00 = quiet
    const before = sent.length;
    const r = await runReminders({ now: new Date("2026-11-04T10:01:00Z"), send, userIds: [U] });
    expect(r.notifications).toBe(1);
    expect(sent.length).toBe(before);
    const [n] = await admin`select title from public.notifications where user_id = ${U} and kind = 'event_reminder' order by created_at desc limit 1`;
    expect(n.title).toBe("Vol tôt");
  });

  it("task deadline reminders and the privileged user listing", async () => {
    const { withUser } = await import("@/lib/server/db");
    const { loadContext } = await import("@/lib/server/context");
    const { createTask } = await import("@/lib/server/services/tasks");
    const { runReminders } = await import("@/lib/server/reminders");
    await withUser(U, async (tx) => createTask(await loadContext(tx, U), { title: "Envoyer la proposition", due_date: "2026-11-05", due_time: "17:00", reminder_offsets: [60] }));
    const before = sent.length;
    const r = await runReminders({ now: new Date("2026-11-05T21:02:00Z"), send }); // 16:02 EST, all users
    expect(r.users).toBeGreaterThan(0);
    expect(sent.slice(before).map((s) => s.title)).toContain("Envoyer la proposition");
    // authenticated users cannot call the privileged listing
    await expect(admin.begin(async (tx) => {
      await tx.unsafe("set local role authenticated");
      await tx`select public.reminder_user_ids()`;
    })).rejects.toThrow(/permission denied/);
  });
});
