import { route } from "@/lib/server/api";
import { categoryCreateSchema } from "@/lib/schemas";
import { createCategory, listCategories } from "@/lib/server/services/projects";

export const GET = route(async ({ ctx }) => listCategories(ctx));
export const POST = route(async ({ ctx, body }) => createCategory(ctx, body), categoryCreateSchema);
