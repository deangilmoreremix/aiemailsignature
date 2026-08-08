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

export const openai = new OpenAI({ apiKey });

export const RESPONSES_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
export const IMAGE_MODEL = process.env.IMAGE_MODEL ?? "gpt-image-2";
