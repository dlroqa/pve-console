const MAX_EXTERNAL_URL_LENGTH = 8_192;

/** Return a normalized browser URL only when it uses an explicitly supported scheme. */
export function normalizeExternalHttpUrl(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_EXTERNAL_URL_LENGTH) {
    throw new Error("Invalid external URL.");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid external URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS links can be opened.");
  }
  return url.href;
}
