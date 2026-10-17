import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { appPath, isNative } from "../lib/fnos-client.js";
import { nativeJson, nativeWrite } from "../native/api.js";
import {
  fetchLatestAppUpdate,
  isNewerVersion,
  type AppUpdate,
} from "./app-update.js";
import {
  DEFAULT_UPDATE_INTERVAL_HOURS,
  isUpdateCheckDue,
  markUpdateChecked,
  readLastUpdateCheck,
  readUpdateInterval,
  writeUpdateInterval,
  type UpdateIntervalHours,
} from "./update-preferences.js";

export type AppUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "current"
  | "downloading"
  | "installing"
  | "waiting-restart"
  | "ready"
  | "error";

export interface AppUpdateProgress {
  percent: number;
  receivedBytes: number;
  source: string;
  speedBytesPerSecond: number;
  stage: "connecting" | "downloading" | "verifying";
  totalBytes: number;
}

interface NativeUpdateResponse {
  currentVersion: string;
  hasUpdate: boolean;
  installable: boolean;
  latest: AppUpdate;
}

interface UpdateJobResponse {
  error?: string;
  path?: string;
  progress: AppUpdateProgress;
  repeated: boolean;
  source?: string;
  status: "queued" | "downloading" | "ready" | "error";
  version: string;
}

export interface AppUpdateContextValue {
  checkForUpdates: (manual?: boolean) => Promise<void>;
  closePrompt: () => void;
  currentVersion: string;
  dismissPrompt: () => void;
  downloadAndInstallUpdate: () => Promise<void>;
  installerPath: string;
  intervalHours: UpdateIntervalHours;
  isAdmin: boolean;
  isPromptOpen: boolean;
  latestUpdate: AppUpdate | null;
  lastCheckedAt: number;
  message: string;
  openInstaller: () => Promise<void>;
  openPrompt: () => void;
  progress: AppUpdateProgress | null;
  setIntervalHours: (value: UpdateIntervalHours) => void;
  status: AppUpdateStatus;
}

const DEFAULT_PROGRESS: AppUpdateProgress = {
  percent: 0,
  receivedBytes: 0,
  source: "",
  speedBytesPerSecond: 0,
  stage: "connecting",
  totalBytes: 0,
};

const fallbackContext: AppUpdateContextValue = {
  checkForUpdates: async () => undefined,
  closePrompt: () => undefined,
  currentVersion: "",
  dismissPrompt: () => undefined,
  downloadAndInstallUpdate: async () => undefined,
  installerPath: "",
  intervalHours: DEFAULT_UPDATE_INTERVAL_HOURS,
  isAdmin: false,
  isPromptOpen: false,
  latestUpdate: null,
  lastCheckedAt: 0,
  message: "",
  openInstaller: async () => undefined,
  openPrompt: () => undefined,
  progress: null,
  setIntervalHours: () => undefined,
  status: "idle",
};

const AppUpdateContext = createContext<AppUpdateContextValue>(fallbackContext);

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

export function useAppUpdate(): AppUpdateContextValue {
  return useContext(AppUpdateContext);
}

export function AppUpdateProvider({
  appVersion,
  children,
}: {
  appVersion: string;
  children: ReactNode;
}) {
  const [status, setStatus] = useState<AppUpdateStatus>("idle");
  const [latestUpdate, setLatestUpdate] = useState<AppUpdate | null>(null);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<AppUpdateProgress | null>(null);
  const [installerPath, setInstallerPath] = useState("");
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [dismissedVersion, setDismissedVersion] = useState(() =>
    typeof sessionStorage === "undefined"
      ? ""
      : sessionStorage.getItem("shiguang.update.dismissedVersion") || "",
  );
  const [isAdmin, setIsAdmin] = useState(false);
  const [intervalHours, setIntervalHoursState] =
    useState<UpdateIntervalHours>(readUpdateInterval);
  const [lastCheckedAt, setLastCheckedAt] = useState(readLastUpdateCheck);
  const checkingRef = useRef(false);
  const intervalRef = useRef(intervalHours);

  useEffect(() => {
    intervalRef.current = intervalHours;
  }, [intervalHours]);

  useEffect(() => {
    if (!isNative) return;
    let active = true;
    const refreshSession = async () => {
      try {
        const session = await nativeJson<{
          user: { isAdmin: boolean };
        }>("/api/session");
        if (active) setIsAdmin(session.user.isAdmin);
      } catch {
        if (active) setIsAdmin(false);
      }
    };
    void refreshSession();
    const timer = globalThis.setInterval(refreshSession, 30_000);
    return () => {
      active = false;
      globalThis.clearInterval(timer);
    };
  }, []);

  const checkForUpdates = useCallback(
    async (manual = false) => {
      if (!appVersion || checkingRef.current) return;
      checkingRef.current = true;
      setStatus("checking");
      setMessage(manual ? "正在检查新版本…" : "正在后台检查新版本…");
      try {
        let next: AppUpdate;
        let newer: boolean;
        if (isNative) {
          const response = await nativeJson<NativeUpdateResponse>(
            "/api/fnos/update?force=1",
          );
          next = response.latest;
          newer = response.hasUpdate;
        } else {
          next = await fetchLatestAppUpdate();
          newer = isNewerVersion(next.version, appVersion);
        }
        setLatestUpdate(next);
        if (newer) {
          setStatus("available");
          setMessage(`发现新版本 ${next.version}`);
          if (manual) setIsPromptOpen(true);
        } else {
          setStatus("current");
          setMessage(`已是最新版本 ${appVersion}`);
        }
      } catch (error) {
        setStatus("error");
        setMessage(
          error instanceof Error ? error.message : "检查更新失败，请稍后重试。",
        );
      } finally {
        checkingRef.current = false;
        markUpdateChecked();
        setLastCheckedAt(Date.now());
      }
    },
    [appVersion],
  );

  useEffect(() => {
    if (!isNative || !appVersion) return;
    let active = true;
    let checkedOnOpen = false;
    const runDueCheck = () => {
      if (
        checkedOnOpen &&
        active &&
        isUpdateCheckDue(intervalRef.current, readLastUpdateCheck())
      ) {
        void checkForUpdates(false);
      }
    };
    // 登录页先完成身份确认，进入工作区后每次启动立即检查一次。
    const firstCheck = globalThis.setInterval(() => {
      if (!active || checkedOnOpen || !document.querySelector(".app-layout")) {
        return;
      }
      checkedOnOpen = true;
      globalThis.clearInterval(firstCheck);
      void checkForUpdates(false);
    }, 500);
    const timer = globalThis.setInterval(runDueCheck, 60_000);
    return () => {
      active = false;
      globalThis.clearInterval(firstCheck);
      globalThis.clearInterval(timer);
    };
  }, [appVersion, checkForUpdates]);

  useEffect(() => {
    if (
      status === "available" &&
      latestUpdate &&
      latestUpdate.version !== dismissedVersion
    ) {
      setIsPromptOpen(true);
    }
  }, [dismissedVersion, latestUpdate, status]);

  const waitForNewVersion = useCallback(async (oldVersion: string) => {
    setStatus("waiting-restart");
    setMessage(
      "安装器已打开。请在飞牛确认升级，安装完成后页面会自动刷新。",
    );
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await wait(2_000);
      try {
        const response = await fetch(appPath("/api/program-info"), {
          cache: "no-store",
        });
        if (!response.ok) continue;
        const info = (await response.json()) as { appVersion?: string };
        if (info.appVersion && info.appVersion !== oldVersion) {
          setMessage(`已升级到 ${info.appVersion}，正在重新启动应用…`);
          globalThis.location.reload();
          return;
        }
      } catch {
        // 应用升级期间服务会短暂断开，继续等待新进程恢复。
      }
    }
    setStatus("ready");
    setMessage("安装包已下载并校验，请完成飞牛安装器中的确认步骤。");
  }, []);

  const launchInstaller = useCallback(async (path: string) => {
    if (!path) return;
    setStatus("installing");
    setMessage("正在打开飞牛安装器…");
    try {
      const { TrimApp } = await import("@trimjs/web-app");
      const app = new TrimApp();
      await app.ready();
      try {
        await app.openFile(path);
      } catch {
        await app.openFileManager(path);
        setMessage(
          "安装包已通过校验并定位到文件管理器，请双击 FPK 完成飞牛升级。",
        );
        setStatus("ready");
        return;
      }
      await waitForNewVersion(appVersion);
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error
          ? `无法打开安装器：${error.message}`
          : "无法打开飞牛安装器。",
      );
    }
  }, [appVersion, waitForNewVersion]);

  const openInstaller = useCallback(async () => {
    await launchInstaller(installerPath);
  }, [installerPath, launchInstaller]);

  const downloadAndInstallUpdate = useCallback(async () => {
    if (!latestUpdate || ["checking", "downloading", "installing", "waiting-restart"].includes(status)) {
      return;
    }
    if (!isNative || !isAdmin || !latestUpdate.asset) {
      globalThis.open(latestUpdate.releaseUrl, "_blank", "noopener,noreferrer");
      return;
    }
    setIsPromptOpen(true);
    setStatus("downloading");
    setProgress(DEFAULT_PROGRESS);
    setMessage("正在选择最快的下载线路…");
    setInstallerPath("");
    try {
      const started = await nativeJson<{
        jobId?: string;
        path?: string;
        reused?: boolean;
      }>("/api/fnos/update/download", nativeWrite({}));
      if (!started.jobId) {
        if (!started.path) throw new Error("下载任务未返回安装包路径。");
        setInstallerPath(started.path);
        setStatus("ready");
        await waitForNewVersion(appVersion);
        return;
      }
      for (let attempt = 0; attempt < 1_200; attempt += 1) {
        await wait(500);
        const job = await nativeJson<UpdateJobResponse>(
          `/api/fnos/update/download/${started.jobId}`,
        );
        setProgress(job.progress);
        if (job.status === "error") {
          throw new Error(job.error || "安装包下载失败。");
        }
        if (job.status === "ready") {
          if (!job.path) throw new Error("下载完成但没有安装包路径。");
          setInstallerPath(job.path);
          setStatus("ready");
          setMessage("安装包已通过 SHA-256 校验，正在启动安装器…");
          await wait(150);
          await launchInstaller(job.path);
          return;
        }
        if (job.progress.stage === "verifying") {
          setMessage("下载完成，正在校验安装包完整性…");
        } else if (job.progress.stage === "connecting") {
          setMessage(
            job.progress.source
              ? `正在连接 ${job.progress.source}…`
              : "正在选择最快的下载线路…",
          );
        } else {
          setMessage(
            `正在从 ${job.progress.source || "镜像"} 下载 ${job.progress.percent}%`,
          );
        }
      }
      throw new Error("下载等待超时，请检查 NAS 网络后重试。");
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error ? error.message : "安装包下载失败，请稍后重试。",
      );
    }
  }, [
    appVersion,
    isAdmin,
    latestUpdate,
    launchInstaller,
    status,
    waitForNewVersion,
  ]);

  const setIntervalHours = useCallback((value: UpdateIntervalHours) => {
    writeUpdateInterval(value);
    setIntervalHoursState(value);
    intervalRef.current = value;
  }, []);

  const dismissPrompt = useCallback(() => {
    if (latestUpdate) {
      setDismissedVersion(latestUpdate.version);
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.setItem(
          "shiguang.update.dismissedVersion",
          latestUpdate.version,
        );
      }
    }
    setIsPromptOpen(false);
  }, [latestUpdate]);

  const value: AppUpdateContextValue = {
    checkForUpdates,
    closePrompt: () => setIsPromptOpen(false),
    currentVersion: appVersion,
    dismissPrompt,
    downloadAndInstallUpdate,
    installerPath,
    intervalHours,
    isAdmin,
    isPromptOpen,
    latestUpdate,
    lastCheckedAt,
    message,
    openInstaller,
    openPrompt: () => setIsPromptOpen(true),
    progress,
    setIntervalHours,
    status,
  };

  return (
    <AppUpdateContext.Provider value={value}>
      {children}
    </AppUpdateContext.Provider>
  );
}
