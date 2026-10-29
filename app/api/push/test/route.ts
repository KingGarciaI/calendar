import { route } from "@/lib/server/api";
import { AppError } from "@/lib/server/context";
import { pushConfigured, webPushSender, type PushSubscriptionRow } from "@/lib/server/reminders";

export const POST = route(async ({ ctx }) => {
  if (!pushConfigured()) throw new AppError("unavailable", "Les notifications push ne sont pas configurées sur le serveur (clés VAPID manquantes).");
  const subs = (await ctx.tx`select id, endpoint, p256dh, auth from public.push_subscriptions where user_id = ${ctx.userId}`) as unknown as PushSubscriptionRow[];
  if (!subs.length) throw new AppError("invalid", "Aucun appareil abonné. Active d'abord les notifications sur cet appareil.");
  let sent = 0;
  for (const s of subs) {
    const r = await webPushSender(s, { title: "MVMNT OS", body: "Les notifications fonctionnent sur cet appareil.", url: "/settings", tag: "test" });
    if (r.ok) sent++;
    if (r.gone) await ctx.tx`delete from public.push_subscriptions where id = ${s.id}`;
  }
  return { sent, devices: subs.length };
});
