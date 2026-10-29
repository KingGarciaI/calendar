import { z } from "zod";
import { route } from "@/lib/server/api";
import { taskCreateSchema, taskListSchema } from "@/lib/schemas";
import { createTask, listTasks } from "@/lib/server/services/tasks";

const list = (v: unknown) => (typeof v === "string" && v ? v.split(",") : undefined);
const querySchema = z.preprocess(
  (raw) => {
    const q = raw as Record<string, string>;
    return {
      ...q,
      status: list(q.status),
      priority: list(q.priority),
      unscheduled: q.unscheduled === "1" ? true : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    };
  },
  taskListSchema,
);

export const GET = route(async ({ ctx, body }) => listTasks(ctx, body), querySchema);
export const POST = route(async ({ ctx, body }) => createTask(ctx, body), taskCreateSchema);
