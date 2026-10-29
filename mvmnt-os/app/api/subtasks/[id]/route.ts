import { route } from "@/lib/server/api";
import { subtaskUpdateSchema, uuid } from "@/lib/schemas";
import { deleteSubtask, updateSubtask } from "@/lib/server/services/tasks";

export const PATCH = route(async ({ ctx, params, body }) => updateSubtask(ctx, uuid.parse(params.id), body), subtaskUpdateSchema);
export const DELETE = route(async ({ ctx, params }) => deleteSubtask(ctx, uuid.parse(params.id)));
