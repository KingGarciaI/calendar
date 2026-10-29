import { route } from "@/lib/server/api";
import { notFound } from "@/lib/server/context";
import { uuid } from "@/lib/schemas";

export const GET = route(async ({ ctx, params }) => {
  const id = uuid.parse(params.id);
  const [conv] = await ctx.tx`select id, title from public.ai_conversations where id = ${id} and user_id = ${ctx.userId}`;
  if (!conv) throw notFound("Conversation");
  const messages = await ctx.tx`select id, role, content, created_at from public.ai_messages where conversation_id = ${id} order by created_at, id`;
  // Reflect the latest status of each proposed action on its card.
  const actions = await ctx.tx`select id, status, error from public.ai_actions where conversation_id = ${id}`;
  return {
    id: conv.id,
    title: conv.title,
    messages: messages.map((m) => ({ ...m, created_at: new Date(m.created_at).toISOString() })),
    actions: Object.fromEntries(actions.map((a) => [a.id, { status: a.status, error: a.error }])),
  };
});

export const DELETE = route(async ({ ctx, params }) => {
  const res = await ctx.tx`delete from public.ai_conversations where id = ${uuid.parse(params.id)} and user_id = ${ctx.userId} returning id`;
  if (!res.length) throw notFound("Conversation");
  return { deleted: true };
});
