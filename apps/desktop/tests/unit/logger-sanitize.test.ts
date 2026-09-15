import { describe, it, expect } from "vitest";
import { sanitize } from "../../src/shared/logger";

describe("log sanitization (spec §21)", () => {
  it("redacts secret-bearing keys", () => {
    const out = sanitize({
      user: "root@pam",
      password: "hunter2",
      apiToken: "secret",
      csrfToken: "xyz",
      cookie: "PVEAuthCookie=abc",
      nested: { authorization: "Bearer abc", ok: "value" },
    }) as Record<string, unknown>;

    expect(out.user).toBe("root@pam");
    expect(out.password).toBe("[redacted]");
    expect(out.apiToken).toBe("[redacted]");
    expect(out.csrfToken).toBe("[redacted]");
    expect(out.cookie).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).authorization).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).ok).toBe("value");
  });

  it("redacts Authorization header values inside strings", () => {
    expect(sanitize("Authorization: Bearer abc123")).toBe("Authorization: [redacted]");
  });

  it("handles arrays and primitives", () => {
    expect(sanitize([1, "two", { token: "x" }])).toEqual([1, "two", { token: "[redacted]" }]);
  });
});
