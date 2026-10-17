// 原生应用更新链路的清单解析、镜像测速、下载与完整性校验。
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  isNewerVersion,
  parseUpdateManifest,
  type AppUpdate,
  type AppUpdateAsset,
} from "../../src/updates/app-update.js";

const DEFAULT_REPOSITORY = "https://github.com/Alicace/shiguang-notes";
const MAX_MANIFEST_BYTES = 32 * 1024;
const MAX_PACKAGE_BYTES = 250 * 1024 * 1024;
const MANIFEST_CACHE_MS = 5 * 60 * 1000;
const MAX_REDIRECTS = 5;
const mirrorHosts = new Set([
  "ghfast.top",
  "gh-proxy.com",
  "ghproxy.net",
  "github.moeyy.xyz",
  "gh.llkk.cc",
]);
const releaseRedirectHosts = new Set([
  "github-releases.githubusercontent.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);
const manifestResponseHosts = new Set([
  "cdn.jsdelivr.net",
  "github.com",
  "raw.githubusercontent.com",
  "github-releases.githubusercontent.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  ...mirrorHosts,
]);

let cached: { data: AppUpdate; expiresAt: number } | null = null;

export interface UpdateDownloadProgress {
  percent: number;
  receivedBytes: number;
  source: string;
  speedBytesPerSecond: number;
  stage: "connecting" | "downloading" | "verifying";
  totalBytes: number;
}

export type UpdateProgressCallback = (progress: UpdateDownloadProgress) => void;

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
    latest,
    raw,
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

function isAllowedDownloadResponseUrl(
  finalValue: string,
  requestedValue: string,
): boolean {
  try {
    const finalUrl = new URL(finalValue);
    if (finalUrl.protocol !== "https:" || finalUrl.username || finalUrl.password) {
      return false;
    }
    return isAllowedUpdateUrl(finalValue) ||
      (isAllowedUpdateUrl(requestedValue) &&
        releaseRedirectHosts.has(finalUrl.hostname));
  } catch {
    return false;
  }
}

function isAllowedManifestResponseUrl(
  finalValue: string,
  requestedValue: string,
): boolean {
  try {
    const finalUrl = new URL(finalValue);
    const requestedUrl = new URL(requestedValue);
    return finalUrl.protocol === "https:" &&
      !finalUrl.username &&
      !finalUrl.password &&
      manifestResponseHosts.has(finalUrl.hostname) &&
      manifestResponseHosts.has(requestedUrl.hostname);
  } catch {
    return false;
  }
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  headers: Record<string, string> = {},
  validate: (next: string, requested: string) => boolean,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchWithCheckedRedirects(url, headers, controller.signal, validate);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithCheckedRedirects(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  validate: (next: string, requested: string) => boolean,
): Promise<Response> {
  let current = url;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetch(current, {
      cache: "no-store",
      headers,
      redirect: "manual",
      signal,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) throw new Error("下载线路返回了无目标的重定向");
      const next = new URL(location, current).toString();
      if (!validate(next, url)) throw new Error("下载线路重定向到不安全地址");
      current = next;
      continue;
    }
    if (!validate(response.url || current, url)) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("下载线路重定向到不安全地址");
    }
    return response;
  }
  throw new Error("下载线路重定向次数过多");
}

function updateDownloadSources(asset: AppUpdateAsset): string[] {
  const direct = asset.urls.find((url) =>
    url.startsWith(
      `${(process.env.SHIGUANG_PROJECT_REPOSITORY_URL?.trim() || DEFAULT_REPOSITORY).replace(/\/+$/, "")}/releases/download/`,
    ),
  );
  const mirrored = direct
    ? Array.from(mirrorHosts, (host) => `https://${host}/${direct}`)
    : [];
  return Array.from(new Set([...asset.urls, ...mirrored])).filter(isAllowedUpdateUrl);
}

async function rankDownloadSources(urls: string[]): Promise<string[]> {
  const probes = await Promise.allSettled(
    urls.map(async (url) => {
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6_000);
      try {
        const response = await fetchWithCheckedRedirects(
          url,
          { Range: "bytes=0-524287" },
          controller.signal,
          isAllowedDownloadResponseUrl,
        );
        if (!response.ok && response.status !== 206) {
          throw new Error(`HTTP ${response.status}`);
        }
        if (!isAllowedDownloadResponseUrl(response.url, url)) {
          throw new Error("下载线路重定向到不安全地址");
        }
        const reader = response.body?.getReader();
        let received = 0;
        while (reader && received < 512 * 1024) {
          const chunk = await reader.read();
          if (chunk.done) break;
          received += chunk.value?.byteLength || 0;
        }
        await reader?.cancel().catch(() => undefined);
        if (!received) throw new Error("下载线路没有返回内容");
        return {
          rate: received / Math.max((Date.now() - started) / 1000, 0.05),
          url,
        };
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  const reachable = probes
    .filter(
      (result): result is PromiseFulfilledResult<{ rate: number; url: string }> =>
        result.status === "fulfilled",
    )
    .map((result) => result.value)
    .sort((left, right) => right.rate - left.rate)
    .map((result) => result.url);
  return Array.from(new Set([...reachable, ...urls]));
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
        {},
        isAllowedManifestResponseUrl,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!isAllowedManifestResponseUrl(response.url, source)) {
        throw new Error("版本清单来源不安全");
      }
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
  onProgress: UpdateProgressCallback = () => undefined,
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
    onProgress({
      percent: 100,
      receivedBytes: update.asset.size,
      source: "cache",
      speedBytesPerSecond: 0,
      stage: "verifying",
      totalBytes: update.asset.size,
    });
    return { path: target, reused: true, source: "cache" };
  } catch {
    await fs.rm(target, { force: true });
  }

  let lastError = "没有可用的下载地址";
  const sources = updateDownloadSources(update.asset);
  onProgress({
    percent: 0,
    receivedBytes: 0,
    source: "",
    speedBytesPerSecond: 0,
    stage: "connecting",
    totalBytes: update.asset.size,
  });
  const rankedSources = await rankDownloadSources(sources);
  for (const url of rankedSources) {
    const source = new URL(url).hostname;
    const temporary = `${target}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`;
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    try {
      onProgress({
        percent: 0,
        receivedBytes: 0,
        source,
        speedBytesPerSecond: 0,
        stage: "connecting",
        totalBytes: update.asset.size,
      });
      const controller = new AbortController();
      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => controller.abort(), 30_000);
      };
      resetIdleTimer();
      const response = await fetchWithCheckedRedirects(
        url,
        {},
        controller.signal,
        isAllowedDownloadResponseUrl,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!isAllowedDownloadResponseUrl(response.url, url)) {
        throw new Error("下载被重定向到不安全地址");
      }
      const declared = Number(response.headers.get("content-length") || 0);
      if (declared > MAX_PACKAGE_BYTES) throw new Error("安装包超过大小限制");
      if (!response.body) throw new Error("下载响应没有内容");
      handle = await fs.open(temporary, "wx", 0o600);
      let received = 0;
      const started = Date.now();
      for await (const chunk of response.body) {
        resetIdleTimer();
        const buffer = Buffer.from(chunk);
        received += buffer.length;
        if (received > MAX_PACKAGE_BYTES) throw new Error("安装包超过大小限制");
        await handle.write(buffer);
        const elapsedSeconds = Math.max((Date.now() - started) / 1000, 0.1);
        onProgress({
          percent: Math.min(99, Math.floor((received / update.asset.size) * 100)),
          receivedBytes: received,
          source,
          speedBytesPerSecond: Math.round(received / elapsedSeconds),
          stage: "downloading",
          totalBytes: update.asset.size,
        });
      }
      if (idleTimer) clearTimeout(idleTimer);
      await handle.sync();
      await handle.close();
      handle = null;
      onProgress({
        percent: 99,
        receivedBytes: received,
        source,
        speedBytesPerSecond: 0,
        stage: "verifying",
        totalBytes: update.asset.size,
      });
      const buffer = await fs.readFile(temporary);
      verifyDownloadedFpk(buffer, update.asset);
      await fs.rename(temporary, target);
      onProgress({
        percent: 100,
        receivedBytes: buffer.length,
        source,
        speedBytesPerSecond: 0,
        stage: "verifying",
        totalBytes: update.asset.size,
      });
      return { path: target, reused: false, source: new URL(url).hostname };
    } catch (error) {
      if (idleTimer) clearTimeout(idleTimer);
      if (handle) await handle.close().catch(() => undefined);
      await fs.rm(temporary, { force: true });
      lastError = error instanceof Error ? error.message : "下载失败";
    }
  }
  throw new Error(`安装包下载失败：${lastError}`);
}
