import { route } from "@/lib/server/api";
import { scheduleTaskSchema, uuid } from "@/lib/schemas";
import { scheduleTask } from "@/lib/server/services/tasks";

export const POST = route(async ({ ctx, params, body }) => scheduleTask(ctx, uuid.parse(params.id), body), scheduleTaskSchema);
