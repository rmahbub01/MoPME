import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNotices } from "../src/infrastructure/html-parser.ts";
import { findDate, toAsciiDigits } from "../src/domain/text.ts";

const html = `
<ul class="menu"><li><a href="/about">About the ministry office</a></li></ul>
<table><tr><td>১</td>
<td><a href="/notices/123">বিদ্যালয় পরিদর্শন সংক্রান্ত নোটিশ</a> <span>নত‌ুন</span></td>
<td>১০-১০-২০২৬</td>
<td><a href="/files/a.pdf">ডাউনলোড</a></td></tr>
<tr><td>2</td><td><a href="https://x.gov.bd/n/9">Training schedule notice</a></td><td>2026-10-01</td></tr></table>`;

test("digits + dates", () => {
  assert.equal(toAsciiDigits("১০"), "10");
  assert.equal(findDate("১০-১০-২০২৬"), "2026-10-10");
  assert.equal(findDate("5 Oct 2026"), "2026-10-05");
  assert.equal(findDate("৫ই অক্টোবর, ২০২৬"), "2026-10-05");
  assert.equal(findDate("প্রকাশের তারিখ: ২৭ - ০৯ - ২০২৬"), "2026-09-27");
});

test("parses rows, skips menu", () => {
  const r = parseNotices(html, "https://dpe.gov.bd/pages/notices");
  assert.equal(r.length, 2);
  assert.equal(r[0]!.title, "বিদ্যালয় পরিদর্শন সংক্রান্ত নোটিশ");
  assert.equal(r[0]!.publishedOn, "2026-10-10");
  assert.equal(r[0]!.isNew, true);
  assert.deepEqual(r[0]!.files, ["https://dpe.gov.bd/files/a.pdf"]);
  assert.equal(r[1]!.url, "https://x.gov.bd/n/9");
});

test("uses the table title and notice details URL instead of the PDF filename and URL", () => {
  const page = `
  <table><tr>
    <td><a href="/notices/456">বিস্তারিত</a></td>
    <td>নিয়োগ সংক্রান্ত গুরুত্বপূর্ণ বিজ্ঞপ্তি</td>
    <td>১০-১০-২০২৬</td>
    <td><a href="/files/48b1a32d-92f.pdf">48b1a32d-92f.pdf</a></td>
  </tr></table>`;
  const notices = parseNotices(page, "https://dpe.gov.bd/pages/notices");

  assert.equal(notices.length, 1);
  assert.equal(notices[0]!.title, "নিয়োগ সংক্রান্ত গুরুত্বপূর্ণ বিজ্ঞপ্তি");
  assert.equal(notices[0]!.url, "https://dpe.gov.bd/notices/456");
  assert.deepEqual(notices[0]!.files, ["https://dpe.gov.bd/files/48b1a32d-92f.pdf"]);
});

test("does not parse notices without an extractable publication date", () => {
  const page = `
  <table><tr>
    <td><a href="/notices/789">একটি তারিখবিহীন নোটিশ</a></td>
    <td><a href="/files/notice.pdf">notice.pdf</a></td>
  </tr></table>`;

  assert.deepEqual(parseNotices(page, "https://dpe.gov.bd/pages/notices"), []);
});

test("extracts a Bengali date split by inline markup", () => {
  const page = `
  <table><tr>
    <td><a href="/notices/790">শিক্ষা সংক্রান্ত বিজ্ঞপ্তি</a></td>
    <td>প্রকাশের তারিখ: <span>২৭</span>-<span>০৯</span>-<span>২০২৬</span></td>
  </tr></table>`;
  const notices = parseNotices(page, "https://dpe.gov.bd/pages/notices");

  assert.equal(notices.length, 1);
  assert.equal(notices[0]!.publishedOn, "2026-09-27");
});

test("uses DPE table headers to select title, file, date, and details link", () => {
  const page = `
  <table>
    <thead><tr><th>নং</th><th>শিরোনাম</th><th>ফাইল সমূহ</th><th>ইমেজ</th><th>প্রকাশের তারিখ</th><th>কার্যকলাপ</th></tr></thead>
    <tbody><tr>
      <td>১</td>
      <td>সরকারি যানবাহন ব্যবহারে জ্বালানীর নির্ধারিত প্রাপ্যতা বজায় রাখা।</td>
      <td><a href="/sites/default/files/notice-123.pdf"><img src="/pdf-icon.png" alt="PDF"></a></td>
      <td></td>
      <td>২৭-০৯-২০২৬</td>
      <td><a href="/notices/456">দেখুন</a></td>
    </tr></tbody>
  </table>`;
  const notices = parseNotices(page, "https://dpe.gov.bd/pages/notices");

  assert.equal(notices.length, 1);
  assert.equal(notices[0]!.title, "সরকারি যানবাহন ব্যবহারে জ্বালানীর নির্ধারিত প্রাপ্যতা বজায় রাখা।");
  assert.equal(notices[0]!.publishedOn, "2026-09-27");
  assert.equal(notices[0]!.url, "https://dpe.gov.bd/notices/456");
  assert.deepEqual(notices[0]!.files, ["https://dpe.gov.bd/sites/default/files/notice-123.pdf"]);
});
