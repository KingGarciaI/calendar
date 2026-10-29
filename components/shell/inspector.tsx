"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { DateTime } from "luxon";
import type { TaskCreateInput } from "@/lib/schemas";

export type EventDraft = { start_at: string; end_at: string; all_day?: boolean; task_id?: string | null; title?: string; project_id?: string | null };

export type PanelState =
  | { kind: "task"; id: string }
  | { kind: "new-task"; defaults?: Partial<TaskCreateInput> }
  | { kind: "event"; id: string; occurrence?: { instance_id: string; start: string; end: string; recurring: boolean } }
  | { kind: "new-event"; draft: EventDraft }
  | { kind: "assistant" }
  | null;

type Ctx = {
  panel: PanelState;
  open: (p: Exclude<PanelState, null>) => void;
  close: () => void;
  toggleAssistant: () => void;
};

const InspectorContext = createContext<Ctx | null>(null);

export function InspectorProvider({ children }: { children: React.ReactNode }) {
  const [panel, setPanel] = useState<PanelState>(null);
  const open = useCallback((p: Exclude<PanelState, null>) => setPanel(p), []);
  const close = useCallback(() => setPanel(null), []);
  const toggleAssistant = useCallback(() => setPanel((p) => (p?.kind === "assistant" ? null : { kind: "assistant" })), []);
  const value = useMemo(() => ({ panel, open, close, toggleAssistant }), [panel, open, close, toggleAssistant]);
  return <InspectorContext.Provider value={value}>{children}</InspectorContext.Provider>;
}

export function useInspector() {
  const c = useContext(InspectorContext);
  if (!c) throw new Error("useInspector outside provider");
  return c;
}

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const useIsDesktop = () => useMediaQuery("(min-width: 1024px)");

/** Global single-key shortcuts, ignored while typing. */
export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      const combo = `${e.metaKey || e.ctrlKey ? "mod+" : ""}${e.shiftKey && e.key.length > 1 ? "shift+" : ""}${e.key.toLowerCase()}`;
      const fn = map[combo];
      if (!fn) return;
      if (typing && !combo.startsWith("mod+")) return;
      if (document.querySelector("[role=dialog]") && !combo.startsWith("mod+")) return;
      e.preventDefault();
      fn(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [map]);
}

/** Next full hour, for "new event" defaults. */
export function newEventDraft(tz: string, minutes = 60): EventDraft {
  const now = DateTime.now().setZone(tz);
  const start = now.plus({ hours: 1 }).startOf("hour");
  return { start_at: start.toUTC().toISO()!, end_at: start.plus({ minutes }).toUTC().toISO()! };
}
