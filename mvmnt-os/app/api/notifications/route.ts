import { z } from "zod";
import { route } from "@/lib/server/api";

export const GET = route(async ({ ctx }) => {
  const items = await ctx.tx`select id, kind, title, body, link, read_at, created_at from public.notifications
    where user_id = ${ctx.userId} order by created_at desc limit 30`;
  const [{ n }] = await ctx.tx`select count(*)::int as n from public.notifications where user_id = ${ctx.userId} and read_at is null`;
  return { unread: n, items: items.map((i) => ({ ...i, created_at: new Date(i.created_at).toISOString(), read_at: i.read_at ? new Date(i.read_at).toISOString() : null })) };
});

export const POST = route(async ({ ctx, body }) => {
  if (body.ids?.length) await ctx.tx`update public.notifications set read_at = now() where user_id = ${ctx.userId} and id = any(${body.ids}::uuid[]) and read_at is null`;
  else await ctx.tx`update public.notifications set read_at = now() where user_id = ${ctx.userId} and read_at is null`;
  return { ok: true };
}, z.object({ ids: z.array(z.uuid()).max(100).optional() }));
