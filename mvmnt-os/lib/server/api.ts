import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { requireUser, UnauthorizedError, type SessionUser } from "@/lib/server/auth";
import { AppError, loadContext, type Ctx } from "@/lib/server/context";
import { withUser } from "@/lib/server/db";

type Handler<B> = (args: { ctx: Ctx; user: SessionUser; body: B; req: NextRequest; params: Record<string, string> }) => Promise<unknown>;

export function errorResponse(err: unknown) {
  if (err instanceof UnauthorizedError) return NextResponse.json({ error: { code: "unauthorized", message: err.message } }, { status: 401 });
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return NextResponse.json(
      { error: { code: "invalid", message: first ? `${first.path.join(".") || "entrée"} : ${first.message}` : "Entrée invalide", issues: err.issues } },
      { status: 400 },
    );
  }
  if (err instanceof AppError) return NextResponse.json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status });
  const pg = err as { code?: string; message?: string };
  if (pg?.code === "23505") return NextResponse.json({ error: { code: "conflict", message: "Cet élément existe déjà" } }, { status: 409 });
  if (pg?.code === "23503") return NextResponse.json({ error: { code: "invalid", message: "Élément lié introuvable" } }, { status: 400 });
  if (pg?.code === "23514" || pg?.code === "22P02" || pg?.code === "22007")
    return NextResponse.json({ error: { code: "invalid", message: "Valeur invalide" } }, { status: 400 });
  console.error("[api] unexpected error", err);
  return NextResponse.json({ error: { code: "server_error", message: "Erreur serveur inattendue" } }, { status: 500 });
}

function sameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return true; // same-origin fetches from older browsers / server-to-server
  try {
    return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
  } catch {
    return false;
  }
}

/** Authenticated JSON route: validates the body, runs inside an RLS-scoped transaction. */
export function route<B = undefined>(handler: Handler<B>, schema?: ZodType<B>) {
  return async (req: NextRequest, segment: { params: Promise<Record<string, string>> }) => {
    try {
      if (req.method !== "GET" && !sameOrigin(req)) throw new AppError("forbidden", "Origine refusée");
      const user = await requireUser();
      let body = undefined as B;
      if (schema) {
        const raw = req.method === "GET" ? Object.fromEntries(req.nextUrl.searchParams) : await req.json().catch(() => ({}));
        body = schema.parse(raw);
      }
      const params = (await segment?.params) ?? {};
      const result = await withUser(user.id, async (tx) => handler({ ctx: await loadContext(tx, user.id), user, body, req, params }));
      return NextResponse.json({ data: result ?? null });
    } catch (err) {
      return errorResponse(err);
    }
  };
}
