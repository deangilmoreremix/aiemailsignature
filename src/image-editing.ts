import { openai } from "./openai.js";
import {
  editImage,
  inpaintImage,
  type ImageUpload,
  type ImageGenOptions,
  type GeneratedImage,
} from "./images.js";
import { editImageViaResponses, type ResponseImage } from "./conversation.js";
import { readFileSync } from "node:fs";

/**
 * Every kind of image content the application might hold, normalized so it can
 * be fed into gpt-image-2 (v2 Image API) for editing.
 */
export type ImageFormat = "png" | "jpeg" | "webp" | "gif";

export type ImageContent =
  | { kind: "buffer"; data: Buffer; format?: ImageFormat }
  | { kind: "blob"; data: Blob; format?: ImageFormat }
  | { kind: "base64"; data: string; mediaType?: string }
  | { kind: "dataUrl"; url: string }
  | { kind: "url"; url: string }
  | { kind: "fileId"; id: string }
  | { kind: "filePath"; path: string; format?: ImageFormat }
  | { kind: "generated"; image: GeneratedImage } // output of gpt-image-2
  | { kind: "responseImage"; image: ResponseImage }; // output of Responses image tool

/** Mask content for inpainting (subset of image sources). */
export type MaskContent =
  | { kind: "buffer"; data: Buffer }
  | { kind: "base64"; data: string }
  | { kind: "dataUrl"; url: string }
  | { kind: "url"; url: string }
  | { kind: "filePath"; path: string }
  | { kind: "fileId"; id: string }
  | { kind: "generated"; image: GeneratedImage };

const MIME: Record<ImageFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

function bytesFromEncoded(s: string): Buffer {
  // Accepts raw base64 or a `data:<mime>;base64,...` URL.
  if (s.startsWith("data:")) {
    const comma = s.indexOf(",");
    return Buffer.from(s.slice(comma + 1), "base64");
  }
  return Buffer.from(s, "base64");
}

function formatOf(content: ImageContent): ImageFormat {
  switch (content.kind) {
    case "buffer":
    case "filePath":
      return content.format ?? "png";
    case "dataUrl": {
      const m = content.url.match(/data:image\/([a-z0-9]+)/);
      return (m?.[1] as ImageFormat) ?? "png";
    }
    default:
      return "png";
  }
}

/** Resolve any ImageContent to raw bytes (no mock data; real fetch/fs/API). */
export async function normalizeToBytes(content: ImageContent): Promise<Buffer> {
  switch (content.kind) {
    case "buffer":
      return content.data;
    case "blob":
      return Buffer.from(await content.data.arrayBuffer());
    case "base64":
      return bytesFromEncoded(content.data);
    case "dataUrl":
      return bytesFromEncoded(content.url);
    case "url": {
      const res = await fetch(content.url);
      if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }
    case "fileId": {
      const fr = await openai.files.content(content.id);
      return Buffer.from(await fr.arrayBuffer());
    }
    case "filePath":
      return readFileSync(content.path);
    case "generated":
    case "responseImage": {
      const b64 = content.image.b64Json;
      if (!b64) throw new Error("Image content has no base64 data (URL-only result).");
      return Buffer.from(b64, "base64");
    }
  }
}

/** Resolve any ImageContent to an uploadable the gpt-image-2 API accepts. */
export async function normalizeToUploadable(content: ImageContent): Promise<ImageUpload> {
  const bytes = await normalizeToBytes(content);
  const fmt = formatOf(content);
  return new File([bytes as BlobPart], `image.${fmt}`, { type: MIME[fmt] });
}

async function maskToBytes(mask: ImageContent): Promise<Buffer> {
  switch (mask.kind) {
    case "buffer":
      return mask.data;
    case "base64":
      return bytesFromEncoded(mask.data);
    case "dataUrl":
      return bytesFromEncoded(mask.url);
    case "url": {
      const res = await fetch(mask.url);
      if (!res.ok) throw new Error(`Failed to fetch mask: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }
    case "fileId": {
      const fr = await openai.files.content(mask.id);
      return Buffer.from(await fr.arrayBuffer());
    }
    case "filePath":
      return readFileSync(mask.path);
    case "generated": {
      if (!mask.image.b64Json) throw new Error("Mask has no base64 data.");
      return Buffer.from(mask.image.b64Json, "base64");
    }
    default:
      throw new Error(`Unsupported mask content: ${mask.kind}`);
  }
}

/**
 * gpt-image-2 EDITING FEATURE 1 — edit via TEXT.
 * Takes any existing image plus a natural-language instruction and returns the
 * edited image(s). This is the core "edit via text" capability.
 */
export async function editViaText(
  content: ImageContent,
  prompt: string,
  options: ImageGenOptions = {}
): Promise<GeneratedImage[]> {
  const image = await normalizeToUploadable(content);
  return editImage(prompt, image, options);
}

/**
 * gpt-image-2 EDITING FEATURE 2 — edit with one or more REFERENCE images.
 * Feeds multiple source images as references and generates a new image guided
 * by the prompt (e.g. combine products into one gift basket).
 */
export async function editWithReferences(
  prompt: string,
  contents: ImageContent[],
  options: ImageGenOptions = {}
): Promise<GeneratedImage[]> {
  const images = await Promise.all(contents.map(normalizeToUploadable));
  return editImage(prompt, images, options);
}

/**
 * gpt-image-2 EDITING FEATURE 3 — INPAINTING via mask.
 * `mask` marks the region to replace (white = repaint). Masking is prompt-guided.
 */
export async function inpaint(
  content: ImageContent,
  mask: ImageContent,
  prompt: string,
  options: ImageGenOptions = {}
): Promise<GeneratedImage[]> {
  const image = await normalizeToUploadable(content);
  const maskBytes = await maskToBytes(mask);
  const maskFile = new File([maskBytes as BlobPart], "mask.png", { type: "image/png" });
  return inpaintImage(prompt, image, maskFile, options);
}

/**
 * gpt-image-2 EDITING FEATURE 4 — conversational text edit (Responses API).
 * Multi-turn editing where the model decides to edit an image already in
 * context. Pass the previous response id from a prior image-generation turn.
 */
export async function editViaTextResponses(
  prompt: string,
  previousResponseId: string,
  options: { quality?: ImageGenOptions["quality"]; size?: ImageGenOptions["size"] } = {}
): Promise<ResponseImage[]> {
  return editImageViaResponses(prompt, previousResponseId, {
    action: "edit",
    quality: options.quality,
    size: options.size,
  });
}
