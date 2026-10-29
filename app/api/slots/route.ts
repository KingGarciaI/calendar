import { route } from "@/lib/server/api";
import { slotsSchema } from "@/lib/schemas";
import { findAvailableSlots } from "@/lib/server/services/schedule";

export const POST = route(async ({ ctx, body }) => findAvailableSlots(ctx, body), slotsSchema);
