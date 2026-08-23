"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders assistant text as markdown, styled with the app's design tokens.
 * Only the tags a chat model actually produces are given styles.
 */
export function MessageMarkdown({ children }: { children: string }) {
  return (
    <div className="space-y-3 text-xs sm:text-[14.5px] leading-relaxed text-foreground/90">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: (props) => <p className="whitespace-pre-wrap" {...props} />,
          ul: (props) => <ul className="list-disc space-y-1 pl-4 sm:pl-5" {...props} />,
          ol: (props) => <ol className="list-decimal space-y-1 pl-4 sm:pl-5" {...props} />,
          strong: (props) => <strong className="font-semibold text-foreground" {...props} />,
          a: (props) => (
            <a className="text-primary underline font-medium" target="_blank" rel="noreferrer" {...props} />
          ),
          // The model is told not to paste image URLs -- generated pictures are
          // rendered from the tool result instead -- but a linked image in a
          // search result would otherwise blow out the column width.
          img: (props) => (
            // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
            <img
              className="my-1 max-h-[420px] w-auto max-w-full rounded-xl border border-border"
              loading="lazy"
              {...props}
            />
          ),
          code: (props) => (
            <code
              className="rounded bg-elevated px-1 py-0.5 font-mono text-[0.85em] text-foreground break-words"
              {...props}
            />
          ),
          pre: (props) => (
            <pre
              className="overflow-x-auto rounded-xl border border-border bg-surface p-2.5 sm:p-3 text-[11px] sm:text-xs [&_code]:bg-transparent [&_code]:p-0"
              {...props}
            />
          ),
          table: (props) => (
            <div className="my-2 max-w-full overflow-x-auto rounded-xl border border-border bg-surface/30">
              <table className="w-full min-w-full border-collapse text-left text-xs sm:text-[13px]" {...props} />
            </div>
          ),
          thead: (props) => <thead className="bg-surface" {...props} />,
          th: (props) => (
            <th
              className="border-b border-border px-2.5 sm:px-3 py-2 text-[10px] sm:text-[11px] font-medium uppercase tracking-wider text-muted-foreground whitespace-nowrap"
              {...props}
            />
          ),
          td: (props) => <td className="border-b border-border/60 px-2.5 sm:px-3 py-2 text-xs sm:text-[13px]" {...props} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
