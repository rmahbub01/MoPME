import { test } from "node:test";
import assert from "node:assert/strict";
import type { Deps } from "../src/application/poll.ts";
import { healthReport, pollLatestForAdmin } from "../src/application/poll.ts";
import { SOURCES } from "../src/domain/sources.ts";
import type { Notice, ParsedNotice } from "../src/domain/types.ts";

test("latest admin poll sends only the newest notice per source to admin, including delivered notices", async () => {
  const noticesBySource = new Map<string, ParsedNotice[]>();
  for (const source of SOURCES) {
    noticesBySource.set(source.id, [
      { title: "Older new-tagged notice", url: `https://example.com/${source.id}/old`, publishedOn: "2026-01-01", isNew: true, files: [] },
      { title: "Latest notice", url: `https://example.com/${source.id}/latest`, publishedOn: "2026-10-10", isNew: false, files: [] },
    ]);
  }

  const sent: Array<{ chatId: string; notice: Notice }> = [];
  const deps: Deps = {
    repo: {
      saveNotice: async () => {},
      deliveredChats: async () => new Set(["admin"]),
      markDelivered: async () => {},
      getSourceState: async () => ({ failures: 0, alerted: false, lastOkAt: null, lastError: null }),
      saveSourceState: async () => {},
      acquireLock: async () => true,
      releaseLock: async () => {},
    },
    scraper: {
      listing: async (source) => noticesBySource.get(source.id) ?? [],
      detailFiles: async () => [],
    },
    notifier: {
      sendNotice: async (chatId, _source, notice) => {
        sent.push({ chatId, notice });
      },
      sendText: async () => {},
    },
    clock: { now: () => Date.parse("2026-10-10T12:00:00Z") },
    settings: {
      chatIds: ["admin", "channel"],
      adminChatId: "admin",
      maxPerRun: 8,
      failureAlertThreshold: 5,
    },
    sources: SOURCES,
  };

  const report = await pollLatestForAdmin(deps, "admin");

  assert.equal(report.sent, SOURCES.length);
  assert.deepEqual(
    sent.map(({ chatId, notice }) => [chatId, notice.title]),
    SOURCES.map(() => ["admin", "Latest notice"]),
  );
});

test("health report includes an escaped source error for troubleshooting", async () => {
  const deps = {
    repo: {
      getSourceState: async (sourceId: string) => ({
        failures: sourceId === "dpe" ? 2 : 0,
        alerted: false,
        lastOkAt: null,
        lastError: sourceId === "dpe" ? "HTTP 503 <temporary outage>" : null,
      }),
    },
    sources: SOURCES,
  } as Deps;

  const report = await healthReport(deps);

  assert.match(report, /<b>Source Health<\/b>/);
  assert.match(report, /<code>HTTP 503 &lt;temporary outage&gt;<\/code>/);
});
