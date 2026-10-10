import { healthReport, poll, pollLatestForAdmin, type Deps } from "./application/poll.ts";
import { briefError } from "./domain/errors.ts";
import { escapeHtml } from "./domain/text.ts";
import { SOURCES } from "./domain/sources.ts";
import { D1Repo } from "./infrastructure/d1-repo.ts";
import { HttpScraper } from "./infrastructure/http-scraper.ts";
import { TelegramClient } from "./infrastructure/telegram.ts";

export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_IDS: string;
  ADMIN_CHAT_ID: string;
  TELEGRAM_WEBHOOK_SECRET: string;
}

function build(env: Env): { deps: Deps; tg: TelegramClient } {
  const tg = new TelegramClient(env.TELEGRAM_BOT_TOKEN);
  const deps: Deps = {
    repo: new D1Repo(env.DB),
    scraper: new HttpScraper(),
    notifier: tg,
    clock: { now: () => Date.now() },
    sources: SOURCES,
    settings: {
      chatIds: env.TELEGRAM_CHAT_IDS.split(",").map((s) => s.trim()).filter(Boolean),
      adminChatId: env.ADMIN_CHAT_ID,
      maxPerRun: 8,
      failureAlertThreshold: 5,
    },
  };
  return { deps, tg };
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const authorized = (req: Request, env: Env) =>
  safeEqual(req.headers.get("x-telegram-bot-api-secret-token") ?? "", env.TELEGRAM_WEBHOOK_SECRET);

async function onCommand(env: Env, ctx: ExecutionContext, text: string, chatId: string) {
  const tg = new TelegramClient(env.TELEGRAM_BOT_TOKEN);
  try {
    if (chatId !== env.ADMIN_CHAT_ID) return;
    const { deps } = build(env);
    const cmd = text.trim().split(/[\s@]/)[0];
    if (cmd === "/health") await tg.sendText(chatId, await healthReport(deps));
    else if (cmd === "/force") {
      await tg.sendText(chatId, "⏳ Force poll started…");
      ctx.waitUntil(
        pollLatestForAdmin(deps, chatId)
        .then((r) => {
          const errors = r.errors.length
            ? `\n⚠️ Errors:\n${r.errors.map((error) => `• ${escapeHtml(error)}`).join("\n").slice(0, 2500)}`
            : "";
          return tg.sendText(chatId, r.skippedByLock ? "⏸ Another poll is running." : `✅ Done. Sent ${r.sent}.${errors}`);
        })
        .catch((error) => {
          console.error(JSON.stringify({ event: "telegram_command_error", command: "force", error: briefError(error) }));
          return tg.sendText(chatId, "⚠️ Force poll failed. Check the Worker logs.");
        }),
      );
    } else if (cmd === "/start") await tg.sendText(chatId, "👋 Commands: /force, /health");
  } catch (error) {
    console.error(JSON.stringify({ event: "telegram_command_error", error: briefError(error) }));
    if (chatId === env.ADMIN_CHAT_ID) {
      await tg.sendText(chatId, "⚠️ Command failed. Check the Worker logs.").catch((sendError) => {
        console.error(JSON.stringify({ event: "telegram_command_reply_error", error: briefError(sendError) }));
      });
    }
  }
}

export default {
  async scheduled(_evt: ScheduledController, env: Env, ctx: ExecutionContext) {
    const { deps } = build(env);
    ctx.waitUntil(
      poll(deps, { force: false }).catch((error) => {
        console.error(JSON.stringify({ event: "scheduled_poll_error", error: briefError(error) }));
      }),
    );
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/healthz") return new Response("ok");

    if (req.method === "POST" && url.pathname === "/setup-webhook") {
      if (!authorized(req, env)) return new Response("forbidden", { status: 403 });
      const tg = new TelegramClient(env.TELEGRAM_BOT_TOKEN);
      try {
        await tg.setWebhook(`${url.origin}/webhook`, env.TELEGRAM_WEBHOOK_SECRET);
        return new Response("webhook set");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const detail = [env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_WEBHOOK_SECRET]
          .filter(Boolean)
          .reduce((text, secret) => text.split(secret).join("[redacted]"), message);
        console.error("Telegram webhook setup failed:", detail);
        return Response.json({ error: detail }, { status: 502 });
      }
    }

    if (req.method === "POST" && (url.pathname === "/webhook" || url.pathname === "/")) {
      if (!authorized(req, env)) return new Response("forbidden", { status: 403 });
      const update = (await req.json().catch(() => null)) as { message?: { text?: string; chat?: { id?: number } } } | null;
      const text = update?.message?.text;
      const chat = update?.message?.chat?.id;
      if (text?.startsWith("/") && chat !== undefined) ctx.waitUntil(onCommand(env, ctx, text, String(chat)));
      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
