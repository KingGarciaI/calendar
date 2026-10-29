import { route } from "@/lib/server/api";
import { projectUpdateSchema, uuid } from "@/lib/schemas";
import { deleteProject, getProject, updateProject } from "@/lib/server/services/projects";

export const GET = route(async ({ ctx, params }) => getProject(ctx, uuid.parse(params.id)));
export const PATCH = route(async ({ ctx, params, body }) => updateProject(ctx, uuid.parse(params.id), body), projectUpdateSchema);
export const DELETE = route(async ({ ctx, params }) => deleteProject(ctx, uuid.parse(params.id)));
