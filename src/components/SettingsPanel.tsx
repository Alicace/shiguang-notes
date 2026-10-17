import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  DEFAULT_FOOTER_BRAND,
  DEFAULT_FOOTER_LOGO_URL,
  DEFAULT_FOOTER_VIA,
  FOOTER_TEXT_MAX_LENGTH,
} from "../lib/footer.js";
import { importImageFile } from "../lib/images.js";
import { HERMES_SKILL_INSTALL_INSTRUCTION_PREVIEW } from "../lib/hermes.js";
import { THEME_OPTIONS } from "../lib/themes.js";
import {
  fetchLatestAppUpdate,
  isNewerVersion,
  PROJECT_REPOSITORY_URL,
  UPSTREAM_REPOSITORY_URL,
  type AppUpdate,
} from "../lib/app-update.js";
import {
  getWechatConnectionStatus,
  getWechatConfiguration,
  saveWechatConfiguration,
} from "../lib/wechat-config.js";
import type { WorkspaceArchiveProgress } from "../lib/export.js";
import type { ThemePreferenceId } from "../types/app.js";
import { isNative, appPath } from "../lib/fnos-client.js";
import { NativeSettings } from "../native/NativeSettings.js";
import { NativeServiceConfig } from "../native/NativeServiceConfig.js";
import { SpacesPanel } from "../native/SpacesPanel.js";
import { FileAccessPanel } from "../native/FileAccessPanel.js";
import { UserManagement } from "../native/UserManagement.js";
import { nativeJson, nativeWrite, useNativeSession } from "../native/api.js";

interface SettingsPanelProps {
  onNativeSpaceChange?: (scope: string) => Promise<void>;
  aiAvailable?: boolean;
  aiEnabled?: boolean;
  appPasswordConfigured?: boolean;
  appVersion?: string;
  authUsername?: string | null;
  canConfigureWechat?: boolean;
  canChangePassword?: boolean;
  cloudStatusLabel?: string;
  footerBrand?: string;
  footerLogoUrl?: string;
  footerVia?: string;
  hermesSkillLinkActionState?:
    | "idle"
    | "copying"
    | "copied"
    | "resetting"
    | "reset";
  isHermesSkillDownloading?: boolean;
  isWorkspaceArchiveExporting?: boolean;
  selectedTheme: ThemePreferenceId;
  workspaceArchiveError?: string;
  workspaceArchiveProgress?: WorkspaceArchiveProgress | null;
  onAiEnabledChange?: (enabled: boolean) => void;
  onChangePassword?: () => void;
  onClose: () => void;
  onFooterBrandChange?: (footerBrand: string) => void;
  onFooterLogoChange?: (footerLogoUrl: string) => void;
  onFooterViaChange?: (footerVia: string) => void;
  onHermesSkillDownload?: () => void;
  onHermesSkillLinkCopy?: () => void;
  onHermesSkillLinkReset?: () => void;
  onLogin?: () => void;
  onLogout?: () => void;
  onThemeChange: (themeId: ThemePreferenceId) => void;
  onWorkspaceArchiveExport?: () => void;
}

const SETTINGS_CATEGORIES = [
  { id: "general", label: "常规" },
  { id: "personalization", label: "个性化" },
  { id: "account", label: "账号与同步" },
  { id: "spaces", label: "共享空间", nativeOnly: true },
  { id: "files", label: "文件授权", nativeOnly: true },
  { id: "extensions", label: "工具与扩展" },
  { id: "about", label: "关于" },
  { id: "fnos", label: "飞牛与诊断", nativeOnly: true },
] as const;

type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number]["id"];

const CHANGELOG_URL = appPath("/changelog");

type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "current"
  | "downloading"
  | "ready"
  | "error";

interface NativeUpdateResponse {
  currentVersion: string;
  hasUpdate: boolean;
  installable: boolean;
  latest: AppUpdate;
}

export function SettingsPanel({
  onNativeSpaceChange = async () => {},
  aiAvailable = false,
  aiEnabled = false,
  appVersion = "",
  appPasswordConfigured = true,
  authUsername = null,
  canConfigureWechat = false,
  canChangePassword = false,
  cloudStatusLabel = "数据仅保存在当前浏览器",
  footerBrand = DEFAULT_FOOTER_BRAND,
  footerLogoUrl = DEFAULT_FOOTER_LOGO_URL,
  footerVia = DEFAULT_FOOTER_VIA,
  hermesSkillLinkActionState = "idle",
  isHermesSkillDownloading = false,
  isWorkspaceArchiveExporting = false,
  selectedTheme,
  workspaceArchiveError = "",
  workspaceArchiveProgress = null,
  onAiEnabledChange = () => undefined,
  onChangePassword,
  onClose,
  onFooterBrandChange = () => undefined,
  onFooterLogoChange = () => undefined,
  onFooterViaChange = () => undefined,
  onHermesSkillDownload,
  onHermesSkillLinkCopy,
  onHermesSkillLinkReset,
  onLogin,
  onLogout,
  onThemeChange,
  onWorkspaceArchiveExport = () => undefined,
}: SettingsPanelProps) {
  const nativeSession = useNativeSession();
  const [category, setCategory] = useState<SettingsCategory>("general");
  const [isFooterLogoUploading, setIsFooterLogoUploading] = useState(false);
  const [footerLogoError, setFooterLogoError] = useState("");
  const [wechatAppId, setWechatAppId] = useState("");
  const [wechatAppSecret, setWechatAppSecret] = useState("");
  const [wechatConfigurationError, setWechatConfigurationError] = useState("");
  const [wechatConfigurationState, setWechatConfigurationState] = useState<
    "idle" | "loading" | "ready" | "saving" | "saved"
  >("idle");
  const [wechatConnectionState, setWechatConnectionState] = useState<
    "idle" | "checking" | "connected" | "failed"
  >("idle");
  const [wechatConnectionError, setWechatConnectionError] = useState("");
  const [isWechatAppSecretVisible, setIsWechatAppSecretVisible] =
    useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [latestUpdate, setLatestUpdate] = useState<AppUpdate | null>(null);
  const [updateMessage, setUpdateMessage] = useState("");
  const [installerPath, setInstallerPath] = useState("");
  const footerLogoInputRef = useRef<HTMLInputElement | null>(null);
  const updateCheckStartedRef = useRef(false);
  const isDefaultFooterLogo = footerLogoUrl === DEFAULT_FOOTER_LOGO_URL;
  const isDefaultFooter =
    footerBrand === DEFAULT_FOOTER_BRAND &&
    isDefaultFooterLogo &&
    footerVia === DEFAULT_FOOTER_VIA;
  const accountInitial =
    authUsername?.trim().charAt(0).toLocaleUpperCase("zh-CN") || "便";

  async function checkForUpdates(): Promise<void> {
    if (!appVersion || ["checking", "downloading"].includes(updateStatus)) return;
    setUpdateStatus("checking");
    setUpdateMessage("");
    setInstallerPath("");
    try {
      let next: AppUpdate;
      let newer: boolean;
      if (isNative) {
        const response = await nativeJson<NativeUpdateResponse>("/api/fnos/update");
        next = response.latest;
        newer = response.hasUpdate;
      } else {
        next = await fetchLatestAppUpdate();
        newer = isNewerVersion(next.version, appVersion);
      }
      setLatestUpdate(next);
      if (newer) {
        setUpdateStatus("available");
        setUpdateMessage(`发现新版本 ${next.version}`);
      } else {
        setUpdateStatus("current");
        setUpdateMessage(`已是最新版本 ${appVersion}`);
      }
    } catch (error) {
      setLatestUpdate(null);
      setUpdateStatus("error");
      setUpdateMessage(
        error instanceof Error ? error.message : "检查更新失败，请稍后重试。",
      );
    }
  }

  async function downloadAndInstallUpdate(): Promise<void> {
    if (!latestUpdate || ["checking", "downloading"].includes(updateStatus)) return;
    if (!isNative || !nativeSession?.user.isAdmin || !latestUpdate.asset) {
      window.open(latestUpdate.releaseUrl, "_blank", "noopener,noreferrer");
      return;
    }
    setUpdateStatus("downloading");
    setUpdateMessage("正在通过加速线路下载并校验安装包…");
    try {
      const result = await nativeJson<{ path: string; reused: boolean }>(
        "/api/fnos/update/download",
        nativeWrite({}),
      );
      setInstallerPath(result.path);
      setUpdateStatus("ready");
      setUpdateMessage("安装包已通过 SHA-256 校验，正在打开飞牛安装器…");
      const { TrimApp } = await import("@trimjs/web-app");
      const app = new TrimApp();
      try {
        await app.openFile(result.path);
      } catch {
        await app.openFileManager(result.path).catch(() => undefined);
        setUpdateMessage(
          "安装包已下载并校验。请在飞牛应用中心手动选择该 FPK 完成升级。",
        );
      }
    } catch (error) {
      setUpdateStatus("error");
      setUpdateMessage(
        error instanceof Error ? error.message : "安装包下载失败，请稍后重试。",
      );
    }
  }

  useEffect(() => {
    if (updateCheckStartedRef.current || !appVersion) return;
    updateCheckStartedRef.current = true;
    void checkForUpdates();
    // appVersion 是本次安装的固定版本号；只在设置面板首次打开时自动检查一次。
  }, [appVersion]);

  useEffect(() => {
    let cancelled = false;

    if (!canConfigureWechat) {
      setWechatAppId("");
      setWechatAppSecret("");
      setWechatConfigurationError("");
      setWechatConfigurationState("idle");
      setWechatConnectionState("idle");
      setWechatConnectionError("");
      setIsWechatAppSecretVisible(false);
      return () => {
        cancelled = true;
      };
    }

    setWechatConfigurationState("loading");
    setWechatConfigurationError("");
    setWechatConnectionState("idle");
    setWechatConnectionError("");

    void getWechatConfiguration()
      .then(async (configuration) => {
        if (cancelled) {
          return;
        }

        setWechatAppId(configuration.appId);
        setWechatAppSecret(configuration.appSecret);

        if (configuration.appId && configuration.appSecret) {
          setWechatConnectionState("checking");

          try {
            const status = await getWechatConnectionStatus();

            if (cancelled) {
              return;
            }

            setWechatConnectionState(
              status.connected ? "connected" : "failed",
            );
            setWechatConnectionError(status.connectionError || "");
          } catch (error) {
            if (cancelled) {
              return;
            }

            setWechatConnectionState("failed");
            setWechatConnectionError(
              error instanceof Error ? error.message : "检查公众号连接失败。",
            );
          }
        }

        setWechatConfigurationState("ready");
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setWechatConfigurationError(
          error instanceof Error ? error.message : "读取公众号配置失败。",
        );
        setWechatConfigurationState("ready");
      });

    return () => {
      cancelled = true;
    };
  }, [authUsername, canConfigureWechat]);

  async function handleWechatConfigurationSave() {
    try {
      setWechatConfigurationState("saving");
      setWechatConfigurationError("");
      setWechatConnectionState("checking");
      setWechatConnectionError("");
      const configuration = await saveWechatConfiguration(
        wechatAppId,
        wechatAppSecret,
      );
      setWechatAppId(configuration.appId);
      setWechatAppSecret(configuration.appSecret);
      setWechatConnectionState(
        configuration.connected ? "connected" : "failed",
      );
      setWechatConnectionError(configuration.connectionError || "");
      setWechatConfigurationState("saved");
    } catch (error) {
      setWechatConfigurationError(
        error instanceof Error ? error.message : "保存公众号配置失败。",
      );
      setWechatConfigurationState("ready");
      setWechatConnectionState("failed");
    }
  }

  async function handleFooterLogoFileChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const input = event.currentTarget;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    try {
      setIsFooterLogoUploading(true);
      setFooterLogoError("");
      const imported = await importImageFile(file);
      onFooterLogoChange(imported.path);
    } catch (error) {
      setFooterLogoError(
        error instanceof Error ? error.message : "Logo 上传失败",
      );
    } finally {
      setIsFooterLogoUploading(false);
      input.value = "";
    }
  }

  return (
    <div
      className="settings-modal-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        id="app-settings-panel"
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-settings-title"
        data-settings-category={category}
      >
        <header className="settings-panel-header">
          <h2 id="app-settings-title">设置</h2>
          <button
            type="button"
            className="settings-close"
            data-diag-action="settings.close"
            aria-label="关闭设置"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="settings-layout">
          <nav className="settings-category-nav" aria-label="设置分类">
            {SETTINGS_CATEGORIES.filter(
              (item) => !("nativeOnly" in item) || isNative,
            ).map((item) => {
              const isActive = category === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  className={isActive ? "active" : undefined}
                  aria-current={isActive ? "page" : undefined}
                  aria-controls={`settings-pane-${item.id}`}
                  data-diag-action="settings.category"
                  onClick={() => setCategory(item.id)}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="settings-content">
            {isNative && (
              <section
                id="settings-pane-spaces"
                className="settings-pane"
                hidden={category !== "spaces"}
              >
                <SpacesPanel onSpaceChange={onNativeSpaceChange} />
              </section>
            )}
            {isNative && (
              <section
                id="settings-pane-files"
                className="settings-pane"
                hidden={category !== "files"}
              >
                <FileAccessPanel />
              </section>
            )}
            {isNative && (
              <section
                id="settings-pane-fnos"
                className="settings-pane"
                hidden={category !== "fnos"}
              >
                <NativeSettings />
              </section>
            )}
            <section
              id="settings-pane-general"
              className="settings-pane"
              aria-labelledby="settings-general-title"
              hidden={category !== "general"}
            >
              <header className="settings-pane-header">
                <h3 id="settings-general-title">常规</h3>
                <p>调整便签的外观和日常使用体验。</p>
              </header>

              <section className="settings-group" aria-label="外观">
                <div className="settings-group-heading">
                  <strong>外观</strong>
                  <small>选择适合当前环境的便签纸张风格。</small>
                </div>
                <div className="settings-card settings-theme-list">
                  {THEME_OPTIONS.map((option) => {
                    const isActive = option.id === selectedTheme;

                    return (
                      <button
                        key={option.id}
                        type="button"
                        className={`settings-theme-row${isActive ? " active" : ""}`}
                        aria-pressed={isActive}
                        onClick={() => onThemeChange(option.id)}
                      >
                        <span
                          className={`settings-theme-swatch settings-theme-swatch-${option.id}`}
                          aria-hidden="true"
                        />
                        <span className="settings-theme-copy">
                          <strong>{option.description}</strong>
                          <span>{option.label}</span>
                        </span>
                        <span className="settings-theme-check" aria-hidden="true">
                          {isActive ? "✓" : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            </section>

            <section
              id="settings-pane-personalization"
              className="settings-pane"
              aria-labelledby="settings-personalization-title"
              hidden={category !== "personalization"}
            >
              <header className="settings-pane-header">
                <h3 id="settings-personalization-title">个性化</h3>
                <p>定制导出图片和公众号内容中的便签署名。</p>
              </header>

              <div className="settings-footer-page">
                <div
                  className="settings-footer-preview"
                  aria-label="便签底部文字预览"
                >
                  <span className="settings-footer-preview-frame is-outer" />
                  <span className="settings-footer-preview-frame is-inner" />
                  <span className="settings-footer-preview-corner is-top-left" />
                  <span className="settings-footer-preview-corner is-top-right" />
                  <span className="settings-footer-preview-corner is-bottom-left" />
                  <span className="settings-footer-preview-corner is-bottom-right" />
                  <div className="settings-footer-preview-copy">
                    <img
                      className={isDefaultFooterLogo ? "is-default-footer-logo" : undefined}
                      src={footerLogoUrl}
                      alt=""
                      aria-hidden="true"
                      draggable={false}
                    />
                    <strong>{footerBrand || "\u00a0"}</strong>
                    <span>{footerVia || "\u00a0"}</span>
                  </div>
                </div>

                <section
                  className="settings-card settings-footer-logo-card"
                  aria-label="便签底部 Logo"
                >
                  <img
                    className={isDefaultFooterLogo ? "is-default-footer-logo" : undefined}
                    src={footerLogoUrl}
                    alt="当前便签底部 Logo"
                    draggable={false}
                  />
                  <span className="settings-footer-logo-copy">
                    <strong>底部 Logo</strong>
                    <small>支持 PNG、JPG、WebP 或 GIF</small>
                  </span>
                  <span className="settings-footer-logo-actions">
                    <input
                      ref={footerLogoInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      aria-label="选择便签底部 Logo 图片"
                      hidden
                      onChange={(event) => {
                        void handleFooterLogoFileChange(event);
                      }}
                    />
                    <button
                      type="button"
                      disabled={isFooterLogoUploading}
                      onClick={() => footerLogoInputRef.current?.click()}
                    >
                      {isFooterLogoUploading ? "上传中…" : "上传更换"}
                    </button>
                    <button
                      type="button"
                      disabled={footerLogoUrl === DEFAULT_FOOTER_LOGO_URL}
                      onClick={() => {
                        setFooterLogoError("");
                        onFooterLogoChange(DEFAULT_FOOTER_LOGO_URL);
                      }}
                    >
                      恢复默认
                    </button>
                  </span>
                  {footerLogoError ? (
                    <span className="settings-footer-logo-error" role="alert">
                      {footerLogoError}
                    </span>
                  ) : null}
                </section>

                <section
                  className="settings-card settings-footer-fields"
                  aria-label="编辑便签底部文字"
                >
                  <label className="settings-footer-field">
                    <span className="settings-footer-field-heading">
                      <strong>发送来源</strong>
                      <small>{footerBrand.length}/{FOOTER_TEXT_MAX_LENGTH}</small>
                    </span>
                    <input
                      type="text"
                      value={footerBrand}
                      maxLength={FOOTER_TEXT_MAX_LENGTH}
                      aria-label="便签底部发送来源"
                      placeholder={DEFAULT_FOOTER_BRAND}
                      onChange={(event) =>
                        onFooterBrandChange(event.target.value)
                      }
                    />
                  </label>
                  <label className="settings-footer-field">
                    <span className="settings-footer-field-heading">
                      <strong>via 文本</strong>
                      <small>{footerVia.length}/{FOOTER_TEXT_MAX_LENGTH}</small>
                    </span>
                    <input
                      type="text"
                      value={footerVia}
                      maxLength={FOOTER_TEXT_MAX_LENGTH}
                      aria-label="便签底部 via 文本"
                      placeholder={DEFAULT_FOOTER_VIA}
                      onChange={(event) => onFooterViaChange(event.target.value)}
                    />
                  </label>
                </section>

                <button
                  type="button"
                  className="settings-footer-reset"
                  disabled={isDefaultFooter}
                  onClick={() => {
                    onFooterBrandChange(DEFAULT_FOOTER_BRAND);
                    onFooterLogoChange(DEFAULT_FOOTER_LOGO_URL);
                    onFooterViaChange(DEFAULT_FOOTER_VIA);
                    setFooterLogoError("");
                  }}
                >
                  恢复默认页脚
                </button>
              </div>
            </section>

            <section
              id="settings-pane-account"
              className="settings-pane"
              aria-labelledby="settings-account-title"
              hidden={category !== "account"}
            >
              <header className="settings-pane-header">
                <h3 id="settings-account-title">账号与同步</h3>
                <p>管理登录状态、云端同步和账号安全。</p>
              </header>

              <section className="settings-card settings-account-card" aria-label="账号信息">
                {authUsername ? (
                  <>
                    <div className="settings-account-identity">
                      <span className="settings-account-avatar" aria-hidden="true">
                        {accountInitial}
                      </span>
                      <span className="settings-account-copy">
                        <strong>{authUsername}</strong>
                        <small>{cloudStatusLabel}</small>
                      </span>
                      <span className="settings-status-badge">已登录</span>
                    </div>
                    {canChangePassword ? (
                      <button
                        type="button"
                        className="settings-row"
                        onClick={onChangePassword}
                      >
                        <span className="settings-row-label">
                          {isNative && !appPasswordConfigured
                            ? "设置应用密码"
                            : "修改密码"}
                          <small>
                            {isNative
                              ? appPasswordConfigured
                                ? "更新密码后，其他设备和旧 Skill Token 会失效"
                                : "NAS 账号第一次设置不需要旧密码，设置后可用账号密码登录"
                              : "更新密码后，其他设备和旧 Skill Token 会失效"}
                          </small>
                        </span>
                        <span className="settings-row-value">
                          <span className="settings-row-chevron" aria-hidden="true">›</span>
                        </span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="settings-row settings-logout-row"
                      onClick={onLogout}
                    >
                      <span className="settings-row-label">
                        退出登录
                        {isNative ? <small>只退出拾光便签，不会退出飞牛 NAS 系统账号</small> : null}
                      </span>
                      <span className="settings-row-value">
                        <span className="settings-row-chevron" aria-hidden="true">›</span>
                      </span>
                    </button>
                  </>
                ) : (
                  <button type="button" className="settings-row" onClick={onLogin}>
                    <span className="settings-row-label">
                      登录账号
                      <small>{cloudStatusLabel}</small>
                    </span>
                    <span className="settings-row-value">
                      登录
                      <span className="settings-row-chevron" aria-hidden="true">›</span>
                    </span>
                  </button>
                )}
              </section>

              <section className="settings-group" aria-label="数据导出">
                <div className="settings-group-heading">
                  <strong>数据导出</strong>
                  <small>保存当前工作区的完整离线副本。</small>
                </div>
                <div className="settings-card settings-workspace-export-card">
                  <button
                    type="button"
                    className="settings-row settings-workspace-export-action"
                    disabled={isWorkspaceArchiveExporting}
                    onClick={onWorkspaceArchiveExport}
                  >
                    <span className="settings-row-label">
                      导出全部便签
                      <small>
                        保留文件夹层级，并把每张便签保存为 Markdown 及相关图片
                      </small>
                    </span>
                    <span className="settings-row-value">
                      {isWorkspaceArchiveExporting
                        ? `${workspaceArchiveProgress?.percent ?? 0}%`
                        : workspaceArchiveProgress?.percent === 100
                          ? "已完成"
                          : "导出 ZIP"}
                      <span className="settings-row-chevron" aria-hidden="true">›</span>
                    </span>
                  </button>
                  {workspaceArchiveProgress ? (
                    <div
                      className="settings-workspace-export-progress"
                      role="progressbar"
                      aria-label="全部便签导出进度"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={workspaceArchiveProgress.percent}
                    >
                      <span className="settings-workspace-export-progress-track">
                        <span
                          className="settings-workspace-export-progress-value"
                          style={{ width: `${workspaceArchiveProgress.percent}%` }}
                        />
                      </span>
                      <span className="settings-workspace-export-progress-copy">
                        {workspaceArchiveProgress.message}
                        {workspaceArchiveProgress.totalNotes > 0
                          ? ` · ${workspaceArchiveProgress.completedNotes}/${workspaceArchiveProgress.totalNotes} 张`
                          : ""}
                      </span>
                    </div>
                  ) : null}
                  {workspaceArchiveError ? (
                    <p className="settings-workspace-export-error" role="alert">
                      {workspaceArchiveError}
                    </p>
                  ) : null}
                </div>
              </section>

              {/* 用户管理属于账号范畴：与登录状态、密码放在同一个分类里。 */}
              {isNative ? <UserManagement /> : null}
            </section>

            <section
              id="settings-pane-extensions"
              className="settings-pane"
              aria-labelledby="settings-extensions-title"
              hidden={category !== "extensions"}
            >
              <header className="settings-pane-header">
                <h3 id="settings-extensions-title">工具与扩展</h3>
                <p>管理 AI 辅助能力和外部工具扩展。</p>
              </header>

              {isNative ? (
                <p className="settings-native-note">
                  飞牛网关会先校验 NAS 登录态。外部 Skill/DSH 需配置有效的 NAS
                  登录态及自己的应用 Token；应用 Token 不能代替 NAS 登录。PNG
                  由客户端生成，NAS 上不运行截图服务。
                </p>
              ) : null}

              {canConfigureWechat ? (
                <section className="settings-group" aria-label="公众号配置">
                  <div className="settings-group-heading">
                    <strong>公众号配置</strong>
                    <small>
                      配置后由服务端保存并用于公众号接口，不再读取 .env 中的
                      AppID 或 AppSecret。
                    </small>
                  </div>
                  <form
                    className="settings-card settings-wechat-configuration"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleWechatConfigurationSave();
                    }}
                  >
                    <label className="settings-wechat-field">
                      <span>AppID</span>
                      <input
                        type="text"
                        value={wechatAppId}
                        placeholder="wx1234567890abcdef"
                        aria-label="公众号 AppID"
                        autoComplete="off"
                        spellCheck={false}
                        disabled={wechatConfigurationState === "loading"}
                        onChange={(event) => {
                          setWechatAppId(event.target.value);
                          setWechatConfigurationState("ready");
                          setWechatConnectionState("idle");
                          setWechatConnectionError("");
                        }}
                      />
                    </label>
                    <label className="settings-wechat-field">
                      <span>AppSecret</span>
                      <span className="settings-wechat-secret-input">
                        <input
                          type={isWechatAppSecretVisible ? "text" : "password"}
                          value={wechatAppSecret}
                          placeholder="请输入 32 位 AppSecret"
                          aria-label="公众号 AppSecret"
                          autoComplete="off"
                          spellCheck={false}
                          disabled={wechatConfigurationState === "loading"}
                          onChange={(event) => {
                            setWechatAppSecret(event.target.value);
                            setWechatConfigurationState("ready");
                            setWechatConnectionState("idle");
                            setWechatConnectionError("");
                          }}
                        />
                        <button
                          type="button"
                          aria-label={
                            isWechatAppSecretVisible
                              ? "隐藏公众号 AppSecret"
                              : "显示公众号 AppSecret"
                          }
                          disabled={wechatConfigurationState === "loading"}
                          onClick={() =>
                            setIsWechatAppSecretVisible((visible) => !visible)
                          }
                        >
                          {isWechatAppSecretVisible ? "隐藏" : "显示"}
                        </button>
                      </span>
                    </label>
                    <div className="settings-wechat-actions">
                      <span aria-live="polite">
                        {wechatConfigurationError ? (
                          <span className="settings-wechat-error" role="alert">
                            {wechatConfigurationError}
                          </span>
                        ) : wechatConnectionState === "failed" ? (
                          <span
                            className="settings-wechat-warning"
                            role="status"
                          >
                            已保存，但尚未连通
                            {wechatConnectionError
                              ? `：${wechatConnectionError}`
                              : "。"}
                          </span>
                        ) : wechatConnectionState === "checking" ? (
                          <span role="status">正在检查公众号连接…</span>
                        ) : wechatConnectionState === "connected" ? (
                          <span className="settings-wechat-saved" role="status">
                            连接正常，可以发布公众号草稿
                          </span>
                        ) : wechatConfigurationState === "saved" ? (
                          <span className="settings-wechat-saved" role="status">
                            已保存并生效
                          </span>
                        ) : null}
                      </span>
                      <button
                        type="submit"
                        disabled={
                          wechatConfigurationState === "loading" ||
                          wechatConfigurationState === "saving" ||
                          !wechatAppId.trim() ||
                          !wechatAppSecret.trim()
                        }
                      >
                        {wechatConfigurationState === "loading"
                          ? "读取中…"
                          : wechatConfigurationState === "saving"
                            ? "保存中…"
                            : "保存配置"}
                      </button>
                    </div>
                  </form>
                </section>
              ) : null}

              {aiAvailable ? (
                <section className="settings-group" aria-label="智能工具">
                  <div className="settings-group-heading">
                    <strong>智能工具</strong>
                  </div>
                  <div className="settings-card">
                    <button
                      type="button"
                      className="settings-row settings-ai-row"
                      role="switch"
                      aria-checked={aiEnabled}
                      aria-label={`AI 辅助审阅，当前${aiEnabled ? "已开启" : "已关闭"}`}
                      onClick={() => onAiEnabledChange(!aiEnabled)}
                    >
                      <span className="settings-row-label">
                        AI 辅助审阅
                        <small>
                          {authUsername
                            ? "逐条确认建议，正文始终由你决定是否修改"
                            : "登录后可逐条确认 AI 提供的修改建议"}
                        </small>
                      </span>
                      <span
                        className={`settings-switch${aiEnabled ? " is-on" : ""}`}
                        aria-hidden="true"
                      >
                        <span />
                      </span>
                    </button>
                  </div>
                </section>
              ) : null}

              <section className="settings-group" aria-label="外部扩展">
                <div className="settings-group-heading">
                  <strong>外部扩展</strong>
                </div>
                <article className="settings-tool-card">
                  <img
                    className="settings-tool-icon"
                    src={appPath("/hermes-skill-icon.png")}
                    alt=""
                    aria-hidden="true"
                  />
                  <div className="settings-tool-copy">
                    <h4>Hermes Skill</h4>
                    <p>
                      把下面这句话直接发给 Hermes，它会自行下载、解压并安装：
                    </p>
                  </div>
                  <div className="settings-tool-details">
                    <div className="settings-tool-prompt">
                      <div className="settings-tool-prompt-header">
                        <span className="settings-tool-prompt-label">安装指令</span>
                        <button
                          type="button"
                          className="settings-tool-prompt-action"
                          aria-label={
                            authUsername
                              ? "复制发给 Hermes 的安装指令"
                              : "登录后复制发给 Hermes 的安装指令"
                          }
                          disabled={
                            Boolean(authUsername) &&
                            (hermesSkillLinkActionState === "copying" ||
                              hermesSkillLinkActionState === "resetting")
                          }
                          onClick={authUsername ? onHermesSkillLinkCopy : onLogin}
                        >
                          {authUsername
                            ? hermesSkillLinkActionState === "copying"
                              ? "生成中…"
                              : hermesSkillLinkActionState === "copied"
                                ? "已复制"
                                : "复制"
                            : "登录后复制"}
                        </button>
                      </div>
                      <p className="settings-tool-prompt-text">
                        “{HERMES_SKILL_INSTALL_INSTRUCTION_PREVIEW}”
                      </p>
                    </div>
                    <small>
                      复制时会自动填入当前账号的专属链接。链接可用于多台电脑；
                      请勿公开分享，仅在主动重置或修改密码后失效。
                    </small>
                  </div>
                  <div className="settings-tool-actions" aria-live="polite">
                    <button
                      type="button"
                      className="settings-tool-action settings-hermes-skill-row"
                      disabled={Boolean(authUsername) && isHermesSkillDownloading}
                      onClick={authUsername ? onHermesSkillDownload : onLogin}
                    >
                      {authUsername
                        ? isHermesSkillDownloading
                          ? "生成中…"
                          : "下载 Skill"
                        : "登录后使用"}
                    </button>
                    {authUsername ? (
                      <button
                        type="button"
                        className="settings-tool-action settings-tool-action-reset"
                        aria-haspopup="dialog"
                        disabled={
                          hermesSkillLinkActionState === "copying" ||
                          hermesSkillLinkActionState === "resetting"
                        }
                        onClick={onHermesSkillLinkReset}
                      >
                        {hermesSkillLinkActionState === "resetting"
                          ? "重置中…"
                          : hermesSkillLinkActionState === "reset"
                            ? "已重置"
                            : "重置链接"}
                      </button>
                    ) : null}
                  </div>
                </article>
              </section>
              <NativeServiceConfig />
            </section>

            <section
              id="settings-pane-about"
              className="settings-pane"
              aria-labelledby="settings-about-title"
              hidden={category !== "about"}
            >
              <header className="settings-pane-header">
                <h3 id="settings-about-title">关于拾光便签</h3>
                <p>一款为飞牛 fnOS 打造的私有便签与共享空间应用。</p>
              </header>

              <section className="settings-card settings-about-hero" aria-label="项目介绍">
                <img
                  src={appPath("/brand/shiguang-app-icon.png")}
                  alt="拾光便签"
                  width="72"
                  height="72"
                />
                <div>
                  <strong>拾光便签</strong>
                  <p>
                    在 NAS 本机保存正文与图片，支持飞牛账号、独立账号、租户隔离、
                    共享空间、富文本与 Markdown 双向排版、PNG 和公众号导出。
                  </p>
                </div>
              </section>

              {appVersion ? (
                <section className="settings-card settings-update-card" aria-label="应用版本">
                  <div className="settings-row">
                    <span className="settings-row-label">
                      拾光便签版本
                      <small>飞牛 fnOS 私有便签与共享空间应用</small>
                    </span>
                    <span className="settings-row-value settings-version-value">
                      {appVersion}
                      {updateStatus === "available" && latestUpdate ? (
                        <span className="settings-version-badge">
                          {latestUpdate.version}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className="settings-update-summary">
                    <span
                      className={`settings-update-status is-${updateStatus}`}
                      role="status"
                    >
                      {updateStatus === "checking"
                        ? "正在检查版本清单…"
                        : updateStatus === "downloading"
                          ? "正在下载并校验…"
                          : updateMessage || "打开设置时自动检查新版本"}
                    </span>
                    {latestUpdate?.publishedAt ? (
                      <small>发布日期：{latestUpdate.publishedAt.slice(0, 10)}</small>
                    ) : null}
                  </div>
                  <div className="settings-update-actions">
                    <button
                      type="button"
                      className="settings-update-check"
                      disabled={["checking", "downloading"].includes(updateStatus)}
                      onClick={() => void checkForUpdates()}
                    >
                      {updateStatus === "checking" ? "检查中…" : "检查更新"}
                    </button>
                    {["available", "ready"].includes(updateStatus) && latestUpdate ? (
                      <button
                        type="button"
                        className="settings-update-install"
                        disabled={updateStatus === "downloading"}
                        onClick={() => void downloadAndInstallUpdate()}
                      >
                        {updateStatus === "ready"
                          ? "重新打开安装器"
                          : isNative && nativeSession?.user.isAdmin
                            ? `升级到 ${latestUpdate.version}`
                            : `查看 ${latestUpdate.version} 新版本`}
                      </button>
                    ) : null}
                  </div>
                  {installerPath ? (
                    <p className="settings-update-note">
                      安装包已保存在 NAS 应用数据目录并通过完整性校验。
                    </p>
                  ) : null}
                </section>
              ) : null}

              <section className="settings-card settings-project-card" aria-label="功能说明">
                <h4>主要功能</h4>
                <ul className="settings-project-features">
                  <li>多便签、分类、搜索、星标、置顶、回收站与自动保存</li>
                  <li>富文本和 Markdown 双模式，支持标题、引用、待办、图片与四种字号</li>
                  <li>暖白、深夜、iPhone、Bear、暖色杂志和 Telegra.ph 等配色</li>
                  <li>飞牛账号自动登录、独立账号、管理员用户管理与租户数据隔离</li>
                  <li>共享空间、成员编辑/只读权限和目录授权</li>
                  <li>PNG、公众号富文本、Markdown 资源包和离线 HTML 导出</li>
                  <li>AI 审阅、Skill/DSH 插件接入和 NAS 本地图片导入</li>
                </ul>
              </section>

              <section className="settings-card settings-project-credit" aria-label="来源与许可">
                <h4>感谢与开源许可</h4>
                <p>
                  感谢{" "}
                  <a href={UPSTREAM_REPOSITORY_URL} target="_blank" rel="noopener noreferrer">
                    zhaoolee/notes
                  </a>
                  {" "}与所有贡献者的开源工作。项目代码依据{" "}
                  <a
                    href={`${PROJECT_REPOSITORY_URL}/blob/main/LICENSE`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Apache License 2.0
                  </a>
                  {" "}发布，原始版权与{" "}
                  <a
                    href={`${PROJECT_REPOSITORY_URL}/blob/main/NOTICE`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    NOTICE
                  </a>
                  {" "}声明继续保留。
                </p>
                <p>再分发时请保留许可证与 NOTICE；第三方主题、字体、图标和商标仍归各自权利人所有。</p>
              </section>

              <section className="settings-card" aria-label="开源项目">
                <a
                  className="settings-row settings-about-link"
                  href={PROJECT_REPOSITORY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`在 GitHub 打开开源项目：${PROJECT_REPOSITORY_URL}`}
                >
                  <span className="settings-row-label">
                    项目主页
                    <small>{PROJECT_REPOSITORY_URL}</small>
                  </span>
                  <span className="settings-row-value">
                    GitHub
                    <span className="settings-row-chevron" aria-hidden="true">›</span>
                  </span>
                </a>
                <a
                  className="settings-row settings-about-link"
                  href={CHANGELOG_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="在新标签页打开更新日志"
                >
                  <span className="settings-row-label">
                    更新日志
                    <small>查看版本新增、变更和修复记录</small>
                  </span>
                  <span className="settings-row-value">
                    查看
                    <span className="settings-row-chevron" aria-hidden="true">›</span>
                  </span>
                </a>
              </section>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
