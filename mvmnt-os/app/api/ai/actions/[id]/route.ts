import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { errorResponse } from "@/lib/server/api";
import { AppError } from "@/lib/server/context";
import { decideAction } from "@/lib/server/ai/agent";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const origin = req.headers.get("origin");
    if (origin && new URL(origin).host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) throw new AppError("forbidden", "Origine refusée");
    const user = await requireUser();
    const { id } = await params;
    const { decision } = z.object({ decision: z.enum(["approve", "reject"]) }).parse(await req.json().catch(() => ({})));
    return NextResponse.json({ data: await decideAction(user.id, z.uuid().parse(id), decision) });
  } catch (e) {
    return errorResponse(e);
  }
}
