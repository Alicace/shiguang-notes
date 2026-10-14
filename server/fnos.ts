import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Express, NextFunction, Request, Response } from "express";
import type { AuthSession, NotesDataStore } from "./auth.js";
import { verifySkillToken } from "./auth.js";
import http from "node:http";
import { createNoteDocument } from "../src/lib/notes.js";
import { checkAiAvailability } from "./ai.js";
import metadata from "../src/native/metadata.json" with { type: "json" };

export const nativeMode = process.env.FNOS_NATIVE === "1";
export const nativePrefix = "/app/fnnotes-m0";
export const nativeVersion = metadata.appVersion;
export interface SharedSpace { id: string; name: string; ownerId: string; members: Record<string, "editor" | "viewer">; createdAt: number }
interface NativeContext { user: AuthSession; uid: number; isAdmin: boolean; scope: string; writable: boolean }
export const nativeContext = new AsyncLocalStorage<NativeContext>();

export class NativeSpaces {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private filename: string) {}
  async all(): Promise<SharedSpace[]> {
    try { return JSON.parse(await fs.readFile(this.filename, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }
  async visible(userId: string) { return (await this.all()).filter((space) => space.ownerId === userId || Object.hasOwn(space.members, userId)); }
  async access(userId: string, scope: string) {
    if (scope === userId) return { writable: true };
    const space = (await this.all()).find((item) => `space-${item.id}` === scope);
    if (!space || (space.ownerId !== userId && !Object.hasOwn(space.members, userId))) return null;
    return { writable: space.ownerId === userId || space.members[userId] === "editor" };
  }
  mutate<T>(operation: (spaces: SharedSpace[]) => T): Promise<T> {
    const result = this.queue.then(async () => {
      const spaces = await this.all();
      const value = operation(spaces);
      await fs.mkdir(path.dirname(this.filename), { recursive: true, mode: 0o700 });
      const temporary = this.filename + "." + randomBytes(6).toString("hex") + ".tmp";
      try { await fs.writeFile(temporary, JSON.stringify(spaces), { mode: 0o600, flag: "wx" }); await fs.rename(temporary, this.filename); }
      finally { await fs.rm(temporary, { force: true }); }
      return value;
    });
    this.queue = result.catch(() => {});
    return result;
  }
}

export function readNativeIdentity(request: Request) {
  for (const key of ["x-trim-userid", "x-trim-username", "x-trim-isadmin"]) {
    if (request.rawHeaders.filter((value, i) => i % 2 === 0 && value.toLowerCase() === key).length !== 1) throw new Error("身份缺失或重复");
  }
  const uid = request.get("x-trim-userid") || "";
  const username = request.get("x-trim-username") || "";
  const admin = request.get("x-trim-isadmin");
  if (!/^[1-9]\d{0,9}$/.test(uid) || Number(uid) > 2147483647 || !username.trim() || username.length > 256 || !["true", "false"].includes(admin || "")) throw new Error("身份格式不正确");
  return { uid: Number(uid), username, isAdmin: admin === "true" };
}

export function installNativeGateway(app: Express, store: NotesDataStore, spaces: NativeSpaces) {
  const csrf = new Map<number, string>();
  app.use(async (request: Request, response: Response, next: NextFunction) => {
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
    let identity;
    try { identity = readNativeIdentity(request); }
    catch { response.status(401).json({ error: "请通过飞牛登录后打开拾光便签。" }); return; }
    if (request.url !== nativePrefix && !request.url.startsWith(nativePrefix + "/")) { response.sendStatus(404); return; }
    request.url = request.url.slice(nativePrefix.length) || "/";
    const account = await store.ensureFnosUser(identity.uid, identity.username);
    const user: AuthSession = { id: account.id, username: account.username, role: "user", remember: false, passwordVersion: account.passwordVersion };
    response.setHeader("X-Shiguang-User", user.id);
    const authorization = request.get("authorization");
    if (authorization) {
      const token = authorization.match(/^Bearer\s+(\S+)$/i)?.[1];
      const credential = verifySkillToken(token);
      if (!credential || credential.id !== user.id || credential.passwordVersion !== account.passwordVersion || credential.skillTokenVersion !== account.skillTokenVersion) { response.status(403).json({ error: "应用 Token 与当前 NAS 登录用户不匹配或已失效。" }); return; }
    }
    if (!csrf.has(identity.uid)) csrf.set(identity.uid, randomBytes(32).toString("hex"));
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      if (request.get("x-shiguang-user") !== user.id) { response.status(403).json({ error: "NAS 账号已变化或身份绑定缺失，请重新打开应用。" }); return; }
      const token = request.get("x-fnnotes-csrf") || "";
      const expected = csrf.get(identity.uid)!;
      let sameOrigin = false;
      try {
        const origin = new URL(request.get("origin") || "");
        const host = request.get("x-forwarded-host") || request.get("host");
        const proto = request.get("x-forwarded-proto") || origin.protocol.slice(0, -1);
        sameOrigin = ["http", "https"].includes(proto) && origin.origin === new URL(`${proto}://${host}`).origin;
      } catch { /* 写操作必须来自同源页面。 */ }
      if (!sameOrigin || !/^[a-f0-9]{64}$/.test(token) || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) { response.status(403).json({ error: "写入校验失败，请从飞牛入口刷新应用。" }); return; }
    }
    const selected = request.get("x-shiguang-space") || user.id;
    const access = await spaces.access(user.id, selected);
    if (!access) { response.status(403).json({ error: "共享空间权限已撤销或空间不存在。" }); return; }
    if (!access.writable && ((request.path === "/api/workspace" && request.method === "PUT") || request.path === "/api/images/import")) { response.status(403).json({ error: "当前共享空间为只读。" }); return; }
    nativeContext.run({ user, uid: identity.uid, isAdmin: identity.isAdmin, scope: selected, writable: access.writable }, () => {
      if (request.path === "/api/auth/session") {
        response.json({ user, requireLogin: true, native: true, csrfToken: csrf.get(identity.uid), scope: selected, writable: access.writable, nasAdmin: identity.isAdmin }); return;
      }
      if (request.path.startsWith("/api/superadmin/") || ["/api/auth/login", "/api/auth/password", "/api/auth/logout"].includes(request.path)) { response.status(409).json({ error: "账号登录、退出和密码管理由飞牛系统提供，请前往 NAS 账号设置。" }); return; }
      if (request.path === "/api/export") { response.status(409).json({ error: "请使用拾光便签客户端生成 PNG；原生服务不运行截图浏览器。" }); return; }
      next();
    });
  });
}

export function installNativeRoutes(app: Express, spaces: NativeSpaces, store: NotesDataStore) {
  app.get("/api/fnos/spaces", async (_request, response) => {
    const context = nativeContext.getStore()!;
    response.json({ privateScope: context.user.id, selected: context.scope, writable: context.writable, spaces: await spaces.visible(context.user.id) });
  });
  app.post("/api/fnos/spaces", async (request, response) => {
    const context = nativeContext.getStore()!;
    const name = request.body?.name;
    if (typeof name !== "string" || !name.trim() || name.trim().length > 60) { response.status(400).json({ error: "空间名称需为 1 至 60 字符。" }); return; }
    const space = await spaces.mutate((items) => { const value: SharedSpace = { id: randomUUID(), name: name.trim(), ownerId: context.user.id, members: {}, createdAt: Date.now() }; items.push(value); return value; });
    const note = createNoteDocument("");
    await store.saveWorkspace(`space-${space.id}`, { version: 1, notes: [note], activeNoteId: note.id, folders: [] });
    response.status(201).json(space);
  });
  app.put("/api/fnos/spaces/:id/members", async (request, response) => {
    const uid = String(request.body?.uid || "");
    const role = request.body?.role;
    if (!/^[1-9]\d{0,9}$/.test(uid) || Number(uid) > 2147483647 || !["editor", "viewer", "remove"].includes(role)) { response.status(400).json({ error: "请输入有效 NAS UID 和成员权限。" }); return; }
    const changed = await spaces.mutate((items) => {
      const space = items.find((item) => item.id === request.params.id && item.ownerId === nativeContext.getStore()!.user.id);
      if (!space || space.ownerId === `nas-${uid}`) return false;
      if (role === "remove") delete space.members[`nas-${uid}`]; else space.members[`nas-${uid}`] = role;
      return true;
    });
    response.status(changed ? 200 : 403).json(changed ? { ok: true } : { error: "只有空间所有者能管理其他成员。" });
  });
  app.delete("/api/fnos/spaces/:id", async (request, response) => {
    const removed = await spaces.mutate((items) => {
      const index = items.findIndex((item) => item.id === request.params.id && item.ownerId === nativeContext.getStore()!.user.id);
      if (index < 0) return false;
      items.splice(index, 1); return true;
    });
    response.status(removed ? 200 : 403).json(removed ? { ok: true } : { error: "只有空间所有者能删除共享空间。" });
  });
  app.get("/api/program-info", (_request, response) => response.json({ appVersion: nativeVersion, stage: "完整适配开发版", nodeVersion: process.versions.node, simulation: process.env.FNOS_SIMULATION === "1", systemApiConfigured: Boolean(process.env.TRIM_API_TOKEN) }));
  app.get("/api/session", (_request, response) => { const ctx = nativeContext.getStore()!; response.json({ user: { uid: ctx.uid, username: ctx.user.username, isAdmin: ctx.isAdmin }, simulation: process.env.FNOS_SIMULATION === "1", systemApiConfigured: Boolean(process.env.TRIM_API_TOKEN) }); });
  app.get("/api/authorized-folders", async (_request, response) => { try { response.json(await systemApi("trim.file.getUserAccessibleFolders", { uid: nativeContext.getStore()!.uid })); } catch { response.status(503).json({ error: "飞牛系统文件授权接口暂不可用。" }); } });
  app.post("/api/file-acl", async (request, response) => {
    const value = request.body?.path;
    if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0") || value.length > 4096) { response.status(400).json({ error: "目录路径格式不正确。" }); return; }
    try { response.json({ permissions: await systemApi("trim.file.checkUserACL", { uid: nativeContext.getStore()!.uid, path: value }) }); }
    catch { response.status(503).json({ error: "飞牛系统权限接口暂不可用。" }); }
  });
  const configKeys = ["OPENAI_BASE_URL", "OPENAI_MODEL", "OPENAI_API_KEY", "QINIU_ACCESS_KEY", "QINIU_SECRET_KEY", "QINIU_BUCKET", "QINIU_DOMAIN", "QINIU_PREFIX"];
  app.get("/api/fnos/config", (_request, response) => {
    if (!nativeContext.getStore()!.isAdmin) { response.sendStatus(403); return; }
    response.json({ OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || "", OPENAI_MODEL: process.env.OPENAI_MODEL || "", QINIU_BUCKET: process.env.QINIU_BUCKET || "", QINIU_DOMAIN: process.env.QINIU_DOMAIN || "", QINIU_PREFIX: process.env.QINIU_PREFIX || "", aiConfigured: Boolean(process.env.OPENAI_API_KEY), qiniuConfigured: Boolean(process.env.QINIU_SECRET_KEY) });
  });
  app.put("/api/fnos/config", async (request, response) => {
    if (!nativeContext.getStore()!.isAdmin) { response.sendStatus(403); return; }
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body) || Object.entries(request.body).some(([key, value]) => !configKeys.includes(key) || typeof value !== "string" || value.length > 2048)) { response.status(400).json({ error: "服务配置格式不正确。" }); return; }
    for (const key of ["OPENAI_BASE_URL", "QINIU_DOMAIN"]) if (request.body[key]) { try { const url = new URL(request.body[key]); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error(); } catch { response.status(400).json({ error: "服务地址需为 HTTP(S) 且不能在网址中包含凭据。" }); return; } }
    const config = Object.fromEntries(configKeys.map((key) => [key, request.body[key] || process.env[key] || ""]));
    const filename = path.join(process.env.TRIM_PKGVAR!, "runtime-config.json");
    const temporary = filename + "." + randomBytes(6).toString("hex") + ".tmp";
    try { await fs.writeFile(temporary, JSON.stringify(config), { mode: 0o600, flag: "wx" }); await fs.rename(temporary, filename); }
    finally { await fs.rm(temporary, { force: true }); }
    for (const [key, value] of Object.entries(config)) process.env[key] = String(value);
    const available = await checkAiAvailability();
    response.json({ ok: true, aiAvailable: available });
  });
}

function systemApi(reqName: string, data: object): Promise<unknown> {
  const token = process.env.TRIM_API_TOKEN;
  if (!token) return Promise.reject(new Error("系统凭据未配置"));
  return new Promise((resolve, reject) => {
    const request = http.request({ socketPath: "/var/run/trim_open_gateway_apiscope.socket", path: "/api/v1/trimapp", method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } }, (response) => {
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 262144) request.destroy(); else chunks.push(chunk); });
      response.on("end", () => { try { const value = JSON.parse(Buffer.concat(chunks).toString()); if (response.statusCode !== 200 || value.code !== 0) throw new Error(); resolve(value.data); } catch { reject(new Error("系统 API 响应失败")); } });
      response.on("error", reject);
    });
    request.setTimeout(5000, () => request.destroy()); request.on("error", reject);
    request.end(JSON.stringify({ reqId: randomBytes(8).toString("hex"), req: reqName, appName: "fnnotes-m0", data }));
  });
}
