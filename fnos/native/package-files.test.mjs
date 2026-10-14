import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { prepareProductionRuntime } from "./package-files.mjs";

test("运行包不携带开发机 npm 命令链接或已删除的编译器链接，模块内容不丢失", (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "shiguang-package-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, "source"); const destination = path.join(directory, "package");
  for (const folder of [".bin", "typescript/bin", "mime", "nested/node_modules/.bin"]) mkdirSync(path.join(source, folder), { recursive: true });
  writeFileSync(path.join(source, "typescript/bin/tsc"), "compiler");
  writeFileSync(path.join(source, "mime/index.js"), "export default 'runtime';");
  symlinkSync("../typescript/bin/tsc", path.join(source, ".bin/tsc"));
  symlinkSync(path.join(source, "mime/index.js"), path.join(source, "nested/node_modules/.bin/mime"));
  prepareProductionRuntime(source, destination);
  assert.equal(existsSync(path.join(destination, ".bin")), false);
  assert.equal(existsSync(path.join(destination, "nested/node_modules/.bin")), false);
  assert.equal(existsSync(path.join(destination, "typescript")), false);
  assert.equal(readFileSync(path.join(destination, "mime/index.js"), "utf8"), "export default 'runtime';");
  assert.equal(existsSync(path.join(source, ".bin/tsc")), true);
});

test("运行目录出现非命令软链接时阻止打包，不能将外部路径悄悄带入 FPK", (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "shiguang-package-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, "source"); mkdirSync(source);
  const external = path.join(directory, "external.js"); writeFileSync(external, "external");
  symlinkSync(external, path.join(source, "module.js"));
  assert.throws(() => prepareProductionRuntime(source, path.join(directory, "package")), /软链接/);
});
