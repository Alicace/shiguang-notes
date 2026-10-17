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
  const isWrite = !["GET", "HEAD"].includes(init.method || "GET");
  // 写操作要带当前会话的 CSRF 与租户绑定；令牌可能在服务端重启后过期，因此每次现取。
  const buildHeaders = () => {
    const headers = new Headers(init.headers);
    if (csrf && isWrite) headers.set("X-Fnnotes-CSRF", csrf);
    if (identity && isWrite && !headers.has("X-Shiguang-User")) headers.set("X-Shiguang-User", identity);
    const scope = currentSpace();
    if (scope && !["/api/auth/session", "/api/fnos/spaces", "/api/program-info"].includes(input)) headers.set("X-Shiguang-Space", scope);
    return headers;
  };
  const refreshSession = async () => {
    const response = await fetch(appPath("/api/auth/session"), { cache: "no-store" });
    if (response.ok) {
      const session = await response.clone().json();
      csrf = session.csrfToken || "";
      identity = session.user?.id || "";
    }
  };
  const start = performance.now(); let status = 0;
  try {
    // 配置页可能在首屏会话请求完成前就允许点击；写操作先补齐身份与令牌。
    if (isWrite && (!csrf || !identity)) await refreshSession();
    let response = await fetch(url, { ...init, headers: buildHeaders(), cache: "no-store" }); status = response.status;
    // 服务端升级/重启会让页面里缓存的写令牌过期：自动换令牌重试一次，不让用户看到「写入校验失败」。
    if (isWrite && status === 403) {
      const detail = await response.clone().json().catch(() => null);
      if (typeof detail?.error === "string" && (
        detail.error.includes("写入校验失败") ||
        detail.error.includes("身份绑定缺失") ||
        detail.error.includes("会话令牌已失效")
      )) {
        await refreshSession();
        response = await fetch(url, { ...init, headers: buildHeaders(), cache: "no-store" }); status = response.status;
      }
    }
    if (input === "/api/auth/session" && response.ok) {
      const session = await response.clone().json();
      if (identity && identity !== session.user?.id) { recorder.setEnabled(false); window.dispatchEvent(new Event("shiguang-identity-changed")); }
      csrf = session.csrfToken; identity = session.user?.id || "";
    }
    if (input === "/api/workspace" && response.ok && !isWrite) {
      if (identity && response.headers.get("X-Shiguang-User") !== identity) { recorder.setEnabled(false); window.dispatchEvent(new Event("shiguang-identity-changed")); throw new Error("NAS 账号已变化，请重新打开应用。"); }
      nativeWritable = response.headers.get("X-Shiguang-Writable") !== "false";
      window.dispatchEvent(new Event("shiguang-workspace-loaded"));
    }
    if (status === 401) { csrf = ""; identity = ""; recorder.setEnabled(false); window.dispatchEvent(new Event("shiguang-identity-changed")); }
    return response;
  } catch (error) { recorder.error(error instanceof Error ? error.name : "Error"); throw error; }
  finally { recorder.api(labels(input), init.method || "GET", status, performance.now() - start); }
}
