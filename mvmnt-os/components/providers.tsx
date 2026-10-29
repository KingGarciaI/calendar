"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { useEffect, useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 20_000, refetchOnWindowFocus: true, retry: (n, e) => n < 2 && (e as { status?: number })?.status !== 401 && (e as { status?: number })?.status !== 404 },
        },
      }),
  );
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={client}>
        <Tooltip.Provider delayDuration={300}>{children}</Tooltip.Provider>
        <Toaster
          position="bottom-right"
          offset={16}
          mobileOffset={{ bottom: "calc(76px + env(safe-area-inset-bottom))" }}
          toastOptions={{
            classNames: {
              toast: "!bg-surface !text-ink !border-line !shadow-pop !rounded-[10px] !font-sans !text-[13px]",
              description: "!text-ink-2",
              actionButton: "!bg-accent !text-accent-fg !font-semibold",
            },
          }}
        />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
