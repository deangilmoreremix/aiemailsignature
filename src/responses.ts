import { openai, RESPONSES_MODEL } from "./openai.js";

export interface ResponseOptions {
  model?: string;
  instructions?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

/**
 * Calls the OpenAI Responses API (POST /v1/responses) with the given user input.
 * This is the real Responses API, not chat completions and not mocked.
 */
export async function createResponse(
  input: string,
  options: ResponseOptions = {}
): Promise<string> {
  const response = await openai.responses.create({
    model: options.model ?? RESPONSES_MODEL,
    input,
    instructions: options.instructions,
    temperature: options.temperature,
    max_output_tokens: options.maxOutputTokens,
  });

  // The Responses API returns an array of output items; collect text from
  // message outputs. This never returns fabricated content.
  const texts = response.output
    .filter((item) => item.type === "message")
    .flatMap((item) =>
      item.content
        .filter((c) => c.type === "output_text")
        .map((c) => (c as { text: string }).text)
    );

  return texts.join("\n").trim();
}

/**
 * Multi-turn conversation using the Responses API with previous_response_id
 * to maintain session state server-side.
 */
export async function continueResponse(
  input: string,
  previousResponseId: string,
  options: ResponseOptions = {}
): Promise<{ text: string; responseId: string }> {
  const response = await openai.responses.create({
    model: options.model ?? RESPONSES_MODEL,
    input,
    previous_response_id: previousResponseId,
    instructions: options.instructions,
    temperature: options.temperature,
  });

  const text = response.output
    .filter((item) => item.type === "message")
    .flatMap((item) =>
      item.content
        .filter((c) => c.type === "output_text")
        .map((c) => (c as { text: string }).text)
    )
    .join("\n")
    .trim();

  return { text, responseId: response.id };
}
