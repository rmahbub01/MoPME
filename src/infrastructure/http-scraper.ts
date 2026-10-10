import type { Scraper } from "../application/ports.ts";
import type { Source } from "../domain/types.ts";
import { extractFileLinks, parseNotices } from "./html-parser.ts";

const HEADERS = {
  "user-agent": "Mozilla/5.0 (compatible; MoPMENoticeBot/2.0)",
  accept: "text/html,application/xhtml+xml",
  "accept-language": "bn,en;q=0.8",
};

async function getHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10_000), redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

export class HttpScraper implements Scraper {
  async listing(source: Source) {
    const items = parseNotices(await getHtml(source.listUrl), source.listUrl);
    if (!items.length) throw new Error(`no notice rows with a recognized title and publication date parsed from ${source.listUrl}`);
    return items;
  }

  async detailFiles(url: string) {
    if (/\.(pdf|docx?|xlsx?|jpe?g|png)(\?|$)/i.test(url)) return [url];
    return extractFileLinks(await getHtml(url), url);
  }
}
