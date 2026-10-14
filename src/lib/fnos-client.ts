import { recorder } from "../../fnos/m0/ui/diagnostics.js";

export const isNative = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_FNOS_NATIVE === "1";
export const nativeBase = "/app/fnnotes-m0";
export const appPath = (value: string) => isNative && value.startsWith("/") && !value.startsWith(nativeBase + "/") ? nativeBase + value : value;
let csrf = "";
let identity = "";
export let nativeWritable = true;
export const currentSpace = () => typeof location === "undefined" ? "" : new URLSearchParams(location.search).get("space") || "";
const labels = (pathname: string) => {
  const route = pathname.replace(nativeBase, "").replace(/^\/api\//, "");
  if (/^workspace\/archive/.test(route)) return "archive";
  if (/^fnos\/spaces\/[^/]+\/members$/.test(route)) return "space-members";
  if (/^fnos\/spaces/.test(route)) return "spaces";
  return route;
};
export async function appFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  if (!isNative || typeof input !== "string" || !input.startsWith("/api/")) return fetch(input, init);
  const url = appPath(input);
  const headers = new Headers(init.headers);
  if (csrf && !["GET", "HEAD"].includes(init.method || "GET")) headers.set("X-Fnnotes-CSRF", csrf);
  if (identity && !["GET", "HEAD"].includes(init.method || "GET") && !headers.has("X-Shiguang-User")) headers.set("X-Shiguang-User", identity);
  const scope = currentSpace();
  if (scope && !["/api/auth/session", "/api/fnos/spaces", "/api/program-info"].includes(input)) headers.set("X-Shiguang-Space", scope);
  const start = performance.now(); let status = 0;
  try {
    const response = await fetch(url, { ...init, headers, cache: "no-store" }); status = response.status;
    if (input === "/api/auth/session" && response.ok) {
      const session = await response.clone().json();
      if (identity && identity !== session.user?.id) { recorder.setEnabled(false); window.dispatchEvent(new Event("shiguang-identity-changed")); }
      csrf = session.csrfToken; identity = session.user?.id || "";
    }
    if (input === "/api/workspace" && response.ok && (init.method || "GET") === "GET") {
      if (identity && response.headers.get("X-Shiguang-User") !== identity) { recorder.setEnabled(false); window.dispatchEvent(new Event("shiguang-identity-changed")); throw new Error("NAS 账号已变化，请重新打开应用。"); }
      nativeWritable = response.headers.get("X-Shiguang-Writable") !== "false";
      window.dispatchEvent(new Event("shiguang-workspace-loaded"));
    }
    if (status === 401) { csrf = ""; identity = ""; recorder.setEnabled(false); window.dispatchEvent(new Event("shiguang-identity-changed")); }
    return response;
  } catch (error) { recorder.error(error instanceof Error ? error.name : "Error"); throw error; }
  finally { recorder.api(labels(input), init.method || "GET", status, performance.now() - start); }
}
