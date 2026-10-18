import { test } from "node:test";
import assert from "node:assert/strict";
import type { Deps } from "../src/application/poll.ts";
import { healthReport, isEligible, noticeId, poll, pollLatestForAdmin } from "../src/application/poll.ts";
import { SOURCES } from "../src/domain/sources.ts";
import type { Notice, ParsedNotice } from "../src/domain/types.ts";

test("latest admin poll sends the newest notice per source to admin, including delivered notices", async () => {
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

test("latest admin poll sends every notice from each source's newest date", async () => {
  const munshiganj = SOURCES.find((source) => source.id === "dpe_munshiganj")!;
  const noticesBySource = new Map<string, ParsedNotice[]>(
    SOURCES.map((source) => [
      source.id,
      source.id === munshiganj.id
        ? Array.from({ length: 6 }, (_, index) => ({
            title: `Latest notice ${index + 1}`,
            url: `https://example.com/${source.id}/${index + 1}`,
            publishedOn: "2026-10-10",
            isNew: false,
            files: [],
          }))
        : [{
            title: "Latest notice",
            url: `https://example.com/${source.id}/latest`,
            publishedOn: "2026-10-10",
            isNew: false,
            files: [],
          }],
    ]),
  );

  const sent: Notice[] = [];
  const deps: Deps = {
    repo: {
      saveNotice: async () => {},
      deliveredChats: async () => new Set<string>(),
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
      sendNotice: async (_chatId, _source, notice) => {
        sent.push(notice);
      },
      sendText: async () => {},
    },
    clock: { now: () => Date.parse("2026-10-10T12:00:00Z") },
    settings: {
      chatIds: ["admin"],
      adminChatId: "admin",
      failureAlertThreshold: 5,
    },
    sources: SOURCES,
  };

  const report = await pollLatestForAdmin(deps, "admin");

  assert.equal(report.sent, 8);
  assert.equal(sent.filter((notice) => notice.sourceId === munshiganj.id).length, 6);
});

test("scheduled polling sends all today's notices, ignores the new badge, and skips delivered notices", async () => {
  const source = SOURCES[0]!;
  const today = "2026-10-10";
  const notices: ParsedNotice[] = Array.from({ length: 10 }, (_, index) => ({
    title: `Today's notice ${index + 1}`,
    url: `https://example.com/${source.id}/${index + 1}`,
    publishedOn: today,
    isNew: false,
    files: [],
  }));
  const oldNewNotice: ParsedNotice = {
    title: "Old notice still marked new",
    url: `https://example.com/${source.id}/old-new`,
    publishedOn: "2026-10-09",
    isNew: true,
    files: [],
  };
  const deliveredId = await noticeId(source.id, notices[0]!);
  const sent: Notice[] = [];
  const deps: Deps = {
    repo: {
      saveNotice: async () => {},
      deliveredChats: async (id) => id === deliveredId ? new Set(["channel"]) : new Set<string>(),
      markDelivered: async () => {},
      getSourceState: async () => ({ failures: 0, alerted: false, lastOkAt: null, lastError: null }),
      saveSourceState: async () => {},
      acquireLock: async () => true,
      releaseLock: async () => {},
    },
    scraper: {
      listing: async (listedSource) => listedSource.id === source.id ? [...notices, oldNewNotice] : [],
      detailFiles: async () => [],
    },
    notifier: {
      sendNotice: async (_chatId, _source, notice) => {
        sent.push(notice);
      },
      sendText: async () => {},
    },
    clock: { now: () => Date.parse("2026-10-10T12:00:00Z") },
    settings: {
      chatIds: ["channel"],
      adminChatId: "admin",
      failureAlertThreshold: 5,
    },
    sources: [source],
  };

  const report = await poll(deps, { force: false });

  assert.equal(report.sent, notices.length - 1);
  assert.equal(sent.some((notice) => notice.title === oldNewNotice.title), false);
  assert.equal(isEligible(oldNewNotice, false, today), false);
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
