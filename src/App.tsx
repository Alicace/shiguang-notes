import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { CategorySidebar } from "./components/CategorySidebar";
import { AiReviewDialog } from "./components/AiReviewDialog";
import { ChangePasswordDialog } from "./components/ChangePasswordDialog";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { EditorPanel, type EditorPanelHandle } from "./components/EditorPanel";
import { LoginDialog } from "./components/LoginDialog";
import { MoveNoteDialog } from "./components/MoveNoteDialog";
import { NoteCardThemePicker } from "./components/NoteCardThemePicker";
import {
  RichTextEditor,
  type RichTextEditorHandle,
} from "./components/RichTextEditor";
import {
  EMPTY_RICH_TOOLBAR_STATE,
  RichTextToolbar,
  type RichToolbarState,
} from "./components/RichTextToolbar";
import { useMediaQuery } from "./lib/use-media-query";
import {
  canStepNoteFontScale,
  getNoteFontScaleLabel,
  normalizeNoteFontScale,
  stepNoteFontScale,
} from "./lib/note-typography";
import { NoteSidebar } from "./components/NoteSidebar";
import { PreviewPanel } from "./components/PreviewPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { SharePanel } from "./components/SharePanel";
import {
  getInitialAiEnabled,
  getInitialFooterBrand,
  getInitialFooterLogoUrl,
  getInitialFooterVia,
  getInitialNoteCardTheme,
  getInitialNoteWorkspace,
  getRenderMode,
  isSmartisanWebTestDataMode,
  NOTE_CARD_THEME_STORAGE_KEY,
  persistAiEnabled,
  persistFooterLogoUrl,
  persistFooterText,
  persistNoteWorkspace,
  THEME_STORAGE_KEY,
} from "./lib/app-state";
import { getAiStatus } from "./lib/ai";
import {
  canUseCloudWorkspace,
  changeUserPassword,
  downloadHermesSkillPackage,
  getHermesSkillInstallLink,
  getAuthState,
  getAuthSession,
  getCloudWorkspace,
  loginUser,
  logoutUser,
  resetHermesSkillInstallLink,
  saveCloudWorkspace,
  type AuthUser,
} from "./lib/auth";
import { copyTextToClipboard, normalizeClipboardMarkdown } from "./lib/clipboard";
import { importNasImage } from "./lib/images";
import {
  exportMarkdownArchive,
  exportMarkdownAsPng,
  exportNoteWorkspaceArchive,
  getExportErrorMessage,
  type WorkspaceArchiveProgress,
} from "./lib/export";
import { buildHermesSkillInstallInstruction } from "./lib/hermes";
import { splitSections } from "./lib/markdown";
import { useResolvedTheme } from "./lib/use-theme";
import {
  getCategoryNoteDocuments,
  getFolderIdFromCategory,
  orderNoteDocuments,
} from "./lib/notes";
import {
  parseNoteRouteHash,
  writeCurrentNoteRoute,
  type NoteRoute,
  type NoteRouteView,
} from "./lib/note-route";
import {
  createCloudSaveQueue,
  handleWorkspaceSaveShortcut,
  shouldApplyPolledWorkspace,
  shouldMarkCloudSyncComplete,
  type CloudSaveQueue,
} from "./lib/workspace-save";
import { getWechatConnectionStatus } from "./lib/wechat-config";
import {
  copyMarkdownForWechat,
  publishMarkdownAsWechatDraft,
} from "./lib/wechat";
import { useAppStore } from "./store/useAppStore";
import type { CSSProperties } from "react";
import type {
  CopyState,
  FormattingMode,
  NoteCardThemeId,
  NoteCategoryId,
  NoteFolder,
  NoteWorkspace,
} from "./types/app";
import { appPath, isNative, nativeWritable } from "./lib/fnos-client";
import {
  forgetNativeLoginConsent,
  hasNativeLoginConsent,
  rememberNativeLoginConsent,
  shouldAutoUseNasLogin,
} from "./lib/native-login";
import { nativeJson } from "./native/api";
import { collectPageEvents, recorder } from "../fnos/m0/ui/diagnostics";
import nativeMetadata from "./native/metadata.json";
import { featureInventory } from "./native/features";

type MobileWorkspaceView = "notes" | "editor" | "preview";
type DesktopWorkspaceView = "editor" | "preview";
type WechatCopyState = "idle" | "preparing" | "copied" | "failed";
type WechatDraftState = "idle" | "publishing" | "published" | "failed";
type HermesSkillLinkActionState =
  | "idle"
  | "copying"
  | "copied"
  | "resetting"
  | "reset";

interface NoteRouteNavigation {
  revision: number;
  route: NoteRoute | null;
}

const NOTE_REFRESH_DELAY_MS = 650;
const CLOUD_SAVE_DELAY_MS = 650;
const CLOUD_POLL_INTERVAL_MS = 15_000;
const HERMES_SKILL_LINK_RESET_CONFIRMATION = {
  title: "重置 Hermes 安装链接？",
  description:
    "重置后，当前专属链接会立即失效，之后无法再用于下载；已经安装的 Skill 不受影响。",
  confirmLabel: "确认重置",
};

const NATIVE_NAS_AUTH_CONFIRMATION = {
  title: "使用 NAS 账号登录？",
  description:
    "拾光便签会读取当前飞牛登录态作为账号，不读取也不保存 NAS 密码。确认后即可进入应用。",
  confirmLabel: "授权",
};

// 对齐官方 formatting_mode 的名称：0 无 / 1 富文本模式 / 2 Markdown 模式。
const FORMATTING_MODE_LABELS: Record<FormattingMode, string> = {
  // 与官方一致：0 号模式叫「无」，另外两档沿用官方名称。
  plain: "无",
  rich: "富文本模式",
  markdown: "Markdown 模式",
};

const FORMATTING_MODE_OPTIONS: Array<{
  id: FormattingMode;
  label: string;
}> = [
  { id: "plain", label: "无" },
  { id: "rich", label: "富文本模式" },
  { id: "markdown", label: "Markdown 模式" },
];

// 官方排版模式选单里每一档都带一个小标识（RTF / M↓），状态栏里也常驻显示当前档位。
function FormatModeBadge({ mode }: { mode: FormattingMode }) {
  if (mode === "plain") {
    return (
      <span className="format-mode-badge" aria-hidden="true">
        <svg viewBox="0 0 16 16">
          <path d="M3 4.5h10M3 8h10M3 11.5h6" />
        </svg>
      </span>
    );
  }

  return (
    <span className={`format-mode-badge is-${mode}`} aria-hidden="true">
      {mode === "rich" ? "RTF" : "M↓"}
    </span>
  );
}

function getCurrentWorkspace(): NoteWorkspace {
  const state = useAppStore.getState();

  return {
    activeNoteId: state.activeNoteId,
    folders: state.folders,
    notes: state.notes,
    version: 1,
  };
}

/**
 * Ctrl/Cmd+S 只有焦点在编辑器正文控件（或编辑器内的按钮/图片）时才真正保存；
 * 搜索框、文件夹下拉、图片预览/裁剪弹窗等不能把保存误发给当前文章。
 */
function isSaveShortcutTargetAllowed(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return true;
  }

  if (target.closest('[role="dialog"]')) {
    return false;
  }

  const control = target.closest(
    'input, textarea, select, [contenteditable="true"]',
  );

  if (!control) {
    return true;
  }

  return Boolean(control.closest(".editor-panel"));
}

function getCategoryLabel(
  categoryId: NoteCategoryId,
  folders: NoteFolder[],
): string {
  if (categoryId === "all") {
    return "全部便签";
  }

  if (categoryId === "starred") {
    return "加星便签";
  }

  if (categoryId === "trash") {
    return "回收站";
  }

  const folderId = getFolderIdFromCategory(categoryId);
  return folders.find((folder) => folder.id === folderId)?.name ?? "全部便签";
}

function getCopyButtonText(copyState: CopyState): string {
  if (copyState === "copied") {
    return "已复制文字";
  }

  if (copyState === "failed") {
    return "复制失败";
  }

  return "复制文字";
}

function getWechatCopyButtonText(copyState: WechatCopyState): string {
  if (copyState === "preparing") {
    return "正在处理图片...";
  }

  if (copyState === "copied") {
    return "已复制到公众号";
  }

  if (copyState === "failed") {
    return "公众号复制失败";
  }

  return "复制到公众号";
}

function getWechatDraftButtonText(state: WechatDraftState): string {
  if (state === "publishing") {
    return "正在发布草稿...";
  }

  if (state === "published") {
    return "已保存到公众号草稿";
  }

  if (state === "failed") {
    return "草稿发布失败";
  }

  return "发布为公众号草稿";
}

function formatMobileNoteUpdatedAt(timestamp: number | undefined): string {
  if (!timestamp) {
    return "";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

export default function App() {
  const renderMode = getRenderMode();
  const isPlaywrightRender = !isNative && renderMode === "playwright";
  const isTestDataMode = isSmartisanWebTestDataMode();
  const [footerBrand, setFooterBrand] = useState(getInitialFooterBrand);
  const [footerLogoUrl, setFooterLogoUrl] = useState(() => appPath(getInitialFooterLogoUrl()));
  const [footerVia, setFooterVia] = useState(getInitialFooterVia);
  const [aiEnabled, setAiEnabled] = useState(getInitialAiEnabled);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiReviewNoteId, setAiReviewNoteId] = useState<string | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isWorkspaceArchiveExporting, setIsWorkspaceArchiveExporting] =
    useState(false);
  const [workspaceArchiveProgress, setWorkspaceArchiveProgress] =
    useState<WorkspaceArchiveProgress | null>(null);
  const [workspaceArchiveError, setWorkspaceArchiveError] = useState("");
  const [isImportingImage, setIsImportingImage] = useState(false);
  const [isImageSourceMenuOpen, setIsImageSourceMenuOpen] = useState(false);
  const [isRefreshingNotes, setIsRefreshingNotes] = useState(false);
  const [isNoteSidebarOpen, setIsNoteSidebarOpen] = useState(false);
  const [isCategorySidebarOpen, setIsCategorySidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isFormattingModeMenuOpen, setIsFormattingModeMenuOpen] =
    useState(false);
  const [isMoveDialogOpen, setIsMoveDialogOpen] = useState(false);
  const [isDesktopCategoryCollapsed, setIsDesktopCategoryCollapsed] =
    useState(false);
  const [isDesktopFocusMode, setIsDesktopFocusMode] = useState(false);
  const [isDesktopSharePreview, setIsDesktopSharePreview] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [requireLogin, setRequireLogin] = useState(isNative);
  const [isNativeLoggedIn, setIsNativeLoggedIn] = useState(
    () => !isNative || hasNativeLoginConsent(),
  );
  const [hasNativeAppPassword, setHasNativeAppPassword] = useState(false);
  const [isNasAuthorizing, setIsNasAuthorizing] = useState(false);
  const [isNasAuthConfirmationOpen, setIsNasAuthConfirmationOpen] =
    useState(false);
  const [nativeLoginError, setNativeLoginError] = useState("");
  const [nativeReadOnly, setNativeReadOnly] = useState(false);
  const [nativeSwitching, setNativeSwitching] = useState(false);
  const cloudFailureRef = useRef(false);
  const [authStatus, setAuthStatus] = useState<"loading" | "ready">("loading");
  const [cloudSyncState, setCloudSyncState] = useState<
    "local" | "syncing" | "synced" | "failed"
  >("local");
  const [cloudSyncError, setCloudSyncError] = useState("");
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isHermesSkillDownloading, setIsHermesSkillDownloading] =
    useState(false);
  const [
    isHermesSkillLinkResetConfirmationOpen,
    setIsHermesSkillLinkResetConfirmationOpen,
  ] = useState(false);
  const [hermesSkillLinkActionState, setHermesSkillLinkActionState] =
    useState<HermesSkillLinkActionState>("idle");
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [wechatCopyState, setWechatCopyState] =
    useState<WechatCopyState>("idle");
  const [wechatDraftState, setWechatDraftState] =
    useState<WechatDraftState>("idle");
  const [canPublishWechatDraft, setCanPublishWechatDraft] = useState(false);
  const [activeCategoryId, setActiveCategoryId] =
    useState<NoteCategoryId>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileWorkspaceView, setMobileWorkspaceView] =
    useState<MobileWorkspaceView>("notes");
  const [desktopWorkspaceView, setDesktopWorkspaceView] =
    useState<DesktopWorkspaceView>("editor");
  const [noteRouteNavigation, setNoteRouteNavigation] =
    useState<NoteRouteNavigation>(() => ({
      revision: 0,
      route:
        typeof window === "undefined"
          ? null
          : parseNoteRouteHash(window.location.hash),
    }));
  const editorPanelRef = useRef<EditorPanelHandle | null>(null);
  const richEditorRef = useRef<RichTextEditorHandle | null>(null);
  const [richToolbarState, setRichToolbarState] = useState<RichToolbarState>(
    EMPTY_RICH_TOOLBAR_STATE,
  );
  const isMobileLayout = useMediaQuery("(max-width: 640px)");
  const refreshTimeoutRef = useRef<number | null>(null);
  const settingsContainerRef = useRef<HTMLDivElement | null>(null);
  const desktopSettingsContainerRef = useRef<HTMLButtonElement | null>(null);
  const settingsPanelHostRef = useRef<HTMLDivElement | null>(null);
  const shareContainerRef = useRef<HTMLDivElement | null>(null);
  const accountContainerRef = useRef<HTMLDivElement | null>(null);
  const formattingModeMenuRef = useRef<HTMLDivElement | null>(null);
  const mobileFormattingModeMenuRef = useRef<HTMLDivElement | null>(null);
  const insertImageMenuRef = useRef<HTMLDivElement | null>(null);
  const desktopViewBeforeShareRef = useRef<DesktopWorkspaceView>("editor");
  const mobileDraftNoteIdRef = useRef<string | null>(null);
  const cloudSaveTimeoutRef = useRef<number | null>(null);
  const cloudRevisionRef = useRef(0);
  const cloudHydratedUserIdRef = useRef<string | null>(null);
  const cloudSaveQueueRef = useRef<CloudSaveQueue | null>(null);

  if (cloudSaveQueueRef.current === null) {
    cloudSaveQueueRef.current = createCloudSaveQueue({
      save: saveCloudWorkspace,
      onSaved: (stored) => {
        cloudFailureRef.current = false;
        cloudRevisionRef.current = stored.updatedAt ?? Date.now();

        // 队列里还有更新的快照或新的防抖定时器时保持“同步中”，
        // 不能让前一个在途请求把后续未保存的快照标成已保存。
        if (
          !shouldMarkCloudSyncComplete({
            hasPendingSave:
              cloudSaveQueueRef.current?.hasPending() ?? false,
            isDebounceScheduled: cloudSaveTimeoutRef.current !== null,
          })
        ) {
          return;
        }

        setCloudSyncError("");
        setCloudSyncState("synced");
      },
      onError: (error) => {
        cloudFailureRef.current = true;
        setCloudSyncError(
          error instanceof Error ? error.message : "云端便签保存失败。",
        );
        setCloudSyncState("failed");
      },
    });
  }

  const skipNextCloudSaveRef = useRef(false);
  const restoredNoteRouteRevisionRef = useRef(-1);
  const activeNoteId = useAppStore((state) => state.activeNoteId);
  const folders = useAppStore((state) => state.folders);
  const noteDocuments = useAppStore((state) => state.notes);
  const markdown = useAppStore((state) => state.markdown);
  const richText = useAppStore((state) => state.richText);
  const setFormattingMode = useAppStore((state) => state.setFormattingMode);
  const setRichText = useAppStore((state) => state.setRichText);
  const setRichStyles = useAppStore((state) => state.setRichStyles);
  const setNoteFontScale = useAppStore((state) => state.setNoteFontScale);
  const selectedTheme = useAppStore((state) => state.selectedTheme);
  const resolvedTheme = useResolvedTheme(selectedTheme);
  const [noteCardThemeOverride, setNoteCardThemeOverride] =
    useState<NoteCardThemeId | null>(getInitialNoteCardTheme);
  const noteCardTheme = noteCardThemeOverride ?? resolvedTheme;
  const isExporting = useAppStore((state) => state.isExporting);
  const exportError = useAppStore((state) => state.exportError);
  const copyState = useAppStore((state) => state.copyState);
  const pendingAction = useAppStore((state) => state.pendingAction);
  const createNote = useAppStore((state) => state.createNote);
  const discardEmptyDraft = useAppStore((state) => state.discardEmptyDraft);
  const createFolder = useAppStore((state) => state.createFolder);
  const deleteFolder = useAppStore((state) => state.deleteFolder);
  const reorderNotes = useAppStore((state) => state.reorderNotes);
  const moveNoteToFolder = useAppStore((state) => state.moveNoteToFolder);
  const selectNote = useAppStore((state) => state.selectNote);
  const requestDeleteNote = useAppStore((state) => state.requestDeleteNote);
  const requestPermanentlyDeleteNote = useAppStore(
    (state) => state.requestPermanentlyDeleteNote,
  );
  const replaceWorkspace = useAppStore((state) => state.replaceWorkspace);
  const restoreNote = useAppStore((state) => state.restoreNote);
  const setMarkdown = useAppStore((state) => state.setMarkdown);
  const setSelectedTheme = useAppStore((state) => state.setSelectedTheme);
  const setIsExporting = useAppStore((state) => state.setIsExporting);
  const setExportError = useAppStore((state) => state.setExportError);
  const setCopyState = useAppStore((state) => state.setCopyState);
  const togglePinned = useAppStore((state) => state.togglePinned);
  const toggleStarred = useAppStore((state) => state.toggleStarred);
  const clearPendingAction = useAppStore((state) => state.clearPendingAction);
  const confirmPendingAction = useAppStore((state) => state.confirmPendingAction);

  useEffect(() => {
    if (!isNative) return;
    recorder.configure(nativeMetadata, featureInventory.map((item) => item.id));
    const dispose = collectPageEvents();
    const identityChanged = () => resetAuthenticatedClientState();
    const workspaceLoaded = () => setNativeReadOnly(!nativeWritable);
    window.addEventListener("shiguang-identity-changed", identityChanged);
    window.addEventListener("shiguang-workspace-loaded", workspaceLoaded);
    return () => { dispose(); recorder.setEnabled(false); window.removeEventListener("shiguang-identity-changed", identityChanged); window.removeEventListener("shiguang-workspace-loaded", workspaceLoaded); };
  }, []);

  async function changeNativeSpace(scope: string) {
    if (nativeSwitching) return;
    setNativeSwitching(true);
    try {
      const pendingSave = cloudSaveTimeoutRef.current !== null || cloudSaveQueueRef.current?.isSaving() || cloudSyncState === "syncing";
      if (cloudSaveTimeoutRef.current !== null) { clearTimeout(cloudSaveTimeoutRef.current); cloudSaveTimeoutRef.current = null; }
      if (!nativeReadOnly && pendingSave) { cloudSaveQueueRef.current?.enqueue(getCurrentWorkspace()); await cloudSaveQueueRef.current?.whenIdle(); }
      if (!nativeReadOnly && cloudFailureRef.current) throw new Error("当前空间保存失败，请先处理同步错误再切换。");
      recorder.action("space.switch");
      const url = new URL(location.href); if (scope) url.searchParams.set("space", scope); else url.searchParams.delete("space"); url.hash = "";
      location.assign(url.toString());
    } finally { setNativeSwitching(false); }
  }

  const categoryNoteDocuments = useMemo(
    () => getCategoryNoteDocuments(noteDocuments, activeCategoryId),
    [activeCategoryId, noteDocuments],
  );
  const categoryLabel = getCategoryLabel(activeCategoryId, folders);
  const activeCategoryNote = categoryNoteDocuments.find(
    (note) => note.id === activeNoteId,
  );
  const hasActiveCategoryNote = Boolean(activeCategoryNote);
  const notes = splitSections(markdown);
  const activeNote = noteDocuments.find((note) => note.id === activeNoteId);
  const formattingMode = activeNote?.formattingMode ?? "markdown";
  const isRichMode = formattingMode === "rich";
  const richContent = isRichMode ? richText : null;
  const editorText = isRichMode ? richContent?.text ?? "" : markdown;
  // 服务端渲染导出页（renderMode=playwright）通过查询参数传入便签字号档位。
  const noteFontScale = isPlaywrightRender
    ? normalizeNoteFontScale(
        Number(new URLSearchParams(location.search).get("fontScale") ?? 1),
      )
    : normalizeNoteFontScale(activeNote?.fontScale);
  const mobileNoteCharacterCount = activeCategoryNote
    ? markdown.replace(/\s/g, "").length
    : 0;

  useLayoutEffect(() => {
    const rootStyle = document.documentElement.style;
    const mobileQuery = window.matchMedia("(max-width: 640px)");
    const viewport = window.visualViewport;
    const propertyNames = [
      "--mobile-visual-viewport-height",
      "--mobile-visual-viewport-offset-top",
    ] as const;

    const clearViewportProperties = () => {
      for (const propertyName of propertyNames) {
        rootStyle.removeProperty(propertyName);
      }
    };

    const syncVisualViewport = () => {
      if (!mobileQuery.matches) {
        clearViewportProperties();
        return;
      }

      const height = Math.max(1, viewport?.height ?? window.innerHeight);
      const offsetTop = Math.max(0, viewport?.offsetTop ?? 0);

      rootStyle.setProperty("--mobile-visual-viewport-height", `${height}px`);
      rootStyle.setProperty(
        "--mobile-visual-viewport-offset-top",
        `${offsetTop}px`,
      );
    };

    syncVisualViewport();
    mobileQuery.addEventListener("change", syncVisualViewport);
    viewport?.addEventListener("resize", syncVisualViewport);
    viewport?.addEventListener("scroll", syncVisualViewport);
    window.addEventListener("orientationchange", syncVisualViewport);
    window.addEventListener("pageshow", syncVisualViewport);
    window.addEventListener("resize", syncVisualViewport);

    return () => {
      mobileQuery.removeEventListener("change", syncVisualViewport);
      viewport?.removeEventListener("resize", syncVisualViewport);
      viewport?.removeEventListener("scroll", syncVisualViewport);
      window.removeEventListener("orientationchange", syncVisualViewport);
      window.removeEventListener("pageshow", syncVisualViewport);
      window.removeEventListener("resize", syncVisualViewport);
      clearViewportProperties();
    };
  }, []);

  useEffect(() => {
    if (isTestDataMode) {
      setAuthStatus("ready");
      setCloudSyncState("local");
      return;
    }

    let cancelled = false;

    void (async () => {
      let session: AuthUser | null;

      try {
        const authState = await getAuthState();
        session = authState.user;

        if (cancelled) {
          return;
        }

        setRequireLogin(authState.requireLogin);
        setHasNativeAppPassword(authState.appPassword);
        setAuthUser(session);
        // 飞牛网关已经确认当前用户时，不需要每次重开都再点一次“使用 NAS 登录”。
        // localStorage 可能被 WebView 清理，自动登记一次并直接继续使用服务端会话。
        if (isNative && session && shouldAutoUseNasLogin()) {
          rememberNativeLoginConsent();
          setIsNativeLoggedIn(true);
        }
      } catch (error) {
        if (!cancelled) {
          setCloudSyncState("failed");
          setCloudSyncError(
            error instanceof Error ? error.message : "云端同步初始化失败。",
          );
        }

        if (!cancelled) {
          setAuthStatus("ready");
        }

        return;
      }

      // 身份确认后立刻进入界面，云端工作区在后台补齐，避免每次打开都停在加载页。
      setAuthStatus("ready");

      if (!canUseCloudWorkspace(session)) {
        return;
      }

      try {
        setCloudSyncState("syncing");
        const cloud = await getCloudWorkspace();

        if (cancelled) {
          return;
        }

        if (cloud.workspace) {
          skipNextCloudSaveRef.current = true;
          replaceWorkspace(cloud.workspace);
          cloudRevisionRef.current = cloud.updatedAt ?? 0;
        } else {
          const saved = await saveCloudWorkspace(getCurrentWorkspace());

          if (cancelled) {
            return;
          }

          cloudRevisionRef.current = saved.updatedAt ?? 0;
          skipNextCloudSaveRef.current = true;
        }

        cloudHydratedUserIdRef.current = session.id;
        setCloudSyncState("synced");
      } catch (error) {
        if (!cancelled) {
          setCloudSyncState("failed");
          setCloudSyncError(
            error instanceof Error ? error.message : "云端同步初始化失败。",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isTestDataMode, replaceWorkspace]);

  useEffect(() => {
    if (
      isPlaywrightRender ||
      authStatus !== "ready" ||
      (requireLogin && !authUser)
    ) {
      return;
    }

    let cancelled = false;
    let retryTimeoutId: number | null = null;
    let attempts = 0;

    const checkStatus = async () => {
      attempts += 1;

      try {
        const available = await getAiStatus();

        if (!cancelled) {
          setAiAvailable(available);
        }
      } catch {
        if (!cancelled && attempts < 10) {
          retryTimeoutId = window.setTimeout(() => {
            void checkStatus();
          }, 800);
        }
      }
    };

    void checkStatus();

    return () => {
      cancelled = true;

      if (retryTimeoutId !== null) {
        window.clearTimeout(retryTimeoutId);
      }
    };
  }, [authStatus, authUser, isPlaywrightRender, requireLogin]);

  useEffect(() => {
    if (authStatus !== "ready" || requireLogin) {
      return;
    }

    if (canUseCloudWorkspace(authUser)) {
      return;
    }

    persistNoteWorkspace({
      activeNoteId,
      folders,
      notes: noteDocuments,
      version: 1,
    });
    setCloudSyncState("local");
  }, [
    activeNoteId,
    authStatus,
    authUser,
    folders,
    noteDocuments,
    requireLogin,
  ]);

  useEffect(() => {
    if (authStatus !== "ready" || !canUseCloudWorkspace(authUser)) {
      return;
    }
    if (isNative && !nativeWritable) return;

    if (cloudHydratedUserIdRef.current !== authUser.id) {
      return;
    }

    if (skipNextCloudSaveRef.current) {
      skipNextCloudSaveRef.current = false;
      return;
    }

    const workspace = getCurrentWorkspace();

    if (cloudSaveTimeoutRef.current !== null) {
      window.clearTimeout(cloudSaveTimeoutRef.current);
    }

    setCloudSyncState("syncing");
    cloudSaveTimeoutRef.current = window.setTimeout(() => {
      cloudSaveTimeoutRef.current = null;
      cloudSaveQueueRef.current?.enqueue(workspace);
    }, CLOUD_SAVE_DELAY_MS);
  }, [
    authStatus,
    authUser,
    folders,
    noteDocuments,
  ]);

  useEffect(() => {
    if (!canUseCloudWorkspace(authUser)) {
      return;
    }

    const hasPendingLocalSave = () =>
      (isNative && cloudFailureRef.current) ||
      cloudSaveTimeoutRef.current !== null ||
      cloudSaveQueueRef.current?.isSaving() === true;

    const intervalId = window.setInterval(() => {
      if (hasPendingLocalSave()) {
        return;
      }

      void getCloudWorkspace()
        .then((cloud) => {
          if (
            cloud.workspace &&
            shouldApplyPolledWorkspace({
              polledUpdatedAt: cloud.updatedAt,
              knownRevision: cloudRevisionRef.current,
              hasPendingLocalSave: hasPendingLocalSave(),
            })
          ) {
            cloudRevisionRef.current = cloud.updatedAt ?? 0;
            skipNextCloudSaveRef.current = true;
            replaceWorkspace(cloud.workspace, {
              preserveActiveNote: true,
            });
            setCloudSyncError("");
            setCloudSyncState("synced");
          }
        })
        .catch((error) => {
          setCloudSyncError(
            error instanceof Error ? error.message : "跨端同步检查失败。",
          );
          setCloudSyncState("failed");
        });
    }, CLOUD_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [authUser, replaceWorkspace]);

  useEffect(() => {
    if (isTestDataMode || !authUser) {
      return;
    }

    let cancelled = false;
    const intervalId = window.setInterval(() => {
      void getAuthState()
        .then((authState) => {
          if (cancelled) {
            return;
          }

          setRequireLogin(authState.requireLogin);

          if (!authState.user || authState.user.id !== authUser.id) {
            resetAuthenticatedClientState();
            return;
          }

          if (
            authState.user.role !== authUser.role ||
            authState.user.username !== authUser.username
          ) {
            setAuthUser(authState.user);
          }
        })
        .catch(() => {
          // 短时网络故障不能被误判为会话失效；已有 API 会继续显示自己的错误。
        });
    }, CLOUD_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [authUser, isTestDataMode]);

  useEffect(() => {
    if (!canUseCloudWorkspace(authUser)) {
      return;
    }

    const flushWorkspace = () => {
      const workspace = getCurrentWorkspace();
      persistNoteWorkspace(workspace);

      if (
        authStatus !== "ready" ||
        cloudHydratedUserIdRef.current !== authUser.id
      ) {
        return;
      }

      if (cloudSaveTimeoutRef.current !== null) {
        window.clearTimeout(cloudSaveTimeoutRef.current);
        cloudSaveTimeoutRef.current = null;
      }
      cloudSaveQueueRef.current?.enqueue(workspace);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushWorkspace();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", flushWorkspace);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", flushWorkspace);
    };
  }, [authStatus, authUser]);

  useEffect(() => {
    function handleSaveShortcut(event: KeyboardEvent) {
      const hasBlockingOverlay =
        isSettingsOpen ||
        isLoginOpen ||
        isChangePasswordOpen ||
        isShareOpen ||
        isMoveDialogOpen ||
        isNoteSidebarOpen ||
        isCategorySidebarOpen ||
        isAccountMenuOpen ||
        isHermesSkillLinkResetConfirmationOpen ||
        aiReviewNoteId !== null ||
        pendingAction !== null;

      const isMobileLayout = window.matchMedia("(max-width: 640px)").matches;
      const isEditing = isMobileLayout
        ? mobileWorkspaceView === "editor"
        : desktopWorkspaceView === "editor";
      const isEditorActive =
        isEditing &&
        activeCategoryId !== "trash" &&
        !hasBlockingOverlay &&
        !isDesktopSharePreview;
      const isLoggedIn = canUseCloudWorkspace(authUser);

      handleWorkspaceSaveShortcut(event, {
        isEditorActive,
        isTargetAllowed: isSaveShortcutTargetAllowed(event.target),
        isWriteReady: authStatus === "ready" && Boolean(activeNoteId),
        isLoggedIn,
        isCloudHydrated:
          isLoggedIn && cloudHydratedUserIdRef.current === authUser.id,
        getLatestWorkspace: getCurrentWorkspace,
        persistLocalWorkspace: persistNoteWorkspace,
        clearPendingCloudSave: () => {
          if (cloudSaveTimeoutRef.current !== null) {
            window.clearTimeout(cloudSaveTimeoutRef.current);
            cloudSaveTimeoutRef.current = null;
          }
        },
        enqueueCloudSave: (workspace) => {
          cloudSaveQueueRef.current?.enqueue(workspace);
        },
        markCloudSyncing: () => {
          setCloudSyncError("");
          setCloudSyncState("syncing");
        },
      });
    }

    document.addEventListener("keydown", handleSaveShortcut);

    return () => {
      document.removeEventListener("keydown", handleSaveShortcut);
    };
  }, [
    activeCategoryId,
    activeNoteId,
    aiReviewNoteId,
    authStatus,
    authUser,
    desktopWorkspaceView,
    isAccountMenuOpen,
    isCategorySidebarOpen,
    isChangePasswordOpen,
    isDesktopSharePreview,
    isHermesSkillLinkResetConfirmationOpen,
    isLoginOpen,
    isMoveDialogOpen,
    isNoteSidebarOpen,
    isSettingsOpen,
    isShareOpen,
    mobileWorkspaceView,
    pendingAction,
  ]);

  useEffect(
    () => () => {
      if (refreshTimeoutRef.current !== null) {
        window.clearTimeout(refreshTimeoutRef.current);
      }

      if (cloudSaveTimeoutRef.current !== null) {
        window.clearTimeout(cloudSaveTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    function handleLocationNavigation() {
      setNoteRouteNavigation((current) => ({
        revision: current.revision + 1,
        route: parseNoteRouteHash(window.location.hash),
      }));
    }

    window.addEventListener("hashchange", handleLocationNavigation);
    window.addEventListener("popstate", handleLocationNavigation);

    return () => {
      window.removeEventListener("hashchange", handleLocationNavigation);
      window.removeEventListener("popstate", handleLocationNavigation);
    };
  }, []);

  useEffect(() => {
    if (
      restoredNoteRouteRevisionRef.current === noteRouteNavigation.revision
    ) {
      return;
    }

    const route = noteRouteNavigation.route;

    if (!route) {
      restoredNoteRouteRevisionRef.current = noteRouteNavigation.revision;
      setMobileWorkspaceView("notes");
      return;
    }

    if (authStatus !== "ready") {
      return;
    }

    const routedNote = noteDocuments.find((note) => note.id === route.noteId);

    if (!routedNote) {
      restoredNoteRouteRevisionRef.current = noteRouteNavigation.revision;
      setActiveCategoryId("all");
      setMobileWorkspaceView("notes");
      writeCurrentNoteRoute(null);
      return;
    }

    const routedView: NoteRouteView = routedNote.deletedAt
      ? "preview"
      : route.view;

    restoredNoteRouteRevisionRef.current = noteRouteNavigation.revision;
    setAiReviewNoteId(null);
    setActiveCategoryId(routedNote.deletedAt ? "trash" : "all");
    selectNote(routedNote.id);
    setDesktopWorkspaceView(routedView);
    setMobileWorkspaceView(routedView);
    setIsDesktopSharePreview(false);
    setIsShareOpen(false);
    setIsNoteSidebarOpen(false);
    setIsCategorySidebarOpen(false);

    if (routedView !== route.view) {
      writeCurrentNoteRoute({ noteId: routedNote.id, view: routedView });
    }
  }, [
    authStatus,
    noteDocuments,
    noteRouteNavigation,
    selectNote,
  ]);

  useEffect(() => {
    if (
      categoryNoteDocuments.length > 0 &&
      !categoryNoteDocuments.some((note) => note.id === activeNoteId)
    ) {
      selectNote(categoryNoteDocuments[0].id);
    }
  }, [activeNoteId, categoryNoteDocuments, selectNote]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(THEME_STORAGE_KEY, selectedTheme);
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme, selectedTheme]);

  useEffect(() => {
    if (noteCardThemeOverride === null || typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      NOTE_CARD_THEME_STORAGE_KEY,
      noteCardThemeOverride,
    );
  }, [noteCardThemeOverride]);

  useEffect(() => {
    persistFooterText(footerBrand, footerVia);
  }, [footerBrand, footerVia]);

  useEffect(() => {
    persistFooterLogoUrl(footerLogoUrl);
  }, [footerLogoUrl]);

  useEffect(() => {
    persistAiEnabled(aiEnabled);
  }, [aiEnabled]);

  useEffect(() => {
    if (aiReviewNoteId && aiReviewNoteId !== activeNoteId) {
      setAiReviewNoteId(null);
    }
  }, [activeNoteId, aiReviewNoteId]);

  useEffect(() => {
    if (copyState === "idle") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setCopyState("idle");
    }, 1800);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [copyState, setCopyState]);

  useEffect(() => {
    if (wechatCopyState === "idle" || wechatCopyState === "preparing") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setWechatCopyState("idle");
    }, 2400);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [wechatCopyState]);

  useEffect(() => {
    if (wechatDraftState === "idle" || wechatDraftState === "publishing") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setWechatDraftState("idle");
    }, 3_000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [wechatDraftState]);

  useEffect(() => {
    let cancelled = false;

    if (!authUser || (!isShareOpen && !isDesktopSharePreview)) {
      setCanPublishWechatDraft(false);
      return () => {
        cancelled = true;
      };
    }

    setCanPublishWechatDraft(false);
    void getWechatConnectionStatus()
      .then((status) => {
        if (!cancelled) {
          setCanPublishWechatDraft(status.configured && status.connected);
        }
      })
      .catch((error) => {
        console.error("Wechat connection check failed", error);

        if (!cancelled) {
          setCanPublishWechatDraft(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authUser, isDesktopSharePreview, isShareOpen]);

  useEffect(() => {
    if (!isSettingsOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (isHermesSkillLinkResetConfirmationOpen) {
        return;
      }

      const target = event.target;

      const isInsideSettings =
        target instanceof Node &&
        [
          settingsContainerRef.current,
          desktopSettingsContainerRef.current,
          settingsPanelHostRef.current,
        ].some((container) => container?.contains(target));

      if (target instanceof Node && !isInsideSettings) {
        setIsSettingsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (isHermesSkillLinkResetConfirmationOpen) {
          setIsHermesSkillLinkResetConfirmationOpen(false);
          return;
        }

        setIsSettingsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isHermesSkillLinkResetConfirmationOpen, isSettingsOpen]);

  useEffect(() => {
    if (!isAccountMenuOpen && !isLoginOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;

      if (
        isAccountMenuOpen &&
        target instanceof Node &&
        !accountContainerRef.current?.contains(target)
      ) {
        setIsAccountMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsAccountMenuOpen(false);
        setIsLoginOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAccountMenuOpen, isLoginOpen]);

  useEffect(() => {
    if (!isShareOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;

      if (target instanceof Node && !shareContainerRef.current?.contains(target)) {
        setIsShareOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsShareOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isShareOpen]);

  useEffect(() => {
    if (!isNoteSidebarOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsNoteSidebarOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isNoteSidebarOpen]);

  useEffect(() => {
    if (!isImageSourceMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;

      if (
        target instanceof Node &&
        !insertImageMenuRef.current?.contains(target)
      ) {
        setIsImageSourceMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsImageSourceMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isImageSourceMenuOpen]);

  useEffect(() => {
    if (!isFormattingModeMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;

      if (
        target instanceof Node &&
        !formattingModeMenuRef.current?.contains(target) &&
        !mobileFormattingModeMenuRef.current?.contains(target)
      ) {
        setIsFormattingModeMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsFormattingModeMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFormattingModeMenuOpen]);

  useEffect(() => {
    if (!isMoveDialogOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMoveDialogOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isMoveDialogOpen]);

  useEffect(() => {
    if (!isCategorySidebarOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsCategorySidebarOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isCategorySidebarOpen]);

  useEffect(() => {
    if (isPlaywrightRender) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.key !== "Escape" ||
        !window.matchMedia("(min-width: 641px)").matches
      ) {
        return;
      }

      const target = event.target;

      if (
        !isDesktopFocusMode &&
        target instanceof HTMLElement &&
        (target.isContentEditable || target.matches("input, textarea, select"))
      ) {
        return;
      }

      const hasOpenOverlay =
        isSettingsOpen ||
        isAccountMenuOpen ||
        isLoginOpen ||
        isChangePasswordOpen ||
        isShareOpen ||
        isNoteSidebarOpen ||
        isMoveDialogOpen ||
        isCategorySidebarOpen ||
        Boolean(aiReviewNoteId) ||
        Boolean(pendingAction);

      if (hasOpenOverlay) {
        return;
      }

      if (isDesktopSharePreview) {
        event.preventDefault();
        setIsDesktopSharePreview(false);
        setDesktopWorkspaceView(
          activeCategoryId === "trash" ? "preview" : "editor",
        );
        return;
      }

      if (
        desktopWorkspaceView === "preview" &&
        activeCategoryId !== "trash"
      ) {
        event.preventDefault();
        setDesktopWorkspaceView("editor");
        writeCurrentNoteRoute({ noteId: activeNoteId, view: "editor" });
        return;
      }

      if (isDesktopFocusMode) {
        event.preventDefault();
        setIsDesktopFocusMode(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    activeCategoryId,
    aiReviewNoteId,
    desktopWorkspaceView,
    isAccountMenuOpen,
    isCategorySidebarOpen,
    isChangePasswordOpen,
    isDesktopFocusMode,
    isDesktopSharePreview,
    isLoginOpen,
    isMoveDialogOpen,
    isNoteSidebarOpen,
    isPlaywrightRender,
    isSettingsOpen,
    isShareOpen,
    pendingAction,
  ]);

  async function handleUserAuthenticated(user: AuthUser) {
    setCloudSyncState("syncing");
    setCloudSyncError("");
    const anonymousWorkspace = getCurrentWorkspace();

    try {
      // 密码登录只返回用户对象，appFetch 里缓存的 CSRF 与身份仍是登录前的账号；
      // 先读一次会话来刷新它们，否则随后的工作区读取会被「身份已变化」保护拦下，
      // 表现为水合失败、编辑内容静默不保存。
      await getAuthSession();
      const cloud = await getCloudWorkspace();

      if (cloud.workspace) {
        skipNextCloudSaveRef.current = true;
        replaceWorkspace(cloud.workspace);
        cloudRevisionRef.current = cloud.updatedAt ?? 0;
      } else {
        const stored = await saveCloudWorkspace(anonymousWorkspace);
        cloudRevisionRef.current = stored.updatedAt ?? 0;
        skipNextCloudSaveRef.current = true;
      }

      cloudHydratedUserIdRef.current = user.id;
      setCloudSyncState("synced");
    } catch (error) {
      cloudHydratedUserIdRef.current = null;
      setCloudSyncState("failed");
      setCloudSyncError(
        error instanceof Error ? error.message : "云端便签加载失败。",
      );
    }

    setAuthUser(user);
    setAuthStatus("ready");
    setIsLoginOpen(false);
    setIsAccountMenuOpen(false);
  }

  // 原生应用内的应用账号与飞牛账号同名，登录后仍沿用同一份私有便签。
  async function handleNativeAccountLogin(
    username: string,
    password: string,
    remember: boolean,
  ) {
    const user = await loginUser(username, password, remember);
    await handleUserAuthenticated(user);
    rememberNativeLoginConsent();
    setIsNativeLoggedIn(true);
    setNativeLoginError("");
    return user;
  }

  async function handleNasLogin() {
    setIsNasAuthConfirmationOpen(false);
    setIsNasAuthorizing(true);
    setNativeLoginError("");

    try {
      const authState = await getAuthState();

      if (!authState.user) {
        throw new Error("未能确认 NAS 登录态，请从飞牛桌面重新打开拾光便签。");
      }

      setRequireLogin(authState.requireLogin);
      setHasNativeAppPassword(authState.appPassword);
      await handleUserAuthenticated(authState.user);
      rememberNativeLoginConsent();
      setIsNativeLoggedIn(true);
    } catch (error) {
      setNativeLoginError(
        error instanceof Error ? error.message : "NAS 登录失败，请稍后重试。",
      );
    } finally {
      setIsNasAuthorizing(false);
    }
  }

  function resetAuthenticatedClientState() {
    if (isNative) recorder.setEnabled(false);
    if (cloudSaveTimeoutRef.current !== null) {
      window.clearTimeout(cloudSaveTimeoutRef.current);
      cloudSaveTimeoutRef.current = null;
    }

    cloudHydratedUserIdRef.current = null;
    cloudRevisionRef.current = 0;
    setAuthUser(null);
    setAiReviewNoteId(null);
    setCloudSyncError("");
    setCloudSyncState("local");
    setIsAccountMenuOpen(false);
    setIsChangePasswordOpen(false);
    setIsSettingsOpen(false);
    setIsShareOpen(false);
    replaceWorkspace(getInitialNoteWorkspace());
    setMobileWorkspaceView("notes");
    writeCurrentNoteRoute(null);
  }

  async function handleLogout() {
    if (
      canUseCloudWorkspace(authUser) &&
      cloudHydratedUserIdRef.current === authUser.id
    ) {
      if (cloudSaveTimeoutRef.current !== null) {
        window.clearTimeout(cloudSaveTimeoutRef.current);
        cloudSaveTimeoutRef.current = null;
      }

      try {
        // 先让在途/排队中的自动保存落地，避免退出时的最新快照被旧快照反超。
        if (cloudSaveQueueRef.current?.isSaving()) {
          await cloudSaveQueueRef.current.whenIdle();
        }

        await saveCloudWorkspace(getCurrentWorkspace());
      } catch (error) {
        setCloudSyncError(
          error instanceof Error ? error.message : "退出前云端保存失败。",
        );
      }
    }

    try {
      await logoutUser();
    } catch (error) {
      // 即使浏览器会话清理请求失败，也必须先回到本机登录页。
      // 否则 WebView 的来源头差异会让“退出登录”看起来完全没响应。
      recorder.error(error instanceof Error ? error.name : "Error");
    } finally {
      resetAuthenticatedClientState();

      if (isNative) {
        forgetNativeLoginConsent();
        setIsNativeLoggedIn(false);
        setNativeLoginError("");
      }
    }
  }

  async function handleHermesSkillDownload() {
    if (isHermesSkillDownloading) {
      return;
    }

    try {
      setIsHermesSkillDownloading(true);
      await downloadHermesSkillPackage();
    } catch (error) {
      console.error("Hermes Skill download failed", error);
      window.alert(
        error instanceof Error
          ? error.message
          : "Hermes Skill 下载失败，请稍后重试。",
      );
    } finally {
      setIsHermesSkillDownloading(false);
    }
  }

  async function handleHermesSkillLinkCopy() {
    if (
      hermesSkillLinkActionState === "copying" ||
      hermesSkillLinkActionState === "resetting"
    ) {
      return;
    }

    try {
      setHermesSkillLinkActionState("copying");
      const { installUrl } = await getHermesSkillInstallLink();
      await copyTextToClipboard(buildHermesSkillInstallInstruction(installUrl));
      setHermesSkillLinkActionState("copied");
      window.setTimeout(() => {
        setHermesSkillLinkActionState((state) =>
          state === "copied" ? "idle" : state,
        );
      }, 2_400);
    } catch (error) {
      console.error("Hermes Skill install link copy failed", error);
      setHermesSkillLinkActionState("idle");
      window.alert(
        error instanceof Error
          ? error.message
          : "Hermes 安装指令复制失败，请稍后重试。",
      );
    }
  }

  async function handleHermesSkillLinkReset() {
    if (
      hermesSkillLinkActionState === "copying" ||
      hermesSkillLinkActionState === "resetting"
    ) {
      return;
    }

    setIsHermesSkillLinkResetConfirmationOpen(false);

    try {
      setHermesSkillLinkActionState("resetting");
      await resetHermesSkillInstallLink();
      setHermesSkillLinkActionState("reset");
      window.setTimeout(() => {
        setHermesSkillLinkActionState((state) =>
          state === "reset" ? "idle" : state,
        );
      }, 2_400);
    } catch (error) {
      console.error("Hermes Skill install link reset failed", error);
      setHermesSkillLinkActionState("idle");
      window.alert(
        error instanceof Error
          ? error.message
          : "Hermes 安装链接重置失败，请稍后重试。",
      );
    }
  }

  async function handleExport() {
    if (isExporting) {
      return;
    }

    try {
      setIsExporting(true);
      setExportError("");
      await exportMarkdownAsPng(markdown, noteCardTheme, {
        fontScale: noteFontScale,
        footerBrand,
        footerLogoUrl,
        footerVia,
      });
    } catch (error) {
      console.error("PNG export failed", error);
      setExportError(getExportErrorMessage(error));
    } finally {
      setIsExporting(false);
    }
  }

  async function handleArchiveDownload() {
    if (isArchiving) {
      return;
    }

    try {
      setIsArchiving(true);
      setExportError("");
      await exportMarkdownArchive(markdown, noteCardTheme, {
        fontScale: noteFontScale,
        footerBrand,
        footerLogoUrl,
        footerVia,
      });
    } catch (error) {
      console.error("Archive download failed", error);
      setExportError(getExportErrorMessage(error));
    } finally {
      setIsArchiving(false);
    }
  }

  async function handleWorkspaceArchiveExport() {
    if (isWorkspaceArchiveExporting) {
      return;
    }

    try {
      setIsWorkspaceArchiveExporting(true);
      setWorkspaceArchiveError("");
      setWorkspaceArchiveProgress({
        percent: 0,
        message: "正在提交整体导出任务",
        completedNotes: 0,
        totalNotes: noteDocuments.length,
      });
      await exportNoteWorkspaceArchive(
        getCurrentWorkspace(),
        setWorkspaceArchiveProgress,
      );
    } catch (error) {
      console.error("Workspace archive export failed", error);
      setWorkspaceArchiveError(getExportErrorMessage(error));
    } finally {
      setIsWorkspaceArchiveExporting(false);
    }
  }

  async function handleCopyMarkdown() {
    recorder.action("copy.markdown");
    try {
      await copyTextToClipboard(normalizeClipboardMarkdown(markdown));
      setCopyState("copied");
    } catch (error) {
      console.error("Markdown copy failed", error);
      setCopyState("failed");
    }
  }

  async function handleCopyWechat() {
    recorder.action("copy.wechat");
    if (wechatCopyState === "preparing") {
      return;
    }

    try {
      setWechatCopyState("preparing");
      setExportError("");
      await copyMarkdownForWechat(
        markdown,
        noteCardTheme,
        {
          footerBrand,
          footerLogoUrl,
          footerVia,
        },
        noteFontScale,
      );
      setWechatCopyState("copied");
    } catch (error) {
      console.error("Wechat rich-text copy failed", error);
      setWechatCopyState("failed");
      setExportError(
        error instanceof Error
          ? `复制到公众号失败：${error.message}`
          : "复制到公众号失败",
      );
    }
  }

  async function handlePublishWechatDraft() {
    if (wechatDraftState === "publishing" || !canPublishWechatDraft) {
      return;
    }

    try {
      setWechatDraftState("publishing");
      setExportError("");
      await publishMarkdownAsWechatDraft(
        markdown,
        noteCardTheme,
        {
          footerBrand,
          footerLogoUrl,
          footerVia,
        },
        noteFontScale,
      );
      setWechatDraftState("published");
    } catch (error) {
      console.error("Wechat draft publication failed", error);
      setWechatDraftState("failed");
      setExportError(
        error instanceof Error
          ? `发布公众号草稿失败：${error.message}`
          : "发布公众号草稿失败",
      );
    }
  }

  function handleCreateNote() {
    setIsSettingsOpen(false);
    setIsShareOpen(false);
    setIsNoteSidebarOpen(false);
    setIsCategorySidebarOpen(false);
    setAiReviewNoteId(null);
    const folderId = getFolderIdFromCategory(activeCategoryId);
    const shouldStar = activeCategoryId === "starred";

    if (activeCategoryId === "trash") {
      setActiveCategoryId("all");
    }

    const createdNoteId = createNote("", folderId, shouldStar);
    mobileDraftNoteIdRef.current = createdNoteId;
    setDesktopWorkspaceView("editor");
    setMobileWorkspaceView("editor");
    setIsDesktopSharePreview(false);
    writeCurrentNoteRoute(
      { noteId: createdNoteId, view: "editor" },
      "push",
    );
  }

  function handleReturnToNoteList() {
    setIsSettingsOpen(false);
    setIsShareOpen(false);

    const draftNoteId = mobileDraftNoteIdRef.current;
    mobileDraftNoteIdRef.current = null;

    if (draftNoteId) {
      const preferredNextNoteId = orderNoteDocuments(
        categoryNoteDocuments.filter((note) => note.id !== draftNoteId),
      )[0]?.id;
      discardEmptyDraft(draftNoteId, preferredNextNoteId);
    }

    setMobileWorkspaceView("notes");
    writeCurrentNoteRoute(null);
  }

  function handleMobileWorkspaceViewChange(view: NoteRouteView) {
    setMobileWorkspaceView(view);

    if (activeNoteId) {
      writeCurrentNoteRoute({ noteId: activeNoteId, view });
    }
  }

  async function flushPendingCloudSave(): Promise<boolean> {
    persistNoteWorkspace(getCurrentWorkspace());

    if (!canUseCloudWorkspace(authUser) || authStatus !== "ready") {
      return true;
    }

    if (cloudHydratedUserIdRef.current !== authUser.id) {
      setCloudSyncError("正在读取 NAS 便签，请稍候再保存。");
      setCloudSyncState("failed");
      return false;
    }

    if (cloudSaveTimeoutRef.current !== null) {
      window.clearTimeout(cloudSaveTimeoutRef.current);
      cloudSaveTimeoutRef.current = null;
    }

    setCloudSyncState("syncing");
    cloudSaveQueueRef.current?.enqueue(getCurrentWorkspace());
    await cloudSaveQueueRef.current?.whenIdle();
    return !cloudFailureRef.current;
  }

  function handleDesktopWorkspaceViewChange(view: NoteRouteView) {
    setDesktopWorkspaceView(view);

    if (activeNoteId) {
      writeCurrentNoteRoute({ noteId: activeNoteId, view });
    }
  }

  function handleOpenAiReview() {
    if (!activeNoteId) {
      return;
    }

    if (document.activeElement instanceof HTMLTextAreaElement) {
      document.activeElement.blur();
    }

    setIsSettingsOpen(false);
    setIsShareOpen(false);
    setAiReviewNoteId(activeNoteId);
  }

  function handleAiReviewPointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    if (event.pointerType !== "touch") {
      return;
    }

    event.preventDefault();
    handleOpenAiReview();
  }

  // 「刷新便签」是重新向服务端取一次当前工作区，并就地更新界面；
  // 以前它直接 location.reload()，整页白屏重载，看起来像误操作。
  function handleRefreshNotes() {
    if (refreshTimeoutRef.current !== null || authStatus !== "ready") {
      return;
    }

    if (!canUseCloudWorkspace(authUser)) {
      setIsRefreshingNotes(true);
      refreshTimeoutRef.current = window.setTimeout(() => {
        refreshTimeoutRef.current = null;
        setIsRefreshingNotes(false);
      }, NOTE_REFRESH_DELAY_MS);
      return;
    }

    setIsRefreshingNotes(true);
    void (async () => {
      try {
        if (cloudSaveTimeoutRef.current !== null) {
          window.clearTimeout(cloudSaveTimeoutRef.current);
          cloudSaveTimeoutRef.current = null;
        }
        if (cloudSaveQueueRef.current?.isSaving()) {
          await cloudSaveQueueRef.current.whenIdle();
        }

        setCloudSyncState("syncing");
        const cloud = await getCloudWorkspace();

        if (cloud.workspace) {
          skipNextCloudSaveRef.current = true;
          replaceWorkspace(cloud.workspace);
          cloudRevisionRef.current = cloud.updatedAt ?? 0;
        }

        setCloudSyncError("");
        setCloudSyncState("synced");
      } catch (error) {
        setCloudSyncState("failed");
        setCloudSyncError(
          error instanceof Error ? error.message : "刷新便签失败。",
        );
      } finally {
        refreshTimeoutRef.current = window.setTimeout(() => {
          refreshTimeoutRef.current = null;
          setIsRefreshingNotes(false);
        }, 320);
      }
    })();
  }

  function handleSelectNote(noteId: string) {
    const selectedNote = noteDocuments.find((note) => note.id === noteId);

    if (!selectedNote) {
      return;
    }

    const selectedView: NoteRouteView = selectedNote.deletedAt
      ? "preview"
      : "editor";

    setAiReviewNoteId(null);
    selectNote(noteId);
    setIsShareOpen(false);
    setIsNoteSidebarOpen(false);
    setIsCategorySidebarOpen(false);
    setDesktopWorkspaceView(selectedView);
    setMobileWorkspaceView(selectedView);
    setIsDesktopSharePreview(false);
    writeCurrentNoteRoute({ noteId, view: selectedView }, "push");
  }

  function handleSelectCategory(categoryId: NoteCategoryId) {
    setAiReviewNoteId(null);
    setActiveCategoryId(categoryId);
    setIsCategorySidebarOpen(false);
    setIsNoteSidebarOpen(false);
    setMobileWorkspaceView("notes");

    const [firstNote] = getCategoryNoteDocuments(noteDocuments, categoryId);

    if (firstNote) {
      selectNote(firstNote.id);
    }

    if (
      firstNote &&
      window.matchMedia("(min-width: 641px)").matches
    ) {
      const selectedView: NoteRouteView =
        firstNote.deletedAt === null ? "editor" : "preview";
      setDesktopWorkspaceView(selectedView);
      writeCurrentNoteRoute({ noteId: firstNote.id, view: selectedView });
      return;
    }

    writeCurrentNoteRoute(null);
  }

  function handleConfirmPendingAction() {
    const confirmedAction = pendingAction;
    confirmPendingAction();

    if (
      confirmedAction?.kind !== "delete-note" &&
      confirmedAction?.kind !== "permanently-delete-note"
    ) {
      return;
    }

    if (
      window.matchMedia("(max-width: 640px)").matches &&
      mobileWorkspaceView === "notes"
    ) {
      writeCurrentNoteRoute(null);
      return;
    }

    const nextState = useAppStore.getState();
    const nextActiveNote = getCategoryNoteDocuments(
      nextState.notes,
      activeCategoryId,
    ).find((note) => note.id === nextState.activeNoteId);

    if (!nextActiveNote) {
      setMobileWorkspaceView("notes");
      writeCurrentNoteRoute(null);
      return;
    }

    const nextView: NoteRouteView = nextActiveNote.deletedAt
      ? "preview"
      : window.matchMedia("(max-width: 640px)").matches
        ? mobileWorkspaceView === "preview"
          ? "preview"
          : "editor"
        : desktopWorkspaceView;

    writeCurrentNoteRoute({ noteId: nextActiveNote.id, view: nextView });
  }

  function handleDeleteFolder(folderId: string) {
    if (getFolderIdFromCategory(activeCategoryId) === folderId) {
      setActiveCategoryId("all");
    }

    deleteFolder(folderId);
  }

  function handleMoveCurrentNoteToFolder(folderId: string | null) {
    moveNoteToFolder(activeNoteId, folderId);
  }

  function handleDeleteCurrentNote() {
    setIsSettingsOpen(false);
    setIsShareOpen(false);
    requestDeleteNote(activeNoteId);
  }

  function handleInsertImage() {
    setIsSettingsOpen(false);
    setIsShareOpen(false);
    setIsImageSourceMenuOpen((isOpen) => !isOpen);
  }

  // 本机图片走浏览器的文件选择器。
  function pickLocalImage() {
    setIsImageSourceMenuOpen(false);
    if (richEditorRef.current) {
      richEditorRef.current.openImagePicker();
      return;
    }
    editorPanelRef.current?.openImagePicker();
  }

  // NAS 图片：通过飞牛文件选择器选择已授权文件，再由服务端读取并导入。
  function pickNasImage() {
    setIsImageSourceMenuOpen(false);

    void (async () => {
      try {
        setIsImportingImage(true);
        const { TrimApp } = await import("@trimjs/web-app");
        const app = new TrimApp();
        await app.ready();

        if (app.isStandaloneWeb) {
          window.alert("请从飞牛桌面打开应用后选择 NAS 图片。");
          return;
        }

        const picked = await app.pickUserFile({
          directory: false,
          accept: ["image/*"],
        });
        const absolutePath = Array.isArray(picked?.data) ? picked.data[0] : undefined;
        if (!absolutePath) return;

        await nativeJson("/api/authorized-folders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paths: [absolutePath] }),
        });
        const result = await importNasImage(absolutePath);
        const snippet = `![](${result.path || result.url})`;
        if (isRichMode && richEditorRef.current) {
          richEditorRef.current.insertText(snippet);
        } else {
          insertMarkdownAtActiveNote(snippet);
        }
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "从 NAS 导入图片失败。");
      } finally {
        setIsImportingImage(false);
      }
    })();
  }

  // 在富文本模式下把 Markdown 图片行追加到正文；Markdown 模式同样落到 markdown。
  function insertMarkdownAtActiveNote(snippet: string) {
    if (!activeCategoryNote) return;
    const next = markdown.length ? `${markdown}\n\n${snippet}` : snippet;
    setMarkdown(next);
  }

  function handleShareTrigger() {
    setIsSettingsOpen(false);

    if (window.matchMedia("(min-width: 641px)").matches) {
      desktopViewBeforeShareRef.current = desktopWorkspaceView;
      setIsDesktopSharePreview(true);
      setDesktopWorkspaceView("preview");
      return;
    }

    setIsShareOpen((isOpen) => !isOpen);
  }

  function handleCloseDesktopSharePreview() {
    setIsDesktopSharePreview(false);
    setDesktopWorkspaceView(desktopViewBeforeShareRef.current);
  }

  function handleSettingsToggle() {
    recorder.action("settings.open");
    setIsCategorySidebarOpen(false);
    setIsShareOpen(false);
    setIsAccountMenuOpen(false);
    setIsSettingsOpen((isOpen) => !isOpen);
  }

  const desktopAccountEntry = (
    <div className="app-account" ref={accountContainerRef}>
      <button
        type="button"
        className="auth-trigger"
        disabled={authStatus === "loading"}
        aria-haspopup={authUser ? "menu" : "dialog"}
        aria-expanded={authUser ? isAccountMenuOpen : isLoginOpen}
        aria-label={
          authStatus === "loading"
            ? "正在检查登录状态"
            : authUser
              ? `账号：${authUser.username}`
              : "登录账号"
        }
        title={
          authUser
            ? `${authUser.username} · 点击查看账号菜单`
            : "登录账号"
        }
        onClick={() => {
          setIsSettingsOpen(false);
          setIsShareOpen(false);

          if (authUser) {
            setIsAccountMenuOpen((isOpen) => !isOpen);
          } else {
            setIsLoginOpen(true);
          }
        }}
      >
        {isNative && authUser ? <>
          <span className="settings-account-avatar native-account-avatar" aria-hidden="true">{Array.from(authUser.username.trim())[0]?.toLocaleUpperCase()}</span>
          <span className="native-account-copy"><span className="auth-trigger-label">{authUser.username}</span><span className={`native-account-status is-${cloudSyncState}`}><span className="auth-trigger-dot" aria-hidden="true" />{cloudSyncState === "syncing" ? "正在同步" : cloudSyncState === "failed" ? "同步异常" : "已登录 · 已同步"}</span></span>
        </> : <><span className="auth-trigger-dot" aria-hidden="true" /><span className="auth-trigger-label">{authStatus === "loading" ? "检查登录..." : authUser?.username ?? "登录拾光便签"}</span></>}
      </button>

      {authUser && isAccountMenuOpen ? (
        <div className="account-menu" role="menu">
          <div className="account-menu-summary">
            <strong title={authUser.username}>{authUser.username}</strong>
            <span>
              {authUser.role === "superadmin" ? "管理员 · " : ""}
              {cloudSyncState === "syncing"
                ? "正在同步云端..."
                : cloudSyncState === "failed"
                  ? "云端同步异常"
                  : "云端已同步"}
            </span>
          </div>
          {cloudSyncError ? <p role="alert">{cloudSyncError}</p> : null}
          {authUser.role === "superadmin" ? (
            <a
              className="account-menu-item"
              href="/superadmin"
              role="menuitem"
            >
              进入管理后台
            </a>
          ) : null}
          {cloudSyncState === "failed" ? (
            <button
              type="button"
              className="account-menu-item"
              role="menuitem"
              onClick={() => {
                setIsAccountMenuOpen(false);
                handleRefreshNotes();
              }}
            >
              重试同步
            </button>
          ) : null}
          {!isNative && authUser.role === "user" ? (
            <button
              type="button"
              className="account-menu-item"
              role="menuitem"
              onClick={() => {
                setIsAccountMenuOpen(false);
                setIsChangePasswordOpen(true);
              }}
            >
              修改密码
            </button>
          ) : null}
          <button
            type="button"
            className="account-menu-item account-menu-logout"
            role="menuitem"
            onClick={() => void handleLogout()}
          >
            退出登录
          </button>
        </div>
      ) : null}
    </div>
  );

  const desktopViewSwitch = (
    <button
      type="button"
      className={`desktop-toolbar-button desktop-workspace-view-toggle is-${desktopWorkspaceView}`}
      aria-label={
        desktopWorkspaceView === "editor" ? "切换到实时预览" : "切换到编辑"
      }
      title={
        desktopWorkspaceView === "editor" ? "实时预览" : "返回编辑"
      }
      onClick={() =>
        handleDesktopWorkspaceViewChange(
          desktopWorkspaceView === "editor" ? "preview" : "editor",
        )
      }
    >
      {desktopWorkspaceView === "editor" ? (
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M2.3 10s2.8-4.6 7.7-4.6 7.7 4.6 7.7 4.6-2.8 4.6-7.7 4.6S2.3 10 2.3 10Z" />
          <circle cx="10" cy="10" r="2.5" />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="m4 16 1.2-4.1L13.9 3.2l3 3-8.7 8.7L4 16Z" />
          <path d="m12.3 4.8 3 3M5.2 11.9l3 3" />
        </svg>
      )}
    </button>
  );

  const desktopFormatModeSwitch = (
    <div className="desktop-format-mode" ref={formattingModeMenuRef}>
      <button
        type="button"
        className="desktop-format-mode-trigger"
        aria-label="切换排版模式"
        aria-haspopup="menu"
        aria-expanded={isFormattingModeMenuOpen}
        disabled={!activeCategoryNote || activeCategoryId === "trash"}
        onClick={() => setIsFormattingModeMenuOpen((isOpen) => !isOpen)}
      >
        <FormatModeBadge mode={formattingMode} />
        <span>{FORMATTING_MODE_LABELS[formattingMode]}</span>
        <span className="desktop-view-switch-arrow" aria-hidden="true" />
      </button>

      {isFormattingModeMenuOpen ? (
        <div className="desktop-view-menu" role="menu">
          {FORMATTING_MODE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={formattingMode === option.id}
              className={formattingMode === option.id ? "is-active" : undefined}
              onClick={() => {
                recorder.action("format.mode", option.id);
                setFormattingMode(option.id);
                setIsFormattingModeMenuOpen(false);
              }}
            >
              <span aria-hidden="true">
                {formattingMode === option.id ? "✓" : ""}
              </span>
              <FormatModeBadge mode={option.id} />
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );

  const desktopFontScale = (
    <div className="desktop-note-scale">
      <div className="desktop-font-scale" role="group" aria-label="便签字号">
        <button
          type="button"
          className="desktop-font-scale-button"
          aria-label="缩小便签字号"
          title={`缩小字号（当前${getNoteFontScaleLabel(noteFontScale)}）`}
          disabled={
            !activeCategoryNote ||
            activeCategoryId === "trash" ||
            !canStepNoteFontScale(noteFontScale, -1)
          }
          onClick={() => {
            recorder.action("note.fontScale");
            setNoteFontScale(stepNoteFontScale(noteFontScale, -1));
          }}
        >
          A−
        </button>
        <button
          type="button"
          className="desktop-font-scale-button"
          aria-label="放大便签字号"
          title={`放大字号（当前${getNoteFontScaleLabel(noteFontScale)}）`}
          disabled={
            !activeCategoryNote ||
            activeCategoryId === "trash" ||
            !canStepNoteFontScale(noteFontScale, 1)
          }
          onClick={() => {
            recorder.action("note.fontScale");
            setNoteFontScale(stepNoteFontScale(noteFontScale, 1));
          }}
        >
          A+
        </button>
      </div>
      <span aria-hidden="true">|</span>
    </div>
  );

  const desktopFormatControls = (
    <div className="desktop-format-controls">
      {desktopFormatModeSwitch}
      {desktopFontScale}
    </div>
  );

  const desktopSidebarFooter = (
    <div className="desktop-sidebar-footer">
      {desktopAccountEntry}
    </div>
  );

  const nativeScopeLabel = nativeReadOnly
    ? "共享空间 · 只读"
    : new URLSearchParams(location.search).has("space")
      ? "共享空间 · 可编辑"
      : "私有便签";

  const settingsPanel = isSettingsOpen ? (
    <SettingsPanel
      aiAvailable={aiAvailable}
      aiEnabled={aiEnabled}
      appVersion={isNative ? nativeMetadata.appVersion : ""}
      appPasswordConfigured={hasNativeAppPassword}
      authUsername={authUser?.username}
      canChangePassword={authUser?.role === "user"}
      onNativeSpaceChange={changeNativeSpace}
      canConfigureWechat={Boolean(authUser)}
      cloudStatusLabel={
        canUseCloudWorkspace(authUser)
          ? cloudSyncState === "syncing"
            ? "正在同步云端"
            : cloudSyncState === "failed"
              ? "云端同步异常"
              : authUser.role === "superadmin"
                ? "管理员便签已保存到云端"
                : "便签已保存到云端"
          : "数据仅保存在当前浏览器"
      }
      footerBrand={footerBrand}
      footerLogoUrl={footerLogoUrl}
      footerVia={footerVia}
      hermesSkillLinkActionState={hermesSkillLinkActionState}
      isHermesSkillDownloading={isHermesSkillDownloading}
      isWorkspaceArchiveExporting={isWorkspaceArchiveExporting}
      selectedTheme={selectedTheme}
      workspaceArchiveError={workspaceArchiveError}
      workspaceArchiveProgress={workspaceArchiveProgress}
      onAiEnabledChange={setAiEnabled}
      onChangePassword={() => {
        setIsSettingsOpen(false);
        setIsChangePasswordOpen(true);
      }}
      onClose={() => setIsSettingsOpen(false)}
      onLogin={() => {
        setIsSettingsOpen(false);
        setIsLoginOpen(true);
      }}
      onLogout={() => {
        setIsSettingsOpen(false);
        void handleLogout();
      }}
      onFooterBrandChange={setFooterBrand}
      onFooterLogoChange={setFooterLogoUrl}
      onFooterViaChange={setFooterVia}
      onHermesSkillDownload={() => void handleHermesSkillDownload()}
      onHermesSkillLinkCopy={() => void handleHermesSkillLinkCopy()}
      onHermesSkillLinkReset={() =>
        setIsHermesSkillLinkResetConfirmationOpen(true)
      }
      onThemeChange={setSelectedTheme}
      onWorkspaceArchiveExport={() => void handleWorkspaceArchiveExport()}
    />
  ) : null;

  if (!isPlaywrightRender && authStatus === "loading") {
    return (
      <main className="superadmin-loading">
        <p>正在验证登录状态...</p>
      </main>
    );
  }

  // 原生应用首次打开先确认登录方式；确认过一次后不再拦截。
  // 已确认但拿不到 NAS 身份时（例如不是在飞牛桌面里打开）仍然给出同一条登录页。
  if (isNative && (!isNativeLoggedIn || (requireLogin && !authUser))) {
    return (
      <main className="required-login-page" data-native-login="true">
        <LoginDialog
          error={nativeLoginError || cloudSyncError}
          title="拾光便签"
          note="NAS 用户直接使用「使用 NAS 登录」，与账号密码登录共用同一份私有便签；应用密码可在「设置 → 账号与同步」中设置。"
          nasLogin={{
            isBusy: isNasAuthorizing,
            onAuthorize: () => setIsNasAuthConfirmationOpen(true),
          }}
          login={handleNativeAccountLogin}
          onAuthenticated={handleUserAuthenticated}
        />
        <ConfirmDialog
          pendingAction={
            isNasAuthConfirmationOpen ? NATIVE_NAS_AUTH_CONFIRMATION : null
          }
          onClose={() => setIsNasAuthConfirmationOpen(false)}
          onConfirm={() => void handleNasLogin()}
        />
      </main>
    );
  }

  if (!isPlaywrightRender && requireLogin && !authUser) {
    return (
      <main className="required-login-page" data-require-login="true">
        <LoginDialog
          login={loginUser}
          onAuthenticated={handleUserAuthenticated}
        />
      </main>
    );
  }

  return (
    <>
      <div
        className="app-layout"
        data-fnos-native={isNative ? "true" : undefined}
        style={{ "--note-font-scale": String(noteFontScale) } as CSSProperties}
        data-theme={resolvedTheme}
        data-theme-preference={selectedTheme}
        data-authenticated={authUser ? "true" : "false"}
        data-render-mode={isPlaywrightRender ? "playwright" : undefined}
        data-desktop-view={desktopWorkspaceView}
        data-desktop-category-collapsed={
          isDesktopCategoryCollapsed ? "true" : "false"
        }
        data-desktop-focus={isDesktopFocusMode ? "true" : "false"}
        data-desktop-share={isDesktopSharePreview ? "true" : "false"}
        data-category-open={isCategorySidebarOpen ? "true" : "false"}
        data-has-active-note={hasActiveCategoryNote ? "true" : "false"}
        data-mobile-view={mobileWorkspaceView}
      >
        <header className="app-topbar">
          <div className="app-topbar-inner">
            <button
              type="button"
              className="mobile-notes-back"
              aria-label="返回便签列表"
              onClick={handleReturnToNoteList}
            >
              <span className="mobile-back-icon" aria-hidden="true" />
            </button>

            <button
              type="button"
              className="note-navigation-trigger"
              aria-controls="note-sidebar"
              aria-expanded={isNoteSidebarOpen}
              aria-label={isNoteSidebarOpen ? "关闭便签导航" : "打开便签导航"}
              onClick={() => setIsNoteSidebarOpen((isOpen) => !isOpen)}
            >
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span aria-hidden="true" />
            </button>

            <div className="app-brand">
              <button
                ref={desktopSettingsContainerRef}
                type="button"
                className="desktop-brand-settings-trigger"
                aria-label={isSettingsOpen ? "关闭设置" : "打开设置"}
                aria-controls="app-settings-panel"
                aria-expanded={isSettingsOpen}
                title="设置"
                onClick={handleSettingsToggle}
              >
                <span className="app-brand-mark" aria-hidden="true">
                  <img src={appPath("/brand/shiguang-app-icon.png")} alt="拾光便签" />
                </span>
              </button>
              <div className="app-brand-copy">
                <span className="app-brand-title">{"拾光便签"}</span>
              </div>
              {isNative ? (
                <span className="native-scope-chip">{nativeScopeLabel}</span>
              ) : null}
            </div>

            <button
              type="button"
              className="mobile-list-title"
              aria-controls="category-sidebar"
              aria-expanded={isCategorySidebarOpen}
              onClick={() => {
                setIsSettingsOpen(false);
                setIsShareOpen(false);
                setIsCategorySidebarOpen((isOpen) => !isOpen);
              }}
            >
              <span>{categoryLabel}</span>
              <span className="mobile-list-title-arrow" aria-hidden="true">
                ▾
              </span>
            </button>

            <button
              type="button"
              className="mobile-list-create"
              aria-label="新建便签"
              title="新建便签"
              onClick={handleCreateNote}
            >
              <span className="smartisan-toolbar-icon icon-create" aria-hidden="true" />
            </button>

            <div className="desktop-left-actions">
              <button
                type="button"
                className={`desktop-toolbar-button desktop-refresh-note${
                  isRefreshingNotes ? " is-refreshing" : ""
                }`}
                aria-label="刷新便签"
                aria-busy={isRefreshingNotes}
                title="刷新便签"
                onClick={handleRefreshNotes}
              >
                <span className="smartisan-toolbar-icon icon-refresh" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="desktop-toolbar-button desktop-create-note"
                aria-label="新建便签"
                title="新建便签"
                onClick={handleCreateNote}
              >
                <span className="smartisan-toolbar-icon icon-create" aria-hidden="true" />
              </button>
              {desktopViewSwitch}
            </div>

            <div className="app-topbar-actions">
              <button type="button" className="primary preview-export" onClick={handleExport}>
                {isExporting ? "导出中..." : "存图"}
              </button>

              <div className="mobile-detail-actions">
                <div className="desktop-insert-image-wrap" ref={insertImageMenuRef}>
                  <button
                    type="button"
                    className="mobile-detail-action mobile-insert-image"
                    aria-label={isImportingImage ? "正在导入图片" : "插入图片"}
                    aria-haspopup="menu"
                    aria-expanded={isImageSourceMenuOpen}
                    disabled={isImportingImage}
                    onClick={handleInsertImage}
                  >
                    <span
                      className="smartisan-toolbar-icon icon-insert-image"
                      aria-hidden="true"
                    />
                  </button>
                  {isImageSourceMenuOpen ? (
                    <div className="desktop-view-menu image-source-menu" role="menu">
                      {isNative ? (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={pickNasImage}
                        >
                          <span aria-hidden="true">NAS 本地</span>
                        </button>
                      ) : null}
                      <button
                        type="button"
                        role="menuitem"
                        onClick={pickLocalImage}
                      >
                        <span aria-hidden="true">电脑本地</span>
                      </button>
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="mobile-detail-action desktop-move-note"
                  aria-label="转移当前便签到文件夹"
                  disabled={!activeCategoryNote || activeCategoryId === "trash"}
                  onClick={() => setIsMoveDialogOpen(true)}
                >
                  <span className="smartisan-toolbar-icon icon-move" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={`mobile-detail-action mobile-edit-done${mobileWorkspaceView === "preview" ? " is-preview" : ""}`}
                  aria-label={
                    mobileWorkspaceView === "preview"
                      ? "返回编辑"
                      : "保存并预览"
                  }
                  onClick={() => {
                    if (mobileWorkspaceView === "preview") {
                      handleMobileWorkspaceViewChange("editor");
                      return;
                    }

                    void flushPendingCloudSave().then((saved) => {
                      if (saved) handleMobileWorkspaceViewChange("preview");
                    });
                  }}
                >
                  <span className="smartisan-toolbar-icon icon-create" aria-hidden="true" />
                </button>

                <div className="desktop-note-actions">
                  {aiAvailable &&
                  aiEnabled &&
                  authUser &&
                  activeCategoryNote &&
                  activeCategoryId !== "trash" ? (
                    <button
                      type="button"
                      className="ai-review-trigger"
                      aria-label="使用 AI 审阅当前便签"
                      title="AI 辅助审阅"
                      onClick={handleOpenAiReview}
                      onPointerDown={handleAiReviewPointerDown}
                    >
                      AI
                    </button>
                  ) : null}
                  {isNative && desktopWorkspaceView === "editor" ? (
                    <NoteCardThemePicker
                      className="topbar-theme-control"
                      value={noteCardTheme}
                      onChange={(theme) => {
                        recorder.action("theme.change");
                        setNoteCardThemeOverride(theme);
                      }}
                    />
                  ) : null}
                  <button
                    type="button"
                    className="mobile-detail-action mobile-delete-note"
                    aria-label="删除当前便签"
                    onClick={handleDeleteCurrentNote}
                  >
                    <span className="smartisan-toolbar-icon icon-delete" aria-hidden="true" />
                  </button>

                  <div className="app-share" ref={shareContainerRef}>
                    <button
                      type="button"
                      className="share-trigger"
                      aria-label={isShareOpen || isDesktopSharePreview ? "关闭分享与导出" : "打开分享与导出"}
                      aria-controls="app-share-panel"
                      aria-expanded={isShareOpen}
                      title="分享与导出"
                      onClick={handleShareTrigger}
                    >
                      <span className="smartisan-toolbar-icon icon-share" aria-hidden="true" />
                    </button>

                    {isShareOpen ? (
                      <SharePanel
                        canPublishWechatDraft={canPublishWechatDraft}
                        copyButtonText={getCopyButtonText(copyState)}
                        isArchiving={isArchiving}
                        isCopyingWechat={wechatCopyState === "preparing"}
                        isExporting={isExporting}
                        isPublishingWechatDraft={
                          wechatDraftState === "publishing"
                        }
                        onArchiveDownload={() => {
                          setIsShareOpen(false);
                          void handleArchiveDownload();
                        }}
                        onClose={() => setIsShareOpen(false)}
                        onCopyMarkdown={() => {
                          void handleCopyMarkdown();
                        }}
                        onCopyWechat={() => {
                          void handleCopyWechat();
                        }}
                        onExport={() => {
                          setIsShareOpen(false);
                          void handleExport();
                        }}
                        onPublishWechatDraft={() => {
                          void handlePublishWechatDraft();
                        }}
                        wechatDraftButtonText={getWechatDraftButtonText(
                          wechatDraftState,
                        )}
                        wechatButtonText={getWechatCopyButtonText(wechatCopyState)}
                      />
                    ) : null}
                  </div>
                </div>
              </div>

              {isDesktopSharePreview ? (
                <div className="desktop-share-preview-actions">
                  <button
                    type="button"
                    className="desktop-share-cancel"
                    onClick={handleCloseDesktopSharePreview}
                  >
                    取消
                  </button>
                  <div className="desktop-share-export-actions">
                    <button
                      type="button"
                      disabled={wechatCopyState === "preparing"}
                      onClick={() => {
                        void handleCopyWechat();
                      }}
                    >
                      {getWechatCopyButtonText(wechatCopyState)}
                    </button>
                    {canPublishWechatDraft ? (
                      <button
                        type="button"
                        disabled={wechatDraftState === "publishing"}
                        onClick={() => {
                          void handlePublishWechatDraft();
                        }}
                      >
                        {getWechatDraftButtonText(wechatDraftState)}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        void handleCopyMarkdown();
                      }}
                    >
                      {getCopyButtonText(copyState)}
                    </button>
                    <button
                      type="button"
                      disabled={isArchiving}
                      onClick={() => {
                        void handleArchiveDownload();
                      }}
                    >
                      {isArchiving ? "归档中..." : "下载归档"}
                    </button>
                    <button
                      type="button"
                      disabled={isExporting}
                      onClick={() => {
                        void handleExport();
                      }}
                    >
                      {isExporting ? "导出中..." : "保存图片"}
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="app-settings" ref={settingsContainerRef}>
                <button
                  type="button"
                  className="settings-trigger"
                  aria-label={isSettingsOpen ? "关闭设置" : "打开设置"}
                  aria-controls="app-settings-panel"
                  aria-expanded={isSettingsOpen}
                  title="设置"
                  onClick={handleSettingsToggle}
                >
                  <img
                    src={appPath("/smartisan/mobile/btn_settings.png")}
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                  />
                </button>
              </div>
            </div>
          </div>
        </header>

        <div className="app-shell">
          <CategorySidebar
            activeCategoryId={activeCategoryId}
            desktopFooter={desktopSidebarFooter}
            folders={folders}
            isOpen={isCategorySidebarOpen}
            notes={noteDocuments}
            searchQuery={searchQuery}
            onCategorySelect={handleSelectCategory}
            onClose={() => setIsCategorySidebarOpen(false)}
            onCreateFolder={createFolder}
            onDeleteFolder={handleDeleteFolder}
            onSearchQueryChange={setSearchQuery}
          />

          <button
            type="button"
            className={`category-popover-backdrop${
              isCategorySidebarOpen ? " is-visible" : ""
            }`}
            aria-label="关闭分类浮窗"
            tabIndex={isCategorySidebarOpen ? 0 : -1}
            onClick={() => setIsCategorySidebarOpen(false)}
          />

          <NoteSidebar
            activeNoteId={activeNoteId}
            categoryLabel={categoryLabel}
            isTrashView={activeCategoryId === "trash"}
            isOpen={isNoteSidebarOpen}
            notes={categoryNoteDocuments}
            searchQuery={searchQuery}
            onClose={() => setIsNoteSidebarOpen(false)}
            onCreateNote={handleCreateNote}
            onDeleteNote={requestDeleteNote}
            onPermanentlyDeleteNote={requestPermanentlyDeleteNote}
            onReorderNotes={reorderNotes}
            onRestoreNote={restoreNote}
            onSearchQueryChange={setSearchQuery}
            onSelectNote={handleSelectNote}
            onTogglePinned={togglePinned}
            onToggleStarred={toggleStarred}
            isDesktopCategoryCollapsed={isDesktopCategoryCollapsed}
            onToggleDesktopCategory={() => {
              setIsSettingsOpen(false);
              setIsDesktopCategoryCollapsed((isCollapsed) => !isCollapsed);
            }}
          />

          <button
            type="button"
            className={`note-sidebar-backdrop${isNoteSidebarOpen ? " is-visible" : ""}`}
            aria-label="关闭便签导航"
            tabIndex={isNoteSidebarOpen ? 0 : -1}
            onClick={() => setIsNoteSidebarOpen(false)}
          />

          <div className="desktop-workspace-toolbar" aria-label="桌面便签工作区状态">
            <button
              type="button"
              className="desktop-focus-exit"
              aria-label="退出专注编辑"
              title="退出专注编辑"
              onClick={() => setIsDesktopFocusMode(false)}
            >
              <span className="desktop-focus-back-icon" aria-hidden="true" />
            </button>

            {desktopFormatControls}

            <div className="desktop-note-status" aria-label="当前便签信息">
              {isRichMode && !isMobileLayout ? (
                <RichTextToolbar
                  disabled={nativeReadOnly || nativeSwitching || activeCategoryId === "trash"}
                  onAction={(shortcut) => {
                    recorder.action("format.rich", shortcut);
                    richEditorRef.current?.applyShortcut(shortcut);
                  }}
                  state={richToolbarState}
                />
              ) : null}
              <span aria-hidden="true">|</span>
              {/* 顶栏只保留当前便签最常用的动作：加星。移动文件夹在便签列表里操作。 */}
              <button
                type="button"
                className={`desktop-note-star${activeCategoryNote?.isStarred ? " is-starred" : ""}`}
                aria-label={
                  activeCategoryNote?.isStarred ? "取消加星当前便签" : "给当前便签加星"
                }
                aria-pressed={Boolean(activeCategoryNote?.isStarred)}
                title={activeCategoryNote?.isStarred ? "取消加星" : "加星"}
                disabled={!activeCategoryNote || activeCategoryId === "trash"}
                onClick={() => {
                  if (!activeCategoryNote) return;
                  recorder.action("note.star");
                  toggleStarred(activeCategoryNote.id);
                }}
              >
                <span className="desktop-note-star-icon" aria-hidden="true" />
              </button>
              <div className="desktop-note-meta">
                <span aria-hidden="true">|</span>
                <span>{formatMobileNoteUpdatedAt(activeCategoryNote?.updatedAt)}</span>
                <span aria-hidden="true">|</span>
                <span>{mobileNoteCharacterCount} 字</span>
              </div>
              <span aria-hidden="true">|</span>
              <button
                type="button"
                className="desktop-focus-toggle"
                aria-label={
                  isDesktopFocusMode ? "退出专注编辑" : "进入专注编辑"
                }
                aria-pressed={isDesktopFocusMode}
                title={isDesktopFocusMode ? "退出专注编辑" : "进入专注编辑"}
                onClick={() => {
                  setIsDesktopFocusMode((isFocused) => {
                    if (!isFocused) {
                      handleDesktopWorkspaceViewChange("editor");
                      setIsCategorySidebarOpen(false);
                      setIsNoteSidebarOpen(false);
                    }

                    return !isFocused;
                  });
                }}
              >
                <span className="desktop-focus-toggle-icon" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="mobile-workspace-tabs" aria-label="便签详情信息与视图">
            <label
              className="mobile-note-folder"
            >
              <span aria-hidden="true">▧</span>
              <span className="visually-hidden">移动当前便签到文件夹</span>
              <select
                aria-label="移动当前便签到文件夹"
                disabled={!activeCategoryNote || activeCategoryId === "trash"}
                value={activeNote?.folderId ?? ""}
                onChange={(event) =>
                  handleMoveCurrentNoteToFolder(event.target.value || null)
                }
              >
                <option value="">全部便签</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
              <span className="mobile-note-folder-arrow" aria-hidden="true">
                ▾
              </span>
            </label>
            <span className="mobile-note-stats">
              <span>{formatMobileNoteUpdatedAt(activeCategoryNote?.updatedAt)}</span>
              <span aria-hidden="true">|</span>
              <span>{mobileNoteCharacterCount}</span>
            </span>
            <button
              type="button"
              className={`desktop-note-star mobile-note-star${activeCategoryNote?.isStarred ? " is-starred" : ""}`}
              aria-label={activeCategoryNote?.isStarred ? "取消加星当前便签" : "给当前便签加星"}
              aria-pressed={Boolean(activeCategoryNote?.isStarred)}
              disabled={!activeCategoryNote || activeCategoryId === "trash"}
              onClick={() => {
                if (activeCategoryNote) toggleStarred(activeCategoryNote.id);
              }}
            >
              <span className="desktop-note-star-icon" aria-hidden="true" />
            </button>
            <div className="mobile-format-mode" ref={mobileFormattingModeMenuRef}>
              <button
                type="button"
                className="mobile-format-mode-trigger"
                aria-label="切换排版模式"
                aria-haspopup="menu"
                aria-expanded={isFormattingModeMenuOpen}
                disabled={!activeCategoryNote || activeCategoryId === "trash"}
                onClick={() => setIsFormattingModeMenuOpen((isOpen) => !isOpen)}
              >
                <FormatModeBadge mode={formattingMode} />
                <span className="desktop-view-switch-arrow" aria-hidden="true" />
              </button>
              {isFormattingModeMenuOpen ? (
                <div className="desktop-view-menu mobile-format-menu" role="menu">
                  {FORMATTING_MODE_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={formattingMode === option.id}
                      className={formattingMode === option.id ? "is-active" : undefined}
                      onClick={() => {
                        recorder.action("format.mode", option.id);
                        setFormattingMode(option.id);
                        setIsFormattingModeMenuOpen(false);
                      }}
                    >
                      <span aria-hidden="true">
                        {formattingMode === option.id ? "✓" : ""}
                      </span>
                      <FormatModeBadge mode={option.id} />
                      {option.label}
                    </button>
                  ))}
                  <div className="mobile-format-size-row" role="group" aria-label="便签字号">
                    <button
                      type="button"
                      aria-label="缩小便签字号"
                      disabled={
                        !activeCategoryNote ||
                        activeCategoryId === "trash" ||
                        !canStepNoteFontScale(noteFontScale, -1)
                      }
                      onClick={() => setNoteFontScale(stepNoteFontScale(noteFontScale, -1))}
                    >
                      A−
                    </button>
                    <span>{getNoteFontScaleLabel(noteFontScale)}</span>
                    <button
                      type="button"
                      aria-label="放大便签字号"
                      disabled={
                        !activeCategoryNote ||
                        activeCategoryId === "trash" ||
                        !canStepNoteFontScale(noteFontScale, 1)
                      }
                      onClick={() => setNoteFontScale(stepNoteFontScale(noteFontScale, 1))}
                    >
                      A+
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {isRichMode ? (
            <aside className="editor-panel" key={`rich-${activeNoteId}`}>
              <RichTextEditor
                ref={richEditorRef}
                onImageImportingChange={setIsImportingImage}
                onRichTextChange={setRichStyles}
                onToolbarStateChange={setRichToolbarState}
                readOnly={nativeReadOnly || nativeSwitching}
                richText={
                  richContent ?? { inline: [], lineStyles: {}, text: "" }
                }
              />
              {/* 手机详情栏放不下八个按钮，工具栏排到编辑区底部（与官方移动端一致）。 */}
              {isMobileLayout ? (
                <RichTextToolbar
                  compact
                  disabled={nativeReadOnly || nativeSwitching || activeCategoryId === "trash"}
                  onAction={(shortcut) => {
                    recorder.action("format.rich", shortcut);
                    richEditorRef.current?.applyShortcut(shortcut);
                  }}
                  state={richToolbarState}
                />
              ) : null}
            </aside>
          ) : (
            <EditorPanel
              key={activeNoteId}
              ref={editorPanelRef}
              markdown={editorText}
              onImageImportingChange={setIsImportingImage}
              onMarkdownChange={setMarkdown}
              readOnly={nativeReadOnly || nativeSwitching}
            />
          )}

          <PreviewPanel
            notes={notes}
            exportError={exportError}
            footerBrand={footerBrand}
            footerLogoUrl={footerLogoUrl}
            footerVia={footerVia}
            noteCardTheme={noteCardTheme}
            onFooterBrandChange={setFooterBrand}
            onFooterViaChange={setFooterVia}
            onNoteCardThemeChange={(theme) => { recorder.action("theme.change"); setNoteCardThemeOverride(theme); }}
          />

          <div className="category-empty-workspace" role="status">
            <p>{activeCategoryId === "trash" ? "回收站为空" : "这个分类还没有便签"}</p>
            {activeCategoryId !== "trash" ? (
              <button type="button" onClick={handleCreateNote}>
                新建便签
              </button>
            ) : null}
          </div>
        </div>

        <div className="settings-panel-host" ref={settingsPanelHostRef}>
          {settingsPanel}
          <ConfirmDialog
            pendingAction={
              isHermesSkillLinkResetConfirmationOpen
                ? HERMES_SKILL_LINK_RESET_CONFIRMATION
                : null
            }
            onClose={() => setIsHermesSkillLinkResetConfirmationOpen(false)}
            onConfirm={() => void handleHermesSkillLinkReset()}
          />
        </div>

        {aiReviewNoteId === activeNoteId && activeNote ? (
          <AiReviewDialog
            key={aiReviewNoteId}
            currentMarkdown={markdown}
            currentNoteId={aiReviewNoteId}
            onClose={() => setAiReviewNoteId(null)}
            onMarkdownChange={setMarkdown}
          />
        ) : null}
      </div>

      {isLoginOpen ? (
        <LoginDialog
          login={loginUser}
          onAuthenticated={handleUserAuthenticated}
          onClose={() => setIsLoginOpen(false)}
        />
      ) : null}

      {isChangePasswordOpen ? (
        <ChangePasswordDialog
          changePassword={changeUserPassword}
          initialSetup={isNative && !hasNativeAppPassword}
          onClose={() => setIsChangePasswordOpen(false)}
          onPasswordSet={() => setHasNativeAppPassword(true)}
        />
      ) : null}

      <ConfirmDialog
        pendingAction={pendingAction}
        onClose={clearPendingAction}
        onConfirm={handleConfirmPendingAction}
      />

      {isMoveDialogOpen ? (
        <MoveNoteDialog
          currentFolderId={activeNote?.folderId ?? null}
          folders={folders}
          onClose={() => setIsMoveDialogOpen(false)}
          onCreateFolder={createFolder}
          onMove={handleMoveCurrentNoteToFolder}
        />
      ) : null}
    </>
  );
}
