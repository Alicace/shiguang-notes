import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";

const MAX_REDIRECTS = 4;
const REQUEST_TIMEOUT_MS = 15_000;

function privateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && b === 51 && parts[2] === 100) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 203 && b === 0 && parts[2] === 113) ||
    a >= 224
  );
}

export function isPrivateNetworkAddress(address: string): boolean {
  let normalized = address.toLowerCase().split("%")[0];
  if (isIP(normalized) === 4) return privateIpv4(normalized);
  if (isIP(normalized) !== 6) return true;
  try {
    normalized = new URL(`http://[${normalized}]/`).hostname.slice(1, -1);
  } catch {
    return true;
  }
  if (normalized === "::" || normalized === "::1") return true;
  if (
    normalized.startsWith("::") ||
    normalized.startsWith("64:ff9b:") ||
    normalized.startsWith("2002:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff") ||
    normalized === "2001:db8" ||
    normalized.startsWith("2001:db8:")
  ) {
    return true;
  }
  return false;
}

const publicLookup = (async (
  hostname: string,
  options: Parameters<LookupFunction>[1],
  callback: Parameters<LookupFunction>[2],
) => {
  try {
    const addresses = await dnsLookup(hostname, {
      all: true,
      verbatim: true,
    });
    if (!addresses.length || addresses.some(({ address }) => isPrivateNetworkAddress(address))) {
      const error = Object.assign(
        new Error("远端图片地址解析到私有或保留网络"),
        { code: "EACCES" },
      );
      callback(error, "", 0);
      return;
    }
    const requestedFamily =
      typeof options === "object" && options.family ? Number(options.family) : 0;
    const selected =
      addresses.find(({ family }) => !requestedFamily || family === requestedFamily) ||
      addresses[0];
    callback(null, selected.address, selected.family);
  } catch (error) {
    callback(error as NodeJS.ErrnoException, "", 0);
  }
}) as LookupFunction;

const allowedPrivateLookup = (async (
  hostname: string,
  options: Parameters<LookupFunction>[1],
  callback: Parameters<LookupFunction>[2],
) => {
  try {
    const addresses = await dnsLookup(hostname, {
      all: true,
      verbatim: true,
    });
    const requestedFamily =
      typeof options === "object" && options.family ? Number(options.family) : 0;
    const selected =
      addresses.find(({ family }) => !requestedFamily || family === requestedFamily) ||
      addresses[0];
    if (!selected) throw new Error("远端图片地址无法解析");
    callback(null, selected.address, selected.family);
  } catch (error) {
    callback(error as NodeJS.ErrnoException, "", 0);
  }
}) as LookupFunction;

type RemoteImageResponse = {
  buffer: Buffer;
  contentType: string | null;
  finalUrl: string;
};

function requestImage(
  url: URL,
  maxBytes: number,
  allowPrivateHost?: string,
): Promise<RemoteImageResponse | { redirect: string }> {
  return new Promise((resolve, reject) => {
    const effectivePort = url.port || (url.protocol === "https:" ? "443" : "80");
    const isAllowedPrivateHost =
      allowPrivateHost === `${url.hostname}:${effectivePort}`;
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(
      {
        headers: {
          Accept: "image/*",
          "User-Agent": "ShiguangNotes remote image import",
        },
        hostname: url.hostname,
        lookup: isAllowedPrivateHost ? allowedPrivateLookup : publicLookup,
        method: "GET",
        path: `${url.pathname}${url.search}`,
        port: url.port || undefined,
        protocol: url.protocol,
        servername: url.protocol === "https:" ? url.hostname : undefined,
      },
      (response) => {
        const status = response.statusCode || 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          const redirect = new URL(response.headers.location, url).toString();
          response.resume();
          resolve({ redirect });
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`图片下载失败（HTTP ${status}）`));
          return;
        }
        const declared = Number(response.headers["content-length"] || 0);
        if (declared > maxBytes) {
          response.destroy();
          reject(new Error("远端图片超过大小限制"));
          return;
        }
        const chunks: Buffer[] = [];
        let received = 0;
        response.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > maxBytes) {
            response.destroy(new Error("远端图片超过大小限制"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({
            buffer: Buffer.concat(chunks, received),
            contentType: response.headers["content-type"] || null,
            finalUrl: url.toString(),
          }),
        );
        response.on("error", reject);
      },
    );
    request.setTimeout(REQUEST_TIMEOUT_MS, () =>
      request.destroy(new Error("远端图片下载超时")),
    );
    request.on("error", reject);
    request.end();
  });
}

export async function downloadRemoteImage(
  source: string,
  maxBytes: number,
  options: { allowPrivateHost?: string } = {},
): Promise<RemoteImageResponse> {
  let current: URL;
  try {
    current = new URL(source);
  } catch {
    throw new Error("远端图片地址格式不正确");
  }
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    if (
      !["http:", "https:"].includes(current.protocol) ||
      current.username ||
      current.password
    ) {
      throw new Error("远端图片地址不安全");
    }
    const literalHost = current.hostname.replace(/^\[|\]$/g, "");
    const effectivePort = current.port || (current.protocol === "https:" ? "443" : "80");
    const allowPrivate = options.allowPrivateHost === `${current.hostname}:${effectivePort}`;
    if (
      !allowPrivate &&
      isIP(literalHost) &&
      isPrivateNetworkAddress(literalHost)
    ) {
      throw new Error("远端图片地址解析到私有或保留网络");
    }
    const result = await requestImage(
      current,
      maxBytes,
      options.allowPrivateHost,
    );
    if (!("redirect" in result)) return result;
    current = new URL(result.redirect);
  }
  throw new Error("远端图片重定向次数过多");
}
