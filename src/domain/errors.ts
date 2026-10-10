export function briefError(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return message
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\b\d{5,}:[A-Za-z0-9_-]{20,}\b/g, "[token]")
    .replace(/\b(?:bearer|token|secret|password|authorization)\s*[:= ]\s*\S+/gi, "[credential]")
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, "[secret]")
    .replace(/\b\d{6,}\b/g, "[id]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}
