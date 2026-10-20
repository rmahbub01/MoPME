import type { Notifier } from "../application/ports.ts";
import { escapeHtml, truncate } from "../domain/text.ts";
import type { Notice, Source } from "../domain/types.ts";

type Json = Record<string, unknown>;
const MEDIA_GROUP_LIMIT = 10;
interface SentMessage {
  message_id: number;
}

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
    const caption = (includeLink: boolean) => [
      "",
      "📢 <b>নতুন বিজ্ঞপ্তি</b>",
      "",
      `<b>শিরোনাম:</b> ${escapeHtml(truncate(n.title, 500))}`,
      "",
      `📅 প্রকাশের তারিখ: ${date}`,
      `🏢 প্রকাশক: ${escapeHtml(source.name)}`,
      `📎 সংযুক্ত নথি: ${fileCount}`,
      "",
      ...(includeLink ? [`<a href="${escapeHtml(n.url)}">🔗 বিস্তারিত দেখুন</a>`, ""] : []),
      `#${escapeHtml(source.id)}`,
    ].join("\n");

    if (n.files.length === 1) {
      const response = await fetch(n.files[0]!, { signal: AbortSignal.timeout(15_000), redirect: "follow" });
      if (!response.ok) throw new Error(`attachment HTTP ${response.status}: ${n.files[0]}`);
      const name = decodeURIComponent(new URL(n.files[0]!).pathname.split("/").pop() || "attachment-1");
      const form = new FormData();
      form.append("chat_id", chatId);
      form.append("document", await response.blob(), name);
      form.append("caption", caption(false));
      form.append("parse_mode", "HTML");
      form.append("reply_markup", JSON.stringify({
        inline_keyboard: [[{ text: "🔗 বিস্তারিত দেখুন", url: n.url }]],
      }));
      await this.callMultipart("sendDocument", form);
      return;
    }

    if (n.files.length) {
      for (let start = 0; start < n.files.length; start += MEDIA_GROUP_LIMIT) {
        const files = n.files.slice(start, start + MEDIA_GROUP_LIMIT);
        const uploads = await Promise.all(files.map(async (url, index) => {
          const response = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: "follow" });
          if (!response.ok) throw new Error(`attachment HTTP ${response.status}: ${url}`);
          const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || `attachment-${index + 1}`);
          return { name, blob: await response.blob() };
        }));
        const media = uploads.map((upload, index) => ({
          type: "document",
          media: `attach://file${index}`,
        }));
        const form = new FormData();
        form.append("chat_id", chatId);
        form.append("media", JSON.stringify(media));
        uploads.forEach((upload, index) => form.append(`file${index}`, upload.blob, upload.name));
        const messages = await this.callMultipart<SentMessage[]>("sendMediaGroup", form);
        const lastMessage = messages.at(-1);
        if (!lastMessage) throw new Error("telegram sendMediaGroup returned no messages");
        await this.call("editMessageCaption", {
          chat_id: chatId,
          message_id: lastMessage.message_id,
          caption: caption(true),
          parse_mode: "HTML",
        });
      }
      return;
    }
    await this.call("sendMessage", {
      chat_id: chatId,
      text: caption(false),
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: "🔗 বিস্তারিত দেখুন", url: n.url }]] },
    });
  }

  private async callMultipart<T = unknown>(method: string, body: FormData): Promise<T> {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await res.json()) as { ok: boolean; result: T; description?: string };
    if (!data.ok) throw new Error(`telegram ${method}: ${data.description ?? res.status}`);
    return data.result;
  }

  setWebhook(url: string, secret: string) {
    return this.call("setWebhook", { url, secret_token: secret, allowed_updates: ["message"], drop_pending_updates: true });
  }
}
