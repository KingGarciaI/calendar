import { z } from "zod";
import { route } from "@/lib/server/api";
import { search } from "@/lib/server/services/schedule";

export const GET = route(async ({ ctx, body }) => search(ctx, body.q), z.object({ q: z.string().trim().min(1).max(100) }));
