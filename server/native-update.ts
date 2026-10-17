import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  isNewerVersion,
  parseUpdateManifest,
  type AppUpdate,
  type AppUpdateAsset,
} from "../src/lib/app-update.js";

const DEFAULT_REPOSITORY = "https://github.com/Alicace/shiguang-notes";
const MAX_MANIFEST_BYTES = 32 * 1024;
const MAX_PACKAGE_BYTES = 250 * 1024 * 1024;
const MANIFEST_CACHE_MS = 5 * 60 * 1000;
const mirrorHosts = new Set([
  "ghfast.top",
  "gh-proxy.com",
  "github.moeyy.xyz",
  "ghproxy.net",
]);

let cached: { data: AppUpdate; expiresAt: number } | null = null;

export function updateManifestSources(): string[] {
  const configured = process.env.SHIGUANG_UPDATE_MANIFEST_URLS
    ?.split(",")
    .map((value) => value.trim())
    .filter((value) => value.startsWith("https://"));
  if (configured?.length) return Array.from(new Set(configured));
  const repository =
    process.env.SHIGUANG_PROJECT_REPOSITORY_URL?.trim() || DEFAULT_REPOSITORY;
  const match = new URL(repository).pathname.split("/").filter(Boolean);
  if (match.length < 2) return [];
  const raw = `https://raw.githubusercontent.com/${match[0]}/${match[1]}/main/version.json`;
  const latest = `https://github.com/${match[0]}/${match[1]}/releases/latest/download/version.json`;
  return [
    `https://ghfast.top/${latest}`,
    latest,
    `https://ghfast.top/${raw}`,
    raw,
    `https://cdn.jsdelivr.net/gh/${match[0]}/${match[1]}@main/version.json`,
  ];
}

export function verifyDownloadedFpk(buffer: Buffer, asset: AppUpdateAsset): void {
  if (buffer.length !== asset.size) throw new Error("安装包大小与版本清单不一致");
  if (buffer.length < 2 || buffer[0] !== 0x1f || buffer[1] !== 0x8b) {
    throw new Error("下载内容不是有效的 FPK 安装包");
  }
  const actual = createHash("sha256").update(buffer).digest();
  const expected = Buffer.from(asset.sha256, "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("安装包 SHA-256 校验失败");
  }
}

export function isAllowedUpdateUrl(value: string): boolean {
  try {
    const repository =
      process.env.SHIGUANG_PROJECT_REPOSITORY_URL?.trim() || DEFAULT_REPOSITORY;
    const directPrefix = `${repository.replace(/\/+$/, "")}/releases/download/`;
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    if (url.hostname === "github.com") return url.href.startsWith(directPrefix);
    return mirrorHosts.has(url.hostname) && url.href.includes(directPrefix);
  } catch {
    return false;
  }
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchLatestUpdate(force = false): Promise<AppUpdate> {
  if (!force && cached && cached.expiresAt > Date.now()) return cached.data;
  const sources = updateManifestSources();
  if (!sources.length) throw new Error("未配置版本清单地址");
  const attempts = sources.map(async (source) => {
    try {
      const separator = source.includes("?") ? "&" : "?";
      const response = await fetchWithTimeout(
        `${source}${separator}t=${Date.now()}`,
        10_000,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.url.startsWith("https://")) throw new Error("版本清单来源不安全");
      const text = await response.text();
      if (Buffer.byteLength(text) > MAX_MANIFEST_BYTES) {
        throw new Error("版本清单过大");
      }
      const data = parseUpdateManifest(JSON.parse(text));
      cached = { data, expiresAt: Date.now() + MANIFEST_CACHE_MS };
      return data;
    } catch {
      throw new Error("版本清单源不可用");
    }
  });
  try {
    return await Promise.any(attempts);
  } catch {
    throw new Error("无法读取版本清单，请检查 NAS 网络后重试");
  }
}

export async function downloadNativeUpdate(
  update: AppUpdate,
  dataDirectory: string,
  currentVersion: string,
): Promise<{ path: string; reused: boolean; source: string }> {
  if (!isNewerVersion(update.version, currentVersion)) {
    throw new Error("当前已经是最新版本");
  }
  if (!update.asset) throw new Error("版本清单没有提供可安装的 FPK");

  const directory = path.join(dataDirectory, "updates");
  const target = path.join(directory, update.asset.name);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const existing = await fs.readFile(target);
    verifyDownloadedFpk(existing, update.asset);
    return { path: target, reused: true, source: "cache" };
  } catch {
    await fs.rm(target, { force: true });
  }

  let lastError = "没有可用的下载地址";
  for (const url of update.asset.urls) {
    if (!isAllowedUpdateUrl(url)) continue;
    try {
      const response = await fetchWithTimeout(url, 120_000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.url.startsWith("https://")) throw new Error("下载被重定向到不安全地址");
      const declared = Number(response.headers.get("content-length") || 0);
      if (declared > MAX_PACKAGE_BYTES) throw new Error("安装包超过大小限制");
      if (!response.body) throw new Error("下载响应没有内容");
      const chunks: Buffer[] = [];
      let received = 0;
      for await (const chunk of response.body) {
        const buffer = Buffer.from(chunk);
        received += buffer.length;
        if (received > MAX_PACKAGE_BYTES) throw new Error("安装包超过大小限制");
        chunks.push(buffer);
      }
      const buffer = Buffer.concat(chunks, received);
      verifyDownloadedFpk(buffer, update.asset);
      const temporary = `${target}.${Date.now()}.tmp`;
      try {
        await fs.writeFile(temporary, buffer, { mode: 0o600, flag: "wx" });
        await fs.rename(temporary, target);
      } finally {
        await fs.rm(temporary, { force: true });
      }
      return { path: target, reused: false, source: new URL(url).hostname };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "下载失败";
    }
  }
  throw new Error(`安装包下载失败：${lastError}`);
}
