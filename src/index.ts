import { writeFileSync } from "node:fs";
import {
  createResponse,
  continueResponse,
  streamResponse,
  createStructuredResponse,
  runWithFunctions,
  createResponseWithImage,
} from "./responses.js";
import {
  generateImage,
  generateImageStream,
  editImage,
  inpaintImage,
  decodeImage,
} from "./images.js";

type Cmd = string | undefined;

async function main() {
  const [cmd] = process.argv.slice(2) as [Cmd, ...string[]];

  switch (cmd) {
    case "chat": {
      const { text } = await createResponse("What can you do? Answer in one sentence.");
      console.log("RESPONSE:", text);
      break;
    }
    case "chat-followup": {
      const first = await createResponse("My name is Ada.");
      const second = await continueResponse("What is my name?", first.responseId);
      console.log("FOLLOWUP:", second.text);
      break;
    }
    case "chat-stream": {
      process.stdout.write("STREAM: ");
      const { text } = await streamResponse("Count from 1 to 5.", (d) =>
        process.stdout.write(d)
      );
      console.log("\nFINAL:", text);
      break;
    }
    case "structured": {
      const weather = await createStructuredResponse<{ city: string; temp_c: number }>(
        "The weather in Paris is 18 degrees Celsius.",
        {
          type: "object",
          properties: {
            city: { type: "string" },
            temp_c: { type: "number" },
          },
          required: ["city", "temp_c"],
          additionalProperties: false,
        }
      );
      console.log("STRUCTURED:", JSON.stringify(weather));
      break;
    }
    case "tools": {
      const res = await runWithFunctions(
        "What is 7 * 6? Use the multiply tool.",
        [
          {
            name: "multiply",
            description: "Multiply two numbers",
            parameters: {
              type: "object",
              properties: {
                a: { type: "number" },
                b: { type: "number" },
              },
              required: ["a", "b"],
              additionalProperties: false,
            },
            handler: ({ a, b }) => Number(a) * Number(b),
          },
        ]
      );
      console.log("TOOL RESULT:", res.text);
      break;
    }
    case "image": {
      const img = await generateImage("A serene mountain lake at sunrise, photorealistic.");
      if (img.b64Json) writeFileSync("out.png", decodeImage(img));
      console.log("IMAGE saved:", img.b64Json ? "out.png" : img.url);
      break;
    }
    case "image-stream": {
      await generateImageStream("A fox wearing a scarf in the snow.", {
        onPartial: (b64, i) => writeFileSync(`partial-${i}.png`, Buffer.from(b64, "base64")),
        onFinal: (img) => {
          if (img.b64Json) writeFileSync("final.png", decodeImage(img));
        },
      });
      console.log("STREAMED images written.");
      break;
    }
    default:
      console.log(
        "Usage: npm start -- <chat|chat-followup|chat-stream|structured|tools|image|image-stream>"
      );
  }
}

main().catch((err) => {
  console.error("[ERROR] Real API call failed:", err.message);
  process.exit(1);
});
