import OpenAI from "openai";
import { openai, RESPONSES_MODEL } from "./openai.js";

/** A chat/text response from the model. */
export interface ResponseResult {
  text: string;
  responseId: string;
  usage?: OpenAI.Responses.ResponseUsage;
}

export interface BaseResponseOptions {
  model?: string;
  instructions?: string;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  store?: boolean;
  truncation?: "auto" | "disabled";
  metadata?: Record<string, string>;
}

function collectText(response: OpenAI.Responses.Response): string {
  return response.output
    .filter((item): item is OpenAI.Responses.ResponseOutputMessage =>
      item.type === "message"
    )
    .flatMap((item) =>
      item.content
        .filter((c) => c.type === "output_text")
        .map((c) => (c as OpenAI.Responses.ResponseOutputText).text)
    )
    .join("\n")
    .trim();
}

/**
 * Responses API — single text response.
 * POST /v1/responses with a plain string `input`.
 */
export async function createResponse(
  input: string,
  options: BaseResponseOptions = {}
): Promise<ResponseResult> {
  const response = await openai.responses.create({
    model: options.model ?? RESPONSES_MODEL,
    input,
    instructions: options.instructions,
    temperature: options.temperature,
    top_p: options.topP,
    max_output_tokens: options.maxOutputTokens,
    store: options.store,
    truncation: options.truncation,
    metadata: options.metadata,
  });

  return { text: collectText(response), responseId: response.id, usage: response.usage };
}

/**
 * Responses API — multi-turn conversation.
 * Uses `previous_response_id` so the model keeps state server-side.
 */
export async function continueResponse(
  input: string,
  previousResponseId: string,
  options: BaseResponseOptions = {}
): Promise<ResponseResult> {
  const response = await openai.responses.create({
    model: options.model ?? RESPONSES_MODEL,
    input,
    previous_response_id: previousResponseId,
    instructions: options.instructions,
    temperature: options.temperature,
    max_output_tokens: options.maxOutputTokens,
  });

  return { text: collectText(response), responseId: response.id, usage: response.usage };
}

/**
 * Responses API — streamed text response.
 * Emits incremental text deltas via `onDelta`, resolves with the full text.
 */
export async function streamResponse(
  input: string,
  onDelta: (delta: string) => void,
  options: BaseResponseOptions = {}
): Promise<ResponseResult> {
  const stream = await openai.responses.stream({
    model: options.model ?? RESPONSES_MODEL,
    input,
    instructions: options.instructions,
    temperature: options.temperature,
    max_output_tokens: options.maxOutputTokens,
  });

  let full = "";
  for await (const event of stream) {
    if (event.type === "response.output_text.delta") {
      full += event.delta;
      onDelta(event.delta);
    }
  }

  const final = await stream.finalResponse();
  return { text: full.trim() || collectText(final), responseId: final.id, usage: final.usage };
}

/**
 * Responses API — Structured Outputs (JSON Schema).
 * Guarantees the model returns JSON that validates against `schema`.
 */
export async function createStructuredResponse<T = unknown>(
  input: string,
  schema: Record<string, unknown>,
  options: BaseResponseOptions & { schemaName?: string; strict?: boolean } = {}
): Promise<T> {
  const response = await openai.responses.create({
    model: options.model ?? RESPONSES_MODEL,
    input,
    instructions: options.instructions,
    temperature: options.temperature,
    max_output_tokens: options.maxOutputTokens,
    text: {
      format: {
        type: "json_schema",
        name: options.schemaName ?? "structured_result",
        schema,
        strict: options.strict ?? true,
      },
    },
  });

  const text = collectText(response);
  return JSON.parse(text) as T;
}

/** A function tool the model can call. */
export interface FunctionTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
  handler: (args: Record<string, unknown>) => unknown | Promise<unknown>;
}

/**
 * Responses API — tool / function calling (agentic loop).
 * Built-in tools (e.g. web search) can be passed via `builtInTools`.
 * Function tools are executed locally and their outputs fed back until the
 * model produces a final answer.
 */
export async function runWithFunctions(
  input: string,
  tools: FunctionTool[],
  options: BaseResponseOptions & { builtInTools?: OpenAI.Responses.Tool[] } = {}
): Promise<ResponseResult> {
  const functionDefs: OpenAI.Responses.Tool[] = tools.map((t) => ({
    type: "function",
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    strict: t.strict ?? true,
  }));

  const allTools = [...functionDefs, ...(options.builtInTools ?? [])];

  // First call uses the user's text input.
  let response = await openai.responses.create({
    model: options.model ?? RESPONSES_MODEL,
    input,
    instructions: options.instructions,
    temperature: options.temperature,
    max_output_tokens: options.maxOutputTokens,
    tools: allTools,
  });

  // Up to 5 round-trips of function calls.
  for (let turn = 0; turn < 5; turn++) {
    const calls = response.output.filter(
      (item) => item.type === "function_call"
    ) as OpenAI.Responses.ResponseFunctionToolCall[];

    if (calls.length === 0) {
      return {
        text: collectText(response),
        responseId: response.id,
        usage: response.usage,
      };
    }

    // Execute each function call and append its output as a follow-up item.
    const outputs: OpenAI.Responses.ResponseInputItem.FunctionCallOutput[] =
      await Promise.all(
        calls.map(async (call) => {
          const fn = tools.find((t) => t.name === call.name);
          const args = call.arguments ? JSON.parse(call.arguments) : {};
          const result = fn ? await fn.handler(args) : null;
          return {
            type: "function_call_output" as const,
            call_id: call.call_id,
            output: JSON.stringify(result ?? null),
          };
        })
      );

    response = await openai.responses.create({
      model: options.model ?? RESPONSES_MODEL,
      previous_response_id: response.id,
      input: outputs,
    });
  }

  throw new Error("Exceeded maximum function-calling turns (5).");
}

/** An image supplied to the model as input. */
/** Vision detail level for image inputs (Responses API + Chat Completions). */
export type ImageDetail = "low" | "high" | "original" | "auto";

export type ImageInput =
  | { url: string; detail?: ImageDetail }
  | { base64: string; mediaType?: string; detail?: ImageDetail }
  | { fileId: string; detail?: ImageDetail };

function toInputImage(img: ImageInput): OpenAI.Responses.ResponseInputImage {
  const detail = (img.detail ?? "auto") as OpenAI.Responses.ResponseInputImage["detail"];
  if ("url" in img)
    return { type: "input_image", image_url: img.url, detail };
  if ("fileId" in img)
    return { type: "input_image", file_id: img.fileId, detail };
  const dataUrl = `data:${img.mediaType ?? "image/png"};base64,${img.base64}`;
  return { type: "input_image", image_url: dataUrl, detail };
}

/**
 * Responses API — multimodal input (text + one or more images).
 * Lets the model reason about images (vision) via URL, base64, or file ID.
 * Use `detail` to control fidelity: "original" preserves dimensions for OCR/
 * spatial tasks; "low" is cheaper/faster; "auto" lets the model decide.
 */
export async function createResponseWithImage(
  text: string,
  images: ImageInput | ImageInput[],
  options: BaseResponseOptions = {}
): Promise<ResponseResult> {
  const list = Array.isArray(images) ? images : [images];
  const content: OpenAI.Responses.ResponseInputMessageContentList = [
    { type: "input_text", text },
    ...list.map(toInputImage),
  ];

  const response = await openai.responses.create({
    model: options.model ?? RESPONSES_MODEL,
    input: [{ role: "user", content }],
    instructions: options.instructions,
    temperature: options.temperature,
    max_output_tokens: options.maxOutputTokens,
  });

  return { text: collectText(response), responseId: response.id, usage: response.usage };
}

/**
 * Convenience wrapper: ask the model a question about one or more images.
 */
export async function analyzeImage(
  question: string,
  images: ImageInput | ImageInput[],
  options: BaseResponseOptions = {}
): Promise<string> {
  const res = await createResponseWithImage(question, images, options);
  return res.text;
}

/**
 * Responses API — streamed multimodal input (text + one or more images).
 * Same vision capabilities as `createResponseWithImage`, but emits incremental
 * text deltas via `onDelta` and resolves with the full text once complete.
 * Per-image `detail` ("low" | "high" | "auto") controls fidelity/cost.
 */
export async function streamResponseWithImage(
  text: string,
  images: ImageInput | ImageInput[],
  onDelta: (delta: string) => void,
  options: BaseResponseOptions = {}
): Promise<ResponseResult> {
  const list = Array.isArray(images) ? images : [images];
  const content: OpenAI.Responses.ResponseInputMessageContentList = [
    { type: "input_text", text },
    ...list.map(toInputImage),
  ];

  const stream = await openai.responses.stream({
    model: options.model ?? RESPONSES_MODEL,
    input: [{ role: "user", content }],
    instructions: options.instructions,
    temperature: options.temperature,
    max_output_tokens: options.maxOutputTokens,
  });

  let full = "";
  for await (const event of stream) {
    if (event.type === "response.output_text.delta") {
      full += event.delta;
      onDelta(event.delta);
    }
  }

  const final = await stream.finalResponse();
  return { text: full.trim() || collectText(final), responseId: final.id, usage: final.usage };
}

/**
 * Convenience wrapper: ask the model a question about one or more images and
 * stream the answer back token-by-token.
 */
export async function streamAnalyzeImage(
  question: string,
  images: ImageInput | ImageInput[],
  onDelta: (delta: string) => void,
  options: BaseResponseOptions = {}
): Promise<ResponseResult> {
  return streamResponseWithImage(question, images, onDelta, options);
}

/** Upload an image to the Files API (purpose: vision) and return its file ID. */
export async function uploadVisionImage(
  source: File | Blob | Buffer,
  filename = "vision.png"
): Promise<string> {
  const file = new File([source as BlobPart], filename, { type: "image/png" });
  const uploaded = await openai.files.create({ file, purpose: "vision" });
  return uploaded.id;
}
