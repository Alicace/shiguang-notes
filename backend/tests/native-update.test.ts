import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  downloadNativeUpdate,
  isAllowedUpdateUrl,
  verifyDownloadedFpk,
} from "../../server/updates/native-update.js";

const assetBuffer = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x01, 0x02, 0x03]);
const asset = {
  name: "fnnotes-m0_0.9.1_x86_64.fpk",
  size: assetBuffer.length,
  sha256: createHash("sha256").update(assetBuffer).digest("hex"),
  urls: [],
};

test("更新安装包必须同时匹配大小、gzip 头和 SHA-256", () => {
  assert.doesNotThrow(() => verifyDownloadedFpk(assetBuffer, asset));
  assert.throws(() =>
    verifyDownloadedFpk(Buffer.from([0x1f, 0x8b, 0x00]), asset),
  );
  const tampered = Buffer.from(assetBuffer);
  tampered[3] = 9;
  assert.throws(() => verifyDownloadedFpk(tampered, asset));
});

test("下载器只接受维护者仓库的 GitHub Release 和固定加速镜像", () => {
  const release =
    "https://github.com/Alicace/shiguang-notes/releases/download/v0.9.1/fnnotes-m0_0.9.1_x86_64.fpk";
  assert.equal(isAllowedUpdateUrl(release), true);
  assert.equal(isAllowedUpdateUrl(`https://ghfast.top/${release}`), true);
  assert.equal(isAllowedUpdateUrl(`https://gh-proxy.com/${release}`), true);
  assert.equal(isAllowedUpdateUrl(release.replace("Alicace", "attacker")), false);
  assert.equal(isAllowedUpdateUrl(`http://ghfast.top/${release}`), false);
  assert.equal(isAllowedUpdateUrl("https://example.com/fnnotes-m0.fpk"), false);
});

test("下载任务输出真实字节进度、选择可用线路并保留校验阶段", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "shiguang-update-"));
  const originalFetch = globalThis.fetch;
  const payload = Buffer.concat([
    assetBuffer,
    Buffer.alloc(128 * 1024, 0x5a),
  ]);
  const update = {
    asset: {
      ...asset,
      size: payload.length,
      sha256: createHash("sha256").update(payload).digest("hex"),
      urls: [
        "https://github.com/Alicace/shiguang-notes/releases/download/v0.9.2/fnnotes-m0_0.9.2_x86_64.fpk",
        "https://gh-proxy.com/https://github.com/Alicace/shiguang-notes/releases/download/v0.9.2/fnnotes-m0_0.9.2_x86_64.fpk",
      ],
    },
    publishedAt: "2026-10-17",
    releaseNotes: "下载进度测试",
    releaseUrl: "https://github.com/Alicace/shiguang-notes/releases/tag/v0.9.2",
    version: "0.9.2",
  };
  const progress: Array<{ percent: number; stage: string; source: string }> = [];
  globalThis.fetch = async (input, init) => {
    const range = new Headers(init?.headers).get("range");
    const response = new Response(payload, {
      status: range ? 206 : 200,
      headers: {
        "content-length": String(payload.length),
        "content-range": `bytes 0-${payload.length - 1}/${payload.length}`,
      },
    });
    Object.defineProperty(response, "url", {
      configurable: true,
      value:
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
    });
    return response;
  };
  try {
    const result = await downloadNativeUpdate(
      update,
      directory,
      "0.9.1",
      (item) => progress.push(item),
    );
    assert.equal(result.reused, false);
    assert.deepEqual(await readFile(result.path), payload);
    assert.ok(progress.some((item) => item.stage === "connecting"));
    assert.ok(progress.some((item) => item.stage === "downloading" && item.percent > 0));
    assert.ok(progress.some((item) => item.stage === "verifying" && item.percent === 100));
    assert.ok(progress.some((item) => item.source.includes("gh-proxy.com") || item.source === "github.com"));
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test("允许的镜像重定向到任意 HTTPS 主机时仍会拒绝下载", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "shiguang-update-"));
  const originalFetch = globalThis.fetch;
  const payload = Buffer.concat([assetBuffer, Buffer.alloc(256, 0x1a)]);
  const update = {
    asset: {
      ...asset,
      size: payload.length,
      sha256: createHash("sha256").update(payload).digest("hex"),
      urls: [
        "https://gh-proxy.com/https://github.com/Alicace/shiguang-notes/releases/download/v0.9.2/fnnotes-m0_0.9.2_x86_64.fpk",
      ],
    },
    publishedAt: "2026-10-17",
    releaseNotes: "重定向测试",
    releaseUrl: "https://github.com/Alicace/shiguang-notes/releases/tag/v0.9.2",
    version: "0.9.2",
  };
  globalThis.fetch = async () => {
    const response = new Response(payload, {
      status: 200,
      headers: { "content-length": String(payload.length) },
    });
    Object.defineProperty(response, "url", {
      configurable: true,
      value: "https://internal.example.invalid/file.fpk",
    });
    return response;
  };
  try {
    await assert.rejects(
      downloadNativeUpdate(update, directory, "0.9.1"),
      /不安全地址/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test("镜像先跳到不受信任主机时不会继续跟随第二跳", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "shiguang-update-"));
  const originalFetch = globalThis.fetch;
  const payload = Buffer.concat([assetBuffer, Buffer.alloc(256, 0x1a)]);
  const update = {
    asset: {
      ...asset,
      size: payload.length,
      sha256: createHash("sha256").update(payload).digest("hex"),
      urls: [
        "https://gh-proxy.com/https://github.com/Alicace/shiguang-notes/releases/download/v0.9.2/fnnotes-m0_0.9.2_x86_64.fpk",
      ],
    },
    publishedAt: "2026-10-17",
    releaseNotes: "中间跳转测试",
    releaseUrl: "https://github.com/Alicace/shiguang-notes/releases/tag/v0.9.2",
    version: "0.9.2",
  };
  let requestedSecondHop = false;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("internal.example.invalid")) {
      requestedSecondHop = true;
      return new Response(payload, { status: 200 });
    }
    return new Response(null, {
      status: 302,
      headers: { location: "https://internal.example.invalid/file.fpk" },
    });
  };
  try {
    await assert.rejects(
      downloadNativeUpdate(update, directory, "0.9.1"),
      /不安全地址/,
    );
    assert.equal(requestedSecondHop, false);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});
