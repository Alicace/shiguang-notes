import metadata from "../metadata.json" with { type: "json" };
import { testCases, type TestResult } from "./features.js";

const actions = new Set(["recording.start", "note.save", "note.create", "note.select", "note.search", "note.delete", "note.restore", "note.star", "note.pin", "category.select", "settings.open", "settings.close", "settings.category", "copy.markdown", "copy.wechat", "image.crop", "image.caption", "image.preview", "image.download", "image.remove", "image.move", "folder.create", "folder.move", "png.generate", "png.download", "theme.paper", "theme.night", "theme.change", "system.authorize", "system.refresh", "system.acl", "report.export", "test.result", "space.switch", "space.create", "space.members"]);
const routes = new Set(["session", "auth/session", "workspace", "authorized-folders", "file-acl", "program-info", "spaces", "space-members", "archive", "images/import", "ai/status", "ai/suggestions", "wechat", "wechat/draft", "wechat/config", "wechat/status", "hermes-skill/download", "hermes-skill/install-link", "hermes-skill/install-link/reset"]);
const errorTypes = new Set(["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "DOMException", "AbortError", "ApiError"]);
const ids = new Set<string>(testCases.map((item) => item.id));
const results = new Set(["untested", "passed", "failed", "not-applicable"]);
type EventData = Record<string, string | number>;
export interface DiagnosticEvent { sequence: number; elapsedMs: number; type: "action" | "api" | "error"; data: EventData }
export interface ProgramInfo { appVersion?: string; stage?: string; nodeVersion?: string; simulation?: boolean; systemApiConfigured?: boolean }

export class DiagnosticRecorder {
  enabled = false;
  private events: DiagnosticEvent[] = [];
  private start = 0;
  private sequence = 0;
  private metadata = metadata;
  private ids = ids;
  configure(app: typeof metadata, testIds: string[]) { this.setEnabled(false); this.metadata = app; this.ids = new Set(testIds); }
  get count() { return this.events.length; }
  setEnabled(enabled: boolean) {
    this.enabled = enabled; this.clear();
    if (enabled) this.action("recording.start");
  }
  clear() { this.events = []; this.sequence = 0; this.start = performance.now(); }
  private append(type: DiagnosticEvent["type"], data: EventData) {
    if (!this.enabled) return;
    this.events.push({ sequence: ++this.sequence, elapsedMs: Math.round(performance.now() - this.start), type, data });
    if (this.events.length > 200) this.events.shift();
  }
  action(action: string, caseId?: string, result?: string) {
    if (!actions.has(action)) return;
    const data: EventData = { action };
    if (action === "test.result") {
      if (!caseId || !this.ids.has(caseId) || !result || !results.has(result)) return;
      data.caseId = caseId; data.result = result;
    }
    this.append("action", data);
  }
  api(route: string, method: string, status: number, durationMs: number) {
    if (!routes.has(route) || !["GET", "PUT", "POST"].includes(method)) return;
    this.append("api", { route, method, status: Math.max(0, Math.min(599, Math.trunc(status))), durationMs: Math.max(0, Math.min(60_000, Math.round(durationMs))) });
  }
  error(name: string, filename = "", line = 0, column = 0) {
    let bundle = "unknown";
    try {
      const candidate = new URL(filename).pathname.split("/").at(-1) || "";
      if (/^(main|api|callback)-[a-zA-Z0-9_-]{1,60}\.js$/.test(candidate)) bundle = candidate;
    } catch { /* 不记录原始 URL 或路径。 */ }
    this.append("error", { name: errorTypes.has(name) ? name : "Error", bundle, line: Math.max(0, Math.min(1_000_000, Math.trunc(line))), column: Math.max(0, Math.min(1_000_000, Math.trunc(column))) });
  }
  snapshot(program: ProgramInfo | null, checks: Record<string, TestResult>) {
    const programInfo: ProgramInfo = {};
    if (program) {
      if (typeof program.nodeVersion === "string" && /^\d+\.\d+\.\d+$/.test(program.nodeVersion)) programInfo.nodeVersion = program.nodeVersion;
      if (typeof program.simulation === "boolean") programInfo.simulation = program.simulation;
      if (typeof program.systemApiConfigured === "boolean") programInfo.systemApiConfigured = program.systemApiConfigured;
    }
    return {
      schemaVersion: 1, exportedAt: new Date().toISOString(), app: this.metadata, program: programInfo,
      capture: { enabled: this.enabled, limit: 200, eventCount: this.events.length, storage: "current-page-memory", automaticUpload: false },
      tests: Object.entries(checks).filter(([id, result]) => this.ids.has(id) && results.has(result)).map(([caseId, result]) => ({ caseId, result })),
      events: this.events.map((event) => ({ ...event, data: { ...event.data } })),
    };
  }
}
export const recorder = new DiagnosticRecorder();

export function clientEnvironment() {
  const ua = navigator.userAgent;
  const match = ua.match(/(Firefox|Edg|Chrome)\/(\d+)/) || ua.match(/Version\/(\d+).*Safari/);
  const browser = match ? match[1] === "Firefox" || match[1] === "Edg" || match[1] === "Chrome" ? `${match[1]} ${match[2]}` : `Safari ${match[1]}` : "other";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS/iPadOS" : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "other";
  return { browser, os, fnosVersion: ua.match(/FNOS\/(\d[\d.]{1,30})/)?.[1], fnAppVersion: ua.match(/FNAppVer\/(\d[\d.]{1,30})/)?.[1], language: /^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{2,8})*$/.test(navigator.language) ? navigator.language : "other", viewport: { width: innerWidth, height: innerHeight }, pixelRatio: Math.min(8, devicePixelRatio), online: navigator.onLine };
}

export function collectPageEvents() {
  const click = (event: MouseEvent) => {
    const node = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-diag-action]") : null;
    if (node) recorder.action(node.dataset.diagAction || "");
  };
  const error = (event: ErrorEvent) => recorder.error(event.error?.name || "Error", event.filename, event.lineno, event.colno);
  const rejection = (event: PromiseRejectionEvent) => recorder.error(event.reason?.name || "Error");
  document.addEventListener("click", click, true); window.addEventListener("error", error); window.addEventListener("unhandledrejection", rejection);
  return () => { document.removeEventListener("click", click, true); window.removeEventListener("error", error); window.removeEventListener("unhandledrejection", rejection); };
}
