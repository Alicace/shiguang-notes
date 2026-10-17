import { useEffect, useState } from "react";
import { appFetch, isNative } from "../lib/fnos-client.js";

export interface ManagedUser {
  createdAt: number;
  disabled: boolean;
  hasPassword: boolean;
  id: string;
  kind: "nas" | "app";
  uid?: number;
  username: string;
}

export interface Space {
  id: string;
  members: Record<string, "editor" | "viewer">;
  name: string;
  ownerId: string;
}

export interface NativeSession {
  csrfToken?: string;
  simulation: boolean;
  systemApiConfigured: boolean;
  user: NativeUser;
  writable?: boolean;
}

export interface NativeUser {
  isAdmin: boolean;
  uid: number;
  username: string;
}

// 原生设置的每个面板都要知道当前身份与「系统 API 是否就绪」，统一在这里读一次。
export function useNativeSession(): NativeSession | null {
  const [session, setSession] = useState<NativeSession | null>(null);

  useEffect(() => {
    if (!isNative) return;
    let active = true;

    nativeJson<NativeSession>("/api/session")
      .then((value) => {
        if (active) setSession(value);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  return session;
}

export class NativeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "NativeApiError";
  }
}

// 原生设置的四个面板共用这一层薄封装：统一错误文案与 JSON 读法。
export async function nativeJson<T>(
  route: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await appFetch(route, init);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new NativeApiError(
      (data as { error?: string }).error || "操作失败，请稍后重试。",
      response.status,
    );
  }

  return data as T;
}

export const nativeWrite = (body: object, method = "POST"): RequestInit => ({
  body: JSON.stringify(body),
  headers: { "Content-Type": "application/json" },
  method,
});

export function formatAccountDate(createdAt: number): string {
  return new Date(createdAt).toLocaleDateString("zh-CN");
}
