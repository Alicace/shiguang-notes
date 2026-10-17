import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  isAllowedUpdateUrl,
  verifyDownloadedFpk,
} from "../../server/native-update.js";

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
