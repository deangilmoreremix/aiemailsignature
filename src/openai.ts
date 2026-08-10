import OpenAI from "openai";
import { config } from "dotenv";

config();

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  throw new Error(
    "OPENAI_API_KEY is required. Refusing to start with mock/fake credentials. " +
      "Set it in your environment or .env file."
  );
}

const EXAMPLE_KEY = "sk-your-real-key-here";

const isExampleKey =
  apiKey === EXAMPLE_KEY ||
  /your[-_]?real[-_]?key|your[-_]?key[-_]?here/i.test(apiKey);

if (isExampleKey) {
  throw new Error(
    "OPENAI_API_KEY is set to the .env.example sample credential. Provide a real OpenAI API key."
  );
}

export const openai = new OpenAI({ apiKey });

export const RESPONSES_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
export const IMAGE_MODEL = process.env.IMAGE_MODEL ?? "gpt-image-2";
