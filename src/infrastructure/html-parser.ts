import { findDate } from "../domain/text.ts";
import type { ParsedNotice } from "../domain/types.ts";

const FILE_RE = /\.(pdf|docx?|xlsx?|pptx?|zip|rar|jpe?g|png)(\?|#|$)/i;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export const decodeEntities = (s: string): string =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1]!.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

export const textOf = (html: string): string =>
  decodeEntities(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();

interface Anchor { href: string; text: string }

function anchors(html: string, base: string): Anchor[] {
  const out: Anchor[] = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = m[1]!.match(/href\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const raw = (href?.[1] ?? href?.[2] ?? "").trim();
    if (!raw || raw.startsWith("#") || /^(javascript|mailto|tel):/i.test(raw)) continue;
    try {
      const url = new URL(decodeEntities(raw), base).toString();
      const title = m[1]!.match(/title\s*=\s*"([^"]*)"/i)?.[1] ?? "";
      out.push({ href: url, text: textOf(m[2]!) || decodeEntities(title).trim() });
    } catch { /* bad href */ }
  }
  return out;
}

const NEW_BADGE = /নতুন|\bnew\b/i;
const cleanTitle = (t: string) => t.replace(/নতুন/g, "").replace(/\s+/g, " ").trim();
const isFileName = (text: string) => FILE_RE.test(text.trim());
const isActionLabel = (text: string) => /^(?:বিস্তারিত(?: দেখুন)?|দেখুন|download|ডাউনলোড|view|details)$/i.test(text.trim());

interface Columns {
  title?: number;
  date?: number;
  action?: number;
  files?: number;
}

function rowCells(inner: string): string[] {
  return [...inner.matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map((cell) => cell[1]!);
}

function tableColumns(header: string): Columns | null {
  const cells = rowCells(header).map(textOf);
  if (!cells.length) return null;
  const findColumn = (predicate: (label: string) => boolean) => cells.findIndex(predicate);
  const title = findColumn((label) => label.includes("শিরোনাম") || label.includes("বিষয়") || label.includes("বিষয়"));
  const date = findColumn((label) => label.includes("প্রকাশের তারিখ") || label.includes("তারিখ"));
  const action = findColumn((label) => label.includes("কার্যকলাপ") || label.includes("কার্যক্রম"));
  const files = findColumn((label) => label.includes("ফাইল") || label.includes("সংযুক্তি"));
  if (title < 0 && date < 0 && action < 0 && files < 0) return null;
  return {
    ...(title >= 0 ? { title } : {}),
    ...(date >= 0 ? { date } : {}),
    ...(action >= 0 ? { action } : {}),
    ...(files >= 0 ? { files } : {}),
  };
}

function cellTextWithoutFiles(cell: string): string {
  return textOf(cell.replace(/<a\b([^>]*)>[\s\S]*?<\/a>/gi, (anchor, attrs: string) => {
    const href = attrs.match(/href\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const raw = href?.[1] ?? href?.[2] ?? "";
    return FILE_RE.test(raw) ? " " : anchor;
  }));
}

function rowTitle(inner: string, links: Anchor[], columns?: Columns): string {
  const cells = rowCells(inner);
  if (columns?.title !== undefined && cells[columns.title]) {
    return cellTextWithoutFiles(cells[columns.title]!);
  }

  const linkedTitle = links
    .filter((link) => !FILE_RE.test(link.href) && link.text.length >= 5 && !isActionLabel(link.text))
    .sort((a, b) => b.text.length - a.text.length)[0]?.text;
  if (linkedTitle) return linkedTitle;

  const cellTitles = cells
    .map(cellTextWithoutFiles)
    .filter((text) => text.length >= 5 && !findDate(text) && !isFileName(text) && !isActionLabel(text));
  if (cellTitles.length) return cellTitles.sort((a, b) => b.length - a.length)[0]!;

  return links
    .filter((link) => !FILE_RE.test(link.href) && link.text.length >= 5 && !isFileName(link.text) && !isActionLabel(link.text))
    .sort((a, b) => b.text.length - a.text.length)[0]?.text ?? "";
}

/** Parses notice tables using their column headers, with a heuristic fallback for other layouts. */
export function parseNotices(html: string, baseUrl: string): ParsedNotice[] {
  const found = new Map<string, ParsedNotice>();

  const parseRow = (inner: string, columns?: Columns) => {
    const links = anchors(inner, baseUrl);
    const cells = rowCells(inner);
    const fileCellLinks = columns?.files !== undefined && cells[columns.files]
      ? anchors(cells[columns.files]!, baseUrl)
      : links;
    const files = [...new Set(fileCellLinks.filter((link) => FILE_RE.test(link.href)).map((link) => link.href))];
    const title = cleanTitle(rowTitle(inner, links, columns));
    if (title.length < 5) return;
    const actionLinks = columns?.action !== undefined && cells[columns.action]
      ? anchors(cells[columns.action]!, baseUrl)
      : links;
    const detail = actionLinks.find((link) => !FILE_RE.test(link.href))
      ?? links.find((link) => !FILE_RE.test(link.href));
    const dateSource = [
      ...(columns?.date !== undefined && cells[columns.date] ? [textOf(cells[columns.date]!)] : []),
      textOf(inner),
      ...[...inner.matchAll(/<(?:time|[^>]+)\b[^>]*(?:datetime|data-date)\s*=\s*["']([^"']+)["'][^>]*>/gi)].map((match) => match[1]!),
    ].join(" ");
    const publishedOn = findDate(dateSource);
    if (!publishedOn) return;
    const url = detail?.href ?? baseUrl;
    found.set(url + "|" + title, {
      title,
      url,
      publishedOn,
      isNew: NEW_BADGE.test(textOf(inner)),
      files,
    });
  };

  for (const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const tableHtml = table[1]!;
    const rows = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
    const header = rows.find((row) => /<th\b/i.test(row[1]!));
    const columns = header ? tableColumns(header[1]!) ?? undefined : undefined;
    for (const row of rows) {
      if (header && row === header) continue;
      parseRow(row[1]!, columns);
    }
  }

  for (const block of html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    parseRow(block[1]!);
  }

  return [...found.values()];
}

export function extractFileLinks(html: string, baseUrl: string): string[] {
  return [...new Set(anchors(html, baseUrl).filter((l) => FILE_RE.test(l.href)).map((l) => l.href))];
}
