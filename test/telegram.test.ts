import { test } from "node:test";
import assert from "node:assert/strict";
import { TelegramClient } from "../src/infrastructure/telegram.ts";
import type { Notice, Source } from "../src/domain/types.ts";

test("notice caption follows the requested Bengali layout", async () => {
  const requestBodies: Array<Record<string, unknown>> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).includes("/sendMediaGroup")) {
      const form = init?.body as FormData;
      requestBodies.push({
        media: form.get("media"),
        documents: ["file0", "file1", "file2", "file3"].map((key) => form.get(key)),
      });
      return Response.json({ ok: true, result: [{ message_id: 101 }, { message_id: 102 }, { message_id: 103 }, { message_id: 104 }] });
    }
    if (String(input).includes("/editMessageCaption")) {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ ok: true, result: {} });
    }
    if (typeof input === "string" && input.startsWith("https://example.com/")) {
      return new Response(new Blob(["file"]), { status: 200 });
    }
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
    files: [
      "https://example.com/notices/1.pdf",
      "https://example.com/notices/2.pdf",
      "https://example.com/notices/3.pdf",
      "https://example.com/notices/4.pdf",
    ],
  };

  try {
    await new TelegramClient("test-token").sendNotice("admin", source, notice);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requestBodies.length, 2);
  const media = JSON.parse(String(requestBodies[0]!.media)) as Array<Record<string, unknown>>;
  assert.deepEqual(media.map((item) => item.media), ["attach://file0", "attach://file1", "attach://file2", "attach://file3"]);
  assert.equal("caption" in media[0]!, false);
  assert.equal(requestBodies[1]!.message_id, 104);
  assert.equal(requestBodies[1]!.caption, [
    "📍 <b>নতুন বিজ্ঞপ্তি</b>",
    "",
    "<b>শিরোনাম:</b> বিদ্যালয় পরিদর্শন সংক্রান্ত নোটিশ",
    "",
    "📅 প্রকাশের তারিখ: ০৫-১০-২০২৬",
    "🏢 প্রকাশক: জেলা প্রাথমিক শিক্ষা অফিস, মুন্সিগঞ্জ",
    "📎 সংযুক্ত নথি: ৪",
    "",
    `<a href="${notice.url}">🔗 বিস্তারিত দেখুন</a>`,
    "",
    "#dpe_munshiganj",
  ].join("\n"));
  assert.equal("reply_markup" in requestBodies[1]!, false);
});

test("single attachment includes the caption and detail button in one document upload", async () => {
  let requestBody: FormData | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).includes("/sendDocument")) {
      requestBody = init?.body as FormData;
      return Response.json({ ok: true, result: { message_id: 105 } });
    }
    if (typeof input === "string" && input.startsWith("https://example.com/")) {
      return new Response(new Blob(["file"]), { status: 200 });
    }
    throw new Error(`unexpected request: ${String(input)}`);
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
    title: "একটি সংযুক্তি",
    url: "https://example.com/notices/2",
    publishedOn: "2026-10-05",
    isNew: true,
    files: ["https://example.com/notices/2.pdf"],
  };

  try {
    await new TelegramClient("test-token").sendNotice("admin", source, notice);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(requestBody);
  assert.equal(requestBody!.get("chat_id"), "admin");
  assert.equal(requestBody!.get("parse_mode"), "HTML");
  assert.equal(requestBody!.get("caption"), [
    "📍 <b>নতুন বিজ্ঞপ্তি</b>",
    "",
    "<b>শিরোনাম:</b> একটি সংযুক্তি",
    "",
    "📅 প্রকাশের তারিখ: ০৫-১০-২০২৬",
    "🏢 প্রকাশক: জেলা প্রাথমিক শিক্ষা অফিস, মুন্সিগঞ্জ",
    "📎 সংযুক্ত নথি: ১",
    "",
    "#dpe_munshiganj",
  ].join("\n"));
  assert.deepEqual(JSON.parse(String(requestBody!.get("reply_markup"))), {
    inline_keyboard: [[{ text: "🔗 বিস্তারিত দেখুন", url: notice.url }]],
  });
  assert.ok(requestBody!.get("document"));
});
