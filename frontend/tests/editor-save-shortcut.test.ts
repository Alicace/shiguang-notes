import assert from "node:assert/strict";
import test from "node:test";
import {
  canExecuteSaveShortcut,
  createCloudSaveQueue,
  handleWorkspaceSaveShortcut,
  matchesSaveShortcut,
  performManualWorkspaceSave,
  shouldApplyPolledWorkspace,
  shouldMarkCloudSyncComplete,
  type CloudWorkspaceSaveResult,
  type SaveShortcutEventLike,
  type SaveShortcutHandlingEvent,
  type WorkspaceSaveShortcutContext,
} from "../../src/lib/workspace-save.js";
import type { NoteWorkspace } from "../../src/types/app.js";

function createWorkspace(markdown: string): NoteWorkspace {
  return {
    activeNoteId: "note-1",
    folders: [],
    notes: [
      {
        id: "note-1",
        markdown,
        createdAt: 1,
        updatedAt: 1,
        normalOrder: 0,
        pinnedAt: null,
        folderId: null,
        isStarred: false,
        deletedAt: null,
      },
    ],
    version: 1,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, reject, resolve };
}

function createEventBase(
  overrides: Partial<SaveShortcutEventLike> = {},
): SaveShortcutEventLike {
  return {
    key: "s",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  };
}

function createDispatchEvent(overrides: Partial<SaveShortcutHandlingEvent> = {}) {
  let prevented = false;

  const event: SaveShortcutHandlingEvent = {
    ...createEventBase(overrides),
    preventDefault: () => {
      prevented = true;
    },
  };

  return { event, wasPrevented: () => prevented };
}

function createContext(
  overrides: Partial<WorkspaceSaveShortcutContext> = {},
) {
  const persisted: NoteWorkspace[] = [];
  const enqueued: NoteWorkspace[] = [];
  let clearedCount = 0;
  let syncingCount = 0;
  let latest = createWorkspace("最新内容");

  const context: WorkspaceSaveShortcutContext = {
    isEditorActive: true,
    isTargetAllowed: true,
    isWriteReady: true,
    isLoggedIn: false,
    isCloudHydrated: false,
    getLatestWorkspace: () => latest,
    persistLocalWorkspace: (workspace) => {
      persisted.push(workspace);
    },
    clearPendingCloudSave: () => {
      clearedCount += 1;
    },
    enqueueCloudSave: (workspace) => {
      enqueued.push(workspace);
    },
    markCloudSyncing: () => {
      syncingCount += 1;
    },
    ...overrides,
  };

  return {
    context,
    enqueued,
    persisted,
    get clearedCount() {
      return clearedCount;
    },
    get syncingCount() {
      return syncingCount;
    },
    setLatest: (workspace: NoteWorkspace) => {
      latest = workspace;
    },
  };
}

test("快捷键命中与可执行性分开判断，repeat/输入法仍算命中但不执行", () => {
  assert.equal(matchesSaveShortcut(createEventBase({ ctrlKey: true })), true);
  assert.equal(
    matchesSaveShortcut(createEventBase({ metaKey: true, key: "S" })),
    true,
  );
  assert.equal(matchesSaveShortcut(createEventBase()), false);
  assert.equal(
    matchesSaveShortcut(createEventBase({ ctrlKey: true, altKey: true })),
    false,
  );
  assert.equal(
    matchesSaveShortcut(createEventBase({ ctrlKey: true, shiftKey: true })),
    false,
  );
  assert.equal(
    matchesSaveShortcut(createEventBase({ ctrlKey: true, key: "p" })),
    false,
  );

  // repeat 与输入法组合态仍然命中快捷键，因此编辑态必须拦截浏览器保存，
  // 但不应真正执行保存。
  const repeated = createEventBase({ ctrlKey: true, repeat: true });
  assert.equal(matchesSaveShortcut(repeated), true);
  assert.equal(canExecuteSaveShortcut(repeated), false);
  assert.equal(
    canExecuteSaveShortcut(
      createEventBase({ ctrlKey: true, isComposing: true }),
    ),
    false,
  );
  assert.equal(
    canExecuteSaveShortcut(createEventBase({ ctrlKey: true })),
    true,
  );
});

test("编辑态长按 repeat 会阻止浏览器保存但不会重复写入", () => {
  const dispatch = createDispatchEvent({ ctrlKey: true, repeat: true });
  const state = createContext();

  const outcome = handleWorkspaceSaveShortcut(dispatch.event, state.context);

  assert.equal(outcome, "prevented-only");
  assert.equal(dispatch.wasPrevented(), true);
  assert.deepEqual(state.persisted, []);
  assert.deepEqual(state.enqueued, []);
  assert.equal(state.clearedCount, 0);
});

test("编辑态输入法组合态只阻止默认且不写入", () => {
  const dispatch = createDispatchEvent({ ctrlKey: true, isComposing: true });
  const state = createContext({ isLoggedIn: true, isCloudHydrated: true });

  const outcome = handleWorkspaceSaveShortcut(dispatch.event, state.context);

  assert.equal(outcome, "prevented-only");
  assert.equal(dispatch.wasPrevented(), true);
  assert.deepEqual(state.enqueued, []);
});

test("会话加载中就绪前仍拦截浏览器保存但不写入", () => {
  const dispatch = createDispatchEvent({ ctrlKey: true });
  const state = createContext({
    isWriteReady: false,
    isLoggedIn: true,
    isCloudHydrated: false,
  });

  const outcome = handleWorkspaceSaveShortcut(dispatch.event, state.context);

  assert.equal(outcome, "prevented-only");
  assert.equal(dispatch.wasPrevented(), true);
  assert.deepEqual(state.persisted, []);
  assert.deepEqual(state.enqueued, []);
});

test("焦点在搜索框或编辑器弹窗内时不拦截、不保存文章", () => {
  const searchDispatch = createDispatchEvent({ ctrlKey: true });
  const searchState = createContext({ isTargetAllowed: false });

  assert.equal(
    handleWorkspaceSaveShortcut(searchDispatch.event, searchState.context),
    "ignored",
  );
  assert.equal(searchDispatch.wasPrevented(), false);
  assert.deepEqual(searchState.persisted, []);

  const dialogDispatch = createDispatchEvent({ ctrlKey: true });
  const dialogState = createContext({
    isTargetAllowed: false,
    isLoggedIn: true,
    isCloudHydrated: true,
  });

  assert.equal(
    handleWorkspaceSaveShortcut(dialogDispatch.event, dialogState.context),
    "ignored",
  );
  assert.equal(dialogDispatch.wasPrevented(), false);
  assert.deepEqual(dialogState.enqueued, []);
});

test("非编辑态不劫持浏览器默认保存", () => {
  const dispatch = createDispatchEvent({ ctrlKey: true });
  const state = createContext({ isEditorActive: false });

  const outcome = handleWorkspaceSaveShortcut(dispatch.event, state.context);

  assert.equal(outcome, "ignored");
  assert.equal(dispatch.wasPrevented(), false);
  assert.deepEqual(state.persisted, []);
});

test("匿名编辑态 Ctrl+S 立即写入最新本地快照并阻止浏览器保存", () => {
  const dispatch = createDispatchEvent({ ctrlKey: true });
  const state = createContext();
  const latest = createWorkspace("匿名保存瞬间");
  state.setLatest(latest);

  const outcome = handleWorkspaceSaveShortcut(dispatch.event, state.context);

  assert.equal(outcome, "anonymous-persisted");
  assert.equal(dispatch.wasPrevented(), true);
  assert.deepEqual(state.persisted, [latest]);
  assert.deepEqual(state.enqueued, []);
});

test("登录且水合完成后 Ctrl+S 清定时器并提交最新快照", () => {
  const dispatch = createDispatchEvent({ metaKey: true, key: "S" });
  const state = createContext({ isLoggedIn: true, isCloudHydrated: true });
  const latest = createWorkspace("登录保存瞬间");
  state.setLatest(latest);

  const outcome = handleWorkspaceSaveShortcut(dispatch.event, state.context);

  assert.equal(outcome, "cloud-enqueued");
  assert.equal(dispatch.wasPrevented(), true);
  assert.equal(state.clearedCount, 1);
  assert.equal(state.syncingCount, 1);
  assert.deepEqual(state.enqueued, [latest]);
});

test("登录但水合未完成时 Ctrl+S 只拦截不覆盖云端", () => {
  const dispatch = createDispatchEvent({ ctrlKey: true });
  const state = createContext({ isLoggedIn: true, isCloudHydrated: false });

  const outcome = handleWorkspaceSaveShortcut(dispatch.event, state.context);

  assert.equal(outcome, "skipped-before-hydration");
  assert.equal(dispatch.wasPrevented(), true);
  assert.deepEqual(state.enqueued, []);
  assert.equal(state.clearedCount, 0);
});

test("直接写入流程按顺序清除定时器并提交保存瞬间的最新快照", () => {
  const events: string[] = [];
  const snapshots = [createWorkspace("保存瞬间的最新内容")];
  let readCount = 0;
  let enqueued: NoteWorkspace | null = null;

  const outcome = performManualWorkspaceSave({
    isLoggedIn: true,
    isCloudHydrated: true,
    getLatestWorkspace: () => {
      events.push("read-latest");
      return snapshots[readCount++];
    },
    persistLocalWorkspace: () => events.push("persist-local"),
    clearPendingCloudSave: () => events.push("clear-timer"),
    enqueueCloudSave: (workspace) => {
      events.push("enqueue");
      enqueued = workspace;
    },
    markCloudSyncing: () => events.push("syncing"),
  });

  assert.equal(outcome, "cloud-enqueued");
  assert.deepEqual(events, ["clear-timer", "syncing", "read-latest", "enqueue"]);
  assert.equal(readCount, 1);
  assert.equal(enqueued, snapshots[0]);
});

test("匿名直接写入流程绝不触碰云端", () => {
  const events: string[] = [];
  let latest = createWorkspace("匿名最新内容");
  let persisted: NoteWorkspace | null = null;

  const outcome = performManualWorkspaceSave({
    isLoggedIn: false,
    isCloudHydrated: false,
    getLatestWorkspace: () => latest,
    persistLocalWorkspace: (workspace) => {
      events.push("persist");
      persisted = workspace;
    },
    clearPendingCloudSave: () => events.push("clear"),
    enqueueCloudSave: () => events.push("enqueue"),
  });

  assert.equal(outcome, "anonymous-persisted");
  assert.equal(persisted, latest);
  assert.deepEqual(events, ["persist"]);
});

test("云端保存队列串行执行，在途期间的连续保存只保留最新快照", async () => {
  const first = createDeferred<CloudWorkspaceSaveResult>();
  const committed: string[] = [];
  const queue = createCloudSaveQueue({
    save: (workspace) => {
      committed.push(workspace.notes[0].markdown);

      if (committed.length === 1) {
        return first.promise;
      }

      return Promise.resolve({ updatedAt: 2, workspace });
    },
  });

  queue.enqueue(createWorkspace("A"));
  assert.equal(queue.isSaving(), true);
  assert.equal(queue.hasPending(), false);

  queue.enqueue(createWorkspace("B"));
  queue.enqueue(createWorkspace("C"));
  assert.equal(queue.hasPending(), true);

  assert.deepEqual(committed, ["A"]);

  first.resolve({ updatedAt: 1, workspace: createWorkspace("A") });
  await queue.whenIdle();

  assert.deepEqual(committed, ["A", "C"]);
  assert.equal(queue.isSaving(), false);
  assert.equal(queue.hasPending(), false);
});

test("在途保存完成时若已有更新的待保存快照，hasPending 为真", async () => {
  const first = createDeferred<CloudWorkspaceSaveResult>();
  const pendingAtSave: boolean[] = [];
  const queue = createCloudSaveQueue({
    save: (workspace) => {
      if (workspace.notes[0].markdown === "A") {
        return first.promise;
      }

      return Promise.resolve({ updatedAt: 2, workspace });
    },
    onSaved: () => {
      pendingAtSave.push(queue.hasPending());
    },
  });

  queue.enqueue(createWorkspace("A"));
  queue.enqueue(createWorkspace("B"));
  first.resolve({ updatedAt: 1, workspace: createWorkspace("A") });
  await queue.whenIdle();

  assert.deepEqual(pendingAtSave, [true, false]);
});

test("只有队列无 pending 且无防抖定时器时才显示已同步", () => {
  assert.equal(
    shouldMarkCloudSyncComplete({
      hasPendingSave: true,
      isDebounceScheduled: false,
    }),
    false,
  );
  assert.equal(
    shouldMarkCloudSyncComplete({
      hasPendingSave: false,
      isDebounceScheduled: true,
    }),
    false,
  );
  assert.equal(
    shouldMarkCloudSyncComplete({
      hasPendingSave: true,
      isDebounceScheduled: true,
    }),
    false,
  );
  assert.equal(
    shouldMarkCloudSyncComplete({
      hasPendingSave: false,
      isDebounceScheduled: false,
    }),
    true,
  );
});

test("云端保存失败会回调错误并允许后续保存继续执行", async () => {
  const errors: unknown[] = [];
  const attempts: string[] = [];
  const queue = createCloudSaveQueue({
    save: async (workspace) => {
      attempts.push(workspace.notes[0].markdown);

      if (attempts.length === 1) {
        throw new Error("网络错误");
      }

      return { updatedAt: 9, workspace };
    },
    onError: (error) => errors.push(error),
  });

  queue.enqueue(createWorkspace("失败"));
  await queue.whenIdle();

  assert.equal(errors.length, 1);
  assert.equal((errors[0] as Error).message, "网络错误");
  assert.equal(queue.isSaving(), false);

  queue.enqueue(createWorkspace("重试"));
  await queue.whenIdle();

  assert.deepEqual(attempts, ["失败", "重试"]);
});

test("有本地待保存时轮询结果不得覆盖编辑器", () => {
  assert.equal(
    shouldApplyPolledWorkspace({
      polledUpdatedAt: 100,
      knownRevision: 1,
      hasPendingLocalSave: true,
    }),
    false,
  );
  assert.equal(
    shouldApplyPolledWorkspace({
      polledUpdatedAt: 100,
      knownRevision: 1,
      hasPendingLocalSave: false,
    }),
    true,
  );
  assert.equal(
    shouldApplyPolledWorkspace({
      polledUpdatedAt: 1,
      knownRevision: 1,
      hasPendingLocalSave: false,
    }),
    false,
  );
  assert.equal(
    shouldApplyPolledWorkspace({
      polledUpdatedAt: null,
      knownRevision: 0,
      hasPendingLocalSave: false,
    }),
    false,
  );
});
