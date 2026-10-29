import { route } from "@/lib/server/api";
import { eventDeleteSchema, eventUpdateSchema, uuid } from "@/lib/schemas";
import { deleteEvent, getEvent, updateEvent } from "@/lib/server/services/events";

export const GET = route(async ({ ctx, params }) => getEvent(ctx, uuid.parse(params.id)));
export const PATCH = route(async ({ ctx, params, body }) => updateEvent(ctx, uuid.parse(params.id), body), eventUpdateSchema);
export const DELETE = route(async ({ ctx, params, req }) => {
  const args = eventDeleteSchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  return deleteEvent(ctx, uuid.parse(params.id), args);
});
export const dynamic = "force-dynamic";
