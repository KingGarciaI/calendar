import { route } from "@/lib/server/api";
import { categoryUpdateSchema, uuid } from "@/lib/schemas";
import { deleteCategory, updateCategory } from "@/lib/server/services/projects";

export const PATCH = route(async ({ ctx, params, body }) => updateCategory(ctx, uuid.parse(params.id), body), categoryUpdateSchema);
export const DELETE = route(async ({ ctx, params }) => deleteCategory(ctx, uuid.parse(params.id)));
