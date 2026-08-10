import { describe, it, expect } from "vitest";

// `src/openai.ts` refuses to load when OPENAI_API_KEY is missing. The pure
// functions we test here never touch the network, but importing their modules
// still constructs the OpenAI client at load time. A local key lets the module
// load without making any request — no simulated data, no canned responses.
if (!process.env.OPENAI_API_KEY) {
  process.env.OPENAI_API_KEY = "sk-local-module-load-only";
}

describe("decodeImage", () => {
  it("decodes a base64 image to the correct Buffer", async () => {
    const { decodeImage } = await import("../src/images.js");

    const original = Buffer.from("hello world");
    const b64 = original.toString("base64");

    const result = decodeImage({ b64Json: b64 });
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result).toEqual(original);
    expect(result.toString("utf8")).toBe("hello world");
  });

  it("throws when b64Json is missing", async () => {
    const { decodeImage } = await import("../src/images.js");

    expect(() => decodeImage({})).toThrow(/No base64 image/);
    expect(() => decodeImage({ url: "https://example.com/x.png" })).toThrow(
      /No base64 image/
    );
  });
});

describe("imageStudioTools", () => {
  it("returns exactly two tools named generate_image and edit_image", async () => {
    const { imageStudioTools } = await import("../src/conversation.js");

    const tools = imageStudioTools();
    const names = tools.map((t) => t.name);

    expect(names).toEqual(["generate_image", "edit_image"]);
  });

  it("exposes the expected parameter schemas for each tool", async () => {
    const { imageStudioTools } = await import("../src/conversation.js");

    const tools = imageStudioTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

    // generate_image requires a prompt and supports size/quality/output_format.
    const gen = byName["generate_image"];
    expect(gen.description.toLowerCase()).toContain("generate");
    expect(gen.parameters.type).toBe("object");
    const genProps = (gen.parameters.properties ?? {}) as Record<string, unknown>;
    expect(Object.keys(genProps)).toEqual(
      expect.arrayContaining(["prompt", "size", "quality", "output_format"])
    );
    expect(gen.parameters.required).toEqual(["prompt"]);
    expect(gen.parameters.additionalProperties).toBe(false);

    // edit_image requires a prompt and a base64 image.
    const edit = byName["edit_image"];
    expect(edit.description.toLowerCase()).toContain("edit");
    const editProps = (edit.parameters.properties ?? {}) as Record<string, unknown>;
    expect(Object.keys(editProps)).toEqual(
      expect.arrayContaining(["prompt", "image_base64", "quality"])
    );
    expect(edit.parameters.required).toEqual(["prompt", "image_base64"]);
    expect(edit.parameters.additionalProperties).toBe(false);
  });

  it("provides callable handler functions (not invoked here)", async () => {
    const { imageStudioTools } = await import("../src/conversation.js");

    const tools = imageStudioTools();
    for (const tool of tools) {
      expect(typeof tool.handler).toBe("function");
    }
  });
});
