import OpenAI from "openai";
import { openai, IMAGE_MODEL } from "./openai.js";

export type ImageSize = "1024x1024" | "1536x1024" | "1024x1536" | "auto";
export type ImageQuality = "low" | "medium" | "high" | "auto";
export type OutputFormat = "png" | "jpeg" | "webp";
export type ImageBackground = "transparent" | "opaque" | "auto";
export type Moderation = "auto" | "low";

/** What you can pass as a source image (File/Blob in browser, Buffer/stream in Node). */
export type ImageUpload = File | Blob | Buffer;

export interface ImageGenOptions {
  size?: ImageSize;
  quality?: ImageQuality;
  outputFormat?: OutputFormat;
  outputCompression?: number;
  background?: ImageBackground;
  moderation?: Moderation;
  n?: number;
}

export interface GeneratedImage {
  b64Json?: string;
  url?: string;
  revisedPrompt?: string;
}

/** Decode a base64 image result to bytes. */
export function decodeImage(img: GeneratedImage): Buffer {
  if (!img.b64Json) throw new Error("No base64 image returned by the API.");
  return Buffer.from(img.b64Json, "base64");
}

/**
 * gpt-image-2 (v2 Image API) — text-to-image generation.
 * POST /v1/images/generations with `model: "gpt-image-2"`.
 */
export async function generateImage(
  prompt: string,
  options: ImageGenOptions = {}
): Promise<GeneratedImage> {
  const result = await openai.images.generate({
    model: IMAGE_MODEL,
    prompt,
    size: options.size ?? "auto",
    quality: options.quality ?? "auto",
    output_format: options.outputFormat ?? "png",
    output_compression: options.outputCompression,
    background: options.background,
    moderation: options.moderation ?? "auto",
    n: options.n ?? 1,
  });

  const item = result.data?.[0];
  if (!item) throw new Error("Image generation returned no data from the API.");
  return {
    b64Json: item.b64_json,
    url: item.url,
    revisedPrompt: item.revised_prompt,
  };
}

/**
 * gpt-image-2 (v2 Image API) — streamed image generation with partial images.
 * POST /v1/images/generations?stream=true. `onPartial` receives up to `partialImages`
 * intermediate frames; the final frame is delivered via `onFinal`.
 */
export async function generateImageStream(
  prompt: string,
  handlers: {
    onPartial?: (b64: string, index: number) => void;
    onFinal?: (img: GeneratedImage) => void;
  },
  options: ImageGenOptions & { partialImages?: number } = {}
): Promise<void> {
  // The SDK's ImageGenerateParams type lags gpt-image-2; the REST API supports
  // stream + partial_images, so we pass them through a cast.
  const stream = (await openai.images.generate({
    model: IMAGE_MODEL,
    prompt,
    size: options.size ?? "auto",
    quality: options.quality ?? "auto",
    output_format: options.outputFormat ?? "png",
    output_compression: options.outputCompression,
    background: options.background,
    moderation: options.moderation ?? "auto",
    n: 1,
    stream: true,
    partial_images: options.partialImages ?? 2,
  } as unknown as OpenAI.ImageGenerateParams)) as unknown as AsyncIterable<{
    type: string;
    b64_json?: string;
    partial_image_index?: number;
  }>;

  for await (const event of stream) {
    if (event.type === "image_generation.partial_image" && event.b64_json) {
      handlers.onPartial?.(event.b64_json, event.partial_image_index ?? 0);
    }
  }

  if (handlers.onFinal) {
    const final = await generateImage(prompt, options);
    handlers.onFinal(final);
  }
}

/**
 * gpt-image-2 (v2 Image API) — edit/reference images.
 * POST /v1/images/edits. Accepts one or more input images as references and
 * produces a new image guided by `prompt`.
 */
export async function editImage(
  prompt: string,
  image: ImageUpload | ImageUpload[],
  options: ImageGenOptions = {}
): Promise<GeneratedImage> {
  const result = await openai.images.edit({
    model: IMAGE_MODEL,
    prompt,
    image: image as File | Blob | Buffer,
    size: options.size ?? "auto",
    quality: options.quality ?? "auto",
    output_format: options.outputFormat ?? "png",
    output_compression: options.outputCompression,
    background: options.background,
    moderation: options.moderation ?? "auto",
    n: options.n ?? 1,
  } as OpenAI.ImageEditParams);

  const item = result.data?.[0];
  if (!item) throw new Error("Image edit returned no data from the API.");
  return {
    b64Json: item.b64_json,
    url: item.url,
    revisedPrompt: item.revised_prompt,
  };
}

/**
 * gpt-image-2 (v2 Image API) — inpainting with a mask.
 * POST /v1/images/edits with `image` + `mask`. The mask marks the region to
 * replace (white = repaint, black = keep). Masking is prompt-guided.
 */
export async function inpaintImage(
  prompt: string,
  image: ImageUpload,
  mask: ImageUpload,
  options: ImageGenOptions = {}
): Promise<GeneratedImage> {
  const result = await openai.images.edit({
    model: IMAGE_MODEL,
    prompt,
    image,
    mask,
    size: options.size ?? "auto",
    quality: options.quality ?? "auto",
    output_format: options.outputFormat ?? "png",
    output_compression: options.outputCompression,
    background: options.background,
    moderation: options.moderation ?? "auto",
  } as OpenAI.ImageEditParams);

  const item = result.data?.[0];
  if (!item) throw new Error("Image inpaint returned no data from the API.");
  return {
    b64Json: item.b64_json,
    url: item.url,
    revisedPrompt: item.revised_prompt,
  };
}
