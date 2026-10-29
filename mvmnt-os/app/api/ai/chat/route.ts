import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { errorResponse } from "@/lib/server/api";
import { AppError } from "@/lib/server/context";
import { runChat } from "@/lib/server/ai/agent";

export const maxDuration = 60;

const schema = z.object({ conversation_id: z.uuid().optional(), message: z.string().trim().min(1).max(4000) });

export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get("origin");
    if (origin && new URL(origin).host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) throw new AppError("forbidden", "Origine refusée");
    const user = await requireUser();
    const body = schema.parse(await req.json().catch(() => ({})));
    return NextResponse.json({ data: await runChat(user.id, body) });
  } catch (e) {
    return errorResponse(e);
  }
}
