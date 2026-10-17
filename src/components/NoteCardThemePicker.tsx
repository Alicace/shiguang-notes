import { useEffect, useId, useRef, useState } from "react";
import { NOTE_CARD_THEME_OPTIONS } from "../lib/themes.js";
import type { NoteCardThemeId } from "../types/app.js";

interface NoteCardThemePickerProps {
  className?: string;
  value: NoteCardThemeId;
  onChange: (theme: NoteCardThemeId) => void;
}

export function NoteCardThemePicker({
  className,
  value,
  onChange,
}: NoteCardThemePickerProps) {
  const popoverId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const activeOption = NOTE_CARD_THEME_OPTIONS.find(
    (option) => option.id === value,
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !containerRef.current?.contains(event.target)
      ) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen]);

  function handleSelect(theme: NoteCardThemeId) {
    onChange(theme);
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div
      className={`preview-theme-control${className ? ` ${className}` : ""}`}
      ref={containerRef}
    >
      {isOpen ? (
        <div
          className="preview-theme-popover"
          id={popoverId}
          role="menu"
          aria-label="选择预览主题"
        >
          <p className="preview-theme-popover-title">主题</p>
          <div className="preview-theme-options">
            {NOTE_CARD_THEME_OPTIONS.map((option) => {
              const isActive = option.id === value;

              return (
                <button
                  key={option.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  className={`preview-theme-option${isActive ? " is-active" : ""}`}
                  onClick={() => handleSelect(option.id)}
                >
                  <span
                    className="preview-theme-swatch"
                    data-preview-theme={option.id}
                    aria-hidden="true"
                  />
                  <span className="preview-theme-option-copy">
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                  <span className="preview-theme-option-check" aria-hidden="true">
                    {isActive ? "✓" : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <button
        ref={triggerRef}
        type="button"
        className="preview-theme-trigger"
        aria-label={`切换预览主题，当前${activeOption?.label ?? "默认主题"}`}
        aria-controls={popoverId}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={() => setIsOpen((open) => !open)}
      >
        <span
          className="preview-theme-trigger-swatch"
          data-preview-theme={value}
          aria-hidden="true"
        >
          <i />
          <i />
          <i />
        </span>
        <span>主题</span>
      </button>
    </div>
  );
}
