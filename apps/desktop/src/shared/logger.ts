/**
 * Minimal structured logger (spec §21). Logs timestamp, severity, module,
 * optional server profile id, event and sanitized detail.
 *
 * It NEVER logs secrets. A redaction pass strips values that look like
 * passwords, tokens, cookies, CSRF tokens, private keys or Authorization
 * headers before anything is written.
 */

export type LogLevel = "error" | "warn" | "info" | "debug";

const LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

/** Keys whose values must never be written to logs. */
const SECRET_KEY_PATTERN =
  /(pass(word)?|secret|token|cookie|csrf|authorization|auth[-_]?header|private[-_]?key|pveticket|csrfpreventiontoken)/i;

/**
 * Recursively redact secret-looking fields from an arbitrary value so that it
 * is safe to serialize into a log line.
 */
export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth-limit]";
  if (value == null) return value;
  if (typeof value === "string") {
    // Redact anything resembling an Authorization header value (whole value).
    return value.replace(/(Authorization:\s*).*/gi, "$1[redacted]");
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY_PATTERN.test(k) ? "[redacted]" : sanitize(v, depth + 1);
  }
  return out;
}

export interface LogFields {
  module: string;
  event: string;
  serverProfileId?: string;
  detail?: unknown;
}

function write(level: LogLevel, fields: LogFields): void {
  if (LEVEL_ORDER[level] > LEVEL_ORDER[currentLevel]) return;

  const line = {
    timestamp: new Date().toISOString(),
    severity: level,
    module: fields.module,
    serverProfileId: fields.serverProfileId,
    event: fields.event,
    detail: fields.detail === undefined ? undefined : sanitize(fields.detail),
  };

  const serialized = JSON.stringify(line);
  if (level === "error") console.error(serialized);
  else if (level === "warn") console.warn(serialized);
  else console.log(serialized);
}

export const logger = {
  error: (f: LogFields) => write("error", f),
  warn: (f: LogFields) => write("warn", f),
  info: (f: LogFields) => write("info", f),
  debug: (f: LogFields) => write("debug", f),
};
