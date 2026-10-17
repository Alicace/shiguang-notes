import { create } from "zustand";
import { isNative, nativeWritable } from "../lib/fnos-client";
import { recorder } from "../../fnos/m0/ui/diagnostics";
const editable = () => !isNative || nativeWritable;
import { getInitialNoteWorkspace, getInitialTheme } from "../lib/app-state";
import {
  createNoteFolder,
  createNoteDocument,
  discardEmptyNoteDraft,
  getNoteDocumentById,
  moveNoteToFolder,
  moveNoteToTrash,
  reorderNormalNoteDocuments,
  resolveWorkspaceActiveNote,
  restoreNoteFromTrash,
  toggleNotePinned,
  toggleNoteStarred,
} from "../lib/notes";
import type {
  CopyState,
  FormattingMode,
  NoteDocument,
  NoteFolder,
  NoteWorkspace,
  PendingAction,
  RichTextContent,
  ThemePreferenceId,
} from "../types/app";
import { normalizeNoteFontScale } from "../lib/note-typography.js";
import {
  markdownToRichText,
  parseRichTextContent,
  reconcileRichTextAfterEdit,
  richTextToMarkdown,
} from "../lib/rich-text.js";

interface AppStoreState {
  activeNoteId: string;
  folders: NoteFolder[];
  notes: NoteDocument[];
  markdown: string;
  richText: RichTextContent | null;
  selectedTheme: ThemePreferenceId;
  isExporting: boolean;
  exportError: string;
  copyState: CopyState;
  pendingAction: PendingAction | null;
  createNote: (
    markdown?: string,
    folderId?: string | null,
    isStarred?: boolean,
  ) => string;
  discardEmptyDraft: (noteId: string, preferredNextNoteId?: string) => void;
  createFolder: (name: string) => string | null;
  deleteFolder: (folderId: string) => void;
  selectNote: (noteId: string) => void;
  requestDeleteNote: (noteId: string) => void;
  requestPermanentlyDeleteNote: (noteId: string) => void;
  replaceWorkspace: (
    workspace: NoteWorkspace,
    options?: { preserveActiveNote?: boolean },
  ) => void;
  restoreNote: (noteId: string) => void;
  reorderNotes: (activeNoteId: string, overNoteId: string) => void;
  moveNoteToFolder: (noteId: string, folderId: string | null) => void;
  setMarkdown: (markdown: string) => void;
  setFormattingMode: (mode: FormattingMode) => void;
  setNoteFontScale: (scale: number) => void;
  setRichText: (text: string) => void;
  setRichStyles: (rich: RichTextContent) => void;
  setSelectedTheme: (theme: ThemePreferenceId) => void;
  setIsExporting: (isExporting: boolean) => void;
  setExportError: (exportError: string) => void;
  setCopyState: (copyState: CopyState) => void;
  togglePinned: (noteId: string) => void;
  toggleStarred: (noteId: string) => void;
  requestReplaceMarkdown: (
    nextMarkdown: string,
    title: string,
    description: string,
  ) => void;
  clearPendingAction: () => void;
  confirmPendingAction: () => void;
}

const initialWorkspace = getInitialNoteWorkspace();
const initialActiveNote =
  initialWorkspace.notes.find((note) => note.id === initialWorkspace.activeNoteId) ??
  initialWorkspace.notes[0];

// 便签的内容以 Markdown 为渲染视图，富文本便签额外保存文本与样式数据。
function activeContent(note: NoteDocument) {
  return { markdown: note.markdown, richText: note.richText ?? null };
}

export const useAppStore = create<AppStoreState>((set, get) => ({
  activeNoteId: initialActiveNote.id,
  folders: initialWorkspace.folders,
  notes: initialWorkspace.notes,
  markdown: initialActiveNote.markdown,
  richText: initialActiveNote.richText ?? null,
  selectedTheme: getInitialTheme(),
  isExporting: false,
  exportError: "",
  copyState: "idle",
  pendingAction: null,
  createNote: (markdown = "", folderId = null, isStarred = false) => {
    if (!editable()) return get().activeNoteId;
    recorder.action("note.create");
    let createdNoteId = "";

    set((state) => {
      const firstNormalOrder = state.notes.reduce(
        (smallest, note) => Math.min(smallest, note.normalOrder),
        0,
      );
      const note = createNoteDocument(
        markdown,
        Date.now(),
        firstNormalOrder - 1,
        folderId,
        isStarred,
      );
      createdNoteId = note.id;

      return {
        activeNoteId: note.id,
        exportError: "",
        ...activeContent(note),
        notes: [note, ...state.notes],
        pendingAction: null,
      };
    });

    return createdNoteId;
  },
  discardEmptyDraft: (noteId, preferredNextNoteId) =>
    editable() && set((state) => {
      const discarded = discardEmptyNoteDraft(
        state.notes,
        noteId,
        preferredNextNoteId,
      );

      if (!discarded) {
        return {};
      }

      if (state.activeNoteId !== noteId) {
        return {
          notes: discarded.notes,
        };
      }

      return {
        activeNoteId: discarded.activeNote.id,
        exportError: "",
        ...activeContent(discarded.activeNote),
        notes: discarded.notes,
        pendingAction: null,
      };
    }),
  createFolder: (name) => {
    if (!editable()) return null;
    recorder.action("folder.create");
    const normalizedName = name.trim();

    if (!normalizedName) {
      return null;
    }

    const existingFolder = get().folders.find(
      (folder) => folder.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase(),
    );

    if (existingFolder) {
      return existingFolder.id;
    }

    const folder = createNoteFolder(normalizedName);
    set((state) => ({
      folders: [...state.folders, folder],
    }));
    return folder.id;
  },
  deleteFolder: (folderId) =>
    editable() && set((state) => ({
      folders: state.folders.filter((folder) => folder.id !== folderId),
      notes: state.notes.map((note) =>
        note.folderId === folderId
          ? {
              ...note,
              folderId: null,
            }
          : note,
      ),
    })),
  selectNote: (noteId) => {
    recorder.action("note.select");
    const note = getNoteDocumentById(get().notes, noteId);

    if (!note) {
      return;
    }

    set({
      activeNoteId: note.id,
      exportError: "",
      ...activeContent(note),
      pendingAction: null,
    });
  },
  requestDeleteNote: (noteId) => {
    if (!editable()) return;
    recorder.action("note.delete");
    const note = get().notes.find((candidate) => candidate.id === noteId);

    if (!note) {
      return;
    }

    set({
      pendingAction: {
        kind: "delete-note",
        noteId,
        title: "将这张便签移到回收站？",
        description: "便签会保留在回收站中，你之后仍可恢复或永久删除。",
        confirmLabel: "移到回收站",
      },
    });
  },
  requestPermanentlyDeleteNote: (noteId) => {
    if (!editable()) return;
    const note = get().notes.find((candidate) => candidate.id === noteId);

    if (!note || note.deletedAt === null) {
      return;
    }

    set({
      pendingAction: {
        kind: "permanently-delete-note",
        noteId,
        title: "永久删除这张便签？",
        description: "永久删除后无法恢复，便签中的 Markdown 内容也会一并移除。",
        confirmLabel: "永久删除",
      },
    });
  },
  replaceWorkspace: (workspace, options) =>
    set((state) => {
      const activeNote = resolveWorkspaceActiveNote(
        workspace,
        options?.preserveActiveNote ? state.activeNoteId : undefined,
      );

      if (!activeNote) {
        return {};
      }

      return {
        activeNoteId: activeNote.id,
        exportError: "",
        folders: workspace.folders,
        ...activeContent(activeNote),
        notes: workspace.notes,
        pendingAction: null,
      };
    }),
  restoreNote: (noteId) =>
    editable() && set((state) => ({
      notes: restoreNoteFromTrash(state.notes, noteId),
    })),
  reorderNotes: (activeNoteId, overNoteId) =>
    editable() && set((state) => ({
      notes: reorderNormalNoteDocuments(
        state.notes,
        activeNoteId,
        overNoteId,
      ),
    })),
  moveNoteToFolder: (noteId, folderId) =>
    editable() && set((state) => {
      const isKnownFolder =
        folderId === null || state.folders.some((folder) => folder.id === folderId);

      return isKnownFolder
        ? {
            notes: moveNoteToFolder(state.notes, noteId, folderId),
          }
        : {};
    }),
  setMarkdown: (markdown) =>
    editable() && set((state) => {
      const activeNote = state.notes.find((note) => note.id === state.activeNoteId);
      const updatedAt = Date.now();
      return {
        markdown,
        notes: state.notes.map((note) =>
          note.id === state.activeNoteId
            ? {
                ...note,
                markdown,
                // 顶层文本改动会让原有样式区间失效，这里直接丢弃，避免导出错位。
                richText:
                  activeNote?.formattingMode === "rich" ? null : note.richText ?? null,
                updatedAt,
              }
            : note,
        ),
        richText: activeNote?.formattingMode === "rich" ? null : state.richText,
      };
    }),
  // 切换排版模式：Markdown 与富文本互转。样式数据在双向都在且一致时保留，
  // 只有 Markdown 侧被改过才重新解析，切模式既不会丢格式也不会丢修改。
  setFormattingMode: (mode) =>
    editable() && set((state) => {
      const activeNote = state.notes.find((note) => note.id === state.activeNoteId);

      if (!activeNote) {
        return {};
      }

      const currentMode = activeNote.formattingMode ?? "markdown";

      if (currentMode === mode) {
        return {};
      }

      let richText: RichTextContent | null = activeNote.richText ?? null;
      let markdown = activeNote.markdown;

      if (mode === "rich") {
        richText =
          richText && richTextToMarkdown(richText) === markdown
            ? richText
            : markdownToRichText(markdown);
        markdown = richTextToMarkdown(richText);
      } else if (currentMode === "rich" && richText) {
        markdown = richTextToMarkdown(richText);
      }

      const updatedAt = Date.now();
      return {
        markdown,
        richText,
        notes: state.notes.map((note) =>
          note.id === activeNote.id
            ? { ...note, formattingMode: mode, markdown, richText, updatedAt }
            : note,
        ),
      };
    }),
  // 便签字号档位（官方移动端 A+/A- 的等价物）：只影响整篇排版，不改正文。
  setNoteFontScale: (scale) =>
    editable() && set((state) => {
      const fontScale = normalizeNoteFontScale(scale);
      return {
        notes: state.notes.map((note) =>
          note.id === state.activeNoteId
            ? { ...note, fontScale, updatedAt: Date.now() }
            : note,
        ),
      };
    }),
  setRichText: (text) =>
    editable() && set((state) => {
      const activeNote = state.notes.find((note) => note.id === state.activeNoteId);

      if (!activeNote) {
        return {};
      }

      const base: RichTextContent = activeNote.richText ?? {
        inline: [],
        lineStyles: {},
        text: "",
      };
      const richText = reconcileRichTextAfterEdit(base, text);
      const markdown = richTextToMarkdown(richText);
      const updatedAt = Date.now();
      return {
        markdown,
        richText,
        notes: state.notes.map((note) =>
          note.id === activeNote.id
            ? { ...note, markdown, richText, updatedAt }
            : note,
        ),
      };
    }),
  setRichStyles: (rich) =>
    editable() && set((state) => {
      const activeNote = state.notes.find((note) => note.id === state.activeNoteId);
      const richText = parseRichTextContent(rich);

      if (!activeNote || !richText) {
        return {};
      }

      const markdown = richTextToMarkdown(richText);
      const updatedAt = Date.now();
      return {
        markdown,
        richText,
        notes: state.notes.map((note) =>
          note.id === activeNote.id
            ? { ...note, markdown, richText, updatedAt }
            : note,
        ),
      };
    }),
  setSelectedTheme: (selectedTheme) => set({ selectedTheme }),
  setIsExporting: (isExporting) => set({ isExporting }),
  setExportError: (exportError) => set({ exportError }),
  setCopyState: (copyState) => set({ copyState }),
  togglePinned: (noteId) =>
    editable() && set((state) => ({
      notes: toggleNotePinned(state.notes, noteId),
    })),
  toggleStarred: (noteId) =>
    editable() && set((state) => ({
      notes: toggleNoteStarred(state.notes, noteId),
    })),
  requestReplaceMarkdown: (nextMarkdown, title, description) =>
    editable() && set((state) => ({
      pendingAction: {
        kind: "replace-markdown",
        noteId: state.activeNoteId,
        nextMarkdown,
        title,
        description,
        confirmLabel: "确认覆盖",
      },
    })),
  clearPendingAction: () => set({ pendingAction: null }),
  confirmPendingAction: () => {
    if (!editable()) return;
    const { activeNoteId, notes, pendingAction } = get();

    if (!pendingAction) {
      return;
    }

    if (pendingAction.kind === "replace-markdown") {
      const updatedAt = Date.now();
      const replacedRich = notes.some(
        (note) =>
          note.id === pendingAction.noteId && note.formattingMode === "rich",
      )
        ? markdownToRichText(pendingAction.nextMarkdown)
        : null;
      set({
        markdown:
          pendingAction.noteId === activeNoteId
            ? pendingAction.nextMarkdown
            : get().markdown,
        richText:
          pendingAction.noteId === activeNoteId
            ? replacedRich ?? get().richText
            : get().richText,
        notes: notes.map((note) =>
          note.id === pendingAction.noteId
            ? {
                ...note,
                markdown: pendingAction.nextMarkdown,
                richText:
                  note.formattingMode === "rich"
                    ? (replacedRich ?? note.richText ?? null)
                    : (note.richText ?? null),
                updatedAt,
              }
            : note,
        ),
        pendingAction: null,
      });
      return;
    }

    if (pendingAction.kind === "delete-note") {
      const deletedNotes = moveNoteToTrash(notes, pendingAction.noteId);

      if (pendingAction.noteId !== activeNoteId) {
        set({
          notes: deletedNotes,
          pendingAction: null,
        });
        return;
      }

      const liveNotes = deletedNotes.filter((note) => note.deletedAt === null);

      if (liveNotes.length === 0) {
        set({
          // 删除最后一张正常便签后留在空工作区，由用户主动点击新建；
          // 已删除内容仍保留在回收站，不能偷偷塞回一张空白便签。
          activeNoteId: pendingAction.noteId,
          exportError: "",
          markdown: "",
          richText: null,
          notes: deletedNotes,
          pendingAction: null,
        });
        return;
      }

      const nextActiveNote = liveNotes[0];
      set({
        activeNoteId: nextActiveNote.id,
        exportError: "",
        ...activeContent(nextActiveNote),
        notes: deletedNotes,
        pendingAction: null,
      });
      return;
    }

    const noteIndex = notes.findIndex((note) => note.id === pendingAction.noteId);
    const remainingNotes = notes.filter((note) => note.id !== pendingAction.noteId);

    if (remainingNotes.length === 0) {
      const emptyNote = createNoteDocument();
      set({
        activeNoteId: emptyNote.id,
        exportError: "",
        ...activeContent(emptyNote),
        notes: [emptyNote],
        pendingAction: null,
      });
      return;
    }

    if (pendingAction.noteId !== activeNoteId) {
      set({
        notes: remainingNotes,
        pendingAction: null,
      });
      return;
    }

    const nextActiveNote =
      remainingNotes.find((note) => note.deletedAt === null) ??
      remainingNotes[Math.min(Math.max(noteIndex, 0), remainingNotes.length - 1)];
    set({
      activeNoteId: nextActiveNote.id,
      exportError: "",
      ...activeContent(nextActiveNote),
      notes: remainingNotes,
      pendingAction: null,
    });
  },
}));
