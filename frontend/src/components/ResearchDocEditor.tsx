import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Bold, Italic, Link2 } from "lucide-react";

export const RESEARCH_DOC_TEMPLATE = `## Thesis

Explain what this bucket is trying to achieve.

## Assets & Allocation Logic

Why did you choose these assets and weights?

## Risk Factors

What can go wrong?

## Strategy & Time Horizon

Is this short-term or long-term?

## Rebalancing Plan

Will you update allocations? When?

## References (optional)

Add links to support your thesis.
`;

function wrapSelection(value: string, start: number, end: number, wrap: (mid: string) => string) {
  const mid = value.slice(start, end);
  const wrapped = wrap(mid);
  const next = value.slice(0, start) + wrapped + value.slice(end);
  const selEnd = start + wrapped.length;
  return { next, selEnd };
}

/** Mirror textarea layout to map selection to viewport rect (handles scroll). */
function getSelectionViewportRect(textarea: HTMLTextAreaElement): DOMRect | null {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  if (start === end) return null;

  const mirror = document.createElement("div");
  const cs = window.getComputedStyle(textarea);
  const taRect = textarea.getBoundingClientRect();

  mirror.style.position = "fixed";
  mirror.style.left = `${taRect.left}px`;
  mirror.style.top = `${taRect.top}px`;
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.style.height = `${textarea.clientHeight}px`;
  mirror.style.overflow = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordBreak = "break-word";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.zIndex = "-1";
  mirror.style.font = cs.font;
  mirror.style.fontSize = cs.fontSize;
  mirror.style.fontFamily = cs.fontFamily;
  mirror.style.fontWeight = cs.fontWeight;
  mirror.style.lineHeight = cs.lineHeight;
  mirror.style.letterSpacing = cs.letterSpacing;
  mirror.style.padding = cs.padding;
  mirror.style.border = cs.border;
  mirror.style.boxSizing = cs.boxSizing;

  const before = document.createTextNode(textarea.value.slice(0, start));
  const span = document.createElement("span");
  span.textContent = textarea.value.slice(start, end);
  mirror.appendChild(before);
  mirror.appendChild(span);
  document.body.appendChild(mirror);
  mirror.scrollTop = textarea.scrollTop;
  mirror.scrollLeft = textarea.scrollLeft;

  const rect = span.getBoundingClientRect();
  document.body.removeChild(mirror);
  return rect;
}

/** Shared renderer map for react-markdown (editor preview + bucket detail). */
export const researchMarkdownComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="text-xl font-semibold tracking-tight text-[#1a1c1e] mt-6 mb-2 first:mt-0">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="text-[17px] font-semibold tracking-tight text-[#1a1c1e] mt-6 mb-2 first:mt-0">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-[15px] font-semibold text-[#374151] mt-4 mb-1">{children}</h3>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="text-[15px] leading-relaxed text-[#6b7280] mb-3 last:mb-0">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-disc pl-5 mb-3 space-y-1 text-[15px] text-[#6b7280]">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="list-decimal pl-5 mb-3 space-y-1 text-[15px] text-[#6b7280]">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => <li className="leading-relaxed">{children}</li>,
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-[#374151] underline underline-offset-2 hover:text-[#1a1c1e]"
    >
      {children}
    </a>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-[#374151]">{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => <em className="italic">{children}</em>
};

export type ResearchDocEditorProps = {
  value: string;
  onChange: (markdown: string) => void;
};

export function ResearchDocEditor({ value, onChange }: ResearchDocEditorProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [toolbar, setToolbar] = useState<{ top: number; left: number } | null>(null);

  const updateToolbarPosition = useCallback(() => {
    const ta = taRef.current;
    if (!ta || mode !== "edit") {
      setToolbar(null);
      return;
    }
    if (ta.selectionStart === ta.selectionEnd) {
      setToolbar(null);
      return;
    }
    const rect = getSelectionViewportRect(ta);
    if (!rect || rect.width === 0) {
      setToolbar(null);
      return;
    }
    const pad = 8;
    const tw = 140;
    let left = rect.left + rect.width / 2 - tw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    let top = rect.top - pad - 40;
    if (top < 8) top = rect.bottom + pad;
    setToolbar({ top, left });
  }, [mode]);

  useLayoutEffect(() => {
    if (mode !== "edit") setToolbar(null);
  }, [mode]);

  const onSelectActivity = useCallback(() => {
    requestAnimationFrame(updateToolbarPosition);
  }, [updateToolbarPosition]);

  useEffect(() => {
    window.addEventListener("scroll", updateToolbarPosition, true);
    return () => window.removeEventListener("scroll", updateToolbarPosition, true);
  }, [updateToolbarPosition]);

  const applyWrap = (fn: (mid: string) => string) => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (start === end) return;
    const { next, selEnd } = wrapSelection(value, start, end, fn);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(selEnd, selEnd);
      setToolbar(null);
    });
  };

  const onBold = () => applyWrap((mid) => `**${mid}**`);
  const onItalic = () => applyWrap((mid) => `*${mid}*`);

  const onLink = () => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (start === end) return;
    const label = value.slice(start, end);
    const url = window.prompt("Link URL (https://…)", "https://");
    if (!url || !url.trim()) return;
    const safeUrl = url.trim();
    const { next, selEnd } = wrapSelection(value, start, end, () => `[${label}](${safeUrl})`);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(selEnd, selEnd);
      setToolbar(null);
    });
  };

  const trimmedLen = value.trim().length;

  return (
    <div className="relative">
      <div className="flex items-center gap-2 mb-3">
        <div
          className="inline-flex rounded-[10px] p-0.5 bg-[#eaebe9] shadow-[inset_0_1px_2px_rgba(0,0,0,0.06),0_1px_0_rgba(255,255,255,0.6)]"
          role="tablist"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "edit"}
            onClick={() => setMode("edit")}
            className={`px-4 py-1.5 rounded-[8px] text-[13px] font-semibold transition-all ${
              mode === "edit"
                ? "bg-[#f8f9f7] text-[#1a1c1e] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_3px_rgba(0,0,0,0.06)]"
                : "text-[#6b7280] hover:text-[#374151]"
            }`}
          >
            Edit
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "preview"}
            onClick={() => setMode("preview")}
            className={`px-4 py-1.5 rounded-[8px] text-[13px] font-semibold transition-all ${
              mode === "preview"
                ? "bg-[#f8f9f7] text-[#1a1c1e] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_3px_rgba(0,0,0,0.06)]"
                : "text-[#6b7280] hover:text-[#374151]"
            }`}
          >
            Preview
          </button>
        </div>
        <span className="text-[13px] font-medium text-[#9ca3af] ml-auto tabular-nums">
          {trimmedLen} / min 100
        </span>
      </div>

      {mode === "edit" && toolbar && (
        <div
          className="fixed z-50 flex items-center gap-1 rounded-[10px] border border-black/8 bg-[#f8f9f7] px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_8px_24px_-4px_rgba(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.04)]"
          style={{ top: toolbar.top, left: toolbar.left }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button
            type="button"
            aria-label="Bold"
            onClick={onBold}
            className="p-1.5 rounded-[6px] text-[#374151] hover:bg-black/5 transition-colors"
          >
            <Bold className="w-4 h-4" strokeWidth={2.25} />
          </button>
          <button
            type="button"
            aria-label="Italic"
            onClick={onItalic}
            className="p-1.5 rounded-[6px] text-[#374151] hover:bg-black/5 transition-colors"
          >
            <Italic className="w-4 h-4" strokeWidth={2.25} />
          </button>
          <button
            type="button"
            aria-label="Link"
            onClick={onLink}
            className="p-1.5 rounded-[6px] text-[#374151] hover:bg-black/5 transition-colors"
          >
            <Link2 className="w-4 h-4" strokeWidth={2.25} />
          </button>
        </div>
      )}

      {mode === "edit" ? (
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onMouseUp={onSelectActivity}
          onKeyUp={onSelectActivity}
          onSelect={onSelectActivity}
          spellCheck
          className="w-full min-h-[420px] resize-y rounded-[1.25rem] border border-black/8 bg-white px-5 py-4 text-[15px] leading-[1.65] tracking-tight text-[#1a1c1e] placeholder:text-[#9ca3af] shadow-[inset_0_2px_4px_rgba(0,0,0,0.03),0_1px_0_rgba(255,255,255,0.8)] outline-none focus-visible:ring-2 focus-visible:ring-[#1a1c1e]/15 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f4f4f4] font-sans"
          placeholder="Write your research document…"
        />
      ) : (
        <div className="min-h-[420px] rounded-[1.25rem] border border-black/8 bg-white px-6 py-5 shadow-[inset_0_2px_4px_rgba(0,0,0,0.03)] overflow-auto">
          <ReactMarkdown components={researchMarkdownComponents}>{value || "*Nothing to preview yet.*"}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
