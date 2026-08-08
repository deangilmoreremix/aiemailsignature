import { openai, IMAGE_MODEL } from "./openai.js";

export type ImageSize = "1024x1024" | "1536x1024" | "1024x1536" | "auto";
export type ImageQuality = "low" | "medium" | "high" | "auto";
export type OutputFormat = "png" | "jpeg" | "webp";

export interface ImageGenOptions {
  model?: string;
  size?: ImageSize;
  quality?: ImageQuality;
  outputFormat?: OutputFormat;
  outputCompression?: number;
  background?: "transparent" | "opaque" | "auto";
  moderation?: "auto" | "low";
}

/**
 * Generates an image using the OpenAI gpt-image-2 model via the v2 images
 * API (POST /v1/images/generations). Real API call, no mock fallback.
 */
export async function generateImage(
  prompt: string,
  options: ImageGenOptions = {}
): Promise<{ b64Json?: string; url?: string; revisedPrompt?: string }> {
  const result = await openai.images.generate({
    model: options.model ?? IMAGE_MODEL,
    prompt,
    size: options.size ?? "auto",
    quality: options.quality ?? "auto",
    output_format: options.outputFormat ?? "png",
    output_compression: options.outputCompression,
    background: options.background,
    moderation: options.moderation ?? "auto",
    n: 1,
  });

  const item = result.data?.[0];
  if (!item) {
    throw new Error("Image generation returned no data from the API.");
  }

  return {
    b64Json: item.b64_json,
    url: item.url,
    revisedPrompt: item.revised_prompt,
  };
}

/**
 * Edits an existing image using gpt-image-2 (image-to-image editing).
 */
export async function editImage(
  prompt: string,
  image: Buffer | ArrayBuffer,
  options: ImageGenOptions = {}
): Promise<{ b64Json?: string; url?: string }> {
  const file = new File([image as BlobPart], "image.png", {
    type: "image/png",
  });

  const result = await openai.images.edit({
    model: options.model ?? IMAGE_MODEL,
    prompt,
    image: file,
    size: options.size ?? "auto",
    quality: options.quality ?? "auto",
    // gpt-image-2 supports output_format; cast because some SDK versions
    // still type this param for gpt-image-1 only.
    output_format: options.outputFormat ?? "png",
  } as Parameters<typeof openai.images.edit>[0]);

  const item = result.data?.[0];
  if (!item) {
    throw new Error("Image edit returned no data from the API.");
  }

  return { b64Json: item.b64_json, url: item.url };
}
