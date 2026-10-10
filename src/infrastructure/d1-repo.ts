import type { NoticeRepo } from "../application/ports.ts";
import type { Notice, SourceState } from "../domain/types.ts";

export class D1Repo implements NoticeRepo {
  constructor(private db: D1Database, private now: () => number = Date.now) {}

  async saveNotice(n: Notice) {
    await this.db
      .prepare("INSERT OR IGNORE INTO notices (id, source_id, title, url, published_on, first_seen_at) VALUES (?,?,?,?,?,?)")
      .bind(n.id, n.sourceId, n.title, n.url, n.publishedOn, this.now())
      .run();
  }

  async deliveredChats(noticeId: string) {
    const r = await this.db.prepare("SELECT chat_id FROM deliveries WHERE notice_id = ?").bind(noticeId).all<{ chat_id: string }>();
    return new Set(r.results.map((x) => x.chat_id));
  }

  async markDelivered(noticeId: string, chatId: string) {
    await this.db
      .prepare("INSERT OR IGNORE INTO deliveries (notice_id, chat_id, delivered_at) VALUES (?,?,?)")
      .bind(noticeId, chatId, this.now())
      .run();
  }

  async getSourceState(id: string): Promise<SourceState> {
    const r = await this.db
      .prepare("SELECT failures, alerted, last_ok_at, last_error FROM source_state WHERE source_id = ?")
      .bind(id)
      .first<{ failures: number; alerted: number; last_ok_at: number | null; last_error: string | null }>();
    return r
      ? { failures: r.failures, alerted: !!r.alerted, lastOkAt: r.last_ok_at, lastError: r.last_error }
      : { failures: 0, alerted: false, lastOkAt: null, lastError: null };
  }

  async saveSourceState(id: string, s: SourceState) {
    await this.db
      .prepare(
        `INSERT INTO source_state (source_id, failures, alerted, last_ok_at, last_error) VALUES (?,?,?,?,?)
         ON CONFLICT(source_id) DO UPDATE SET failures=excluded.failures, alerted=excluded.alerted,
         last_ok_at=excluded.last_ok_at, last_error=excluded.last_error`,
      )
      .bind(id, s.failures, s.alerted ? 1 : 0, s.lastOkAt, s.lastError)
      .run();
  }

  /** Atomic: takes the lock only if absent or expired. */
  async acquireLock(name: string, ttlSec: number) {
    const t = this.now();
    const r = await this.db
      .prepare(
        `INSERT INTO worker_locks (name, expires_at) VALUES (?, ?)
         ON CONFLICT(name) DO UPDATE SET expires_at = excluded.expires_at WHERE worker_locks.expires_at < ?`,
      )
      .bind(name, t + ttlSec * 1000, t)
      .run();
    return (r.meta.changes ?? 0) > 0;
  }

  async releaseLock(name: string) {
    await this.db.prepare("DELETE FROM worker_locks WHERE name = ?").bind(name).run();
  }
}
