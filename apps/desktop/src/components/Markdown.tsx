import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo } from "react";

const ALLOWED_TAGS = ["b", "strong", "i", "em", "code", "br", "span"];

/**
 * Inline markdown for model-written text (steps, safety notes). Rendered through
 * DOMPurify with a tiny allow-list: no links, images, HTML blocks or attributes.
 */
export function sanitizeInline(text: string): string {
  const html = marked.parseInline(text, { async: false, gfm: true }) as string;
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR: [] });
}

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => sanitizeInline(text), [text]);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
