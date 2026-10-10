import { test } from "node:test";
import assert from "node:assert/strict";
import { briefError } from "../src/domain/errors.ts";

test("brief errors redact URLs, credentials, long identifiers, and limit output", () => {
  const summary = briefError(
    new Error("request https://example.com/path?token=private failed for 1234567890 with token=abcdef0123456789abcdef0123456789"),
  );

  assert.equal(summary, "Error: request [url] failed for [id] with [credential]");
  assert.ok(briefError(new Error("x".repeat(300))).length <= 180);
});
