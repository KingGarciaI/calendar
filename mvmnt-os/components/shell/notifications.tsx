"use client";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { DateTime } from "luxon";
import { api } from "@/lib/client/api";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlay";
import { cn } from "@/lib/utils";

type Item = { id: string; kind: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string };

export function NotificationBell() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get<{ unread: number; items: Item[] }>("/api/notifications"),
    refetchInterval: 60_000,
  });
  const unread = data?.unread ?? 0;
  return (
    <Popover
      onOpenChange={async (o) => {
        if (!o && unread) {
          await api.post("/api/notifications", {});
          qc.invalidateQueries({ queryKey: ["notifications"] });
        }
      }}
    >
      <PopoverTrigger asChild>
        <button className="relative rounded-md p-2 text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label={unread ? `Notifications, ${unread} non lues` : "Notifications"}>
          <Bell className="h-[18px] w-[18px]" />
          {unread ? <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent ring-2 ring-surface" /> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(360px,calc(100vw-24px))] p-0">
        <p className="border-b border-line px-4 py-3 text-sm font-semibold">Notifications</p>
        <div className="scroll-thin max-h-[60vh] overflow-y-auto">
          {data?.items.length ? (
            data.items.map((n) => (
              <Link key={n.id} href={n.link ?? "/today"} className={cn("block border-b border-line px-4 py-3 last:border-0 hover:bg-surface-hover", !n.read_at && "bg-accent-soft/50")}>
                <span className="flex items-start justify-between gap-3">
                  <span className="text-sm font-semibold">{n.title}</span>
                  <span className="shrink-0 text-[11px] text-ink-3">{DateTime.fromISO(n.created_at).setLocale("fr-CA").toRelative()}</span>
                </span>
                {n.body ? <span className="mt-0.5 block text-xs text-ink-2">{n.body}</span> : null}
              </Link>
            ))
          ) : (
            <p className="px-4 py-6 text-sm text-ink-3">Tes rappels de rendez-vous, d&apos;échéances et ton résumé du matin apparaîtront ici.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
