import type { Notifier } from "../application/ports.ts";
import { escapeHtml, truncate } from "../domain/text.ts";
import type { Notice, Source } from "../domain/types.ts";

type Json = Record<string, unknown>;

export class TelegramClient implements Notifier {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  async call<T = unknown>(method: string, body: Json, retry = true): Promise<T> {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json()) as { ok: boolean; result: T; description?: string; parameters?: { retry_after?: number } };
    if (!data.ok) {
      const wait = data.parameters?.retry_after;
      if (retry && wait && wait <= 5) {
        await new Promise((r) => setTimeout(r, wait * 1000));
        return this.call<T>(method, body, false);
      }
      throw new Error(`telegram ${method}: ${data.description ?? res.status}`);
    }
    return data.result;
  }

  sendText(chatId: string, html: string) {
    return this.call("sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML", link_preview_options: { is_disabled: true } }).then(() => {});
  }

  async sendNotice(chatId: string, source: Source, n: Notice) {
    const date = n.publishedOn.split("-").reverse().join("-").replace(/\d/g, (digit) => "০১২৩৪৫৬৭৮৯"[Number(digit)]!);
    const fileCount = String(n.files.length).replace(/\d/g, (digit) => "০১২৩৪৫৬৭৮৯"[Number(digit)]!);
    const caption = [
      "📍 <b>নতুন বিজ্ঞপ্তি</b>",
      "",
      `<b>শিরোনাম:</b> ${escapeHtml(truncate(n.title, 600))}`,
      "",
      `📅 প্রকাশের তারিখ: ${date}`,
      `🏢 প্রকাশক: ${escapeHtml(source.name)}`,
      `📎 সংযুক্ত নথি: ${fileCount}`,
      "",
      `#${escapeHtml(source.id)}`,
    ].join("\n");
    const keyboard = { inline_keyboard: [[{ text: "🔗 বিস্তারিত দেখুন", url: n.url }]] };

    if (n.files.length) {
      try {
        const [first, ...rest] = n.files;
        await this.call("sendDocument", {
          chat_id: chatId,
          document: first,
          caption: truncate(caption, 1000),
          parse_mode: "HTML",
          reply_markup: keyboard,
        });
        for (const f of rest) await this.call("sendDocument", { chat_id: chatId, document: f });
        return;
      } catch {
        // Telegram could not fetch the file (broken TLS, blocked…) → fall back to links.
      }
    }
    const fileRows = n.files.map((f, i) => [{ text: `📎 ফাইল ${i + 1}`, url: f }]);
    await this.call("sendMessage", {
      chat_id: chatId,
      text: caption,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [...keyboard.inline_keyboard, ...fileRows] },
    });
  }

  setWebhook(url: string, secret: string) {
    return this.call("setWebhook", { url, secret_token: secret, allowed_updates: ["message"], drop_pending_updates: true });
  }
}
