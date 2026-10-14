export const BASE = "/app/fnnotes-m0/";
export const AUTH_STATE_KEY = "fnnotes-m0.authorization";

export interface Session {
  user: { uid: number; username: string; isAdmin: boolean };
  csrfToken: string;
  prototype: boolean;
  simulation: boolean;
  systemApiConfigured: boolean;
}
export interface Workspace { text: string; revision: number }
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function api<T>(route: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(BASE + "api/" + route, { ...init, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new ApiError(response.status, data.error || "请求失败。");
  return data as T;
}
export function writeOptions(session: Session, body: unknown, method = "PUT"): RequestInit {
  return { method, headers: { "Content-Type": "application/json", "X-Fnnotes-CSRF": session.csrfToken }, body: JSON.stringify(body) };
}
