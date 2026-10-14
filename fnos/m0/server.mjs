import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

export const PREFIX = "/app/fnnotes-m0";
export const APP_NAME = "fnnotes-m0";

class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function assertNonRoot(uid) {
  if (uid === 0) throw new Error("服务必须以专用包用户运行，禁止 root。");
}

function gatewayUser(req) {
  const uid = req.headers["x-trim-userid"];
  const admin = req.headers["x-trim-isadmin"];
  const username = req.headers["x-trim-username"];
  const keys = ["x-trim-userid", "x-trim-isadmin", "x-trim-username"];
  for (const key of keys) {
    if (req.rawHeaders.filter((value, i) => i % 2 === 0 && value.toLowerCase() === key).length !== 1) throw new RequestError(401, "缺少或重复的飞牛网关身份。");
  }
  if (typeof uid !== "string" || !/^[1-9]\d{0,9}$/.test(uid) || Number(uid) > 2_147_483_647 || !["true", "false"].includes(admin) || typeof username !== "string" || !username.trim() || username.length > 256) {
    throw new RequestError(401, "飞牛网关身份格式不正确。");
  }
  return { uid: Number(uid), username, isAdmin: admin === "true" };
}

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  if (req.headers["content-type"]?.split(";")[0] !== "application/json") throw new RequestError(400, "需要 JSON 请求。");
  const buffer = await new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 262_144) { chunks = []; reject(new RequestError(413, "请求内容过大。")); }
      else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", () => reject(new RequestError(400, "请求被中断。")));
  });
  try { return JSON.parse(buffer.toString("utf8")); }
  catch { throw new RequestError(400, "请求 JSON 格式不正确。"); }
}

function onlyKeys(body, keys) {
  return body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).every((key) => keys.includes(key));
}

export function systemApi(reqName, data) {
  const token = process.env.TRIM_API_TOKEN;
  if (!token) throw new RequestError(503, "系统 API 尚未配置，请在飞牛中检查应用权限。");
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: "/var/run/trim_open_gateway_apiscope.socket", path: "/api/v1/trimapp", method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } }, (res) => {
      const chunks = [];
      let length = 0;
      res.on("data", (chunk) => { length += chunk.length; if (length > 262_144) req.destroy(); else chunks.push(chunk); });
      res.on("end", () => {
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString());
          if (res.statusCode !== 200 || result.code !== 0) throw new Error("system_api_failed");
          resolve(result.data);
        } catch { reject(new RequestError(502, "飞牛系统 API 调用失败，请检查授权配置。")); }
      });
      res.on("error", () => reject(new RequestError(502, "飞牛系统 API 响应中断。")));
    });
    req.setTimeout(5000, () => req.destroy());
    req.on("error", () => reject(new RequestError(503, "飞牛系统 API 暂时不可用。")));
    req.end(JSON.stringify({ reqId: randomBytes(8).toString("hex"), req: reqName, appName: APP_NAME, data }));
  });
}

export function createM0Server({ dataDir, webDir, prefix = PREFIX, systemGateway = systemApi, simulation = false }) {
  const tokens = new Map();
  let writes = Promise.resolve();
  const tokenFor = (uid) => {
    if (!tokens.has(uid)) tokens.set(uid, randomBytes(32).toString("hex"));
    return tokens.get(uid);
  };
  const load = async (uid) => {
    try {
      const value = JSON.parse(await readFile(path.join(dataDir, `${uid}.json`), "utf8"));
      if (typeof value.text !== "string" || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error("invalid_store");
      return value;
    } catch (error) { if (error.code === "ENOENT") return { text: "", revision: 0 }; throw error; }
  };
  const save = (uid, body) => {
    const operation = writes.then(async () => {
      const current = await load(uid);
      if (current.revision !== body.revision) throw new RequestError(409, "便签已在另一端修改，请保留当前草稿并重新加载。");
      const next = { text: body.text, revision: current.revision + 1 };
      await mkdir(dataDir, { recursive: true, mode: 0o700 });
      const filename = path.join(dataDir, `${uid}.json`);
      const temporary = `${filename}.${randomBytes(6).toString("hex")}.tmp`;
      try { await writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: "wx" }); await rename(temporary, filename); }
      finally { await rm(temporary, { force: true }); }
      return next;
    });
    writes = operation.catch(() => {});
    return operation;
  };
  const checkWrite = (req, user) => {
    const csrf = req.headers["x-fnnotes-csrf"];
    const expected = tokens.get(user.uid);
    if (typeof csrf !== "string" || !/^[a-f0-9]{64}$/.test(csrf) || !expected || !timingSafeEqual(Buffer.from(csrf), Buffer.from(expected))) throw new RequestError(403, "写入校验失败，请刷新页面后重试。");
    try {
      const origin = new URL(req.headers.origin);
      const host = req.headers["x-forwarded-host"] || req.headers.host;
      const protocol = req.headers["x-forwarded-proto"];
      if (!["http:", "https:"].includes(origin.protocol) || typeof host !== "string" || host.includes(",") || (protocol && !["http", "https"].includes(protocol))) throw new Error("invalid_origin");
      const expected = new URL(`${protocol || origin.protocol.slice(0, -1)}://${host}`);
      if (origin.origin !== expected.origin) throw new Error("invalid_origin");
    } catch { throw new RequestError(403, "拒绝跨站写入请求。"); }
  };
  return http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'");
    try {
      const user = gatewayUser(req);
      const pathname = decodeURIComponent((req.url || "").split("?")[0]);
      if (pathname !== prefix && !pathname.startsWith(prefix + "/")) throw new RequestError(404, "页面不存在。");
      const route = pathname.slice(prefix.length) || "/";
      if (req.method === "GET" && route === "/api/session") return json(res, 200, { user, csrfToken: tokenFor(user.uid), prototype: true, simulation, systemApiConfigured: Boolean(process.env.TRIM_API_TOKEN) });
      if (req.method === "GET" && route === "/api/workspace") return json(res, 200, await load(user.uid));
      if (req.method === "PUT" && route === "/api/workspace") {
        checkWrite(req, user);
        const body = await readBody(req);
        if (!onlyKeys(body, ["text", "revision"]) || typeof body.text !== "string" || body.text.length > 50_000 || !Number.isSafeInteger(body.revision) || body.revision < 0) throw new RequestError(400, "正文或版本格式不正确，正文最多 50000 字符。");
        return json(res, 200, await save(user.uid, body));
      }
      if (req.method === "GET" && route === "/api/authorized-folders") return json(res, 200, await systemGateway("trim.file.getUserAccessibleFolders", { uid: user.uid }));
      if (req.method === "POST" && route === "/api/file-acl") {
        checkWrite(req, user);
        const body = await readBody(req);
        if (!onlyKeys(body, ["path"]) || typeof body.path !== "string" || !path.isAbsolute(body.path) || body.path.includes("\0") || body.path.length > 4096) throw new RequestError(400, "文件路径格式不正确。");
        return json(res, 200, { permissions: await systemGateway("trim.file.checkUserACL", { uid: user.uid, path: body.path }) });
      }
      if (req.method !== "GET" || route.startsWith("/api/") || route.includes("..") || route.includes("\\") || route.includes("\0") || /\/(\.|server)/.test(route)) throw new RequestError(404, "页面不存在。");
      const file = path.join(webDir, route === "/" ? "index.html" : route);
      if (!(await stat(file)).isFile()) throw new RequestError(404, "页面不存在。");
      const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
      res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
      createReadStream(file).on("error", () => res.destroy()).pipe(res);
    } catch (error) {
      if (res.headersSent) return res.destroy();
      const status = error.status || (error.code === "ENOENT" || error.code === "ENOTDIR" ? 404 : 500);
      json(res, status, { error: error.status ? error.message : status === 404 ? "页面不存在。" : "服务暂时不可用，请查看应用日志。" });
    }
  });
}
