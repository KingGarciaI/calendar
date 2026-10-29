"use client";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/client/api";
import type { EventCreateInput, ProjectCreateInput, SettingsUpdateInput, TaskCreateInput, TaskUpdateInput } from "@/lib/schemas";
import type {
  Category,
  Conflict,
  DaySchedule,
  EventDetail,
  EventOccurrence,
  Me,
  ProjectSummary,
  Slot,
  Subtask,
  Task,
  TaskDetail,
} from "@/lib/types";

export const keys = {
  me: ["me"] as const,
  categories: ["categories"] as const,
  projects: ["projects"] as const,
  project: (id: string) => ["project", id] as const,
  tasks: (f: object) => ["tasks", f] as const,
  task: (id: string) => ["task", id] as const,
  event: (id: string) => ["event", id] as const,
  events: (start: string, end: string) => ["events", start, end] as const,
  day: (date?: string) => ["day", date ?? "today"] as const,
};

/** Anything that changes tasks/events can affect every view: refresh them all. */
export function useInvalidateData() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      ["tasks", "task", "events", "event", "day", "projects", "project", "week"].map((k) => qc.invalidateQueries({ queryKey: [k] })),
    );
}

export function errorToast(e: unknown) {
  toast.error(e instanceof ApiError ? e.message : "Une erreur est survenue");
}

// ------------------------------------------------------------ reads
export const useMe = () => useQuery({ queryKey: keys.me, queryFn: () => api.get<Me>("/api/me"), staleTime: 5 * 60_000 });
export const useCategories = () =>
  useQuery({ queryKey: keys.categories, queryFn: () => api.get<Category[]>("/api/categories"), staleTime: 5 * 60_000 });
export const useProjects = (archived = false) =>
  useQuery({ queryKey: [...keys.projects, archived], queryFn: () => api.get<ProjectSummary[]>("/api/projects", { archived: archived ? 1 : undefined }) });
export const useProject = (id: string) =>
  useQuery({
    queryKey: keys.project(id),
    queryFn: () => api.get<ProjectSummary & { tasks: Task[]; upcoming_events: EventOccurrence[]; recent_events: EventOccurrence[] }>(`/api/projects/${id}`),
  });

export type TaskFilter = { status?: string; project_id?: string; priority?: string; search?: string; unscheduled?: 1 };
export const useTasks = (f: TaskFilter = {}) =>
  useQuery({ queryKey: keys.tasks(f), queryFn: () => api.get<Task[]>("/api/tasks", f), placeholderData: keepPreviousData });
export const useTask = (id: string | null) =>
  useQuery({ queryKey: keys.task(id ?? ""), queryFn: () => api.get<TaskDetail>(`/api/tasks/${id}`), enabled: !!id });
export const useEvent = (id: string | null) =>
  useQuery({ queryKey: keys.event(id ?? ""), queryFn: () => api.get<EventDetail>(`/api/events/${id}`), enabled: !!id });
export const useEvents = (start: string, end: string) =>
  useQuery({
    queryKey: keys.events(start, end),
    queryFn: () => api.get<EventOccurrence[]>("/api/events", { start, end }),
    placeholderData: keepPreviousData,
    enabled: !!start && !!end,
  });
export const useDay = (date?: string) =>
  useQuery({ queryKey: keys.day(date), queryFn: () => api.get<DaySchedule>("/api/schedule/day", { date }), refetchInterval: 5 * 60_000 });

// ------------------------------------------------------------ writes
type EventResult = { event: EventDetail; conflicts: Conflict[] };

export function conflictToast(conflicts: Conflict[], tz: string, undo?: () => void) {
  if (!conflicts.length) return;
  const names = conflicts.slice(0, 2).map((c) => c.title).join(", ");
  toast.warning(`Chevauche ${names}${conflicts.length > 2 ? ` et ${conflicts.length - 2} autre(s)` : ""}`, {
    action: undo ? { label: "Annuler", onClick: undo } : undefined,
    duration: 7000,
  });
  void tz;
}

export function useCreateEvent() {
  const invalidate = useInvalidateData();
  return useMutation({
    mutationFn: (input: EventCreateInput) => api.post<EventResult>("/api/events", input),
    onSuccess: invalidate,
    onError: errorToast,
  });
}

export type UpdateEventArgs = {
  id: string;
  patch: Partial<EventCreateInput>;
  scope?: "occurrence" | "following" | "series";
  occurrence_start?: string;
};
export function useUpdateEvent() {
  const invalidate = useInvalidateData();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateEventArgs) => api.patch<EventResult>(`/api/events/${id}`, body),
    onSuccess: invalidate,
    onError: errorToast,
  });
}

export function useDeleteEvent() {
  const invalidate = useInvalidateData();
  return useMutation({
    mutationFn: ({ id, scope, occurrence_start }: { id: string; scope?: string; occurrence_start?: string }) =>
      api.del(`/api/events/${id}`, { scope, occurrence_start }),
    onSuccess: invalidate,
    onError: errorToast,
  });
}

export function useCreateTask() {
  const invalidate = useInvalidateData();
  return useMutation({
    mutationFn: (input: TaskCreateInput) => api.post<TaskDetail>("/api/tasks", input),
    onSuccess: invalidate,
    onError: errorToast,
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  const invalidate = useInvalidateData();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TaskUpdateInput }) => api.patch<TaskDetail>(`/api/tasks/${id}`, patch),
    onMutate: async ({ id, patch }) => {
      // Optimistic: reflect status/priority changes instantly in every task list.
      await qc.cancelQueries({ queryKey: ["tasks"] });
      const snapshots = qc.getQueriesData<Task[]>({ queryKey: ["tasks"] });
      for (const [key, list] of snapshots) {
        if (list) qc.setQueryData(key, list.map((t) => (t.id === id ? { ...t, ...(patch as Partial<Task>) } : t)));
      }
      return { snapshots };
    },
    onError: (e, _v, context) => {
      context?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
      errorToast(e);
    },
    onSettled: invalidate,
  });
}

export function useDeleteTask() {
  const invalidate = useInvalidateData();
  return useMutation({
    mutationFn: ({ id, blocks }: { id: string; blocks?: boolean }) => api.del(`/api/tasks/${id}`, { blocks: blocks ? 1 : undefined }),
    onSuccess: invalidate,
    onError: errorToast,
  });
}

export function useScheduleTask() {
  const invalidate = useInvalidateData();
  return useMutation({
    mutationFn: ({ id, start_at, duration_minutes }: { id: string; start_at: string; duration_minutes?: number }) =>
      api.post<EventResult>(`/api/tasks/${id}/schedule`, { start_at, duration_minutes }),
    onSuccess: invalidate,
    onError: errorToast,
  });
}

export function useSubtaskMutations(taskId: string) {
  const invalidate = useInvalidateData();
  const add = useMutation({
    mutationFn: (title: string) => api.post<Subtask>(`/api/tasks/${taskId}/subtasks`, { title }),
    onSuccess: invalidate,
    onError: errorToast,
  });
  const update = useMutation({
    mutationFn: ({ id, ...patch }: { id: string; title?: string; done?: boolean }) => api.patch<Subtask>(`/api/subtasks/${id}`, patch),
    onSuccess: invalidate,
    onError: errorToast,
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/api/subtasks/${id}`), onSuccess: invalidate, onError: errorToast });
  return { add, update, remove };
}

export function useProjectMutations() {
  const invalidate = useInvalidateData();
  const create = useMutation({
    mutationFn: (input: ProjectCreateInput) => api.post<ProjectSummary>("/api/projects", input),
    onSuccess: invalidate,
    onError: errorToast,
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ProjectCreateInput> }) => api.patch<ProjectSummary>(`/api/projects/${id}`, patch),
    onSuccess: invalidate,
    onError: errorToast,
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/api/projects/${id}`), onSuccess: invalidate, onError: errorToast });
  return { create, update, remove };
}

export function useCategoryMutations() {
  const qc = useQueryClient();
  const done = () => {
    qc.invalidateQueries({ queryKey: keys.categories });
    qc.invalidateQueries({ queryKey: ["events"] });
  };
  return {
    create: useMutation({ mutationFn: (b: { name: string; color: string }) => api.post<Category>("/api/categories", b), onSuccess: done, onError: errorToast }),
    update: useMutation({
      mutationFn: ({ id, ...b }: { id: string; name?: string; color?: string }) => api.patch<Category>(`/api/categories/${id}`, b),
      onSuccess: done,
      onError: errorToast,
    }),
    remove: useMutation({ mutationFn: (id: string) => api.del(`/api/categories/${id}`), onSuccess: done, onError: errorToast }),
  };
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SettingsUpdateInput) => api.patch<Me>("/api/me", input),
    onSuccess: (me) => {
      qc.setQueryData(keys.me, me);
      qc.invalidateQueries({ queryKey: ["day"] });
    },
    onError: errorToast,
  });
}

export async function checkConflicts(body: {
  start_at: string;
  end_at: string;
  rrule?: string | null;
  exclude_event_id?: string;
  exclude_instance_id?: string;
  suggest?: boolean;
}) {
  return api.post<{ conflicts: Conflict[]; suggestions: Slot[] }>("/api/events/conflicts", body);
}
