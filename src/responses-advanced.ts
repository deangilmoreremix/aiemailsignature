import OpenAI from "openai";
import { openai, RESPONSES_MODEL } from "./openai.js";

/**
 * Result of an advanced Responses API call: the final text plus the server-side
 * response id (usable with `previous_response_id`, retrieve, and delete), the
 * generation status, any reasoning summary emitted by a reasoning model, and
 * real token usage reported by the API.
 */
export interface AdvancedResponseResult {
  text: string;
  responseId: string;
  status?: string;
  reasoningSummary?: string[];
  usage?: OpenAI.Responses.ResponseUsage;
}

/** Concatenate every `output_text` part of every `message` output item. */
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
 * Collect the reasoning summary text from `reasoning` output items.
 * Only reasoning models (o-series / gpt-5 family) emit these, and only when
 * `reasoning.summary` was requested — otherwise the array is empty.
 */
function collectReasoningSummary(
  response: OpenAI.Responses.Response
): string[] | undefined {
  const summaries = response.output
    .filter((item): item is OpenAI.Responses.ResponseReasoningItem =>
      item.type === "reasoning"
    )
    .flatMap((item) => item.summary.map((s) => s.text))
    .filter((text) => text.length > 0);

  return summaries.length > 0 ? summaries : undefined;
}

/**
 * Responses API — reasoning controls.
 * `effort` trades latency/cost against depth of thinking; `summary` asks the
 * API to return a human-readable digest of the model's reasoning.
 */
export async function createResponseWithReasoning(
  prompt: string,
  options: {
    model?: string;
    effort?: "low" | "medium" | "high";
    summary?: "auto" | "concise" | "detailed";
    store?: boolean;
  } = {}
): Promise<AdvancedResponseResult> {
  // Send `reasoning` only when the caller actually asked for it: non-reasoning
  // models reject the parameter, and the SDK omits `undefined` from the body.
  const reasoning: OpenAI.Reasoning | undefined =
    options.effort !== undefined || options.summary !== undefined
      ? { effort: options.effort, summary: options.summary }
      : undefined;

  const response = await openai.responses.create({
    model: options.model ?? RESPONSES_MODEL,
    input: prompt,
    store: options.store,
    reasoning,
  });

  return {
    text: collectText(response),
    responseId: response.id,
    status: response.status,
    reasoningSummary: collectReasoningSummary(response),
    usage: response.usage,
  };
}

/**
 * Responses API — background (async) mode.
 * Returns immediately with a `queued` / `in_progress` response; poll it with
 * `getResponse` or `waitForResponse`. Background responses must be stored, so
 * leave `store` unset (the API defaults it to true) unless you know better.
 */
export async function createResponseBackground(
  prompt: string,
  options: { model?: string; store?: boolean } = {}
): Promise<{ id: string; status: string }> {
  const response = await openai.responses.create({
    model: options.model ?? RESPONSES_MODEL,
    input: prompt,
    store: options.store,
    background: true,
  });

  // `status` is optional in the SDK's `Response` type, but the API always sets
  // it for background runs. Surface the real value; never invent one.
  if (!response.status) {
    throw new Error(
      `Background response ${response.id} was returned without a status.`
    );
  }

  return { id: response.id, status: response.status };
}

/** Conversation management — fetch a stored response by id. */
export async function getResponse(
  id: string
): Promise<OpenAI.Responses.Response> {
  return openai.responses.retrieve(id);
}

/** Statuses after which a response will never change again. */
// "expired" is a real API status that the v4.104 `ResponseStatus` union does
// not list yet, so terminal states are compared as plain strings.
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "failed",
  "cancelled",
  "expired",
]);

/**
 * Poll a (typically background) response until it reaches a terminal state.
 * Every poll is a real `GET /v1/responses/{id}` call.
 */
export async function waitForResponse(
  id: string,
  pollMs = 5000
): Promise<OpenAI.Responses.Response> {
  for (;;) {
    const response = await openai.responses.retrieve(id);

    if (response.status && TERMINAL_STATUSES.has(response.status)) {
      return response;
    }

    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/** Conversation management — delete a stored response server-side. */
export async function deleteResponse(id: string): Promise<void> {
  await openai.responses.del(id);
}

/**
 * The audio output item returned by audio-capable models. The v4.104
 * `ResponseOutputItem` union does not include it yet, so its shape is declared
 * locally and the raw output items are narrowed to it at runtime.
 */
interface AudioOutputItem {
  type: "audio";
  audio?: { id?: string; transcript?: string; data?: string };
}

/**
 * Responses API — audio output modality.
 * Asks the model for text *and* spoken audio; the audio arrives as base64 WAV
 * together with its transcript. If the configured model or voice does not
 * support audio output, the real API error propagates to the caller.
 */
export async function createResponseWithAudioOutput(
  prompt: string,
  options: { model?: string; voice?: string } = {}
): Promise<
  AdvancedResponseResult & {
    audio?: { id?: string; transcript?: string; data?: string };
  }
> {
  // `modalities` and the audio output config are not part of the v4.104
  // `ResponseCreateParams` type yet, so widen through `unknown` to send them.
  const params = {
    model: options.model ?? RESPONSES_MODEL,
    input: prompt,
    modalities: ["text", "audio"],
    audio: { voice: options.voice ?? "alloy", format: "wav" },
  } as unknown as OpenAI.Responses.ResponseCreateParamsNonStreaming;

  const response = await openai.responses.create(params);

  const audio = response.output
    .map((item) => item as unknown as AudioOutputItem)
    .find((item) => item.type === "audio")?.audio;

  return {
    text: collectText(response),
    responseId: response.id,
    status: response.status,
    reasoningSummary: collectReasoningSummary(response),
    usage: response.usage,
    audio,
  };
}
