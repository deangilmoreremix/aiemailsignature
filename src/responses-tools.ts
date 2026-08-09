import OpenAI from "openai";
import { openai, RESPONSES_MODEL } from "./openai.js";

/** Normalized result returned by the built-in search/retrieval tools. */
export interface ToolResult {
  text: string;
  annotations: {
    type: string;
    url?: string;
    title?: string;
    fileId?: string;
  }[];
  raw: unknown[];
}

/** Extract message text plus any url/file citations from a Responses API response. */
function collectTextAndAnnotations(
  response: OpenAI.Responses.Response
): { text: string; annotations: ToolResult["annotations"] } {
  const annotations: ToolResult["annotations"] = [];
  const parts: string[] = [];

  for (const item of response.output) {
    if (item.type !== "message") continue;
    const message = item as OpenAI.Responses.ResponseOutputMessage;
    for (const content of message.content) {
      if (content.type !== "output_text") continue;
      const text = content as OpenAI.Responses.ResponseOutputText;
      parts.push(text.text);
      for (const ann of text.annotations) {
        if (ann.type === "url_citation") {
          annotations.push({ type: ann.type, url: ann.url, title: ann.title });
        } else if (ann.type === "file_citation" || ann.type === "file_path") {
          annotations.push({ type: ann.type, fileId: ann.file_id });
        }
      }
    }
  }

  return { text: parts.join("\n").trim(), annotations };
}

/**
 * Responses API — built-in Web Search tool.
 * Performs a live web search and returns the model's answer with source
 * citations (url_citation annotations).
 */
export async function webSearch(
  prompt: string,
  options: {
    model?: string;
    searchContextSize?: "low" | "medium" | "high";
    userLocation?: {
      type: "approximate";
      country?: string;
      city?: string;
      region?: string;
      timezone?: string;
    };
  } = {}
): Promise<ToolResult> {
  const response = await openai.responses.create({
    model: options.model ?? RESPONSES_MODEL,
    input: prompt,
    tools: [
      {
        type: "web_search",
        search_context_size: options.searchContextSize,
        user_location: options.userLocation,
      } as unknown as OpenAI.Responses.Tool,
    ],
  });

  const { text, annotations } = collectTextAndAnnotations(response);
  return { text, annotations, raw: response.output };
}

/**
 * Responses API — built-in File Search (RAG) tool.
 * Retrieves chunks from the given vector stores and returns the model's
 * grounded answer with file citations. Retrieved chunks are surfaced in `raw`.
 */
export async function fileSearch(
  prompt: string,
  vectorStoreIds: string[],
  options: {
    model?: string;
    maxNumResults?: number;
    filters?: unknown;
  } = {}
): Promise<ToolResult> {
  const response = await openai.responses.create({
    model: options.model ?? RESPONSES_MODEL,
    input: prompt,
    include: ["file_search_call.results"] as unknown as OpenAI.Responses.ResponseIncludable[],
    tools: [
      {
        type: "file_search",
        vector_store_ids: vectorStoreIds,
        max_num_results: options.maxNumResults,
        filters: options.filters as any,
      } as OpenAI.Responses.Tool,
    ],
  });

  const { text, annotations } = collectTextAndAnnotations(response);
  return { text, annotations, raw: response.output };
}

/** The shape of a single Code Interpreter execution result. */
export interface CodeInterpreterResult {
  text: string;
  code: string[];
  results: string[];
  raw: unknown[];
}

/**
 * Responses API — built-in Code Interpreter tool.
 * Runs Python code server-side and returns the model's answer, the executed
 * code snippets, and their textual/file outputs.
 */
export async function codeInterpreter(
  prompt: string,
  options: {
    model?: string;
    container?:
      | { type: "auto" }
      | { type: "image"; file_id: string };
  } = {}
): Promise<CodeInterpreterResult> {
  const response = await openai.responses.create({
    model: options.model ?? RESPONSES_MODEL,
    input: prompt,
    tools: [
      {
        type: "code_interpreter",
        container: (options.container ?? { type: "auto" }) as
          | string
          | OpenAI.Responses.Tool.CodeInterpreter.CodeInterpreterToolAuto,
      } as OpenAI.Responses.Tool,
    ],
  });

  const { text } = collectTextAndAnnotations(response);
  const code: string[] = [];
  const results: string[] = [];

  for (const item of response.output) {
    if (item.type !== "code_interpreter_call") continue;
    const call = item as OpenAI.Responses.ResponseCodeInterpreterToolCall;
    code.push(call.code);
    for (const result of call.results) {
      if (result.type === "logs") {
        results.push(result.logs);
      } else {
        for (const file of result.files) {
          results.push(file.file_id);
        }
      }
    }
  }

  return { text, code, results, raw: response.output };
}

/* ----------------------------- RAG helper flow ---------------------------- */

/** Create a vector store and return its ID. */
export async function createVectorStore(name: string): Promise<string> {
  const vs = await openai.vectorStores.create({ name });
  return vs.id;
}

/** Upload a file (path or Buffer) to OpenAI and return its file ID. */
export async function uploadFileForSearch(
  pathOrBuffer: string | Buffer,
  purpose: OpenAI.FilePurpose = "assistants"
): Promise<string> {
  const file =
    typeof pathOrBuffer === "string"
      ? await import("node:fs").then((fs) => fs.readFileSync(pathOrBuffer))
      : pathOrBuffer;
  const uploaded = await openai.files.create({ file: file as any, purpose });
  return uploaded.id;
}

/** Attach an uploaded file to a vector store so it can be searched. */
export async function addFileToVectorStore(
  vectorStoreId: string,
  fileId: string
): Promise<void> {
  await openai.vectorStores.files.create(vectorStoreId, { file_id: fileId });
}
