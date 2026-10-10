import { test } from "node:test";
import assert from "node:assert/strict";
import { TelegramClient } from "../src/infrastructure/telegram.ts";
import type { Notice, Source } from "../src/domain/types.ts";

test("notice caption follows the requested Bengali layout", async () => {
  const requestBodies: Array<Record<string, unknown>> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({ ok: true, result: {} });
  };

  const source: Source = {
    id: "dpe_munshiganj",
    name: "জেলা প্রাথমিক শিক্ষা অফিস, মুন্সিগঞ্জ",
    emoji: "📍",
    listUrl: "https://example.com/notices",
  };
  const notice: Notice = {
    id: "notice-id",
    sourceId: source.id,
    title: "বিদ্যালয় পরিদর্শন সংক্রান্ত নোটিশ",
    url: "https://example.com/notices/1",
    publishedOn: "2026-10-05",
    isNew: true,
    files: ["https://example.com/notices/1.pdf"],
  };

  try {
    await new TelegramClient("test-token").sendNotice("admin", source, notice);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requestBodies.length, 1);
  assert.equal(
    requestBodies[0]!.caption,
    [
      "📍 <b>নতুন বিজ্ঞপ্তি</b>",
      "",
      "<b>শিরোনাম:</b> বিদ্যালয় পরিদর্শন সংক্রান্ত নোটিশ",
      "",
      "📅 প্রকাশের তারিখ: ০৫-১০-২০২৬",
      "🏢 প্রকাশক: জেলা প্রাথমিক শিক্ষা অফিস, মুন্সিগঞ্জ",
      "📎 সংযুক্ত নথি: ১",
      "",
      "#dpe_munshiganj",
    ].join("\n"),
  );
  assert.equal(requestBodies[0]!.document, notice.files[0]);
  assert.deepEqual(
    (requestBodies[0]!.reply_markup as { inline_keyboard: Array<Array<{ url: string }>> }).inline_keyboard[0]![0]!.url,
    notice.url,
  );
});
