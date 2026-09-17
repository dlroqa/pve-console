import { describe, expect, it } from "vitest";
import { normalizeExternalHttpUrl } from "../../src/main/external-url";

describe("external terminal URL validation", () => {
  it("accepts and normalizes HTTP and HTTPS URLs", () => {
    expect(normalizeExternalHttpUrl("https://example.test/docs?q=terminal#links"))
      .toBe("https://example.test/docs?q=terminal#links");
    expect(normalizeExternalHttpUrl("http://example.test"))
      .toBe("http://example.test/");
  });

  it.each([
    "javascript:alert(1)",
    "file:///etc/passwd",
    "ssh://example.test",
    "not a url",
    "",
  ])("rejects unsupported or malformed input: %s", (value) => {
    expect(() => normalizeExternalHttpUrl(value)).toThrow();
  });

  it("rejects non-string and oversized values", () => {
    expect(() => normalizeExternalHttpUrl(null)).toThrow();
    expect(() => normalizeExternalHttpUrl(`https://example.test/${"a".repeat(8_192)}`)).toThrow();
  });
});
