import { route } from "@/lib/server/api";
import { taskUpdateSchema, uuid } from "@/lib/schemas";
import { deleteTask, getTask, updateTask } from "@/lib/server/services/tasks";

export const GET = route(async ({ ctx, params }) => getTask(ctx, uuid.parse(params.id)));
export const PATCH = route(async ({ ctx, params, body }) => updateTask(ctx, uuid.parse(params.id), body), taskUpdateSchema);
export const DELETE = route(async ({ ctx, params, req }) =>
  deleteTask(ctx, uuid.parse(params.id), { deleteBlocks: req.nextUrl.searchParams.get("blocks") === "1" }),
);
