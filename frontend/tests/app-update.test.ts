import assert from "node:assert/strict";
import test from "node:test";
import {
  isNewerVersion,
  parseUpdateManifest,
  PROJECT_REPOSITORY_URL,
  updateManifestSources,
} from "../../src/lib/app-update.js";

const sha256 = "a".repeat(64);

test("项目关于页默认指向维护者的 GitHub 仓库", () => {
  assert.equal(
    PROJECT_REPOSITORY_URL,
    "https://github.com/Alicace/shiguang-notes",
  );
  assert.ok(updateManifestSources()[0].startsWith("https://ghfast.top/"));
  assert.ok(
    updateManifestSources().some((url) =>
      url.includes("Alicace/shiguang-notes/main/version.json"),
    ),
  );
  assert.equal(
    updateManifestSources().some((url) => url.includes("api.github.com")),
    false,
  );
});

test("版本比较按数字段处理，不把 0.10 判成小于 0.9", () => {
  assert.equal(isNewerVersion("0.10.0", "0.9.9"), true);
  assert.equal(isNewerVersion("v1.0.0", "0.99.99"), true);
  assert.equal(isNewerVersion("0.9.0", "0.9.0"), false);
  assert.equal(isNewerVersion("bad", "0.9.0"), false);
});

test("版本清单同时接受简洁版和带 FPK 校验信息的完整版", () => {
  const simple = parseUpdateManifest({
    version: "0.9.1",
    release_url: "https://github.com/Alicace/shiguang-notes/releases/tag/v0.9.1",
    published_at: "2026-10-17",
    release_notes: "测试版本",
  });
  assert.equal(simple.version, "0.9.1");
  assert.equal(simple.asset, null);

  const full = parseUpdateManifest({
    version: "0.9.1",
    releaseUrl: "https://github.com/Alicace/shiguang-notes/releases/tag/v0.9.1",
    asset: {
      name: "fnnotes-m0_0.9.1_x86_64.fpk",
      size: 1024,
      sha256,
      urls: [
        "https://github.com/Alicace/shiguang-notes/releases/download/v0.9.1/fnnotes-m0_0.9.1_x86_64.fpk",
        "https://ghfast.top/https://github.com/Alicace/shiguang-notes/releases/download/v0.9.1/fnnotes-m0_0.9.1_x86_64.fpk",
      ],
    },
  });
  assert.equal(full.asset?.sha256, sha256);
  assert.equal(full.asset?.urls.length, 2);
});

test("版本清单拒绝危险文件名、HTTP 下载地址和无效摘要", () => {
  const base = {
    version: "0.9.1",
    asset: {
      name: "fnnotes-m0.fpk",
      size: 1024,
      sha256,
      urls: ["https://github.com/Alicace/shiguang-notes/releases/download/v0.9.1/fnnotes-m0.fpk"],
    },
  };
  assert.throws(() =>
    parseUpdateManifest({ ...base, asset: { ...base.asset, name: "../x.fpk" } }),
  );
  assert.throws(() =>
    parseUpdateManifest({
      ...base,
      asset: { ...base.asset, urls: ["http://example.com/x.fpk"] },
    }),
  );
  assert.throws(() =>
    parseUpdateManifest({
      ...base,
      asset: { ...base.asset, sha256: "not-a-hash" },
    }),
  );
});
