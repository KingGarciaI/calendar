// @vitest-environment jsdom
/**
 * UI smoke tests: render real pages/components in jsdom, wired to a running
 * server (BASE_URL, dev-auth mode) so they exercise real data and real APIs.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const BASE = process.env.MVMNT_TEST_URL;
const d = BASE ? describe : describe.skip;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}));
vi.mock("next/link", () => ({ default: ({ children, href, ...p }: { children: React.ReactNode; href: string }) => React.createElement("a", { href, ...p }, children) }));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "light", resolvedTheme: "light", setTheme: vi.fn() }), ThemeProvider: ({ children }: { children: React.ReactNode }) => children }));

let cookie = "";
const realFetch = globalThis.fetch;

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return async () => {
    const { InspectorProvider } = await import("@/components/shell/inspector");
    return render(
      <QueryClientProvider client={qc}>
        <InspectorProvider>{ui}</InspectorProvider>
      </QueryClientProvider>,
    );
  };
}

d("UI smoke (jsdom, real API)", () => {
  beforeAll(async () => {
    const r = await realFetch(`${BASE}/auth/dev`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `ui-${Date.now()}@test.local` }) });
    cookie = r.headers.get("set-cookie")!.split(";")[0];
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      return realFetch(url.startsWith("/") ? BASE + url : url, { ...init, headers: { ...(init?.headers ?? {}), cookie } });
    }) as typeof fetch;
    window.matchMedia = ((q: string) => ({ matches: q.includes("min-width: 1024px"), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
    Element.prototype.scrollIntoView = () => {};
    // seed via the real API
    await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Chez Jhon" }) });
    await fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Proposition commerciale", priority: "urgent", estimated_minutes: 60 }) });
    const now = new Date();
    const s = new Date(now.getTime() + 2 * 3600_000);
    await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Tournage Georgio", start_at: s.toISOString(), end_at: new Date(s.getTime() + 3600_000).toISOString() }) });
  });
  afterAll(() => {
    cleanup();
  });

  it("dashboard renders real priorities and upcoming events", async () => {
    const { default: Page } = await import("@/app/(app)/page");
    await act(async () => void (await wrap(<Page />)()));
    await waitFor(() => expect(screen.getAllByText("Proposition commerciale").length).toBeGreaterThan(0), { timeout: 8000 });
    await waitFor(() => expect(screen.getAllByText("Tournage Georgio").length).toBeGreaterThan(0), { timeout: 8000 });
    expect((await screen.findAllByText("Chez Jhon", {}, { timeout: 8000 })).length).toBeGreaterThan(0);
    cleanup();
  });

  it("tasks page: quick add creates a task, checkbox completes it", async () => {
    const { default: Page } = await import("@/app/(app)/tasks/page");
    await act(async () => void (await wrap(<Page />)()));
    const input = await screen.findByLabelText("Ajouter une tâche");
    fireEvent.change(input, { target: { value: "Exporter les vidéos" } });
    await act(async () => void fireEvent.submit(input.closest("form")!));
    await waitFor(() => expect(screen.getByText("Exporter les vidéos")).toBeTruthy(), { timeout: 8000 });
    const check = screen.getByLabelText("Terminer Exporter les vidéos");
    await act(async () => void fireEvent.click(check));
    await waitFor(async () => {
      const list = await (await fetch("/api/tasks?search=Exporter")).json();
      expect(list.data[0].status).toBe("done");
    }, { timeout: 8000 });
    cleanup();
  });

  it("task editor: new task form creates a task with subtasks", async () => {
    const { TaskEditor } = await import("@/components/tasks/task-editor");
    await act(async () => void (await wrap(<TaskEditor defaults={{ priority: "high" }} />)()));
    fireEvent.change(screen.getByLabelText("Titre"), { target: { value: "Monter la vidéo Georgio" } });
    const sub = screen.getByPlaceholderText("Ajouter une sous-tâche");
    fireEvent.change(sub, { target: { value: "Couleur" } });
    fireEvent.submit(sub.closest("form")!);
    await act(async () => void fireEvent.click(screen.getByText("Créer la tâche")));
    await waitFor(async () => {
      const list = await (await fetch("/api/tasks?search=Monter")).json();
      expect(list.data[0]?.priority).toBe("high");
      expect(list.data[0]?.subtasks_total).toBe(1);
    }, { timeout: 8000 });
    cleanup();
  });

  it("event editor: shows conflict warning and creates the event", async () => {
    const { EventEditor } = await import("@/components/events/event-editor");
    const list = await (await fetch(`/api/events?start=${new Date().toISOString()}&end=${new Date(Date.now() + 86400_000).toISOString()}`)).json();
    const target = list.data.find((e: { title: string }) => e.title === "Tournage Georgio");
    await act(async () => void (await wrap(<EventEditor draft={{ start_at: target.occurrence_start, end_at: target.occurrence_end }} />)()));
    fireEvent.change(screen.getByLabelText("Titre"), { target: { value: "Appel client" } });
    await waitFor(() => expect(screen.getByText("Ce créneau est déjà occupé")).toBeTruthy(), { timeout: 8000 });
    await act(async () => void fireEvent.click(screen.getByText("Créer l'événement")));
    await waitFor(async () => {
      const after = await (await fetch(`/api/search?q=Appel client`)).json();
      expect(after.data.events.length).toBe(1);
    }, { timeout: 8000 });
    cleanup();
  });

  it("calendar renders the week with real events", async () => {
    const { CalendarView } = await import("@/components/calendar/calendar-view");
    await act(async () => void (await wrap(<div style={{ height: 800 }}><CalendarView /></div>)()));
    await waitFor(() => expect(document.querySelector(".fc-timegrid")).toBeTruthy(), { timeout: 8000 });
    await waitFor(() => expect(screen.getAllByText("Tournage Georgio").length).toBeGreaterThan(0), { timeout: 8000 });
    expect(screen.getByText("Semaine")).toBeTruthy();
    // unscheduled rail lists the task
    expect((await screen.findAllByText("Proposition commerciale", {}, { timeout: 8000 })).length).toBeGreaterThan(0);
    cleanup();
  });

  it("settings page renders account preferences", async () => {
    const { default: Page } = await import("@/app/(app)/settings/page");
    await act(async () => void (await wrap(<Page />)()));
    await waitFor(() => expect(screen.getByText("Heures de travail")).toBeTruthy(), { timeout: 8000 });
    expect(await screen.findByDisplayValue("Rendez-vous", {}, { timeout: 8000 })).toBeTruthy();
    cleanup();
  });
});

d("assistant UI without an API key", () => {
  it("explains clearly that the AI key is missing", async () => {
    const { AssistantPanel } = await import("@/components/assistant/assistant-panel");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { InspectorProvider } = await import("@/components/shell/inspector");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => void render(<QueryClientProvider client={qc}><InspectorProvider><AssistantPanel /></InspectorProvider></QueryClientProvider>));
    await act(async () => void fireEvent.click(screen.getByText("Qu'est-ce que j'ai à faire aujourd'hui ?")));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/ANTHROPIC_API_KEY/), { timeout: 8000 });
    cleanup();
  });
});
