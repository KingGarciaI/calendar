import "server-only";
import { AppError } from "@/lib/server/context";

/** Provider-neutral conversation format, stored as-is in ai_messages.content. */
export type Block =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "tool_result"; call_id: string; name: string; result: unknown; is_error?: boolean }
  /** UI-only: a proposed / decided action card. Sent to the model as plain text. */
  | { type: "action"; action_id: string; tool: string; summary: string; status: "proposed" | "executed" | "rejected" | "failed"; error?: string };

export type Msg = { role: "user" | "assistant"; content: Block[] };
export type ToolSpec = { name: string; description: string; input_schema: Record<string, unknown> };
export type ProviderReply = { blocks: Block[]; stop: "end" | "tool_use" | "max_tokens" };

export interface Provider {
  name: "anthropic" | "openai" | "mock";
  complete(args: { system: string; messages: Msg[]; tools: ToolSpec[] }): Promise<ProviderReply>;
}

const ACTION_TEXT: Record<string, string> = {
  proposed: "en attente de confirmation",
  executed: "confirmée par l'utilisateur et exécutée",
  rejected: "refusée par l'utilisateur — ne pas l'exécuter",
  failed: "a échoué",
};
const actionText = (b: Extract<Block, { type: "action" }>) =>
  `[Action ${b.action_id} « ${b.summary} » : ${ACTION_TEXT[b.status]}${b.error ? ` (${b.error})` : ""}]`;

// --------------------------------------------------------------- Anthropic
function toAnthropic(messages: Msg[]) {
  const out: { role: "user" | "assistant"; content: unknown[] }[] = [];
  for (const m of messages) {
    const content = m.content
      .map((b) => {
        switch (b.type) {
          case "text":
            return b.text ? { type: "text", text: b.text } : null;
          case "tool_call":
            return { type: "tool_use", id: b.id, name: b.name, input: b.args ?? {} };
          case "tool_result":
            return { type: "tool_result", tool_use_id: b.call_id, content: JSON.stringify(b.result ?? null), is_error: b.is_error || undefined };
          case "action":
            return { type: "text", text: actionText(b) };
        }
      })
      .filter(Boolean) as unknown[];
    if (!content.length) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content.push(...content);
    else out.push({ role: m.role, content });
  }
  // tool_result blocks must come first in a user turn
  for (const m of out) if (m.role === "user") m.content.sort((a, b) => Number((b as { type: string }).type === "tool_result") - Number((a as { type: string }).type === "tool_result"));
  return out;
}

export function anthropicProvider(apiKey: string, model: string): Provider {
  return {
    name: "anthropic",
    async complete({ system, messages, tools }) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 2048, system, messages: toAnthropic(messages), tools }),
        signal: AbortSignal.timeout(55_000),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new AppError("unavailable", `Claude a répondu ${res.status} : ${json?.error?.message ?? "erreur inconnue"}`);
      const blocks: Block[] = [];
      for (const c of json.content ?? []) {
        if (c.type === "text") blocks.push({ type: "text", text: c.text });
        if (c.type === "tool_use") blocks.push({ type: "tool_call", id: c.id, name: c.name, args: c.input });
      }
      return { blocks, stop: json.stop_reason === "tool_use" ? "tool_use" : json.stop_reason === "max_tokens" ? "max_tokens" : "end" };
    },
  };
}

// --------------------------------------------------------------- OpenAI
function toOpenAI(system: string, messages: Msg[]) {
  const out: Record<string, unknown>[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "assistant") {
      const text = m.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
      const calls = m.content.filter((b) => b.type === "tool_call") as Extract<Block, { type: "tool_call" }>[];
      out.push({
        role: "assistant",
        content: text || null,
        ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } })) } : {}),
      });
    } else {
      for (const b of m.content) if (b.type === "tool_result") out.push({ role: "tool", tool_call_id: b.call_id, content: JSON.stringify(b.result ?? null) });
      const text = m.content
        .map((b) => (b.type === "text" ? b.text : b.type === "action" ? actionText(b) : ""))
        .filter(Boolean)
        .join("\n");
      if (text) out.push({ role: "user", content: text });
    }
  }
  return out;
}

export function openaiProvider(apiKey: string, model: string): Provider {
  return {
    name: "openai",
    async complete({ system, messages, tools }) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: toOpenAI(system, messages),
          tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } })),
        }),
        signal: AbortSignal.timeout(55_000),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new AppError("unavailable", `OpenAI a répondu ${res.status} : ${json?.error?.message ?? "erreur inconnue"}`);
      const msg = json.choices?.[0]?.message ?? {};
      const blocks: Block[] = [];
      if (msg.content) blocks.push({ type: "text", text: msg.content });
      for (const c of msg.tool_calls ?? []) {
        let args: unknown = {};
        try {
          args = JSON.parse(c.function.arguments || "{}");
        } catch {}
        blocks.push({ type: "tool_call", id: c.id, name: c.function.name, args });
      }
      return { blocks, stop: blocks.some((b) => b.type === "tool_call") ? "tool_use" : "end" };
    },
  };
}

/** Picks the provider from the user's setting; keys live only in server env vars. */
export function getProvider(preferred: "anthropic" | "openai"): Provider {
  const order = preferred === "openai" ? (["openai", "anthropic"] as const) : (["anthropic", "openai"] as const);
  for (const p of order) {
    if (p === "anthropic" && process.env.ANTHROPIC_API_KEY) return anthropicProvider(process.env.ANTHROPIC_API_KEY, process.env.AI_MODEL_ANTHROPIC || "claude-sonnet-5-5");
    if (p === "openai" && process.env.OPENAI_API_KEY) return openaiProvider(process.env.OPENAI_API_KEY, process.env.AI_MODEL_OPENAI || "gpt-5");
  }
  throw new AppError("unavailable", "Aucune clé d'IA n'est configurée sur le serveur. Ajoute ANTHROPIC_API_KEY dans les variables d'environnement Vercel.");
}

export { toAnthropic as _toAnthropic, toOpenAI as _toOpenAI };
