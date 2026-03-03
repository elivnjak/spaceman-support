"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type RichTextEditorProps = {
  value: string;
  onChange: (nextValue: string) => void;
  placeholder?: string;
  minHeightClassName?: string;
};

function hasVisibleText(html: string): boolean {
  const withoutTags = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim();
  return withoutTags.length > 0;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  minHeightClassName = "min-h-[9rem]",
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!editorRef.current) return;
    if (editorRef.current.innerHTML === value) return;
    editorRef.current.innerHTML = value;
  }, [value]);

  function emitChange() {
    const html = editorRef.current?.innerHTML ?? "";
    onChange(html);
  }

  function execCommand(command: string, valueArg?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, valueArg);
    emitChange();
  }

  function insertLink() {
    const hrefInput = window.prompt("Enter URL (https://..., mailto:..., tel:..., /path, or #anchor):");
    const href = hrefInput?.trim();
    if (!href) return;

    const selection = window.getSelection();
    const hasSelection = Boolean(selection && selection.rangeCount > 0 && !selection.isCollapsed);
    if (hasSelection) {
      execCommand("createLink", href);
      return;
    }

    editorRef.current?.focus();
    document.execCommand(
      "insertHTML",
      false,
      `<a href="${escapeAttribute(href)}">${escapeAttribute(href)}</a>`
    );
    emitChange();
  }

  const showPlaceholder = useMemo(
    () => Boolean(placeholder) && !focused && !hasVisibleText(value),
    [placeholder, focused, value]
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execCommand("bold")}
          className="rounded border border-border px-2 py-1 text-xs text-ink hover:bg-aqua/30"
        >
          Bold
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execCommand("italic")}
          className="rounded border border-border px-2 py-1 text-xs text-ink hover:bg-aqua/30"
        >
          Italic
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execCommand("underline")}
          className="rounded border border-border px-2 py-1 text-xs text-ink hover:bg-aqua/30"
        >
          Underline
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execCommand("insertUnorderedList")}
          className="rounded border border-border px-2 py-1 text-xs text-ink hover:bg-aqua/30"
        >
          Bullet List
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={insertLink}
          className="rounded border border-border px-2 py-1 text-xs text-ink hover:bg-aqua/30"
        >
          Link
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execCommand("unlink")}
          className="rounded border border-border px-2 py-1 text-xs text-ink hover:bg-aqua/30"
        >
          Remove Link
        </button>
      </div>

      <div className="relative">
        {showPlaceholder && (
          <p className="pointer-events-none absolute left-3 top-2 text-sm text-muted">
            {placeholder}
          </p>
        )}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={emitChange}
          onBlur={() => {
            setFocused(false);
            emitChange();
          }}
          onFocus={() => setFocused(true)}
          className={`${minHeightClassName} w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 [&_a]:text-primary [&_a]:underline`}
        />
      </div>
    </div>
  );
}
