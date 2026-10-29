import "server-only";
import { DateTime } from "luxon";
import { AppError, loadContext, type Ctx } from "@/lib/server/context";
import { withUser } from "@/lib/server/db";
import { getProvider, type Block, type Msg, type Provider } from "@/lib/server/ai/providers";
import { requiresConfirmation, toolByName, toolSpecs } from "@/lib/server/ai/tools";

const MAX_STEPS = 8;
const HISTORY = 40;

export type StoredMessage = { id: string; role: "user" | "assistant"; content: Block[]; created_at: string };

export function systemPrompt(ctx: Ctx, now = ctx.now()) {
  const n = DateTime.fromJSDate(now, { zone: ctx.tz }).setLocale("fr-CA");
  const days = Array.from({ length: 15 }, (_, i) => {
    const d = n.plus({ days: i });
    const label = i === 0 ? "aujourd'hui" : i === 1 ? "demain" : i === 2 ? "après-demain" : "";
    return `- ${d.toFormat("cccc d LLLL yyyy")} = ${d.toISODate()}${label ? ` (${label})` : ""}`;
  }).join("\n");
  const s = ctx.settings;
  const dayNames = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];
  return `Tu es l'assistant personnel intégré à MVMNT OS, l'outil d'organisation du fondateur de MVMNT (agence de croissance et de contenu au Québec : tournages, montage, rendez-vous clients, prospection).

Contexte temporel (source de vérité, ne la recalcule pas autrement) :
- Maintenant : ${n.toFormat("cccc d LLLL yyyy, HH:mm")} (${ctx.tz}, UTC${n.toFormat("ZZ")})
- Calendrier des 15 prochains jours :
${days}
- Heures de travail : ${s.work_start}–${s.work_end}, jours : ${s.work_days.map((d) => dayNames[d]).join(", ")}. Marge entre rendez-vous : ${s.buffer_minutes} min. Durée par défaut : ${s.default_event_minutes} min.
- Les outils acceptent et renvoient des heures locales au format YYYY-MM-DDTHH:mm dans le fuseau ${ctx.tz}. N'ajoute pas de décalage UTC toi-même.
- Interprétation : « matin » = début des heures de travail jusqu'à 12:00 ; « après-midi » = 13:00 jusqu'à la fin des heures de travail ; « ce soir » = après 17:00 ; « vendredi » sans précision = le prochain vendredi à venir (aujourd'hui si on est vendredi et que l'heure n'est pas passée) ; « la semaine prochaine » = semaine suivant celle en cours.

Règles :
1. N'invente jamais d'événement, de tâche, de projet ou de disponibilité. Pour toute question sur l'agenda, appelle d'abord un outil de lecture. Pour proposer un horaire, appelle find_available_slots.
2. Distingue toujours clairement : ce que tu PROPOSES, ce qui ATTEND la confirmation de l'utilisateur, et ce qui a RÉELLEMENT été exécuté. Ne dis « c'est fait » que si l'outil a renvoyé un succès.
3. Quand un outil renvoie status "pending_confirmation", dis en une phrase que l'action attend la confirmation (la carte de confirmation s'affiche dans l'interface). Ne la relance pas.
4. Une suppression, l'annulation d'un rendez-vous ou le déplacement d'un événement existant passent par la confirmation : appelle quand même l'outil, le système gère la confirmation.
5. Les événements « locked » sont des rendez-vous fermes : ne propose jamais de les déplacer sans que l'utilisateur le demande explicitement.
6. Pour « organise ma journée / mes tâches », récupère les rendez-vous, les tâches ouvertes, priorités, échéances et durées estimées, puis présente d'abord un plan réaliste (avec heures exactes, marges, une pause, sans remplir toutes les heures libres, sans chevauchement). N'exécute les planifications (schedule_task) qu'après l'accord de l'utilisateur, sauf s'il t'a explicitement demandé de le faire directement.
7. Si une demande est ambiguë (quel rendez-vous ? quelle durée ? quel jour ?), pose UNE question courte au lieu de deviner. Si une tâche n'a pas de durée estimée, demande-la ou propose une durée et dis-le.
8. Si create_event, update_event ou schedule_task signale des conflits, mentionne-les et propose une alternative.
9. Après une action, confirme en une ligne avec le jour et l'heure exacts.

Style : français québécois naturel, tutoiement, concis. Heures au format 14 h 30. Listes courtes quand c'est plus lisible. Pas de préambule.`;
}

/** Keep the tail of the conversation, never starting on an orphan tool result. */
function trimHistory(rows: StoredMessage[]): Msg[] {
  let msgs = rows.slice(-HISTORY);
  while (msgs.length && (msgs[0].role !== "user" || msgs[0].content.some((b) => b.type === "tool_result"))) msgs = msgs.slice(1);
  return msgs.map((m) => ({ role: m.role, content: m.content }));
}

async function insertMessage(ctx: Ctx, conversationId: string, role: "user" | "assistant", content: Block[]): Promise<StoredMessage> {
  const [row] = await ctx.tx`insert into public.ai_messages (user_id, conversation_id, role, content)
    values (${ctx.userId}, ${conversationId}, ${role}, ${ctx.tx.json(content as never)}) returning id, role, content, created_at`;
  await ctx.tx`update public.ai_conversations set updated_at = now() where id = ${conversationId}`;
  return { ...(row as unknown as StoredMessage), created_at: new Date(row.created_at).toISOString() };
}

type Opts = { provider?: Provider; now?: () => Date };

async function ctxFor(tx: Parameters<Parameters<typeof withUser>[1]>[0], userId: string, actor: Ctx["actor"], opts: Opts) {
  const ctx = await loadContext(tx, userId, actor);
  if (opts.now) ctx.now = opts.now;
  return ctx;
}

export async function runChat(userId: string, input: { conversation_id?: string; message: string }, opts: Opts = {}) {
  if (!opts.provider && !process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    throw new AppError("unavailable", "L'assistant n'est pas encore branché : ajoute ANTHROPIC_API_KEY dans les variables d'environnement du serveur (Vercel).");
  }
  // 1. persist the user turn
  const start = await withUser(userId, async (tx) => {
    const ctx = await ctxFor(tx, userId, "user", opts);
    let convId = input.conversation_id;
    if (convId) {
      const ok = await tx`select 1 from public.ai_conversations where id = ${convId} and user_id = ${userId}`;
      if (!ok.length) throw new AppError("not_found", "Conversation introuvable");
    } else {
      const title = input.message.trim().replace(/\s+/g, " ").slice(0, 80);
      [{ id: convId }] = await tx`insert into public.ai_conversations (user_id, title) values (${userId}, ${title}) returning id`;
    }
    const userMsg = await insertMessage(ctx, convId!, "user", [{ type: "text", text: input.message.trim() }]);
    const rows = (await tx`select id, role, content, created_at from public.ai_messages where conversation_id = ${convId!} order by created_at, id`) as unknown as StoredMessage[];
    return { convId: convId!, userMsg, history: trimHistory(rows), settings: ctx.settings };
  });

  const provider = opts.provider ?? getProvider(start.settings.ai_provider);
  const produced: StoredMessage[] = [start.userMsg];
  const history = start.history;
  const tools = toolSpecs();

  // 2. agent loop — no DB transaction is held open while the model thinks
  for (let step = 0; step < MAX_STEPS; step++) {
    const system = await withUser(userId, async (tx) => systemPrompt(await ctxFor(tx, userId, "assistant", opts)));
    let reply;
    try {
      reply = await provider.complete({ system, messages: history, tools });
    } catch (e) {
      const msg = e instanceof AppError ? e.message : "Le service d'IA ne répond pas. Réessaie dans un instant.";
      const saved = await withUser(userId, async (tx) => insertMessage(await ctxFor(tx, userId, "assistant", opts), start.convId, "assistant", [{ type: "text", text: `⚠️ ${msg}` }]));
      produced.push(saved);
      break;
    }
    const assistantBlocks = reply.blocks.length ? reply.blocks : [{ type: "text" as const, text: "" }];
    const saved = await withUser(userId, async (tx) => insertMessage(await ctxFor(tx, userId, "assistant", opts), start.convId, "assistant", assistantBlocks));
    produced.push(saved);
    history.push({ role: "assistant", content: assistantBlocks });

    const calls = reply.blocks.filter((b): b is Extract<Block, { type: "tool_call" }> => b.type === "tool_call");
    if (!calls.length) break;

    const results: Block[] = [];
    for (const call of calls) {
      results.push(...(await executeCall(userId, start.convId, call, opts)));
    }
    const savedResults = await withUser(userId, async (tx) => insertMessage(await ctxFor(tx, userId, "assistant", opts), start.convId, "user", results));
    produced.push(savedResults);
    history.push({ role: "user", content: results });
    if (step === MAX_STEPS - 1) {
      const stop = await withUser(userId, async (tx) =>
        insertMessage(await ctxFor(tx, userId, "assistant", opts), start.convId, "assistant", [{ type: "text", text: "J'ai atteint la limite d'étapes pour cette demande. Peux-tu la préciser ou la découper ?" }]),
      );
      produced.push(stop);
    }
  }
  return { conversation_id: start.convId, messages: produced };
}

async function executeCall(userId: string, convId: string, call: Extract<Block, { type: "tool_call" }>, opts: Opts): Promise<Block[]> {
  const def = toolByName(call.name);
  if (!def) return [{ type: "tool_result", call_id: call.id, name: call.name, result: { error: `Outil inconnu : ${call.name}` }, is_error: true }];
  const parsed = def.schema.safeParse(call.args ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return [{ type: "tool_result", call_id: call.id, name: call.name, result: { error: `Arguments invalides : ${issue?.path.join(".")} ${issue?.message}` }, is_error: true }];
  }
  const args = parsed.data;

  try {
    return await withUser(userId, async (tx) => {
      const ctx = await ctxFor(tx, userId, "assistant", opts);
      if (requiresConfirmation(def, args, ctx)) {
        const summary = await def.summarize(args, ctx);
        const [a] = await tx`insert into public.ai_actions (user_id, conversation_id, tool, args, status)
          values (${userId}, ${convId}, ${def.name}, ${tx.json(args as never)}, 'proposed') returning id`;
        return [
          { type: "tool_result", call_id: call.id, name: call.name, result: { status: "pending_confirmation", action_id: a.id, summary } },
          { type: "action", action_id: a.id, tool: def.name, summary, status: "proposed" },
        ] as Block[];
      }
      const result = await def.run(ctx, args);
      if (def.risk !== "read") {
        const summary = await def.summarize(args, ctx);
        await tx`insert into public.ai_actions (user_id, conversation_id, tool, args, status, result, decided_at)
          values (${userId}, ${convId}, ${def.name}, ${tx.json(args as never)}, 'executed', ${tx.json(result as never)}, now())`;
        return [
          { type: "tool_result", call_id: call.id, name: call.name, result: { status: "executed", ...(result as object) } },
          { type: "action", action_id: "auto", tool: def.name, summary, status: "executed" },
        ] as Block[];
      }
      return [{ type: "tool_result", call_id: call.id, name: call.name, result }] as Block[];
    });
  } catch (e) {
    const message = e instanceof AppError ? e.message : "Erreur lors de l'exécution";
    if (def.risk !== "read") {
      await withUser(userId, (tx) =>
        tx`insert into public.ai_actions (user_id, conversation_id, tool, args, status, error, decided_at)
          values (${userId}, ${convId}, ${def.name}, ${tx.json(args as never)}, 'failed', ${message}, now())`,
      ).catch(() => {});
    }
    if (!(e instanceof AppError)) console.error("[ai] tool failed", call.name, e);
    return [{ type: "tool_result", call_id: call.id, name: call.name, result: { error: message }, is_error: true }];
  }
}

/** The user confirms or rejects a proposed action. Executes it through the same validated tool. */
export async function decideAction(userId: string, actionId: string, decision: "approve" | "reject", opts: Opts = {}) {
  return withUser(userId, async (tx) => {
    const ctx = await ctxFor(tx, userId, "assistant", opts);
    const [a] = await tx`select id, tool, args, status, conversation_id from public.ai_actions where id = ${actionId} and user_id = ${userId} for update`;
    if (!a) throw new AppError("not_found", "Action introuvable");
    if (a.status !== "proposed") throw new AppError("conflict", "Cette action a déjà été traitée");
    const def = toolByName(a.tool);
    if (!def) throw new AppError("invalid", "Outil inconnu");
    const args = def.schema.parse(a.args);
    const summary = await def.summarize(args, ctx);
    let status: "executed" | "rejected" | "failed" = "rejected";
    let result: unknown = null;
    let error: string | undefined;
    if (decision === "approve") {
      try {
        result = await tx.savepoint(async () => def.run(ctx, args));
        status = "executed";
      } catch (e) {
        status = "failed";
        error = e instanceof AppError ? e.message : "Erreur lors de l'exécution";
        if (!(e instanceof AppError)) console.error("[ai] confirmed action failed", e);
      }
    }
    await tx`update public.ai_actions set status = ${status}, result = ${result === null ? null : tx.json(result as never)}, error = ${error ?? null}, decided_at = now() where id = ${actionId}`;
    let message: StoredMessage | null = null;
    if (a.conversation_id) {
      message = await insertMessage(ctx, a.conversation_id, "user", [{ type: "action", action_id: actionId, tool: def.name, summary, status, error }]);
    }
    return { status, summary, result, error, message };
  });
}
