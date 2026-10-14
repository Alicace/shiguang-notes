import { cpSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

export function prepareProductionRuntime(source, destination) {
  cpSync(source, destination, { recursive: true, verbatimSymlinks: true });
  rmSync(path.join(destination, "typescript"), { recursive: true, force: true });
  function clean(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.name === ".bin" && entry.isDirectory()) rmSync(filename, { recursive: true, force: true });
      else if (entry.isSymbolicLink()) throw new Error("运行包包含不支持的软链接：" + path.relative(destination, filename));
      else if (entry.isDirectory()) clean(filename);
    }
  }
  clean(destination);
}
