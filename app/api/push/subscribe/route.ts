import { z } from "zod";
import { route } from "@/lib/server/api";

const schema = z.object({
  endpoint: z.url().max(2048),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

export const POST = route(async ({ ctx, body, req }) => {
  // An endpoint belongs to one browser; re-subscribing replaces the previous owner row for this user.
  await ctx.tx`delete from public.push_subscriptions where endpoint = ${body.endpoint}`;
  await ctx.tx`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
    values (${ctx.userId}, ${body.endpoint}, ${body.keys.p256dh}, ${body.keys.auth}, ${req.headers.get("user-agent")?.slice(0, 300) ?? null})`;
  const [{ n }] = await ctx.tx`select count(*)::int as n from public.push_subscriptions where user_id = ${ctx.userId}`;
  return { subscribed: true, devices: n };
}, schema);

export const DELETE = route(async ({ ctx, req }) => {
  const endpoint = req.nextUrl.searchParams.get("endpoint");
  if (endpoint) await ctx.tx`delete from public.push_subscriptions where endpoint = ${endpoint} and user_id = ${ctx.userId}`;
  return { subscribed: false };
});

export const GET = route(async ({ ctx }) => {
  const [{ n }] = await ctx.tx`select count(*)::int as n from public.push_subscriptions where user_id = ${ctx.userId}`;
  return { devices: n, vapid_public_key: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null };
});
