"use client";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "network", "Connexion impossible. Vérifie ta connexion Internet.");
  }
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, json?.error?.code ?? "error", json?.error?.message ?? `Erreur ${res.status}`, json?.error?.details);
  }
  return json?.data as T;
}

const qs = (params?: Record<string, string | number | boolean | undefined | null>) => {
  if (!params) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const api = {
  get: <T,>(url: string, params?: Parameters<typeof qs>[0]) => request<T>("GET", url + qs(params)),
  post: <T,>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  patch: <T,>(url: string, body: unknown) => request<T>("PATCH", url, body),
  del: <T,>(url: string, params?: Parameters<typeof qs>[0]) => request<T>("DELETE", url + qs(params)),
};
