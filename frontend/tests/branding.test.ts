import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function text(path: string): string {
  return readFileSync(path, "utf8");
}

test("登录页、页眉和关于页统一使用拾光便签图标", () => {
  for (const path of [
    "src/components/LoginDialog.tsx",
    "src/App.tsx",
    "src/components/SettingsPanel.tsx",
    "index.html",
  ]) {
    const source = text(path);
    assert.match(source, /\/brand\/shiguang-app-icon\.png/);
    assert.doesNotMatch(source, /\/header\/logo\.png/);
  }
});

test("用户可见的当前界面不再包含旧品牌或艺人主题名", () => {
  const visibleSources = [
    "src/components/LoginDialog.tsx",
    "src/components/SettingsPanel.tsx",
    "src/lib/themes.ts",
    "src/lib/footer.ts",
    "src/native/features.ts",
    "fnos/m0/ui/features.ts",
    "skills/notes-export-api/skill-card.md",
  ].map(text).join("\n");
  assert.doesNotMatch(visibleSources, /锤子|老罗|Smartisan Notes/);
  assert.match(text("src/lib/themes.ts"), /暖色杂志/);
});

test("应用图标是 1024 x 1024 的用户提供 PNG 资源", () => {
  const png = readFileSync("public/brand/shiguang-app-icon.png");
  assert.deepEqual([...png.subarray(1, 4)], [...Buffer.from("PNG")]);
  assert.equal(png.readUInt32BE(16), 1024);
  assert.equal(png.readUInt32BE(20), 1024);
});
