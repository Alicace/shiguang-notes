import type { NoteWorkspace } from "../types/app.js";

/**
 * 手动保存快捷键（Ctrl+S / Cmd+S）的最小事件形状，便于在单元测试里
 * 用普通对象直接验证行为，而不依赖真实 DOM。
 */
export interface SaveShortcutEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
  isComposing?: boolean;
}

/**
 * 只判断是否命中 Ctrl/Cmd+S（大小写不敏感，排除 Alt/Shift 组合）。
 * 不在这里排除 repeat 或输入法组合态：编辑态一旦命中就必须先阻止浏览器
 * “保存网页”，再决定是否真正执行保存。
 */
export function matchesSaveShortcut(event: SaveShortcutEventLike): boolean {
  if (!event.ctrlKey && !event.metaKey) {
    return false;
  }

  if (event.altKey || event.shiftKey) {
    return false;
  }

  return event.key.toLowerCase() === "s";
}

/** repeat 与输入法组合态允许拦截浏览器默认行为，但不能真正执行保存。 */
export function canExecuteSaveShortcut(event: SaveShortcutEventLike): boolean {
  return !event.repeat && !event.isComposing;
}

export interface CloudWorkspaceSaveResult {
  updatedAt: number | null;
  workspace: NoteWorkspace | null;
}

export interface CloudSaveQueueOptions {
  save: (workspace: NoteWorkspace) => Promise<CloudWorkspaceSaveResult>;
  onSaved?: (result: CloudWorkspaceSaveResult) => void;
  onError?: (error: unknown) => void;
}

export interface CloudSaveQueue {
  isSaving: () => boolean;
  /** 是否有比当前在途请求更新的快照已排队等待写入。 */
  hasPending: () => boolean;
  /**
   * 请求保存一份快照。同一时刻只允许一个 PUT 在途，在途期间再次调用会
   * 合并为最新的那一份，保证旧快照不会晚于新快照写入服务端。
   */
  enqueue: (workspace: NoteWorkspace) => void;
  /** 等待队列空闲，仅测试与收尾使用。 */
  whenIdle: () => Promise<void>;
}

/**
 * 串行化云端工作区保存。除了保证写入顺序，`isSaving()` 也让轮询可以
 * 在本地保存未落地时直接跳过，避免把旧的云端数据回灌到编辑器。
 */
export function createCloudSaveQueue(
  options: CloudSaveQueueOptions,
): CloudSaveQueue {
  let pending: NoteWorkspace | null = null;
  let running = false;
  let idleResolvers: Array<() => void> = [];

  async function drain(): Promise<void> {
    if (running) {
      return;
    }

    running = true;

    try {
      while (pending !== null) {
        const workspace = pending;
        pending = null;

        try {
          const result = await options.save(workspace);
          options.onSaved?.(result);
        } catch (error) {
          options.onError?.(error);
        }
      }
    } finally {
      running = false;

      const resolvers = idleResolvers;
      idleResolvers = [];
      for (const resolve of resolvers) {
        resolve();
      }
    }
  }

  return {
    hasPending: () => pending !== null,
    isSaving: () => running,
    enqueue: (workspace) => {
      pending = workspace;
      void drain();
    },
    whenIdle: () => {
      if (!running && pending === null) {
        return Promise.resolve();
      }

      return new Promise<void>((resolve) => {
        idleResolvers.push(resolve);
      });
    },
  };
}

export interface CloudSyncCompletionDecision {
  hasPendingSave: boolean;
  isDebounceScheduled: boolean;
}

/**
 * 只有队列没有更新的待保存快照、且没有新的防抖定时器时，才把状态显示为
 * “已同步”。前一个在途请求完成时，后续未保存的快照仍应保持“同步中”。
 */
export function shouldMarkCloudSyncComplete(
  decision: CloudSyncCompletionDecision,
): boolean {
  return !decision.hasPendingSave && !decision.isDebounceScheduled;
}

export interface PolledWorkspaceDecision {
  polledUpdatedAt: number | null | undefined;
  knownRevision: number;
  hasPendingLocalSave: boolean;
}

/**
 * 轮询是否可以覆盖本地工作区。只要有本地保存待处理（debounce 未触发或
 * PUT 在途），就绝不覆盖，避免刚输入的内容被上一次云端快照回灌。
 */
export function shouldApplyPolledWorkspace(
  decision: PolledWorkspaceDecision,
): boolean {
  if (decision.hasPendingLocalSave) {
    return false;
  }

  return (
    typeof decision.polledUpdatedAt === "number" &&
    decision.polledUpdatedAt > decision.knownRevision
  );
}

export interface ManualWorkspaceSaveOptions {
  isLoggedIn: boolean;
  isCloudHydrated: boolean;
  getLatestWorkspace: () => NoteWorkspace;
  persistLocalWorkspace: (workspace: NoteWorkspace) => void;
  clearPendingCloudSave: () => void;
  enqueueCloudSave: (workspace: NoteWorkspace) => void;
  markCloudSyncing?: () => void;
}

export type ManualWorkspaceSaveOutcome =
  | "anonymous-persisted"
  | "cloud-enqueued"
  | "skipped-before-hydration";

/**
 * 实际写入流程：
 * - 匿名：立即写入 localStorage，绝不触碰云端。
 * - 已登录且已完成水合：清除 debounce 定时器后立即提交最新 store 快照。
 * - 会话加载/水合完成前：直接跳过，避免用本地旧数据覆盖云端。
 */
export function performManualWorkspaceSave(
  options: ManualWorkspaceSaveOptions,
): ManualWorkspaceSaveOutcome {
  if (!options.isLoggedIn) {
    options.persistLocalWorkspace(options.getLatestWorkspace());
    return "anonymous-persisted";
  }

  if (!options.isCloudHydrated) {
    return "skipped-before-hydration";
  }

  options.clearPendingCloudSave();
  options.markCloudSyncing?.();
  options.enqueueCloudSave(options.getLatestWorkspace());
  return "cloud-enqueued";
}

export interface SaveShortcutHandlingEvent extends SaveShortcutEventLike {
  preventDefault: () => void;
}

export interface WorkspaceSaveShortcutContext {
  /** 是否处于编辑器工作区（非回收站、无覆盖层、桌面或手机编辑态）。 */
  isEditorActive: boolean;
  /** 焦点是否位于允许触发保存的编辑器控件内，而不是搜索框或内部弹窗。 */
  isTargetAllowed: boolean;
  /** 会话与当前便签是否已就绪；未就绪只拦截浏览器保存，不写入。 */
  isWriteReady: boolean;
  isLoggedIn: boolean;
  isCloudHydrated: boolean;
  getLatestWorkspace: () => NoteWorkspace;
  persistLocalWorkspace: (workspace: NoteWorkspace) => void;
  clearPendingCloudSave: () => void;
  enqueueCloudSave: (workspace: NoteWorkspace) => void;
  markCloudSyncing?: () => void;
}

export type WorkspaceSaveShortcutOutcome =
  | "ignored"
  | "prevented-only"
  | ManualWorkspaceSaveOutcome;

/**
 * 编辑器保存快捷键的完整处理顺序，匹配与执行严格分离：
 * 1. 未命中 Ctrl/Cmd+S、不在编辑态或焦点在其他控件/弹窗：不拦截。
 * 2. 编辑器一旦命中：始终 `preventDefault()`，阻止浏览器“保存网页”。
 * 3. repeat、输入法组合态、会话未就绪：只拦截不写入。
 * 4. 其余情况按匿名/登录路径写入最新快照。
 */
export function handleWorkspaceSaveShortcut(
  event: SaveShortcutHandlingEvent,
  context: WorkspaceSaveShortcutContext,
): WorkspaceSaveShortcutOutcome {
  if (!matchesSaveShortcut(event)) {
    return "ignored";
  }

  if (!context.isEditorActive || !context.isTargetAllowed) {
    return "ignored";
  }

  event.preventDefault();

  if (!context.isWriteReady) {
    return "prevented-only";
  }

  if (!canExecuteSaveShortcut(event)) {
    return "prevented-only";
  }

  return performManualWorkspaceSave({
    isLoggedIn: context.isLoggedIn,
    isCloudHydrated: context.isCloudHydrated,
    getLatestWorkspace: context.getLatestWorkspace,
    persistLocalWorkspace: context.persistLocalWorkspace,
    clearPendingCloudSave: context.clearPendingCloudSave,
    enqueueCloudSave: context.enqueueCloudSave,
    markCloudSyncing: context.markCloudSyncing,
  });
}
