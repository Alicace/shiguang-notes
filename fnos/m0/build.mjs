import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packageDir = path.join(root, "fnnotes-m0");
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error || result.status !== 0) throw result.error || new Error(`${command} 失败。`);
}
run(process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "fnos/m0/tsconfig.json"]);
run(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--config", "fnos/m0/vite.config.ts"]);
for (const file of readdirSync(path.join(packageDir, "cmd"))) chmodSync(path.join(packageDir, "cmd", file), 0o755);
for (const folder of ["web", "server"]) {
  const target = path.join(packageDir, "app", folder);
  rmSync(target, { recursive: true, force: true }); mkdirSync(target, { recursive: true });
}
cpSync(path.join(root, "fnos/m0/dist"), path.join(packageDir, "app/web"), { recursive: true });
for (const file of ["server.mjs", "main.mjs"]) cpSync(path.join(root, "fnos/m0", file), path.join(packageDir, "app/server", file));
for (const file of ["LICENSE", "NOTICE"]) cpSync(path.join(root, file), path.join(packageDir, "app", file));
const projectVersion = JSON.parse(readFileSync(path.join(root, "package.json"))).version;
writeFileSync(path.join(packageDir, "app/build-info.json"), JSON.stringify({ appVersion: "0.1.0", upstreamVersion: projectVersion, upstreamCommit: "6a9b6a3f02a3dd189117bd511d840e44e0c665d5", png: "client", nativeRuntime: "nodejs_v22", stage: "M0", nasVerified: false }, null, 2));
function removeFinderMetadata(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.name === ".DS_Store") rmSync(file);
    else if (entry.isDirectory()) removeFinderMetadata(file);
  }
}
removeFinderMetadata(packageDir);
if (process.argv.includes("--pack")) {
  const binary = process.env.FN_PACK_BIN || path.resolve(root, "../.tools/fnpack-1.2.3-darwin-arm64");
  if (!existsSync(binary)) throw new Error("请安装官方 fnpack，并通过 FN_PACK_BIN 指定其路径。");
  run(binary, ["build", "--directory", packageDir]);
}
