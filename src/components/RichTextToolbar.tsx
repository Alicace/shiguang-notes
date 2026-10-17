import { useState } from "react";
import type { RichBlockStyle, RichInlineStyle } from "../types/app.js";
import type { RichShortcut } from "../lib/rich-text.js";

// 官方把富文本工具栏放在便签状态栏同一行（`富文本模式 ▾` 右边），
// 这里保持同样的位置与图标语义，只把图标换成项目内的线性 SVG。
export interface RichToolbarState {
  blocks: RichBlockStyle[];
  center: boolean;
  head?: number;
  inline: RichInlineStyle[];
}

export const EMPTY_RICH_TOOLBAR_STATE: RichToolbarState = {
  blocks: [],
  center: false,
  inline: [],
};

interface RichTextToolbarProps {
  compact?: boolean;
  disabled?: boolean;
  onAction: (shortcut: RichShortcut) => void;
  state: RichToolbarState;
}

interface ToolbarToggle {
  action: RichShortcut;
  mobileLabel: string;
  text?: string;
}

// 桌面显示完整工具集；手机只放官方六个高频工具，其余收进「更多」。
const TOGGLES: ToolbarToggle[] = [
  { action: "title", mobileLabel: "标题", text: "H" },
  { action: "center", mobileLabel: "居中" },
  { action: "list", mobileLabel: "列表" },
  { action: "todo", mobileLabel: "待办" },
  { action: "bold", mobileLabel: "粗体", text: "B" },
  { action: "italic", mobileLabel: "斜体", text: "I" },
  { action: "underline", mobileLabel: "下划线", text: "U" },
  { action: "strike", mobileLabel: "删除线", text: "S" },
  { action: "code", mobileLabel: "代码", text: "<>" },
  { action: "quote", mobileLabel: "引用" },
  { action: "clear", mobileLabel: "清除" },
];

const MOBILE_PRIMARY_ACTIONS: RichShortcut[] = [
  "title",
  "center",
  "list",
  "bold",
  "quote",
  "todo",
];

export function richToolbarLabel(action: RichShortcut): string {
  switch (action) {
    case "title":
      return "选择标题级别";
    case "center":
      return "居中当前行";
    case "list":
      return "切换无序列表";
    case "todo":
      return "切换待办事项";
    case "bold":
      return "加粗所选文字";
    case "quote":
      return "切换引用";
    case "italic":
      return "斜体所选文字";
    case "underline":
      return "给所选文字加下划线";
    case "strike":
      return "给所选文字加删除线";
    case "code":
      return "设置行内代码";
    case "clear":
      return "清除所选格式";
    default:
      return "排版";
  }
}

function isActive(action: RichShortcut, state: RichToolbarState): boolean {
  switch (action) {
    case "title":
      return Boolean(state.head);
    case "center":
      return state.center;
    case "list":
      return state.blocks.includes("ul");
    case "todo":
      return (
        state.blocks.includes("todo") || state.blocks.includes("todo_checked")
      );
    case "bold":
    case "italic":
    case "underline":
    case "strike":
    case "code":
      return state.inline.includes(action);
    case "quote":
      return state.blocks.includes("quote");
    default:
      return false;
  }
}

function ToolbarIcon({ action }: { action: RichShortcut }) {
  if (action === "center") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M3.5 4.5h13M5.5 8.5h9M3.5 12.5h13M5.5 16.5h9" />
      </svg>
    );
  }

  if (action === "list") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M7.5 5.5h9M7.5 10h9M7.5 14.5h9" />
        <circle cx="4" cy="5.5" r="1.1" />
        <circle cx="4" cy="10" r="1.1" />
        <circle cx="4" cy="14.5" r="1.1" />
      </svg>
    );
  }

  if (action === "todo") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <rect x="3.2" y="3.2" width="13.6" height="13.6" rx="2.6" />
        <path d="M6.6 10.2l2.3 2.3 4.5-4.6" />
      </svg>
    );
  }

  if (action === "quote") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M6.2 6.6c-1.6 0-2.7 1.1-2.7 2.6s1 2.5 2.5 2.5c.4 0 .8-.1 1.1-.3-.3 1.2-1.2 2-2.5 2.4" />
        <path d="M13.9 6.6c-1.6 0-2.7 1.1-2.7 2.6s1 2.5 2.5 2.5c.4 0 .8-.1 1.1-.3-.3 1.2-1.2 2-2.5 2.4" />
      </svg>
    );
  }

  if (action === "clear") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="m4.2 11.1 5.8-5.8 5.8 5.8-3.4 3.4H7.6l-3.4-3.4Z" />
        <path d="m7.2 18h8.4M6.2 9.1l5.8 5.8" />
      </svg>
    );
  }

  return null;
}

export function RichTextToolbar({
  compact = false,
  disabled = false,
  onAction,
  state,
}: RichTextToolbarProps) {
  const [isHeadingMenuOpen, setIsHeadingMenuOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const visibleToggles = compact
    ? TOGGLES.filter((toggle) =>
        MOBILE_PRIMARY_ACTIONS.includes(toggle.action),
      )
    : TOGGLES;
  const moreToggles = TOGGLES.filter(
    (toggle) => !MOBILE_PRIMARY_ACTIONS.includes(toggle.action),
  );

  function runAction(action: RichShortcut): void {
    setIsHeadingMenuOpen(false);
    setIsMoreMenuOpen(false);
    onAction(action);
  }

  function renderToggle(toggle: ToolbarToggle) {
    const active = isActive(toggle.action, state);

    return (
      <button
        key={toggle.action}
        type="button"
        className={active ? "is-active" : undefined}
        aria-label={richToolbarLabel(toggle.action)}
        aria-pressed={active}
        disabled={disabled}
        // 保住编辑器里的选区：点工具栏不抢焦点。
        onPointerDown={(event) => {
          event.preventDefault();
        }}
        onClick={() => {
          if (toggle.action === "title") {
            setIsHeadingMenuOpen((isOpen) => !isOpen);
            setIsMoreMenuOpen(false);
            return;
          }

          runAction(toggle.action);
        }}
      >
        <ToolbarIcon action={toggle.action} />
        {toggle.text ? (
          <span
            className={`editor-rich-toolbar-text is-${toggle.action}`}
            aria-hidden="true"
          >
            {toggle.text}
          </span>
        ) : null}
        {compact ? (
          <span className="editor-rich-toolbar-label" aria-hidden="true">
            {toggle.mobileLabel}
          </span>
        ) : null}
      </button>
    );
  }

  return (
    <div
      className={`editor-rich-toolbar${compact ? " is-compact" : ""}`}
      role="toolbar"
      aria-label="富文本工具栏"
    >
      {visibleToggles.map(renderToggle)}
      {compact ? (
        <button
          type="button"
          className={`editor-rich-more-trigger${isMoreMenuOpen ? " is-active" : ""}`}
          aria-label="更多文字格式"
          aria-expanded={isMoreMenuOpen}
          disabled={disabled}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            setIsMoreMenuOpen((isOpen) => !isOpen);
            setIsHeadingMenuOpen(false);
          }}
        >
          <span aria-hidden="true">•••</span>
          <span className="editor-rich-toolbar-label" aria-hidden="true">
            更多
          </span>
        </button>
      ) : null}

      {isHeadingMenuOpen ? (
        <div className="editor-rich-heading-menu" role="menu" aria-label="选择标题级别">
          {([
            ["body", "正文"],
            ["h1", "标题 1"],
            ["h2", "标题 2"],
            ["h3", "标题 3"],
          ] as const).map(([action, label]) => (
            <button
              key={action}
              type="button"
              role="menuitemradio"
              aria-checked={
                action === "body"
                  ? !state.head
                  : state.head === Number(action.slice(1))
              }
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => runAction(action)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {isMoreMenuOpen ? (
        <div className="editor-rich-more-menu" role="menu" aria-label="更多文字格式">
          {moreToggles.map((toggle) => {
            const active = isActive(toggle.action, state);
            return (
              <button
                key={toggle.action}
                type="button"
                role="menuitemcheckbox"
                aria-checked={active}
                className={active ? "is-active" : undefined}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => runAction(toggle.action)}
              >
                <ToolbarIcon action={toggle.action} />
                {toggle.text ? <span aria-hidden="true">{toggle.text}</span> : null}
                <span>{toggle.mobileLabel}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
