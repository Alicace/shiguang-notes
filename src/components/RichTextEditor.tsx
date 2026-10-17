import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  defaultKeymap,
  history,
  historyKeymap,
} from "@codemirror/commands";
import {
  EditorSelection,
  EditorState,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  keymap,
  type DecorationSet,
} from "@codemirror/view";
import { importImageFile, importImageUrl } from "../lib/images.js";
import { applyRichShortcut, type RichShortcut } from "../lib/rich-text.js";
import {
  fromStyleState,
  richStyleField,
  setRichStyles,
  toStyleState,
  toggleTodoLine,
} from "../lib/rich-editor-state.js";
import type { RichToolbarState } from "./RichTextToolbar.js";
import type {
  RichBlockStyle,
  RichInlineStyle,
  RichLineStyle,
  RichTextContent,
} from "../types/app.js";

export interface RichTextEditorHandle {
  applyShortcut: (shortcut: RichShortcut) => void;
  focus: () => void;
  insertText: (text: string) => void;
  openImagePicker: () => void;
}

interface RichTextEditorProps {
  readOnly?: boolean;
  richText: RichTextContent;
  onImageImportingChange?: (isImporting: boolean) => void;
  onRichTextChange: (rich: RichTextContent) => void;
  onToolbarStateChange?: (state: RichToolbarState) => void;
}

const IMAGE_LINE_PATTERN = /^\s*!\[([^\]]*)\]\(([^()\n]|\([^)\n]*\))+\)\s*$/;

function findImageUrl(html: string, text: string): string | null {
  if (html) {
    const image = new DOMParser()
      .parseFromString(html, "text/html")
      .querySelector("img");
    const source = image?.getAttribute("src")?.trim();

    if (source && /^https?:\/\//i.test(source)) {
      return source;
    }
  }

  const candidate = text.trim();
  return /^https?:\/\/\S+\.(?:avif|bmp|gif|jpe?g|png|webp)(?:[?#]\S*)?$/i.test(
    candidate,
  )
    ? candidate
    : null;
}

function clipboardImageFile(event: ClipboardEvent): File | null {
  return (
    Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .find((file): file is File => Boolean(file?.type.startsWith("image/"))) ??
    null
  );
}

function dropImageFile(dataTransfer: DataTransfer): File | null {
  return (
    Array.from(dataTransfer.files).find((file) =>
      file.type.startsWith("image/"),
    ) ?? null
  );
}

function hasImageTransfer(dataTransfer: DataTransfer): boolean {
  return (
    Array.from(dataTransfer.files).some((file) =>
      file.type.startsWith("image/"),
    ) ||
    Array.from(dataTransfer.types).includes("Files") ||
    Array.from(dataTransfer.files).length === 0 &&
      (dataTransfer.types.includes("text/html") ||
        dataTransfer.types.includes("text/uri-list"))
  );
}

// 富文本编辑面里的图片按图片块呈现，而不是一行 `![]()` 文本。
class ImageWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly alt: string,
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return other.source === this.source && other.alt === this.alt;
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = "rtf-image";
    const image = document.createElement("img");
    image.src = this.source;
    image.alt = this.alt;
    image.loading = "lazy";
    image.decoding = "async";
    wrapper.append(image);
    return wrapper;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function parseImageLine(text: string): { alt: string; source: string } | null {
  const match = text.match(IMAGE_LINE_PATTERN);

  if (!match) {
    return null;
  }

  const source = text.slice(text.indexOf("](") + 2, text.lastIndexOf(")")).trim();
  return source ? { alt: match[1] ?? "", source } : null;
}

class TodoWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  eq(other: TodoWidget): boolean {
    return other.checked === this.checked;
  }

  toDOM(): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `rtf-todo-box${this.checked ? " is-checked" : ""}`;
    button.setAttribute("aria-label", this.checked ? "标记为未完成" : "标记为已完成");
    button.setAttribute("role", "checkbox");
    button.setAttribute("aria-checked", String(this.checked));
    return button;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function buildDecorations(state: EditorState): DecorationSet {
  const styleState = state.field(richStyleField);
  const ranges: Array<{ deco: Decoration; from: number; to?: number }> = [];
  const styleByLine = new Map<number, RichLineStyle>();

  for (const entry of styleState.lines) {
    const position = Math.max(0, Math.min(entry.start, state.doc.length));
    styleByLine.set(state.doc.lineAt(position).number, entry.style);
  }

  // 逐行构建：图片行优先按图片块呈现，其余行按行样式加装饰。
  for (let number = 1; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number);
    const image = parseImageLine(line.text);

    if (image) {
      ranges.push({ deco: Decoration.line({ class: "rtf-image-line" }), from: line.from });
      ranges.push({
        deco: Decoration.replace({
          widget: new ImageWidget(image.source, image.alt),
        }),
        from: line.from,
        to: line.to,
      });
      continue;
    }

    const style = styleByLine.get(number);
    const classes: string[] = [];

    if (style) {
      const { blocks, head, center } = style;

      if (head) {
        classes.push(`rtf-head-${head}`);
      }

      if (blocks.includes("ul")) {
        classes.push("rtf-list");
      }

      if (blocks.includes("ol")) {
        classes.push("rtf-ordered");
      }

      if (blocks.includes("quote")) {
        classes.push("rtf-quote");
      }

      if (blocks.includes("todo") || blocks.includes("todo_checked")) {
        classes.push("rtf-todo");
        ranges.push({
          deco: Decoration.widget({
            side: -1,
            widget: new TodoWidget(blocks.includes("todo_checked")),
          }),
          from: line.from,
        });
      }

      if (center) {
        classes.push("rtf-center");
      }
    }

    if (classes.length) {
      ranges.push({ deco: Decoration.line({ class: classes.join(" ") }), from: line.from });
    }
  }

  for (const entry of styleState.inline) {
    const from = Math.max(0, Math.min(entry.from, state.doc.length));
    const to = Math.max(from, Math.min(entry.to, state.doc.length));

    if (to > from) {
      ranges.push({
        deco: Decoration.mark({
          class:
            entry.style === "bold"
              ? "rtf-bold"
              : entry.style === "italic"
                ? "rtf-italic"
                : entry.style === "underline"
                  ? "rtf-underline"
                  : entry.style === "strike"
                    ? "rtf-strike"
                    : "rtf-code",
        }),
        from,
        to,
      });
    }
  }

  return Decoration.set(
    ranges.map((range) =>
      range.to === undefined
        ? range.deco.range(range.from)
        : range.deco.range(range.from, range.to),
    ),
    true,
  );
}

const editorTheme = EditorView.theme({
  "&": { height: "100%" },
  ".cm-scroller": { overflow: "auto" },
  ".cm-content": { caretColor: "var(--ink, #4a4038)" },
  "&.cm-focused": { outline: "none" },
  ".cm-gutters": { display: "none" },
});

export const RichTextEditor = forwardRef<
  RichTextEditorHandle,
  RichTextEditorProps
>(function RichTextEditor(
  {
    readOnly = false,
    richText,
    onImageImportingChange,
    onRichTextChange,
    onToolbarStateChange,
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const changeHandlerRef = useRef(onRichTextChange);
  const toolbarHandlerRef = useRef(onToolbarStateChange);
  const [imageError, setImageError] = useState("");
  const [isImportingImage, setIsImportingImage] = useState(false);
  const [isDropTargetActive, setIsDropTargetActive] = useState(false);
  const [activeLineNumber, setActiveLineNumber] = useState(1);

  changeHandlerRef.current = onRichTextChange;
  toolbarHandlerRef.current = onToolbarStateChange;

  const syncActiveLine = useCallback(() => {
    const view = viewRef.current;

    if (!view) {
      return;
    }

    const { from, to } = view.state.selection.main;
    const line = view.state.doc.lineAt(from);
    const entry = view.state
      .field(richStyleField)
      .lines.find((item) => view.state.doc.lineAt(item.start).number === line.number);
    const range =
      from === to ? (caretWordRange(view, from) ?? { from, to }) : { from, to };
    const inline = view.state
      .field(richStyleField)
      .inline.filter((item) => item.from <= range.from && item.to >= range.to)
      .map((item) => item.style);
    const blocks = entry?.style.blocks ?? [];

    setActiveLineNumber(line.number);
    // 工具栏渲染在便签状态栏里（与官方同一行），因此把激活态同步给外层。
    toolbarHandlerRef.current?.({
      blocks,
      center: entry?.style.center === true,
      head: entry?.style.head,
      inline,
    });
  }, []);

  const importRichImage = useCallback(
    async (source: File | string) => {
      try {
        setIsImportingImage(true);
        onImageImportingChange?.(true);
        setImageError("");
        const result =
          typeof source === "string"
            ? await importImageUrl(source)
            : await importImageFile(source);
        const view = viewRef.current;

        if (!view) {
          return;
        }

        const { from, to } = view.state.selection.main;
        const line = view.state.doc.lineAt(from);
        const leading = line.text.trim() ? "\n" : "";
        const snippet = `${leading}![](${result.path || result.url})`;
        view.dispatch({
          changes: { from, insert: snippet, to },
          selection: EditorSelection.cursor(from + snippet.length),
        });
      } catch (error: unknown) {
        setImageError(
          error instanceof Error ? error.message : "图片导入失败，请稍后重试。",
        );
      } finally {
        setIsImportingImage(false);
        onImageImportingChange?.(false);
      }
    },
    [onImageImportingChange],
  );

  const applyShortcut = useCallback(
    (shortcut: RichShortcut) => {
      const view = viewRef.current;

      if (!view) {
        return;
      }

      const { from, to } = view.state.selection.main;
      const isInline =
        shortcut === "bold" ||
        shortcut === "italic" ||
        shortcut === "underline" ||
        shortcut === "strike" ||
        shortcut === "code";
      // 行内样式作用于光标处的词；行样式作用于选区覆盖的整行（光标折叠时取所在行）。
      const inlineRange = from === to ? caretWordRange(view, from) : { from, to };

      if (isInline && !inlineRange) {
        return;
      }

      // 复用库里的快捷键实现：与 Markdown 视图、公众号与单测共用同一套语义，
      // 行样式可以来回切换（标题 1→2→3→无、待办 无→待办→已完成→无、列表/引用可取消）。
      view.dispatch({
        effects: setRichStyles.of(
          toStyleState(
            applyRichShortcut(
              fromStyleState(view.state),
              isInline
                ? { end: inlineRange!.to, start: inlineRange!.from }
                : { end: Math.max(to, from + 1), start: from },
              shortcut,
            ),
          ),
        ),
      });
    },
    [],
  );

  const commands = useMemo<Extension>(
    () =>
      keymap.of([
        // 自己的绑定放在 defaultKeymap 之前：CodeMirror 的 defaultKeymap 已占用
        // Mod-u（undoSelection），否则下划线快捷键会被它抢先处理。
        {
          key: "Mod-b",
          run: () => {
            applyShortcut("bold");
            return true;
          },
        },
        {
          key: "Mod-i",
          run: () => {
            applyShortcut("italic");
            return true;
          },
        },
        {
          key: "Mod-u",
          run: () => {
            applyShortcut("underline");
            return true;
          },
        },
        {
          key: "Mod-Shift-x",
          run: () => {
            applyShortcut("strike");
            return true;
          },
        },
        {
          key: "Mod-`",
          run: () => {
            applyShortcut("code");
            return true;
          },
        },
        ...defaultKeymap,
        ...historyKeymap,
      ]),
    [applyShortcut],
  );

  useEffect(() => {
    const host = hostRef.current;

    if (!host) {
      return;
    }

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: richText.text,
        extensions: [
          history(),
          commands,
          editorTheme,
          EditorView.lineWrapping,
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          richStyleField,
          EditorView.decorations.compute(
            [richStyleField, "doc"],
            buildDecorations,
          ),
          EditorView.updateListener.of((update) => {
            const hasTransaction = update.transactions.length > 0;

            // 样式改动（工具栏、待办勾选）不改文本但会改变按钮激活态，同样要重新同步。
            if (update.docChanged || update.selectionSet || hasTransaction) {
              syncActiveLine();
            }

            // 样式改动（工具栏、待办勾选）不一定改文本，同样要回写应用层，
            // 否则 store 会拿旧值把编辑面里的样式覆盖回去。
            if (update.docChanged || hasTransaction) {
              changeHandlerRef.current(fromStyleState(update.state));
            }
          }),
          EditorView.domEventHandlers({
            paste: (event) => {
              const file = clipboardImageFile(event);

              if (file) {
                event.preventDefault();
                void importRichImage(file);
                return true;
              }

              const url = findImageUrl(
                event.clipboardData?.getData("text/html") ?? "",
                event.clipboardData?.getData("text/plain") ?? "",
              );

              if (!url) {
                return false;
              }

              event.preventDefault();
              void importRichImage(url);
              return true;
            },
            dragenter: (event) => {
              if (!hasImageTransfer(event.dataTransfer!)) {
                return false;
              }

              event.preventDefault();
              setIsDropTargetActive(true);
              return true;
            },
            dragover: (event) => {
              if (!hasImageTransfer(event.dataTransfer!)) {
                return false;
              }

              event.preventDefault();
              event.dataTransfer!.dropEffect = "copy";
              setIsDropTargetActive(true);
              return true;
            },
            dragleave: (event, activeView) => {
              if (
                event.relatedTarget instanceof Node &&
                activeView.contentDOM.contains(event.relatedTarget)
              ) {
                return false;
              }

              setIsDropTargetActive(false);
              return false;
            },
            drop: (event) => {
              const file = dropImageFile(event.dataTransfer!);
              const url = file
                ? null
                : findImageUrl(
                    event.dataTransfer?.getData("text/html") ?? "",
                    event.dataTransfer?.getData("text/uri-list") ||
                      event.dataTransfer?.getData("text/plain") ||
                      "",
                  );

              setIsDropTargetActive(false);

              if (!file && !url) {
                return false;
              }

              event.preventDefault();
              void importRichImage(file ?? url!);
              return true;
            },
            mousedown: (event, activeView) => {
              const target = event.target;

              if (
                target instanceof HTMLElement &&
                target.classList.contains("rtf-todo-box")
              ) {
                const position = activeView.posAtDOM(target);
                activeView.dispatch({
                  effects: toggleTodoLine.of(
                    activeView.state.doc.lineAt(position).number,
                  ),
                });
                changeHandlerRef.current(fromStyleState(activeView.state));
                event.preventDefault();
                return true;
              }

              return false;
            },
          }),
        ],
      }),
    });

    viewRef.current = view;
    view.dispatch({ effects: setRichStyles.of(toStyleState(richText)) });
    syncActiveLine();

    // 纸张横线与正文必须一起滚动（与 Markdown 模式同一套 --editor-paper-scroll-y）。
    const syncPaperScroll = () => {
      hostRef.current?.style.setProperty(
        "--editor-paper-scroll-y",
        `${-view.scrollDOM.scrollTop}px`,
      );
    };
    view.scrollDOM.addEventListener("scroll", syncPaperScroll, { passive: true });
    syncPaperScroll();

    return () => {
      view.scrollDOM.removeEventListener("scroll", syncPaperScroll);
      view.destroy();
      viewRef.current = null;
    };
    // 编辑器只在便签切换时重建；文本与样式同步由下面的 effect 负责。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commands, importRichImage, readOnly]);

  useEffect(() => {
    const view = viewRef.current;

    if (!view) {
      return;
    }

    const current = fromStyleState(view.state);

    if (
      current.text !== richText.text ||
      JSON.stringify(current.lineStyles) !== JSON.stringify(richText.lineStyles) ||
      JSON.stringify(current.inline) !== JSON.stringify(richText.inline)
    ) {
      view.dispatch({
        changes: { from: 0, insert: richText.text, to: view.state.doc.length },
        effects: setRichStyles.of(toStyleState(richText)),
      });
    }
  }, [richText]);

  useImperativeHandle(
    ref,
    () => ({
      applyShortcut: (shortcut: RichShortcut) => {
        applyShortcut(shortcut);
        viewRef.current?.focus();
      },
      focus: () => viewRef.current?.focus(),
      insertText: (text: string) => {
        const view = viewRef.current;

        if (!view) {
          return;
        }

        const { from, to } = view.state.selection.main;
        view.dispatch({
          changes: { from, insert: text, to },
          selection: EditorSelection.cursor(from + text.length),
        });
      },
      openImagePicker: () => imageInputRef.current?.click(),
    }),
    [],
  );

  return (
    <>
      <div
        className={`rich-editor-surface${
          isDropTargetActive ? " drag-active" : ""
        }`}
        ref={hostRef}
        data-line={activeLineNumber}
      />
      {imageError ? <p className="image-import-status error">{imageError}</p> : null}
      {isImportingImage ? <p className="image-import-status">正在导入图片...</p> : null}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";

          if (!file) {
            return;
          }

          void importRichImage(file);
        }}
      />
    </>
  );
});

function caretWordRange(
  view: EditorView,
  position: number,
): { from: number; to: number } | null {
  const line = view.state.doc.lineAt(position);
  const text = line.text;
  const offset = position - line.from;
  const isWordCharacter = (character: string | undefined) =>
    Boolean(character && /[\p{L}\p{N}]/u.test(character));
  let start = offset;
  let end = offset;

  while (start > 0 && isWordCharacter(text[start - 1])) {
    start -= 1;
  }

  while (end < text.length && isWordCharacter(text[end])) {
    end += 1;
  }

  return end > start ? { from: line.from + start, to: line.from + end } : null;
}
