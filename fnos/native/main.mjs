import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

if (process.getuid?.() === 0) throw new Error("拾光便签必须由专用包用户运行，不能使用 root。");
const appDir = process.env.TRIM_APPDEST;
const dataDir = process.env.TRIM_PKGVAR;
if (!appDir || !dataDir || !path.isAbsolute(appDir) || !path.isAbsolute(dataDir)) throw new Error("缺少应用目录配置。");
process.umask(0o077);
await mkdir(dataDir, { recursive: true, mode: 0o700 });
const socket = path.join(appDir, "app.sock");
try { if (!(await lstat(socket)).isSocket()) throw new Error("Socket 位置被其他文件占用。"); await rm(socket); }
catch (error) { if (error.code !== "ENOENT") throw error; }
await rm(path.join(dataDir, "ready.pid"), { force: true });
const configKeys = ["OPENAI_BASE_URL", "OPENAI_MODEL", "OPENAI_API_KEY", "QINIU_ACCESS_KEY", "QINIU_SECRET_KEY", "QINIU_BUCKET", "QINIU_DOMAIN", "QINIU_PREFIX"];
try { const config = JSON.parse(await readFile(path.join(dataDir, "runtime-config.json"), "utf8")); for (const key of configKeys) if (typeof config[key] === "string") process.env[key] = config[key]; }
catch (error) { if (error.code !== "ENOENT") throw error; }
const secret = path.join(dataDir, "session-secret");
try { process.env.SESSION_SECRET = await readFile(secret, "utf8"); }
catch (error) { if (error.code !== "ENOENT") throw error; process.env.SESSION_SECRET = randomBytes(32).toString("base64url"); await writeFile(secret, process.env.SESSION_SECRET, { mode: 0o600, flag: "wx" }); }
process.env.FNOS_NATIVE = "1";
process.env.REQUIRE_LOGIN = "true";
process.env.FNOS_SOCKET = socket;
process.env.DATA_STORAGE_DIR = path.join(dataDir, "data");
process.env.IMAGE_STORAGE_DIR = path.join(dataDir, "images");
await import("../dist-server/server/index.js");
