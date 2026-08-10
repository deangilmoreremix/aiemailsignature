import { describe, it, expect } from "vitest";

// src/server.ts builds an OpenAI client at load time, so a local key is set
// here to allow the module to load without any network request.
if (!process.env.OPENAI_API_KEY) {
  process.env.OPENAI_API_KEY = "sk-local-module-load-only";
}

describe("toContent", () => {
  it("maps an https URL to a url content", async () => {
    const { toContent } = await import("../src/server.js");
    expect(toContent("https://example.com/a.png")).toEqual({
      kind: "url",
      url: "https://example.com/a.png",
    });
  });

  it("maps an http URL to a url content", async () => {
    const { toContent } = await import("../src/server.js");
    expect(toContent("http://example.com/a.png")).toEqual({
      kind: "url",
      url: "http://example.com/a.png",
    });
  });

  it("maps a data URL to a dataUrl content", async () => {
    const { toContent } = await import("../src/server.js");
    const src = "data:image/png;base64,abc123";
    expect(toContent(src)).toEqual({ kind: "dataUrl", url: src });
  });

  it("throws for an empty string", async () => {
    const { toContent } = await import("../src/server.js");
    expect(() => toContent("")).toThrow();
  });

  it("throws for a non-string value", async () => {
    const { toContent } = await import("../src/server.js");
    expect(() => toContent(null)).toThrow();
    expect(() => toContent(undefined)).toThrow();
    expect(() => toContent(42)).toThrow();
  });
});

describe("optsFrom", () => {
  it("passes through size, quality, outputFormat and background", async () => {
    const { optsFrom } = await import("../src/server.js");
    expect(
      optsFrom({
        size: "1024x1024",
        quality: "high",
        outputFormat: "png",
        background: "transparent",
      })
    ).toEqual({
      size: "1024x1024",
      quality: "high",
      outputFormat: "png",
      background: "transparent",
    });
  });

  it("coerces outputCompression and n via Number", async () => {
    const { optsFrom } = await import("../src/server.js");
    expect(optsFrom({ outputCompression: "80", n: "2" })).toEqual({
      outputCompression: 80,
      n: 2,
    });
  });

  it("returns an empty options object for an empty body", async () => {
    const { optsFrom } = await import("../src/server.js");
    expect(optsFrom({})).toEqual({});
  });

  it("ignores unknown fields", async () => {
    const { optsFrom } = await import("../src/server.js");
    expect(optsFrom({ size: "512x512", unknownField: "ignored" })).toEqual({
      size: "512x512",
    });
  });
});

describe("withDataUrl", () => {
  it("builds a data URL from b64Json", async () => {
    const { withDataUrl } = await import("../src/server.js");
    const result = withDataUrl({ b64Json: "abc123" });
    expect(result.dataUrl).toBe("data:image/png;base64,abc123");
  });

  it("falls back to the url when only url is present", async () => {
    const { withDataUrl } = await import("../src/server.js");
    const result = withDataUrl({ url: "https://x/y.png" });
    expect(result.dataUrl).toBe("https://x/y.png");
  });

  it("returns null dataUrl for an empty object", async () => {
    const { withDataUrl } = await import("../src/server.js");
    const result = withDataUrl({});
    expect(result.dataUrl).toBeNull();
  });
});
