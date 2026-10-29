import { route } from "@/lib/server/api";
import { subtaskCreateSchema, uuid } from "@/lib/schemas";
import { addSubtask } from "@/lib/server/services/tasks";

export const POST = route(async ({ ctx, params, body }) => addSubtask(ctx, uuid.parse(params.id), body.title), subtaskCreateSchema);
