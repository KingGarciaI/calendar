import { z } from "zod";
import { route } from "@/lib/server/api";
import { isoDate } from "@/lib/schemas";
import { getWeekSchedule } from "@/lib/server/services/schedule";

export const GET = route(async ({ ctx, body }) => getWeekSchedule(ctx, body.date), z.object({ date: isoDate.optional() }));
