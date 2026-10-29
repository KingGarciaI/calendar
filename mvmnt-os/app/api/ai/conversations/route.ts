import { route } from "@/lib/server/api";

export const GET = route(async ({ ctx }) => {
  const rows = await ctx.tx`select id, title, updated_at from public.ai_conversations where user_id = ${ctx.userId} order by updated_at desc limit 30`;
  return rows.map((r) => ({ id: r.id, title: r.title, updated_at: new Date(r.updated_at).toISOString() }));
});
