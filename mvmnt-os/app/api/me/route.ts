import { route } from "@/lib/server/api";
import { settingsUpdateSchema } from "@/lib/schemas";
import { getMe, updateSettings } from "@/lib/server/services/settings";
import { loadContext } from "@/lib/server/context";

export const GET = route(async ({ ctx, user }) => getMe(ctx, user.email));
export const PATCH = route(async ({ ctx, user, body }) => {
  await updateSettings(ctx, body);
  return getMe(await loadContext(ctx.tx, ctx.userId), user.email);
}, settingsUpdateSchema);
