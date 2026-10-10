import { escapeHtml, sha256Hex, todayInDhaka } from "../domain/text.ts";
import { briefError } from "../domain/errors.ts";
import type { Notice, ParsedNotice, Source } from "../domain/types.ts";
import type { Clock, NoticeRepo, Notifier, Scraper, Settings } from "./ports.ts";

export interface Deps {
  repo: NoticeRepo;
  scraper: Scraper;
  notifier: Notifier;
  clock: Clock;
  settings: Settings;
  sources: readonly Source[];
  log?: (msg: string, extra?: unknown) => void;
}

export interface PollReport {
  sent: number;
  skippedByLock: boolean;
  errors: string[];
}

const LOCK = "poll";
const MAX_FILES = 3;

export const noticeId = (sourceId: string, n: ParsedNotice) =>
  sha256Hex(`${sourceId}|${n.url}|${n.title}`).then((h) => `${sourceId}:${h.slice(0, 24)}`);

/** Scheduled mode: today's (Dhaka) notices. Force mode: anything tagged নতুন. */
export const isEligible = (n: ParsedNotice, force: boolean, today: string) =>
  force ? n.isNew || n.publishedOn === today : n.publishedOn === today;

export async function poll(d: Deps, opts: { force: boolean }): Promise<PollReport> {
  return runPoll(d, {
    force: opts.force,
    latestOnly: false,
    recipients: d.settings.chatIds,
    resend: false,
  });
}

export async function pollLatestForAdmin(d: Deps, adminChatId: string): Promise<PollReport> {
  return runPoll(d, {
    force: true,
    latestOnly: true,
    recipients: [adminChatId],
    resend: true,
  });
}

async function runPoll(
  d: Deps,
  opts: { force: boolean; latestOnly: boolean; recipients: string[]; resend: boolean },
): Promise<PollReport> {
  const report: PollReport = { sent: 0, skippedByLock: false, errors: [] };
  if (!(await d.repo.acquireLock(LOCK, 110))) {
    report.skippedByLock = true;
    return report;
  }
  try {
    const today = todayInDhaka(d.clock.now());
    let budget = d.settings.maxPerRun; // keeps us under the Workers subrequest cap

    for (const source of d.sources) {
      if (budget <= 0) break;
      let items: ParsedNotice[];
      try {
        items = await d.scraper.listing(source);
        await recordOk(d, source);
      } catch (e) {
        report.errors.push(`${source.id}: ${String(e)}`);
        console.error(JSON.stringify({
          event: "notice_poll_error",
          source: source.id,
          stage: "listing",
          error: briefError(e),
        }));
        await recordFailure(d, source, String(e));
        continue;
      }

      const candidates = opts.latestOnly ? latestNotice(items) : items.filter((i) => isEligible(i, opts.force, today));
      for (const item of candidates) {
        if (budget <= 0) break;
        const notice: Notice = { ...item, sourceId: source.id, id: await noticeId(source.id, item) };
        const done = opts.resend ? new Set<string>() : await d.repo.deliveredChats(notice.id);
        const pending = opts.recipients.filter((c) => !done.has(c));
        if (!pending.length) continue;

        budget--;
        await d.repo.saveNotice(notice);
        if (!notice.files.length) {
          notice.files = await d.scraper.detailFiles(notice.url).catch((error: unknown) => {
            console.error(JSON.stringify({
              event: "notice_poll_error",
              source: source.id,
              stage: "attachment_lookup",
              error: briefError(error),
            }));
            return [];
          });
        }
        notice.files = notice.files.slice(0, MAX_FILES);

        for (const chat of pending) {
          try {
            await d.notifier.sendNotice(chat, source, notice);
            await d.repo.markDelivered(notice.id, chat);
            report.sent++;
          } catch (e) {
            report.errors.push(`${source.id}: Telegram delivery failed: ${String(e)}`);
            console.error(JSON.stringify({
              event: "notice_poll_error",
              source: source.id,
              stage: "delivery",
              error: briefError(e),
            }));
          }
        }
      }
    }
  } finally {
    await d.repo.releaseLock(LOCK);
  }
  return report;
}

function latestNotice(items: ParsedNotice[]): ParsedNotice[] {
  let latest: ParsedNotice | undefined;
  for (const item of items) {
    if (!latest || (item.publishedOn ?? "") > (latest.publishedOn ?? "")) latest = item;
  }
  return latest ? [latest] : [];
}

async function recordOk(d: Deps, s: Source) {
  const st = await d.repo.getSourceState(s.id);
  if (st.alerted) {
    await d.notifier.sendText(d.settings.adminChatId, `✅ <b>${escapeHtml(s.name)}</b> recovered.`).catch((error: unknown) => {
      console.error(JSON.stringify({
        event: "notice_poll_error",
        source: s.id,
        stage: "recovery_alert",
        error: briefError(error),
      }));
    });
  }
  await d.repo.saveSourceState(s.id, { failures: 0, alerted: false, lastOkAt: d.clock.now(), lastError: null });
}

async function recordFailure(d: Deps, s: Source, err: string) {
  const st = await d.repo.getSourceState(s.id);
  const failures = st.failures + 1;
  let alerted = st.alerted;
  if (!alerted && failures >= d.settings.failureAlertThreshold) {
    await d.notifier
      .sendText(d.settings.adminChatId, `⚠️ <b>${escapeHtml(s.name)}</b>\n<code>${escapeHtml(err.slice(0, 300))}</code>`)
      .then(() => (alerted = true))
      .catch((error: unknown) => {
        console.error(JSON.stringify({
          event: "notice_poll_error",
          source: s.id,
          stage: "failure_alert",
          error: briefError(error),
        }));
      });
  }
  await d.repo.saveSourceState(s.id, { ...st, failures, alerted, lastError: err.slice(0, 500) });
}

export async function healthReport(d: Deps): Promise<string> {
  const lines = ["🩺 <b>Source Health\n</b>"];
  for (const s of d.sources) {
    const st = await d.repo.getSourceState(s.id);
    const ok = st.failures === 0;
    const when = st.lastOkAt ? new Date(st.lastOkAt + 6 * 3600_000).toISOString().slice(0, 16).replace("T", " ") : "never";
    lines.push(`${ok ? "🟢" : "🔴"} ${escapeHtml(s.name)} — last ok: ${when} (BST)${ok ? "" : `, failures: ${st.failures}`}`);
    if (!ok && st.lastError) lines.push(`  <code>${escapeHtml(st.lastError.slice(0, 300))}</code>`);
  }
  return lines.join("\n");
}
