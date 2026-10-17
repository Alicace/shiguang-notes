import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { prepareProductionRuntime } from "./package-files.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const templateDir = path.join(root, "fnos/native/package-template");
const packageDir = path.join(root, ".build/fnnotes-m0");
const app = path.join(packageDir, "app");
const nativeDist = path.join(root, "dist-fnos");
const metadata = JSON.parse(readFileSync(path.join(root, "src/native/metadata.json")));
function run(command, args, env = process.env) { const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit" }); if (result.error || result.status !== 0) throw result.error || new Error("原生构建失败。"); }
run(process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "tsconfig.json"]);
rmSync(path.join(root, "dist-server"), { recursive: true, force: true });
run(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.server.json"]);
run(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--outDir", "dist-fnos"], { ...process.env, VITE_FNOS_NATIVE: "1" });
cpSync(path.join(nativeDist, "fnos/m0/ui/auth-callback.html"), path.join(nativeDist, "auth-callback.html"));
rmSync(packageDir, { recursive: true, force: true });
mkdirSync(path.dirname(packageDir), { recursive: true });
cpSync(templateDir, packageDir, { recursive: true });
mkdirSync(path.join(app, "server"), { recursive: true });
mkdirSync(path.join(app, "ui/images"), { recursive: true });
cpSync(path.join(root, "fnos/native/main.mjs"), path.join(app, "server/main.mjs"));
cpSync(nativeDist, path.join(app, "dist"), { recursive: true });
for (const folder of ["dist-server", "public", "src/assets/fonts", "skills/notes-workspace-api", "skills/notes-export-api"]) cpSync(path.join(root, folder), path.join(app, folder), { recursive: true });
for (const filename of ["LICENSE", "NOTICE"]) cpSync(path.join(root, filename), path.join(app, filename));
cpSync(path.join(root, "DOCS/fnos-icon.md"), path.join(app, "ICON-SOURCE.md"));
for (const size of [64, 256]) {
  const icon = await sharp(path.join(root, "public/brand/shiguang-app-icon.png")).resize(size, size).png().toBuffer();
  writeFileSync(path.join(packageDir, size === 64 ? "ICON.PNG" : "ICON_256.PNG"), icon);
  writeFileSync(path.join(app, `ui/images/icon_${size}.png`), icon);
}
// 开发机模拟器与测试浏览器不进入原生包；Linux Sharp 运行依赖必须独立准备。
const runtime = process.env.FNOS_RUNTIME_DIR || path.resolve(root, "../.tools/native-runtime-linux");
if (!existsSync(path.join(runtime, "node_modules/sharp/package.json"))) throw new Error("缺少 Linux x64 原生运行依赖，请先准备 FNOS_RUNTIME_DIR。");
// 七牛的已发布 JS 不调用编译器；npm 命令链接也不属于 NAS 服务运行入口。
prepareProductionRuntime(path.join(runtime, "node_modules"), path.join(app, "node_modules"));
for (const filename of readdirSync(path.join(packageDir, "cmd"))) chmodSync(path.join(packageDir, "cmd", filename), 0o755);
let manifest = readFileSync(path.join(packageDir, "manifest"), "utf8");
manifest = manifest.replace(/^version\s*=.*$/m, "version=" + metadata.appVersion).replace(/^desc\s*=.*$/m, "desc=拾光便签：NAS 上的私有便签与共享空间，使用飞牛账号登录，支持七种纸张主题、插入图片、导出 PNG 与公众号排版。");
writeFileSync(path.join(packageDir, "manifest"), manifest);
writeFileSync(path.join(app, "build-info.json"), JSON.stringify({ ...metadata, png: "client", nasVerified: false }, null, 2));
writeFileSync(path.join(app, "package.json"), JSON.stringify({ type: "module", private: true, version: metadata.appVersion }));
function clean(dir) { for (const item of readdirSync(dir, { withFileTypes: true })) { const target = path.join(dir, item.name); if (item.name === ".DS_Store" || item.name === ".env" || (item.name.startsWith(".env.") && item.name !== ".env.example") || item.name === ".npmrc") rmSync(target); else if (item.isSymbolicLink()) throw new Error("打包目录包含不支持的软链接：" + path.relative(packageDir, target)); else if (item.isDirectory()) clean(target); } }
clean(packageDir);
if (process.argv.includes("--pack")) run(process.env.FN_PACK_BIN || path.resolve(root, "../.tools/fnpack-1.2.3-darwin-arm64"), ["build", "--directory", packageDir]);
