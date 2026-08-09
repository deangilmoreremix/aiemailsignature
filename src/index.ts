import { writeFileSync } from "node:fs";
import {
  createResponse,
  continueResponse,
  streamResponse,
  createStructuredResponse,
  runWithFunctions,
  createResponseWithImage,
  analyzeImage,
  uploadVisionImage,
  streamAnalyzeImage,
} from "./responses.js";
import {
  generateImage,
  generateImageStream,
  editImage,
  inpaintImage,
  decodeImage,
} from "./images.js";
import {
  generateImageViaResponses,
  editImageViaResponses,
  streamImageViaResponses,
  runImageStudio,
  analyzeThenGenerate,
  visionGuidedEdit,
} from "./conversation.js";
import {
  editViaText,
  editWithReferences,
  inpaint as inpaintContent,
  editViaTextResponses,
} from "./image-editing.js";
import {
  webSearch,
  fileSearch,
  codeInterpreter,
} from "./responses-tools.js";
import {
  createResponseWithReasoning,
  createResponseBackground,
  waitForResponse,
  deleteResponse,
  createResponseWithAudioOutput,
} from "./responses-advanced.js";

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
      if (img[0]?.b64Json) writeFileSync("out.png", decodeImage(img[0]));
      console.log("IMAGE saved:", img[0]?.b64Json ? "out.png" : img[0]?.url);
      break;
    }
    case "image-stream": {
      await generateImageStream("A fox wearing a scarf in the snow.", {
        onPartial: (b64, i) => writeFileSync(`partial-${i}.png`, Buffer.from(b64, "base64")),
        onFinal: (imgs) => {
          if (imgs[0]) writeFileSync("final.png", decodeImage(imgs[0]));
        },
      });
      console.log("STREAMED images written.");
      break;
    }
    case "resp-image": {
      const imgs = await generateImageViaResponses("A watercolor painting of a lighthouse on a cliff.");
      if (imgs[0]) writeFileSync("resp-image.png", Buffer.from(imgs[0].b64Json, "base64"));
      console.log("RESPONSES-API image written:", imgs.length);
      break;
    }
    case "resp-image-edit": {
      const [_, id, prompt] = process.argv.slice(2);
      const imgs = await editImageViaResponses(prompt ?? "Make it nighttime.", id);
      if (imgs[0]) writeFileSync("resp-image-edit.png", Buffer.from(imgs[0].b64Json, "base64"));
      console.log("RESPONSES-API edited image written:", imgs.length);
      break;
    }
    case "resp-image-stream": {
      await streamImageViaResponses("A dragon curled around a glowing crystal.", {
        onPartial: (b64, i) => writeFileSync(`resp-partial-${i}.png`, Buffer.from(b64, "base64")),
        onDone: (imgs) => {
          if (imgs[0]) writeFileSync("resp-final.png", Buffer.from(imgs[0].b64Json, "base64"));
        },
      });
      console.log("RESPONSES-API streamed images written.");
      break;
    }
    case "studio": {
      const res = await runImageStudio(
        "Generate an image of a cozy reading nook, then make it look like a sci-fi spaceship lounge."
      );
      console.log("STUDIO FINAL TEXT:", res.text);
      break;
    }
    case "vision": {
      const answer = await analyzeImage(
        "What is in this image? Be specific.",
        { url: "https://api.nga.gov/iiif/a2e6da57-3cd1-4235-b20e-95dcaefed6c8/full/!800,800/0/default.jpg", detail: "high" }
      );
      console.log("VISION:", answer);
      break;
    }
    case "vision-generate": {
      const { description, image } = await analyzeThenGenerate(
        { url: "https://api.nga.gov/iiif/a2e6da57-3cd1-4235-b20e-95dcaefed6c8/full/!800,800/0/default.jpg", detail: "high" },
        "Describe this artwork in one sentence."
      );
      if (image[0]?.b64Json)
        writeFileSync("vision-generated.png", Buffer.from(image[0].b64Json, "base64"));
      console.log("DESCRIPTION:", description, "\nGENERATED:", image.length, "image(s)");
      break;
    }
    case "upload-vision": {
      const [_, path] = process.argv.slice(2);
      const id = await uploadVisionImage(await import("node:fs").then((m) => m.readFileSync(path)));
      console.log("UPLOADED file_id:", id);
      break;
    }
    case "vision-stream": {
      process.stdout.write("STREAM: ");
      const res = await streamAnalyzeImage(
        "What is happening in this image, step by step?",
        { url: "https://api.nga.gov/iiif/a2e6da57-3cd1-4235-b20e-95dcaefed6c8/full/!800,800/0/default.jpg", detail: "high" },
        (d) => process.stdout.write(d)
      );
      console.log("\nDONE:", res.responseId);
      break;
    }
    case "vision-edit": {
      const [_, url, prompt] = process.argv.slice(2);
      const edited = await visionGuidedEdit(
        { url: url ?? "https://api.nga.gov/iiif/a2e6da57-3cd1-4235-b20e-95dcaefed6c8/full/!800,800/0/default.jpg" },
        prompt ?? "Make the background a warm sunset."
      );
      if (edited[0]?.b64Json) writeFileSync("vision-edit.png", Buffer.from(edited[0].b64Json, "base64"));
      console.log("VISION-GUIDED EDIT:", edited.length, "image(s)");
      break;
    }
    case "web-search": {
      const r = await webSearch(process.argv[3] ?? "What is the latest news about renewable energy?");
      console.log("WEB SEARCH:\n", r.text, "\nSOURCES:", JSON.stringify(r.annotations));
      break;
    }
    case "file-search": {
      const [_, prompt, vsId] = process.argv.slice(2);
      const r = await fileSearch(prompt ?? "Summarize the document.", [vsId].filter(Boolean) as string[]);
      console.log("FILE SEARCH:\n", r.text);
      break;
    }
    case "code": {
      const r = await codeInterpreter(process.argv[3] ?? "Plot a sine wave and return the code.");
      console.log("CODE INTERPRETER:\nCODE:", r.code.join("\n"), "\nRESULTS:", r.results.join("\n"), "\nTEXT:", r.text);
      break;
    }
    case "reason": {
      const r = await createResponseWithReasoning(process.argv[3] ?? "Solve: if a train travels 60mph for 2.5h, how far?", {
        effort: "medium",
        summary: "auto",
      });
      console.log("REASONING SUMMARY:", r.reasoningSummary, "\nANSWER:", r.text);
      break;
    }
    case "background": {
      const r = await createResponseBackground(process.argv[3] ?? "Write a detailed 3-paragraph history of coffee.");
      console.log("BACKGROUND SUBMITTED:", r.id, r.status);
      break;
    }
    case "response-get": {
      const r = await waitForResponse(process.argv[3] ?? "");
      console.log("RESPONSE:", r.status, "\n", r.output_text);
      break;
    }
    case "response-del": {
      await deleteResponse(process.argv[3] ?? "");
      console.log("DELETED", process.argv[3]);
      break;
    }
    case "audio": {
      const r = await createResponseWithAudioOutput(process.argv[3] ?? "Read a short poem about the ocean.");
      console.log("AUDIO id:", r.audio?.id, "\nTRANSCRIPT:", r.audio?.transcript, "\nTEXT:", r.text);
      break;
    }
    default:
      console.log(
        "Usage: npm start -- <chat|chat-followup|chat-stream|structured|tools|image|image-stream|resp-image|resp-image-edit <id> <prompt>|resp-image-stream|studio|vision|vision-generate|upload-vision <path>|vision-stream|vision-edit [url] [prompt]|web-search [q]|file-search <prompt> <vsId>|code [q]|reason [q]|background [q]|response-get <id>|response-del <id>|audio [q]>"
      );
  }
}

main().catch((err) => {
  console.error("[ERROR] Real API call failed:", err.message);
  process.exit(1);
});
