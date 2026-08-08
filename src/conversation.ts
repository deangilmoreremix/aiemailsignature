import OpenAI from "openai";
import { openai, RESPONSES_MODEL } from "./openai.js";
import { runWithFunctions, analyzeImage, type ImageInput, type ImageDetail } from "./responses.js";
import { generateImage, editImage, decodeImage } from "./images.js";

/** A generated image returned from the Responses API image tool. */
export interface ResponseImage {
  b64Json: string;
  revisedPrompt?: string;
}

export interface ImageGenToolOptions {
  model?: string;
  quality?: "low" | "medium" | "high" | "auto";
  size?: "1024x1024" | "1024x1536" | "1536x1024" | "auto";
  background?: "transparent" | "opaque" | "auto";
  moderation?: "auto" | "low";
  outputFormat?: "png" | "webp" | "jpeg";
  outputCompression?: number;
  /** Force generate vs edit when an image is already in context. */
  action?: "generate" | "edit" | "auto";
  /** Partial images for streaming (0-3). */
  partialImages?: number;
}

/**
 * Builds the Responses API `image_generation` built-in tool.
 * NOTE: the Responses API image tool selects its own GPT Image model
 * (defaults to gpt-image-1). Use the Image API (src/images.ts) for gpt-image-2.
 */
function imageGenTool(opts: ImageGenToolOptions = {}): OpenAI.Responses.Tool {
  return {
    type: "image_generation",
    model: opts.model as "gpt-image-1" | undefined,
    quality: opts.quality,
    size: opts.size,
    background: opts.background,
    moderation: opts.moderation,
    output_format: opts.outputFormat,
    output_compression: opts.outputCompression,
    partial_images: opts.partialImages,
    action: opts.action,
  } as OpenAI.Responses.Tool;
}

function extractImages(response: OpenAI.Responses.Response): ResponseImage[] {
  return response.output
    .filter((o) => o.type === "image_generation_call")
    .map((o) => o as unknown as { result: string | null; revised_prompt?: string })
    .filter((o) => o.result != null)
    .map((o) => ({ b64Json: o.result as string, revisedPrompt: o.revised_prompt }));
}

/**
 * Responses API — generate an image conversationally via the built-in
 * `image_generation` tool. Returns the base64 image(s).
 */
export async function generateImageViaResponses(
  prompt: string,
  opts: ImageGenToolOptions & { model?: string } = {}
): Promise<ResponseImage[]> {
  const response = await openai.responses.create({
    model: opts.model ?? RESPONSES_MODEL,
    input: prompt,
    tools: [imageGenTool(opts)],
  });
  return extractImages(response);
}

/**
 * Responses API — multi-turn, high-fidelity image editing. Pass the previous
 * response id to iterate on the same image across turns.
 */
export async function editImageViaResponses(
  prompt: string,
  previousResponseId: string,
  opts: ImageGenToolOptions & { model?: string } = {}
): Promise<ResponseImage[]> {
  const response = await openai.responses.create({
    model: opts.model ?? RESPONSES_MODEL,
    previous_response_id: previousResponseId,
    input: prompt,
    tools: [imageGenTool({ ...opts, action: opts.action ?? "auto" })],
  });
  return extractImages(response);
}

/**
 * Responses API — streamed image generation with partial images.
 * `onPartial` fires for each intermediate frame; `onDone` delivers the final image.
 */
export async function streamImageViaResponses(
  prompt: string,
  handlers: {
    onPartial?: (b64: string, index: number) => void;
    onDone?: (images: ResponseImage[]) => void;
  },
  opts: ImageGenToolOptions & { model?: string } = {}
): Promise<void> {
  const stream = await openai.responses.stream({
    model: opts.model ?? RESPONSES_MODEL,
    input: prompt,
    stream: true,
    tools: [imageGenTool({ ...opts, partialImages: opts.partialImages ?? 2 })],
  });

  let finalImages: ResponseImage[] = [];
  for await (const event of stream) {
    if (event.type === "response.image_generation_call.partial_image") {
      handlers.onPartial?.(event.partial_image_b64, event.partial_image_index);
    } else if (event.type === "response.completed") {
      finalImages = extractImages(event.response);
    }
  }
  handlers.onDone?.(finalImages);
}

import type { FunctionTool } from "./responses.js";

/**
 * ENHANCEMENT: combine both APIs into one agent.
 * The Responses API provides reasoning + tool use; the gpt-image-2 Image API
 * (src/images.ts) performs the actual generation/editing. The model can call
 * `generate_image` / `edit_image` and get real gpt-image-2 results back.
 */
export function imageStudioTools(): FunctionTool[] {
  return [
    {
      name: "generate_image",
      description:
        "Generate a brand-new image from a text prompt using gpt-image-2. Returns base64 PNG.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          size: { type: "string", enum: ["1024x1024", "1536x1024", "1024x1536", "auto"] },
          quality: { type: "string", enum: ["low", "medium", "high", "auto"] },
          output_format: { type: "string", enum: ["png", "jpeg", "webp"] },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
      handler: async (args) => {
        const img = await generateImage(args.prompt as string, {
          size: args.size as ImageGenToolOptions["size"],
          quality: args.quality as ImageGenToolOptions["quality"],
          outputFormat: args.output_format as "png" | "jpeg" | "webp",
        });
        return { b64Json: img[0]?.b64Json, revisedPrompt: img[0]?.revisedPrompt };
      },
    },
    {
      name: "edit_image",
      description:
        "Edit or restyle an existing image using gpt-image-2. Accepts a base64 PNG image.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          image_base64: { type: "string" },
          quality: { type: "string", enum: ["low", "medium", "high", "auto"] },
        },
        required: ["prompt", "image_base64"],
        additionalProperties: false,
      },
      handler: async (args) => {
        const bytes = Buffer.from(args.image_base64 as string, "base64");
        const img = await editImage(args.prompt as string, new File([bytes], "image.png", { type: "image/png" }), {
          quality: args.quality as ImageGenToolOptions["quality"],
        });
        return { b64Json: img[0]?.b64Json, revisedPrompt: img[0]?.revisedPrompt };
      },
    },
  ];
}

/**
 * Run the combined image studio: a Responses API conversation that can call
 * gpt-image-2 through function tools, with optional image input.
 */
export async function runImageStudio(
  input: string,
  options: { model?: string; instructions?: string } = {}
) {
  return runWithFunctions(input, imageStudioTools(), {
    model: options.model,
    instructions:
      options.instructions ??
      "You are an image studio assistant. Use the generate_image and edit_image tools (gpt-image-2) to fulfill requests.",
  });
}

/**
 * ENHANCEMENT: vision + gpt-image-2.
 * Uses the Responses API's vision to understand an image, then feeds that
 * understanding into gpt-image-2 (Image API) to generate a new image.
 */
export async function analyzeThenGenerate(
  image: ImageInput,
  question: string,
  genPrompt?: string,
  options: { detail?: ImageDetail } = {}
): Promise<{ description: string; image: import("./images.js").GeneratedImage[] }> {
  const visionImage: ImageInput =
    "detail" in image && image.detail ? image : { ...image, detail: options.detail ?? "auto" };
  const description = await analyzeImage(question, visionImage);
  const generated = await generateImage(genPrompt ?? description);
  return { description, image: generated };
}

/**
 * Resolve any `ImageInput` (base64 / URL / Files API id) to raw image bytes.
 * Needed because the Responses API accepts images by reference, while the
 * Image API (`/v1/images/edits`) needs the actual file upload.
 */
export async function imageInputToBytes(image: ImageInput): Promise<Buffer> {
  if ("base64" in image) {
    return Buffer.from(image.base64, "base64");
  }

  if ("url" in image) {
    const res = await fetch(image.url);
    if (!res.ok) throw new Error("Failed to fetch image: " + res.status);
    return Buffer.from(await res.arrayBuffer());
  }

  const fr = await openai.files.content(image.fileId);
  return Buffer.from(await fr.arrayBuffer());
}

/**
 * ENHANCEMENT: vision-guided editing ("Images and vision" guide).
 * 1. The model actually LOOKS at the image with the Responses API (vision) and
 *    describes it.
 * 2. That description is prepended to the user's instruction so gpt-image-2
 *    edits the same image with real context about what is in it.
 * Returns every image gpt-image-2 produced (use `result[0]` for a single one).
 */
export async function visionGuidedEdit(
  image: ImageInput,
  editPrompt: string,
  options: ImageGenToolOptions = {}
): Promise<import("./images.js").GeneratedImage[]> {
  const bytes = await imageInputToBytes(image);
  const file = new File([bytes as BlobPart], "image.png", { type: "image/png" });

  // Real vision call: understand the image before editing it.
  const description = await analyzeImage(
    "Briefly describe this image for editing context.",
    image
  );

  const effectivePrompt = description
    ? `Source image description: ${description}\n\nEdit instruction: ${editPrompt}`
    : editPrompt;

  return editImage(effectivePrompt, file, options);
}
