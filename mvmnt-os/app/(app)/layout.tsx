import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/server/auth";
import { AppShell } from "@/components/shell/app-shell";
import { InspectorProvider } from "@/components/shell/inspector";
import { ThemeSync } from "@/components/shell/theme-sync";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return (
    <InspectorProvider>
      <ThemeSync />
      <AppShell>{children}</AppShell>
    </InspectorProvider>
  );
}
