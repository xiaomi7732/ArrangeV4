'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
          // A one-liner carries no paragraph of its own: the block wrapper
          // would break the line out of its label and add vertical space.
          ...(inline ? { p: ({ children }) => <>{children}</> } : {}),
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
