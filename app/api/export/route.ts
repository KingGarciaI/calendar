import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { loadContext } from "@/lib/server/context";
import { withUser } from "@/lib/server/db";
import { errorResponse } from "@/lib/server/api";
import { exportData } from "@/lib/server/services/settings";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const what = (["tasks", "events", "all"] as const).find((w) => w === req.nextUrl.searchParams.get("what")) ?? "all";
    const data = await withUser(user.id, async (tx) => exportData(await loadContext(tx, user.id), what));
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="mvmnt-os-${what}-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
