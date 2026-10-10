import type { Notice, ParsedNotice, Source, SourceState } from "../domain/types.ts";

export interface NoticeRepo {
  saveNotice(n: Notice): Promise<void>;
  deliveredChats(noticeId: string): Promise<Set<string>>;
  markDelivered(noticeId: string, chatId: string): Promise<void>;
  getSourceState(sourceId: string): Promise<SourceState>;
  saveSourceState(sourceId: string, s: SourceState): Promise<void>;
  acquireLock(name: string, ttlSec: number): Promise<boolean>;
  releaseLock(name: string): Promise<void>;
}

export interface Scraper {
  listing(source: Source): Promise<ParsedNotice[]>;
  detailFiles(url: string): Promise<string[]>;
}

export interface Notifier {
  sendNotice(chatId: string, source: Source, notice: Notice): Promise<void>;
  sendText(chatId: string, html: string): Promise<void>;
}

export interface Clock {
  now(): number;
}

export interface Settings {
  chatIds: string[];
  adminChatId: string;
  maxPerRun: number;
  failureAlertThreshold: number;
}
