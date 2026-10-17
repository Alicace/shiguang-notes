import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Express, NextFunction, Request, Response } from "express";
import type { AuthSession, NotesDataStore } from "./auth.js";
import {
  accountKindOf,
  createNativeCsrfToken,
  DuplicateUsernameError,
  InvalidUsernameError,
  normalizeUsername,
  readSessionToken,
  safeStringEqual,
  verifySessionToken,
  verifySkillToken,
} from "./auth.js";
import http from "node:http";
import { createNoteDocument } from "../src/lib/notes.js";
import { isNewerVersion } from "../src/updates/app-update.js";
import { checkAiAvailability } from "./ai.js";
import {
  downloadNativeUpdate,
  fetchLatestUpdate,
  type UpdateDownloadProgress,
} from "./updates/native-update.js";
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
  /** 与应用数据同目录的兄弟文件位置（授权目录记录等）。 */
  sibling(name: string): string { return path.join(path.dirname(this.filename), name); }
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

// 飞牛网关内的写操作只接受同源页面，登录与退出在拿到 CSRF 令牌前也要校验一次来源。
function isSameOrigin(request: Request): boolean {
  try {
    const originHeader = request.get("origin");
    const origin = new URL(originHeader || request.get("referer") || "");
    const host = request.get("x-forwarded-host") || request.get("host");
    const proto = request.get("x-forwarded-proto") || origin.protocol.slice(0, -1);
    return ["http", "https"].includes(proto) && origin.origin === new URL(`${proto}://${host}`).origin;
  } catch {
    return false;
  }
}

// 只接受与当前飞牛账号同名的应用账号会话，避免在同一个窗口里切换成别人的便签。
// 被停用的账号要明确拒绝（而不是悄悄退回网关身份），旧会话则按「无会话」处理。
async function resolveAppSession(
  request: Request,
  store: NotesDataStore,
): Promise<{ account: Awaited<ReturnType<NotesDataStore["getUserById"]>>; disabled: boolean }> {
  const cookie = request.get("cookie");
  if (!cookie || !cookie.includes("notes_session=")) return { account: null, disabled: false };
  const session = verifySessionToken(readSessionToken(cookie));
  if (!session || session.role !== "user") return { account: null, disabled: false };
  const account = await store.getUserById(session.id);
  if (!account) return { account: null, disabled: false };
  if (account.disabled) return { account: null, disabled: true };
  if (account.passwordVersion !== (session.passwordVersion ?? 1)) return { account: null, disabled: false };
  return { account: safeStringEqual(normalizeUsername(account.username), normalizeUsername(session.username)) ? account : null, disabled: false };
}

export function installNativeGateway(app: Express, store: NotesDataStore, spaces: NativeSpaces) {
  const credentialPaths = new Set(["/api/auth/login", "/api/auth/logout"]);
  app.use(async (request: Request, response: Response, next: NextFunction) => {
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
    let identity;
    try { identity = readNativeIdentity(request); }
    catch { response.status(401).json({ error: "请通过飞牛登录后打开拾光便签。" }); return; }
    if (request.url !== nativePrefix && !request.url.startsWith(nativePrefix + "/")) { response.sendStatus(404); return; }
    request.url = request.url.slice(nativePrefix.length) || "/";
    const gatewayAccount = await store.ensureFnosUser(identity.uid, identity.username);
    const { account: sessionAccount, disabled: sessionDisabled } = await resolveAppSession(request, store);
    if (sessionDisabled) { response.status(403).json({ error: "该账号已被停用，请联系管理员。" }); return; }
    // 飞牛托管账号必须与网关身份一致；应用自建账号是独立租户，允许在自己的会话下使用。
    if (sessionAccount && accountKindOf(sessionAccount.id) === "nas" && sessionAccount.id !== gatewayAccount.id) { response.status(401).json({ error: "该应用账号不属于当前飞牛用户，请重新登录。" }); return; }
    const account = sessionAccount ?? gatewayAccount;
    if (account.disabled) { response.status(403).json({ error: "该账号已被停用，请联系管理员。" }); return; }
    const user: AuthSession = { id: account.id, username: account.username, role: "user", remember: false, passwordVersion: account.passwordVersion };
    response.setHeader("X-Shiguang-User", user.id);
    const authorization = request.get("authorization");
    if (authorization) {
      const token = authorization.match(/^Bearer\s+(\S+)$/i)?.[1];
      const credential = verifySkillToken(token);
      if (!credential || credential.id !== user.id || credential.passwordVersion !== account.passwordVersion || credential.skillTokenVersion !== account.skillTokenVersion) { response.status(403).json({ error: "应用 Token 与当前 NAS 登录用户不匹配或已失效。" }); return; }
    }
    if (credentialPaths.has(request.path)) {
      if (!isSameOrigin(request)) { response.status(403).json({ error: "请从拾光便签页面登录。" }); return; }
    } else if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      if (request.get("x-shiguang-user") !== user.id) { response.status(403).json({ error: "NAS 账号已变化或身份绑定缺失，请重新打开应用。" }); return; }
      const token = request.get("x-fnnotes-csrf") || "";
      const expected = createNativeCsrfToken(identity.uid);
      if (!/^[a-f0-9]{64}$/.test(token) || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) { response.status(403).json({ error: "写入校验失败：会话令牌已失效，请刷新应用后重试。" }); return; }
    }
    const selected = request.get("x-shiguang-space") || user.id;
    const access = await spaces.access(user.id, selected);
    const isSessionRequest = request.path === "/api/auth/session";
    const appPassword = isSessionRequest ? await store.hasAppPassword(user.id) : false;
    if (!access) { response.status(403).json({ error: "共享空间权限已撤销或空间不存在。" }); return; }
    if (!access.writable && ((request.path === "/api/workspace" && request.method === "PUT") || request.path === "/api/images/import")) { response.status(403).json({ error: "当前共享空间为只读。" }); return; }
    nativeContext.run({ user, uid: identity.uid, isAdmin: identity.isAdmin, scope: selected, writable: access.writable }, () => {
      if (request.path === "/api/auth/session") {
        response.json({ user, requireLogin: true, native: true, csrfToken: createNativeCsrfToken(identity.uid), scope: selected, writable: access.writable, nasAdmin: identity.isAdmin, appPassword }); return;
      }
      if (request.path.startsWith("/api/superadmin/")) { response.status(409).json({ error: "请在「设置 → 飞牛与诊断 → 用户管理」中管理账号。" }); return; }
      if (request.path === "/api/export") { response.status(409).json({ error: "请使用拾光便签客户端生成 PNG；原生服务不运行截图浏览器。" }); return; }
      next();
    });
  });
}

export function installNativeRoutes(app: Express, spaces: NativeSpaces, store: NotesDataStore) {
  const imagesDir = process.env.IMAGE_STORAGE_DIR || "";
  function requireNativeAdmin(response: Response): boolean {
    if (!nativeContext.getStore()!.isAdmin) {
      response.status(403).json({ error: "只有 NAS 管理员可以管理账号。" });
      return false;
    }

    return true;
  }

  // 用户管理：飞牛托管账号（nas-<uid>）与应用自建账号（uuid）都是独立租户，
  // 各自的工作区与图片目录只按账号 id 隔离。
  app.get("/api/fnos/users", async (_request, response) => {
    requireNativeAdmin(response) &&
      response.json({
        currentUserId: nativeContext.getStore()!.user.id,
        users: await store.listManagedAccounts(),
      });
  });
  app.post("/api/fnos/users", async (request, response) => {
    if (!requireNativeAdmin(response)) return;
    const username = request.body?.username;
    if (typeof username !== "string" || !username.trim()) { response.status(400).json({ error: "请输入用户名或邮箱。" }); return; }
    try {
      const created = await store.createAppAccount(username);
      response.status(201).json({ initialPassword: created.initialPassword, user: await store.getManagedAccount(created.id) });
    } catch (error) {
      response.status(error instanceof DuplicateUsernameError ? 409 : error instanceof InvalidUsernameError ? 400 : 500).json({ error: error instanceof Error ? error.message : "创建账号失败。" });
    }
  });
  app.patch("/api/fnos/users/:id", async (request, response) => {
    if (!requireNativeAdmin(response)) return;
    const id = String(request.params.id);
    if (!(await store.getManagedAccount(id))) { response.status(404).json({ error: "账号不存在。" }); return; }
    const disabled = request.body?.disabled;
    const resetPassword = request.body?.resetPassword === true;
    // 管理员可以直接为其他账号指定新密码；不传则生成一次性临时密码。
    const newPassword = request.body?.newPassword;
    if (newPassword !== undefined && (typeof newPassword !== "string" || newPassword.length < 8 || newPassword.length > 128)) {
      response.status(400).json({ error: "新密码长度应为 8–128 个字符。" });
      return;
    }
    try {
      if (typeof disabled === "boolean") await store.setAccountDisabled(id, disabled);
      let temporaryPassword: string | undefined;
      if (typeof newPassword === "string" && newPassword) {
        await store.setAccountPasswordAsAdmin(id, newPassword);
      } else if (resetPassword) {
        temporaryPassword = (await store.resetUserPassword(id)).temporaryPassword;
      }
      response.json({ temporaryPassword, user: await store.getManagedAccount(id) });
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : "更新账号失败。" });
    }
  });
  app.delete("/api/fnos/users/:id", async (request, response) => {
    if (!requireNativeAdmin(response)) return;
    const id = String(request.params.id);
    const account = await store.getManagedAccount(id);
    if (!account) { response.status(404).json({ error: "账号不存在。" }); return; }
    if (account.kind === "nas") { response.status(400).json({ error: "飞牛账号由 NAS 管理，如需禁止使用请选择停用。" }); return; }
    if (id === nativeContext.getStore()!.user.id) { response.status(400).json({ error: "不能删除当前登录的账号。" }); return; }
    // 连同租户数据一起清掉：工作区、图片、以及他拥有的共享空间。
    await spaces.mutate((items) => items.filter((space) => space.ownerId !== id).map((space) => { delete space.members[id]; return space; }));
    const removed = await store.deleteAccount(id);
    if (imagesDir) await fs.rm(path.join(imagesDir, id), { force: true, recursive: true }).catch(() => undefined);
    response.json({ user: removed });
  });

  app.get("/api/fnos/spaces", async (_request, response) => {
    const context = nativeContext.getStore()!;
    response.json({ privateScope: context.user.id, selected: context.scope, writable: context.writable, spaces: await spaces.visible(context.user.id) });
  });
  // 共享空间成员选择只需要账号名和 UID，不把停用状态、密码状态等管理字段暴露给普通用户。
  app.get("/api/fnos/member-candidates", async (_request, response) => {
    const users = (await store.listManagedAccounts()).filter(
      (user) => !user.disabled,
    );
    response.json({
      users: users.map(({ id, uid, username, kind }) => ({ id, uid, username, kind })),
    });
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
    const userId = String(request.body?.userId || "");
    const role = request.body?.role;
    // 成员既可以直接填 NAS UID（允许先邀请、后启用），也可以按账号 id 指定（应用自建账号）。
    const memberId = userId || `nas-${uid}`;
    // 按 UID 邀请的成员在对方首次登录前还没有账号记录，nas-<uid> 本身就是合法的成员键。
    const nasMember = /^nas-[1-9]\d{0,9}$/.test(memberId);
    const validUid = /^[1-9]\d{0,9}$/.test(uid) && Number(uid) <= 2147483647;
    if ((!userId && !validUid) || !["editor", "viewer", "remove"].includes(role)) { response.status(400).json({ error: "请输入有效 NAS UID 和成员权限。" }); return; }
    if (!nasMember && !(await store.getManagedAccount(memberId))) { response.status(404).json({ error: "该账号不存在。" }); return; }
    const changed = await spaces.mutate((items) => {
      const space = items.find((item) => item.id === request.params.id && item.ownerId === nativeContext.getStore()!.user.id);
      if (!space || space.ownerId === memberId) return false;
      if (role === "remove") delete space.members[memberId]; else space.members[memberId] = role;
      return true;
    });
    response.status(changed ? 200 : 403).json(
      changed
        ? { ok: true }
        : { error: "只有空间所有者能管理其他成员，且所有者本人不需要被加成成员。" },
    );
  });
  app.delete("/api/fnos/spaces/:id", async (request, response) => {
    const removed = await spaces.mutate((items) => {
      const index = items.findIndex((item) => item.id === request.params.id && item.ownerId === nativeContext.getStore()!.user.id);
      if (index < 0) return false;
      items.splice(index, 1); return true;
    });
    response.status(removed ? 200 : 403).json(removed ? { ok: true } : { error: "只有空间所有者能删除共享空间。" });
  });
  app.get("/api/program-info", async (_request, response) => response.json({ appVersion: nativeVersion, stage: "完整适配开发版", nodeVersion: process.versions.node, simulation: process.env.FNOS_SIMULATION === "1", systemApiConfigured: Boolean(await systemApiToken()) }));
  app.get("/api/fnos/update", async (request, response) => {
    if (process.env.FNOS_SIMULATION === "1" && !process.env.SHIGUANG_UPDATE_MANIFEST_URLS) {
      response.json({
        currentVersion: nativeVersion,
        latest: {
          asset: null,
          publishedAt: "",
          releaseNotes: "",
          releaseUrl: "https://github.com/Alicace/shiguang-notes/releases",
          version: nativeVersion,
        },
        hasUpdate: false,
        installable: false,
      });
      return;
    }
    try {
      const latest = await fetchLatestUpdate(request.query.force === "1");
      response.json({
        currentVersion: nativeVersion,
        latest,
        hasUpdate: isNewerVersion(latest.version, nativeVersion),
        installable: Boolean(latest.asset),
      });
    } catch (error) {
      response.status(503).json({
        error: error instanceof Error ? error.message : "检查更新失败。",
      });
    }
  });

  type UpdateJob = {
    createdAt: number;
    error?: string;
    ownerId: string;
    path?: string;
    progress: UpdateDownloadProgress;
    repeated: boolean;
    source?: string;
    status: "queued" | "downloading" | "ready" | "error";
    version: string;
  };
  const updateJobs = new Map<string, UpdateJob>();
  const pruneUpdateJobs = () => {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [id, job] of updateJobs) {
      if (job.createdAt < cutoff) updateJobs.delete(id);
    }
  };

  app.post("/api/fnos/update/download", async (_request, response) => {
    if (!requireNativeAdmin(response)) return;
    try {
      const latest = await fetchLatestUpdate(true);
      if (!isNewerVersion(latest.version, nativeVersion)) {
        response.status(409).json({ error: "当前已经是最新版本。" });
        return;
      }
      const existing = [...updateJobs.entries()].find(([, job]) =>
        job.ownerId === nativeContext.getStore()!.user.id &&
        job.version === latest.version &&
        ["queued", "downloading"].includes(job.status)
      );
      if (existing) {
        response.status(202).json({ jobId: existing[0], version: latest.version });
        return;
      }
      const id = randomBytes(12).toString("hex");
      const job: UpdateJob = {
        createdAt: Date.now(),
        ownerId: nativeContext.getStore()!.user.id,
        progress: {
          percent: 0,
          receivedBytes: 0,
          source: "",
          speedBytesPerSecond: 0,
          stage: "connecting",
          totalBytes: latest.asset?.size || 0,
        },
        repeated: false,
        status: "queued",
        version: latest.version,
      };
      updateJobs.set(id, job);
      pruneUpdateJobs();
      response.status(202).json({ jobId: id, version: latest.version });
      void downloadNativeUpdate(
        latest,
        process.env.TRIM_PKGVAR!,
        nativeVersion,
        (progress) => {
          job.status = "downloading";
          job.progress = progress;
        },
      ).then((result) => {
        job.path = result.path;
        job.repeated = result.reused;
        job.source = result.source;
        job.status = "ready";
      }).catch((error) => {
        job.error = error instanceof Error ? error.message : "安装包下载失败。";
        job.status = "error";
      });
    } catch (error) {
      response.status(502).json({
        error: error instanceof Error ? error.message : "安装包下载失败。",
      });
    }
  });
  app.get("/api/fnos/update/download/:id", (request, response) => {
    if (!requireNativeAdmin(response)) return;
    const job = updateJobs.get(request.params.id);
    if (!job || job.ownerId !== nativeContext.getStore()!.user.id) {
      response.status(404).json({ error: "下载任务不存在或已过期。" });
      return;
    }
    response.json({
      error: job.error,
      path: job.path,
      progress: job.progress,
      repeated: job.repeated,
      source: job.source,
      status: job.status,
      version: job.version,
    });
  });
  app.get("/api/session", async (_request, response) => { const ctx = nativeContext.getStore()!; response.json({ user: { uid: ctx.uid, username: ctx.user.username, isAdmin: ctx.isAdmin }, simulation: process.env.FNOS_SIMULATION === "1", systemApiConfigured: Boolean(await systemApiToken()) }); });
  // 没有系统凭据时不能装作成功：明确告诉前端「未就绪」，界面据此给出可操作的提示。
  // 飞牛宿主会把本应用的会话凭据交给页面里的 SDK；把它登记下来，系统文件授权接口
  // 后续才能调用。凭据写在应用数据目录，重启后仍然有效，用户不必反复授权。
  app.post("/api/fnos/system-credential", async (request, response) => {
    const secret = request.body?.secret;
    if (typeof secret !== "string" || secret.length < 8 || secret.length > 4096 || /\s/.test(secret)) {
      response.status(400).json({ error: "系统凭据格式不正确。" });
      return;
    }

    const filename = path.join(process.env.TRIM_PKGVAR!, "api-token");
    const temporary = filename + "." + randomBytes(6).toString("hex") + ".tmp";
    try {
      await fs.writeFile(temporary, secret, { mode: 0o600, flag: "wx" });
      await fs.rename(temporary, filename);
    } finally {
      await fs.rm(temporary, { force: true });
    }

    response.json({ configured: Boolean(await systemApiToken()) });
  });

  // 已授权目录：系统接口是权威来源，但它在部分宿主版本上只返回当前会话内的授权，
  // 刷新或切换工作区后就会变空。这里把用户确认过的路径落盘，两个来源取并集，
  // 保证「刷新授权状态」和「共享空间返回」都不会把已授权目录弄丢。
  const authorizedFolderFile = () => spaces.sibling("authorized-folders.json");
  let authorizedFolderQueue: Promise<void> = Promise.resolve();
  const readAuthorizedFolders = async (): Promise<Record<string, string[]>> => {
    try {
      const parsed = JSON.parse(await fs.readFile(authorizedFolderFile(), "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      const result: Record<string, string[]> = {};
      for (const [key, paths] of Object.entries(parsed)) {
        if (
          Array.isArray(paths) &&
          paths.every((item) => typeof item === "string")
        ) {
          result[key] = paths;
        }
      }
      return result;
    } catch { return {}; }
  };
  const writeAuthorizedFolders = async (value: Record<string, string[]>): Promise<void> => {
    const filename = authorizedFolderFile();
    const temporary = filename + "." + randomBytes(6).toString("hex") + ".tmp";
    await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
    try { await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" }); await fs.rename(temporary, filename); }
    finally { await fs.rm(temporary, { force: true }); }
  };
  const updateAuthorizedFolders = <T>(operation: (value: Record<string, string[]>) => T): Promise<T> => {
    const result = authorizedFolderQueue.then(async () => {
      const value = await readAuthorizedFolders();
      const output = operation(value);
      await writeAuthorizedFolders(value);
      return output;
    });
    authorizedFolderQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const configuredFileRoots = (process.env.FNOS_ALLOWED_FILE_ROOTS || "")
    .split(path.delimiter)
    .filter((item) => item.startsWith("/"))
    .map((item) => path.resolve(item));
  const isManagedFilesystemPath = (value: string): boolean => {
    if (configuredFileRoots.length) {
      return configuredFileRoots.some((root) => {
        const relative = path.relative(root, value);
        return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
      });
    }
    return /^\/(?:vol\d+|share)(?:\/|$)/.test(value);
  };

  const normalizeAuthorizedPath = async (value: string): Promise<string | null> => {
    if (!value.startsWith("/") || value.includes("\0") || value.length > 4096) return null;
    try {
      const real = await fs.realpath(path.resolve(value));
      if (!isManagedFilesystemPath(real)) return null;
      await fs.stat(real);
      await fs.access(real, fsConstants.R_OK);
      return real.replace(/\/+$/, "") || "/";
    } catch {
      return null;
    }
  };
  const extractFolderPaths = (value: unknown, depth = 0): string[] => {
    if (depth > 4 || value == null) return [];
    if (typeof value === "string") {
      const pathValue = value.trim();
      return pathValue.startsWith("/") ? [pathValue] : [];
    }
    if (Array.isArray(value)) {
      return value.flatMap((item) => extractFolderPaths(item, depth + 1));
    }
    if (typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    for (const key of ["paths", "folders", "items", "list", "data", "result"]) {
      const found = extractFolderPaths(record[key], depth + 1);
      if (found.length) return found;
    }
    for (const key of ["path", "folder", "directory"]) {
      const found = extractFolderPaths(record[key], depth + 1);
      if (found.length) return found;
    }
    return [];
  };
  const loadLiveAuthorizedFolders = async (): Promise<{ healthy: boolean; paths: string[] }> => {
    if (!(await systemApiToken())) return { healthy: false, paths: [] };
    try {
      const value = await systemApi("trim.file.getUserAccessibleFolders", { uid: nativeContext.getStore()!.uid });
      return {
        healthy: value != null,
        paths: Array.from(new Set(extractFolderPaths(value))),
      };
    } catch { return { healthy: false, paths: [] }; }
  };
  const loadAuthorizedRoots = async (userId: string): Promise<string[]> => {
    const remembered = (await readAuthorizedFolders())[userId] || [];
    const normalizedRemembered = (await Promise.all(remembered.map(normalizeAuthorizedPath)))
      .filter((item): item is string => Boolean(item));
    // Once the host API is available, its ACL is authoritative. A stale
    // remembered path must not keep working after the user loses access.
    if (!(await systemApiToken())) return normalizedRemembered;
    const live = await loadLiveAuthorizedFolders();
    return live.healthy
      ? Array.from(new Set([...live.paths, ...normalizedRemembered]))
      : normalizedRemembered;
  };
  const isPathInside = (root: string, candidate: string): boolean => {
    const relative = path.relative(root, candidate);
    return relative === "" ||
      (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  };

  app.get("/api/authorized-folders", async (_request, response) => {
    const userId = nativeContext.getStore()!.user.id;
    response.json({
      configured: Boolean(await systemApiToken()),
      paths: await loadAuthorizedRoots(userId),
    });
  });

  // 记录本次宿主选择器确认过的目录；系统 API 可用时再按实时授权列表复核。
  app.post("/api/authorized-folders", async (request, response) => {
    const userId = nativeContext.getStore()!.user.id;
    const input = request.body?.paths;
    const candidates = Array.isArray(input)
      ? input.filter((item: unknown): item is string => typeof item === "string" && item.startsWith("/") && !item.includes("\0") && item.length <= 4096).slice(0, 64)
      : [];
    const live = await loadLiveAuthorizedFolders();
    const normalizedLive = (await Promise.all(live.paths.map(normalizeAuthorizedPath)))
      .filter((item): item is string => Boolean(item));
    const normalizedCandidates = (await Promise.all(candidates.map(normalizeAuthorizedPath)))
      .filter((item): item is string => Boolean(item));
    const hostPicker = request.get("x-fnnotes-host-picker") === "1";
    const verified: string[] = [];
    for (const candidate of normalizedCandidates) {
      const insideLiveRoot = normalizedLive.some((folder) => isPathInside(folder, candidate));
      if (insideLiveRoot) {
        verified.push(candidate);
        continue;
      }
      if (!hostPicker) continue;
      // A selected path may not appear in the host's folder list yet. If the
      // host API is available, verify the exact file/folder ACL before saving.
      if (!(await systemApiToken())) {
        verified.push(candidate);
        continue;
      }
      try {
        const permissions = await systemApi("trim.file.checkUserACL", {
          uid: nativeContext.getStore()!.uid,
          path: candidate,
        });
        const list = Array.isArray(permissions)
          ? permissions
          : permissions && typeof permissions === "object"
            ? (permissions as { permissions?: unknown }).permissions
            : null;
        const readable = (Array.isArray(list) && list.some(
          (item) => item && typeof item === "object" &&
            (item as { readable?: unknown }).readable === true,
        )) || Boolean(
          permissions && typeof permissions === "object" &&
            (permissions as { readable?: unknown }).readable === true,
        );
        if (readable) verified.push(candidate);
      } catch {
        // Fail closed when the host API cannot verify the selected path.
      }
    }
    const paths = await updateAuthorizedFolders((store_) => {
      store_[userId] = Array.from(new Set([...(store_[userId] || []), ...verified]));
      return store_[userId];
    });
    response.json({ paths });
  });
  // 读取 NAS 上已授权目录里的图片：只允许用户已授权目录下的图片文件，
  // 单个文件有上限，避免把应用当成任意文件读取器。
  app.post("/api/fnos/read-image", async (request, response) => {
    const value = request.body?.path;
    if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0") || value.length > 4096) {
      response.status(400).json({ error: "图片路径格式不正确。" });
      return;
    }

    const userId = nativeContext.getStore()!.user.id;
    const allowedRoots = await loadAuthorizedRoots(userId);
    let requestedPath: string;
    try { requestedPath = await fs.realpath(path.resolve(value)); }
    catch { response.status(404).json({ error: "图片文件不存在或无法读取。" }); return; }
    const realRoots = (await Promise.all(allowedRoots.map(async (folder) => {
      try { return await fs.realpath(path.resolve(folder)); } catch { return null; }
    }))).filter((item): item is string => Boolean(item));
    const insideAuthorizedFolder = realRoots.some((folder) => {
      const relative = path.relative(folder, requestedPath);
      return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    });
    if (!insideAuthorizedFolder) {
      response.status(403).json({ error: "该文件不在已授权的目录里，请先在「文件授权」中授权。" });
      return;
    }

    try {
      if (await systemApiToken()) {
        let permissions: unknown;
        try {
          permissions = await systemApi("trim.file.checkUserACL", {
            uid: nativeContext.getStore()!.uid,
            path: requestedPath,
          });
        } catch {
          response.status(503).json({ error: "飞牛文件 ACL 检查暂不可用，请稍后重试。" });
          return;
        }
        const permissionList = Array.isArray(permissions)
          ? permissions
          : permissions && typeof permissions === "object"
            ? (permissions as { permissions?: unknown }).permissions
            : null;
        const readable =
          (Array.isArray(permissionList) &&
            permissionList.some(
              (item) => item && typeof item === "object" &&
                (item as { readable?: unknown }).readable === true,
            )) ||
          Boolean(
              permissions && typeof permissions === "object" &&
                (permissions as { readable?: unknown }).readable === true,
          );
        if (!readable) {
          response.status(403).json({ error: "当前用户没有读取该文件的权限。" });
          return;
        }
      }
      const stat = await fs.stat(requestedPath);
      if (!stat.isFile() || stat.size > 32 * 1024 * 1024) {
        response.status(400).json({ error: "只能读取 32MB 以内的图片文件。" });
        return;
      }

      const buffer = await fs.readFile(requestedPath);
      response.json({
        dataUrl: `data:${detectImageMimeType(buffer, requestedPath)};base64,${buffer.toString("base64")}`,
        filename: path.basename(requestedPath),
      });
    } catch {
      response.status(404).json({ error: "读取图片失败，请确认文件仍然存在。" });
    }
  });

  app.post("/api/file-acl", async (request, response) => {
    const value = request.body?.path;
    if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0") || value.length > 4096) { response.status(400).json({ error: "目录路径格式不正确。" }); return; }
    if (!(await systemApiToken())) { response.status(503).json({ error: "飞牛系统权限接口未就绪：应用还没有系统 API 凭据。" }); return; }
    try { response.json({ permissions: await systemApi("trim.file.checkUserACL", { uid: nativeContext.getStore()!.uid, path: value }) }); }
    catch { response.status(503).json({ error: "飞牛系统权限接口调用失败，请稍后重试。" }); }
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

// 系统 API 凭据：优先取平台注入的环境变量，其次读应用数据目录里的 api-token 文件，
// 这样在 NAS 上放开系统 API 之后不必重新打包就能启用目录授权与 ACL 检查。
async function systemApiToken(): Promise<string | null> {
  const fromEnv = process.env.TRIM_API_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const dataDir = process.env.TRIM_PKGVAR;
  if (!dataDir) return null;
  try {
    const value = (await fs.readFile(path.join(dataDir, "api-token"), "utf8")).trim();
    return value || null;
  } catch {
    return null;
  }
}

// 只按文件头判断常见图片类型；无法识别时退回 application/octet-stream。
function detectImageMimeType(buffer: Buffer, filename: string): string {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 6 && buffer.subarray(0, 6).toString("ascii").match(/^GIF8[79]a$/)) return "image/gif";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buffer.length >= 2 && buffer.subarray(0, 2).toString("ascii") === "BM") return "image/bmp";
  const lower = filename.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

async function systemApi(reqName: string, data: object): Promise<unknown> {
  const token = await systemApiToken();
  if (!token) throw new Error("系统凭据未配置");
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
