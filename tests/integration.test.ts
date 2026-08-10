import { describe, it, expect } from "vitest";

// INTEGRATION TESTS — only executed when a REAL OpenAI API key is present.
// Without a key the entire suite is skipped, so `npm test` stays green in CI.
// We never import the network-dependent modules at the top level: the import is
// performed lazily inside the suite so the module-load guard in src/openai.ts
// does not fire when no key is configured.
const hasKey = Boolean(process.env.OPENAI_API_KEY);

describe.skipIf(!hasKey)("OpenAI real API integration", () => {
  it("createResponse returns non-empty text", async () => {
    const { createResponse } = await import("../src/responses.js");
    const result = await createResponse("Reply with the single word: pong");
    expect(typeof result.text).toBe("string");
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.responseId).toBeTruthy();
  });

  it("decodeImage still works in the real-client environment", async () => {
    const { decodeImage } = await import("../src/images.js");
    const b64 = Buffer.from("integration").toString("base64");
    expect(decodeImage({ b64Json: b64 }).toString("utf8")).toBe("integration");
  });
});
