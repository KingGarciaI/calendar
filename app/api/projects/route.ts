import { route } from "@/lib/server/api";
import { projectCreateSchema } from "@/lib/schemas";
import { createProject, listProjects } from "@/lib/server/services/projects";

export const GET = route(async ({ ctx, req }) => listProjects(ctx, { includeArchived: req.nextUrl.searchParams.get("archived") === "1" }));
export const POST = route(async ({ ctx, body }) => createProject(ctx, body), projectCreateSchema);
