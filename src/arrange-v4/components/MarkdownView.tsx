'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ReactNode } from 'react';
import { safeMarkdownUrl } from '@/lib/markdown';
import styles from './MarkdownView.module.css';

interface MarkdownViewProps {
  content: string;
  className?: string;
  /**
   * Render as a single line: no block wrapper around the text. Used for
   * checklist items, which are one-liners.
   */
  inline?: boolean;
}

const Unwrapped = ({ children }: { children?: ReactNode }) => <>{children}</>;
const Spaced = ({ children }: { children?: ReactNode }) => <span>{children} </span>;

/**
 * Inline mode only promises inline formatting, but Markdown can always produce
 * block constructs, and a checklist item is rendered inside the `<label>` of
 * its own checkbox. Left alone, an item such as `- [ ] buy milk` would render a
 * second checkbox inside that label, and a heading or table would break the row
 * apart. Block containers are therefore flattened to text, and the task-list
 * checkbox GFM generates is dropped entirely.
 */
const INLINE_BLOCK_OVERRIDES = {
  p: Unwrapped,
  h1: Unwrapped,
  h2: Unwrapped,
  h3: Unwrapped,
  h4: Unwrapped,
  h5: Unwrapped,
  h6: Unwrapped,
  blockquote: Unwrapped,
  pre: Unwrapped,
  ul: Unwrapped,
  ol: Unwrapped,
  li: Spaced,
  table: Unwrapped,
  thead: Unwrapped,
  tbody: Unwrapped,
  tr: Spaced,
  th: Spaced,
  td: Spaced,
  hr: () => null,
  input: () => null,
} as const;

/**
 * Renders a remark written in Markdown.
 *
 * Remarks can come from somewhere other than this app — a shared Sheets book,
 * a cell edited in Google Sheets, a calendar event from another organiser — so
 * the content is treated as untrusted:
 *
 * - react-markdown compiles to React elements, so no HTML string is ever
 *   injected and `dangerouslySetInnerHTML` stays absent from the codebase.
 * - `rehype-raw` is deliberately not used, which leaves raw HTML in the source
 *   inert.
 * - Link and image URLs go through an allow-list, so `javascript:` and `data:`
 *   targets are dropped rather than rendered.
 */
export default function MarkdownView({ content, className, inline = false }: MarkdownViewProps) {
  const Wrapper = inline ? 'span' : 'div';
  return (
    <Wrapper className={`${inline ? styles.inline : styles.prose} ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={url => safeMarkdownUrl(url) ?? ''}
        components={{
          ...(inline ? INLINE_BLOCK_OVERRIDES : {}),
          // Only known-safe props are forwarded; react-markdown also passes its
          // internal `node`, which must not reach the DOM.
          a: ({ href, title, children }) => {
            const safeHref = safeMarkdownUrl(href);
            if (!safeHref) return <span title={title}>{children}</span>;
            return (
              <a href={safeHref} title={title} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
          // Remote images would leak the reader's IP to whoever authored the
          // remark, so show the alt text instead of fetching anything.
          img: ({ alt }) => <span className={styles.imagePlaceholder}>{alt || 'image'}</span>,
        }}
      >
        {content}
      </ReactMarkdown>
    </Wrapper>
  );
}
