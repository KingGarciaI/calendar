"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  CalendarDays,
  CheckSquare,
  FolderKanban,
  LayoutGrid,
  Plus,
  Search,
  Settings,
  Sparkles,
  Sun,
  X,
  CalendarPlus,
  ListPlus,
  PanelRightClose,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Kbd } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/overlay";
import { newEventDraft, useHotkeys, useInspector, useIsDesktop, type PanelState } from "@/components/shell/inspector";
import { CommandPalette } from "@/components/shell/command-palette";
import { NotificationBell } from "@/components/shell/notifications";
import { TaskEditor } from "@/components/tasks/task-editor";
import { EventEditor } from "@/components/events/event-editor";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { useMe } from "@/lib/client/hooks";

const NAV = [
  { href: "/", label: "Tableau de bord", short: "Accueil", icon: LayoutGrid },
  { href: "/today", label: "Aujourd'hui", short: "Aujourd'hui", icon: Sun },
  { href: "/calendar", label: "Calendrier", short: "Calendrier", icon: CalendarDays },
  { href: "/tasks", label: "Tâches", short: "Tâches", icon: CheckSquare },
  { href: "/projects", label: "Projets", short: "Projets", icon: FolderKanban },
  { href: "/assistant", label: "Assistant", short: "Assistant", icon: Sparkles },
];

const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" aria-hidden>
        <rect width="24" height="24" rx="6" fill="var(--accent)" />
        <path d="M6 17V7.5l6 6 6-6V17" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-[15px] font-bold tracking-[0.06em]">MVMNT</span>
      <span className="text-[15px] font-normal text-ink-3">OS</span>
    </span>
  );
}


function panelTitle(p: PanelState) {
  switch (p?.kind) {
    case "task":
      return "Tâche";
    case "new-task":
      return "Nouvelle tâche";
    case "event":
      return "Événement";
    case "new-event":
      return "Nouvel événement";
    case "assistant":
      return "Assistant";
    default:
      return "";
  }
}

function PanelBody({ panel }: { panel: PanelState }) {
  if (!panel) return null;
  switch (panel.kind) {
    case "task":
      return <TaskEditor key={panel.id} id={panel.id} />;
    case "new-task":
      return <TaskEditor key={JSON.stringify(panel.defaults ?? {})} defaults={panel.defaults} />;
    case "event":
      return <EventEditor key={panel.id + (panel.occurrence?.instance_id ?? "")} id={panel.id} occurrence={panel.occurrence} />;
    case "new-event":
      return <EventEditor key={panel.draft.start_at + (panel.draft.task_id ?? "")} draft={panel.draft} />;
    case "assistant":
      return <AssistantPanel compact />;
  }
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { panel, open, close, toggleAssistant } = useInspector();
  const isDesktop = useIsDesktop();
  const { data: me } = useMe();
  const tz = me?.profile.timezone ?? "America/Toronto";
  const [paletteOpen, setPaletteOpen] = useState(false);
  const onAssistantPage = pathname.startsWith("/assistant");

  const hotkeys = useMemo(
    () => ({
      "mod+k": () => setPaletteOpen((o) => !o),
      "/": () => setPaletteOpen(true),
      n: () => open({ kind: "new-task" }),
      e: () => open({ kind: "new-event", draft: newEventDraft(tz, me?.settings.default_event_minutes) }),
      a: () => (onAssistantPage ? null : toggleAssistant()),
      escape: () => close(),
      "1": () => router.push("/"),
      "2": () => router.push("/today"),
      "3": () => router.push("/calendar"),
      "4": () => router.push("/tasks"),
      "5": () => router.push("/projects"),
    }),
    [open, close, toggleAssistant, router, tz, me?.settings.default_event_minutes, onAssistantPage],
  );
  useHotkeys(hotkeys);

  const showSidePanel = isDesktop && panel !== null && !(panel.kind === "assistant" && onAssistantPage);

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Sidebar */}
      <aside className="hidden w-[228px] shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div className="flex h-14 items-center px-5">
          <Link href="/" aria-label="Accueil MVMNT OS">
            <Wordmark />
          </Link>
        </div>
        <div className="px-3 pb-2">
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex h-8 w-full items-center gap-2 rounded-[var(--radius-ctl)] border border-line bg-bg px-2.5 text-sm text-ink-3 hover:border-line-strong"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="flex-1 text-left">Rechercher</span>
            <Kbd>⌘K</Kbd>
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 px-3 py-2" aria-label="Navigation principale">
          {NAV.map((n, i) => {
            const active = isActive(pathname, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex h-8 items-center gap-2.5 rounded-[var(--radius-ctl)] px-2.5 text-[13.5px] font-semibold transition-colors",
                  active ? "bg-accent-soft text-accent-text" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                )}
              >
                <n.icon className="h-4 w-4" />
                <span className="flex-1">{n.label}</span>
                {i < 5 ? <span className="text-[11px] font-normal text-ink-3 opacity-0 group-hover:opacity-100">{i + 1}</span> : null}
              </Link>
            );
          })}
        </nav>
        <div className="space-y-0.5 border-t border-line px-3 py-3">
          <Link
            href="/settings"
            className={cn(
              "flex h-8 items-center gap-2.5 rounded-[var(--radius-ctl)] px-2.5 text-[13.5px] font-semibold",
              pathname.startsWith("/settings") ? "bg-accent-soft text-accent-text" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
            )}
          >
            <Settings className="h-4 w-4" /> Paramètres
          </Link>
          <p className="truncate px-2.5 pt-1 text-xs text-ink-3">{me?.profile.full_name || me?.user.email}</p>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="pt-safe flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line bg-surface/80 px-4 backdrop-blur md:bg-transparent md:backdrop-blur-none md:border-transparent md:px-6">
          <Link href="/" className="md:hidden" aria-label="Tableau de bord">
            <Wordmark />
          </Link>
          <div className="hidden md:block" />
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPaletteOpen(true)} className="rounded-md p-2 text-ink-2 hover:bg-surface-2 md:hidden" aria-label="Rechercher">
              <Search className="h-[18px] w-[18px]" />
            </button>
            <NotificationBell />
            <Link href="/settings" className="rounded-md p-2 text-ink-2 hover:bg-surface-2 md:hidden" aria-label="Paramètres">
              <Settings className="h-[18px] w-[18px]" />
            </Link>
            {!onAssistantPage ? (
              <button
                onClick={toggleAssistant}
                className={cn(
                  "hidden h-8 items-center gap-1.5 rounded-[var(--radius-ctl)] px-2.5 text-sm font-semibold md:flex",
                  panel?.kind === "assistant" ? "bg-accent-soft text-accent-text" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                )}
                title="Assistant (A)"
              >
                <Sparkles className="h-4 w-4" /> Assistant
              </button>
            ) : null}
            <Menu>
              <MenuTrigger asChild>
                <button className="hidden h-8 items-center gap-1.5 rounded-[var(--radius-ctl)] bg-accent px-3 text-sm font-semibold text-accent-fg hover:bg-accent-hover md:flex">
                  <Plus className="h-4 w-4" /> Créer
                </button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem onSelect={() => open({ kind: "new-task" })}>
                  <ListPlus /> Tâche <Kbd className="ml-auto">N</Kbd>
                </MenuItem>
                <MenuItem onSelect={() => open({ kind: "new-event", draft: newEventDraft(tz, me?.settings.default_event_minutes) })}>
                  <CalendarPlus /> Événement <Kbd className="ml-auto">E</Kbd>
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        </header>
        <main id="main" className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-[calc(64px+env(safe-area-inset-bottom))] md:pb-0">
          {children}
        </main>
      </div>

      {/* Right panel (desktop) */}
      {showSidePanel ? (
        <aside className="animate-panel flex w-[400px] shrink-0 flex-col border-l border-line bg-surface xl:w-[420px]" aria-label={panelTitle(panel)}>
          <div className="flex h-14 shrink-0 items-center justify-between px-5">
            <span className="text-sm font-semibold text-ink-2">{panelTitle(panel)}</span>
            <button onClick={close} className="-mr-1.5 rounded-md p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Fermer le panneau">
              {panel?.kind === "assistant" ? <PanelRightClose className="h-4 w-4" /> : <X className="h-4 w-4" />}
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <PanelBody panel={panel} />
          </div>
        </aside>
      ) : null}

      {/* Same panel as a bottom sheet on phones/tablets */}
      {!isDesktop ? (
        <DialogPrimitive.Root open={panel !== null && !(panel.kind === "assistant" && onAssistantPage)} onOpenChange={(o) => !o && close()}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="animate-fade fixed inset-0 z-40 bg-overlay" />
            <DialogPrimitive.Content className="animate-sheet pb-safe fixed inset-x-0 bottom-0 z-40 flex h-[92dvh] flex-col rounded-t-[16px] border-t border-line bg-surface focus:outline-none">
              <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-line-strong" />
              <div className="flex h-11 shrink-0 items-center justify-between px-5">
                <DialogPrimitive.Title className="text-sm font-semibold text-ink-2">{panelTitle(panel)}</DialogPrimitive.Title>
                <DialogPrimitive.Description className="sr-only">{panelTitle(panel)}</DialogPrimitive.Description>
                <DialogPrimitive.Close className="-mr-1.5 rounded-md p-1.5 text-ink-3" aria-label="Fermer">
                  <X className="h-4 w-4" />
                </DialogPrimitive.Close>
              </div>
              <div className="min-h-0 flex-1">
                <PanelBody panel={panel} />
              </div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      ) : null}

      {/* Mobile tab bar */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur md:hidden" aria-label="Navigation">
        <div className="grid h-16 grid-cols-5 items-center">
          {[NAV[1], NAV[2]].map((n) => (
            <MobileTab key={n.href} href={n.href} label={n.short} icon={n.icon} active={isActive(pathname, n.href)} />
          ))}
          <div className="flex justify-center">
            <Menu>
              <MenuTrigger asChild>
                <button className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-accent-fg shadow-pop active:scale-95" aria-label="Créer">
                  <Plus className="h-5 w-5" />
                </button>
              </MenuTrigger>
              <MenuContent align="center" side="top" className="min-w-48">
                <MenuItem className="h-10" onSelect={() => open({ kind: "new-task" })}>
                  <ListPlus /> Nouvelle tâche
                </MenuItem>
                <MenuItem className="h-10" onSelect={() => open({ kind: "new-event", draft: newEventDraft(tz, me?.settings.default_event_minutes) })}>
                  <CalendarPlus /> Nouvel événement
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
          {[NAV[3], NAV[5]].map((n) => (
            <MobileTab key={n.href} href={n.href} label={n.short} icon={n.icon} active={isActive(pathname, n.href)} />
          ))}
        </div>
      </nav>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

function MobileTab({ href, label, icon: Icon, active }: { href: string; label: string; icon: React.ComponentType<{ className?: string }>; active: boolean }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={cn("flex flex-col items-center gap-0.5 text-[10.5px] font-semibold", active ? "text-accent-text" : "text-ink-3")}>
      <Icon className="h-[21px] w-[21px]" />
      {label}
    </Link>
  );
}
