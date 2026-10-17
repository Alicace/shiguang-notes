import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const fpkPath = process.env.FPK_PATH || "fnnotes-m0.fpk";
const metadata = JSON.parse(
  readFileSync(path.resolve("src/native/metadata.json"), "utf8"),
);
const version = (process.env.APP_VERSION || metadata.appVersion)
  .replace(/^v/i, "")
  .trim();
const tag = process.env.RELEASE_TAG || `v${version}`;
const repository =
  process.env.GITHUB_REPOSITORY ||
  process.env.SHIGUANG_GITHUB_REPOSITORY ||
  "Alicace/shiguang-notes";
const assetName =
  process.env.ASSET_NAME || `fnnotes-m0_${version}_x86_64.fpk`;
const output = process.env.MANIFEST_OUTPUT || "version.json";
const buffer = readFileSync(path.resolve(fpkPath));

if (buffer.length < 2 || buffer[0] !== 0x1f || buffer[1] !== 0x8b) {
  throw new Error("FPK_PATH 不是有效的 gzip/FPK 安装包");
}

const directUrl = `https://github.com/${repository}/releases/download/${tag}/${assetName}`;
const manifest = {
  version,
  release_url: `https://github.com/${repository}/releases/tag/${tag}`,
  published_at: new Date().toISOString().slice(0, 10),
  release_notes:
    process.env.RELEASE_NOTES ||
    `拾光便签 ${version} 正式版本。`,
  asset: {
    name: assetName,
    size: statSync(path.resolve(fpkPath)).size,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    urls: [
      directUrl,
      `https://ghfast.top/${directUrl}`,
      `https://gh-proxy.com/${directUrl}`,
    ],
  },
};

writeFileSync(path.resolve(output), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ output, version, size: manifest.asset.size }));
