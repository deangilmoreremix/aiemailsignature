import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generateImage, generateImageStream, generateImagesBatch, type ImageGenOptions } from "./images.js";
import {
  generateImageViaResponses,
  editImageViaResponses,
  streamImageViaResponses,
  runImageStudio,
  visionGuidedEdit,
} from "./conversation.js";
import { analyzeImage, type ImageInput } from "./responses.js";
import { editViaText, editWithReferences, inpaint, type ImageContent as EditContent } from "./image-editing.js";
import {
  webSearch,
  fileSearch,
  codeInterpreter,
  createVectorStore,
  uploadFileForSearch,
  addFileToVectorStore,
} from "./responses-tools.js";
import {
  createResponseWithReasoning,
  createResponseBackground,
  getResponse,
  waitForResponse,
  deleteResponse,
  createResponseWithAudioOutput,
} from "./responses-advanced.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "30mb" }));

/** Accept a data URL or http(s) URL from the UI and map to an ImageContent. */
function toContent(src: unknown): EditContent {
  if (typeof src !== "string" || !src) throw new Error("image source must be a data URL or http(s) URL");
  if (src.startsWith("http://") || src.startsWith("https://")) return { kind: "url", url: src };
  return { kind: "dataUrl", url: src };
}

function optsFrom(body: Record<string, unknown>): ImageGenOptions {
  const o: ImageGenOptions = {};
  if (body.size) o.size = body.size as ImageGenOptions["size"];
  if (body.quality) o.quality = body.quality as ImageGenOptions["quality"];
  if (body.outputFormat) o.outputFormat = body.outputFormat as ImageGenOptions["outputFormat"];
  if (body.outputCompression != null) o.outputCompression = Number(body.outputCompression);
  if (body.background) o.background = body.background as ImageGenOptions["background"];
  if (body.n != null) o.n = Number(body.n);
  return o;
}

function withDataUrl(img: { b64Json?: string; url?: string; revisedPrompt?: string }) {
  return {
    b64Json: img.b64Json,
    url: img.url,
    revisedPrompt: img.revisedPrompt,
    dataUrl: img.b64Json ? `data:image/png;base64,${img.b64Json}` : img.url ?? null,
  };
}

app.post("/api/generate", async (req, res) => {
  const { prompt } = req.body;
  const images = await generateImage(prompt, optsFrom(req.body));
  res.json({ images: images.map(withDataUrl) });
});

app.post("/api/edit", async (req, res) => {
  const { prompt, image, references } = req.body;
  const base = toContent(image);
  if (Array.isArray(references) && references.length) {
    const refs: EditContent[] = references.map(toContent);
    const images = await editWithReferences(prompt, [base, ...refs], optsFrom(req.body));
    res.json({ images: images.map(withDataUrl) });
  } else {
    const images = await editViaText(base, prompt, optsFrom(req.body));
    res.json({ images: images.map(withDataUrl) });
  }
});

app.post("/api/inpaint", async (req, res) => {
  const { prompt, image, mask } = req.body;
  const images = await inpaint(toContent(image), toContent(mask), prompt, optsFrom(req.body));
  res.json({ images: images.map(withDataUrl) });
});

app.post("/api/vision/edit", async (req, res) => {
  const { prompt, image } = req.body;
  const images = await visionGuidedEdit(toContent(image) as unknown as ImageInput, prompt, optsFrom(req.body));
  res.json({ images: images.map(withDataUrl) });
});

app.post("/api/analyze", async (req, res) => {
  const { question, image, detail } = req.body;
  const text = await analyzeImage(question, toContent(image) as unknown as ImageInput);
  res.json({ text });
});

app.post("/api/studio", async (req, res) => {
  const { input } = req.body;
  const result = await runImageStudio(input);
  res.json({ text: result.text });
});

app.post("/api/batch", async (req, res) => {
  const { prompts } = req.body;
  const batch = await generateImagesBatch(prompts, optsFrom(req.body));
  res.json({ batchId: batch.id, status: batch.status });
});

app.post("/api/batch/:id", async (req, res) => {
  const { openai } = await import("./openai.js");
  const batch = await openai.batches.retrieve(req.params.id);
  res.json({ batchId: batch.id, status: batch.status, requestCounts: batch.request_counts });
});

// ---- Streaming (SSE): live partial images ----
app.post("/api/generate-stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders?.();

  const { prompt } = req.body;
  const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    await generateImageStream(prompt, {
      onPartial: (b64, index) => send({ type: "partial", index, dataUrl: `data:image/png;base64,${b64}` }),
      onFinal: (imgs) => send({ type: "done", images: imgs.map(withDataUrl) }),
    }, { ...optsFrom(req.body), partialImages: Number(req.body.partialImages ?? 2) });
  } catch (err) {
    send({ type: "error", message: (err as Error).message });
  } finally {
    res.end();
  }
});

app.post("/api/responses-stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders?.();
  const { prompt } = req.body;
  const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  try {
    await streamImageViaResponses(prompt, {
      onPartial: (b64, index) => send({ type: "partial", index, dataUrl: `data:image/png;base64,${b64}` }),
      onDone: (imgs) => send({ type: "done", images: imgs.map((i) => ({ dataUrl: `data:image/png;base64,${i.b64Json}` })) }),
    }, { partialImages: Number(req.body.partialImages ?? 2) });
  } catch (err) {
    send({ type: "error", message: (err as Error).message });
  } finally {
    res.end();
  }
});

// ---- Responses API built-in tools & advanced features ----
app.post("/api/web-search", async (req, res) => {
  const r = await webSearch(req.body.prompt, { searchContextSize: req.body.searchContextSize, userLocation: req.body.userLocation });
  res.json(r);
});

app.post("/api/file-search", async (req, res) => {
  const r = await fileSearch(req.body.prompt, req.body.vectorStoreIds ?? [], { maxNumResults: req.body.maxNumResults, filters: req.body.filters });
  res.json(r);
});

app.post("/api/code", async (req, res) => {
  const r = await codeInterpreter(req.body.prompt);
  res.json(r);
});

app.post("/api/reason", async (req, res) => {
  const r = await createResponseWithReasoning(req.body.prompt, { effort: req.body.effort, summary: req.body.summary });
  res.json(r);
});

app.post("/api/background", async (req, res) => {
  const r = await createResponseBackground(req.body.prompt);
  res.json(r);
});

app.get("/api/responses/:id", async (req, res) => {
  const r = await waitForResponse(req.params.id);
  res.json({ id: r.id, status: r.status, text: r.output_text });
});

app.delete("/api/responses/:id", async (req, res) => {
  await deleteResponse(req.params.id);
  res.json({ deleted: req.params.id });
});

app.post("/api/audio", async (req, res) => {
  const r = await createResponseWithAudioOutput(req.body.prompt, { voice: req.body.voice });
  res.json(r);
});

app.use(express.static(join(process.cwd(), "public")));

// Centralized error handler: surface real API errors as JSON (no mock fallback).
app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[api error]", err);
  res.status(err.status ?? 500).json({ error: { message: err.message } });
});

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => console.log(`Image studio UI running at http://localhost:${PORT}`));
