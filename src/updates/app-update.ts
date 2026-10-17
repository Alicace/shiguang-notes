// 版本清单解析、校验与下载来源选择集中在更新模块，避免散落在设置界面。
const buildEnvironment = (import.meta as ImportMeta & {
  env?: Record<string, string>;
}).env;

export const DEFAULT_PROJECT_REPOSITORY_URL =
  "https://github.com/Alicace/shiguang-notes";
export const UPSTREAM_REPOSITORY_URL = "https://github.com/zhaoolee/notes";
export const PROJECT_REPOSITORY_URL =
  buildEnvironment?.VITE_PROJECT_REPOSITORY_URL?.trim() ||
  DEFAULT_PROJECT_REPOSITORY_URL;

export interface AppUpdateAsset {
  name: string;
  sha256: string;
  size: number;
  urls: string[];
}

export interface AppUpdate {
  asset: AppUpdateAsset | null;
  publishedAt: string;
  releaseNotes: string;
  releaseUrl: string;
  version: string;
}

function normalizedVersion(value: string): number[] | null {
  const match = value
    .trim()
    .replace(/^v/i, "")
    .match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/);
  return match
    ? [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)]
    : null;
}

export function isNewerVersion(next: string, current: string): boolean {
  const left = normalizedVersion(next);
  const right = normalizedVersion(current);
  if (!left || !right) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function parseUpdateManifest(value: unknown): AppUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("版本清单格式不正确");
  }
  const input = value as Record<string, unknown>;
  const version =
    typeof input.version === "string" ? input.version.trim().replace(/^v/i, "") : "";
  if (!normalizedVersion(version)) throw new Error("版本清单缺少有效 version");

  const releaseUrl =
    httpsUrl(input.release_url) ||
    httpsUrl(input.releaseUrl) ||
    `${PROJECT_REPOSITORY_URL.replace(/\/+$/, "")}/releases/tag/v${version}`;
  const publishedAt =
    typeof input.published_at === "string"
      ? input.published_at
      : typeof input.publishedAt === "string"
        ? input.publishedAt
        : "";
  const releaseNotes =
    typeof input.release_notes === "string"
      ? input.release_notes
      : typeof input.releaseNotes === "string"
        ? input.releaseNotes
        : "";

  const rawAsset =
    input.asset && typeof input.asset === "object" && !Array.isArray(input.asset)
      ? (input.asset as Record<string, unknown>)
      : null;
  let asset: AppUpdateAsset | null = null;
  if (rawAsset) {
    const name = typeof rawAsset.name === "string" ? rawAsset.name.trim() : "";
    const sha256 =
      typeof rawAsset.sha256 === "string" ? rawAsset.sha256.toLowerCase() : "";
    const size =
      typeof rawAsset.size === "number" ? rawAsset.size : Number(rawAsset.size);
    const candidates = Array.isArray(rawAsset.urls)
      ? rawAsset.urls
      : [rawAsset.url, rawAsset.download_url];
    const urls = Array.from(
      new Set(candidates.map(httpsUrl).filter((url): url is string => Boolean(url))),
    );
    if (
      !name ||
      !/^[a-zA-Z0-9._-]+\.fpk$/.test(name) ||
      !/^[a-f0-9]{64}$/.test(sha256) ||
      !Number.isSafeInteger(size) ||
      size < 1 ||
      size > 250 * 1024 * 1024 ||
      !urls.length
    ) {
      throw new Error("版本清单中的安装包信息无效");
    }
    asset = { name, sha256, size, urls };
  }

  return { asset, publishedAt, releaseNotes, releaseUrl, version };
}

function repositorySlug(url: string): { owner: string; repo: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") return null;
    const [owner, repo] = parsed.pathname.split("/").filter(Boolean);
    return owner && repo ? { owner, repo } : null;
  } catch {
    return null;
  }
}

export function updateManifestSources(): string[] {
  const configured: Array<string | undefined> =
    buildEnvironment?.VITE_UPDATE_MANIFEST_URLS?.split(",") ?? [
      buildEnvironment?.VITE_UPDATE_MANIFEST_URL,
    ];
  const explicit = configured
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value && /^https:\/\//.test(value)));
  if (explicit.length) return Array.from(new Set(explicit));
  const slug = repositorySlug(PROJECT_REPOSITORY_URL);
  if (!slug) return [];
  const repository = `${slug.owner}/${slug.repo}`;
  const raw = `https://raw.githubusercontent.com/${repository}/main/version.json`;
  const latest = `https://github.com/${repository}/releases/latest/download/version.json`;
  return [
    latest,
    raw,
  ];
}

export async function fetchLatestAppUpdate(
  sources = updateManifestSources(),
): Promise<AppUpdate> {
  if (!sources.length) throw new Error("检查更新失败：未配置版本清单");
  const attempts = sources.map(async (source) => {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), 8000);
    try {
      const separator = source.includes("?") ? "&" : "?";
      const response = await fetch(`${source}${separator}t=${Date.now()}`, {
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.url.startsWith("https://")) throw new Error("版本清单来源不安全");
      return parseUpdateManifest(await response.json());
    } finally {
      globalThis.clearTimeout(timeout);
    }
  });
  try {
    return await Promise.any(attempts);
  } catch {
    throw new Error("检查更新失败：版本服务暂时不可达");
  }
}
