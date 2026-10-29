import { route } from "@/lib/server/api";
import { eventCreateSchema, rangeSchema } from "@/lib/schemas";
import { createEvent, getOccurrences } from "@/lib/server/services/events";

export const GET = route(async ({ ctx, body }) => getOccurrences(ctx, new Date(body.start), new Date(body.end)), rangeSchema);
export const POST = route(async ({ ctx, body }) => createEvent(ctx, body), eventCreateSchema);
