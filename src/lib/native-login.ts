import { isNative } from "./fnos-client.js";

// 只在原生应用里记录「这台设备已经确认过一次登录」，用于让首开登录页只出现一次。
const NATIVE_LOGIN_STORAGE_KEY = "notes.nativeLogin";
const NATIVE_LOGOUT_STORAGE_KEY = "notes.nativeLoginLoggedOut";

export function hasNativeLoginConsent(): boolean {
  if (!isNative || typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(NATIVE_LOGIN_STORAGE_KEY) === "yes";
  } catch {
    return false;
  }
}

export function rememberNativeLoginConsent(): void {
  if (!isNative || typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(NATIVE_LOGIN_STORAGE_KEY, "yes");
    window.localStorage.removeItem(NATIVE_LOGOUT_STORAGE_KEY);
  } catch {
    // 隐私模式下写不进去也只影响下一次打开是否再确认一次。
  }
}

export function forgetNativeLoginConsent(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(NATIVE_LOGIN_STORAGE_KEY);
    window.localStorage.setItem(NATIVE_LOGOUT_STORAGE_KEY, "yes");
  } catch {
    // 忽略存储不可用。
  }
}

export function shouldAutoUseNasLogin(): boolean {
  if (!isNative || typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(NATIVE_LOGOUT_STORAGE_KEY) !== "yes";
  } catch {
    return true;
  }
}
