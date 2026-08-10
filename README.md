# openai-real-api-app

A TypeScript CLI **and** Express web UI for the OpenAI **Responses API** and the **gpt-image-2** v2 Image API.

> **Real API only — no mock data.** Every command and endpoint in this repository performs a live HTTP call to OpenAI. There are no fixtures, no stubs, and no offline fallbacks: `src/openai.ts` throws at import time if `OPENAI_API_KEY` is missing, so the CLI and the server refuse to start without a real key. Running anything here **consumes real API quota and money**.

---

## Features

- **Responses API text** — single-shot responses, multi-turn conversations via `previous_response_id`, and token-by-token streaming (`response.output_text.delta`).
- **Structured Outputs** — strict JSON Schema responses (`text.format = json_schema`) parsed into typed objects.
- **Function / tool calling** — agentic loop that executes local function tools and feeds their outputs back to the model (up to 5 round-trips).
- **Vision** — multimodal input by image URL, base64 data URL, or Files API `file_id`, with `detail` control; blocking and streaming variants; image upload with `purpose: "vision"`.
- **gpt-image-2 text-to-image** — `POST /v1/images/generations` with size, quality, output format, compression, background, moderation and `n` controls.
- **gpt-image-2 streaming** — partial-image frames rendered live while the image is produced.
- **gpt-image-2 editing** — edit via text instruction, edit with multiple reference images, and mask-based **inpainting** (`POST /v1/images/edits`).
- **Responses-API image tool** — conversational image generation/editing through the built-in `image_generation` tool, including multi-turn edits and streamed partial images.
- **Vision-guided editing** — the model *looks* at the source image first, then that description is prepended to the edit instruction sent to gpt-image-2.
- **Image studio agent** — a Responses API conversation wired to `generate_image` / `edit_image` function tools backed by gpt-image-2.
- **Batch generation** — builds a JSONL job against `/v1/images/generations`, uploads it, creates a Batch, and polls its status.
- **Built-in tools** — **web search** (with `url_citation` sources), **file search / RAG** over vector stores (with file citations), and **code interpreter** (executed Python plus its code and outputs).
- **Reasoning controls** — `reasoning.effort` and `reasoning.summary`, surfacing the reasoning summary when the model emits one.
- **Background (async) responses** — submit, poll to a terminal state, retrieve, and delete stored responses.
- **Audio output** — request the `text` + `audio` modalities and receive base64 WAV plus its transcript.

---

## Prerequisites

- **Node.js 18+** (Node 20+ recommended — the code uses global `fetch`, `File`, and `Blob`).
- A **real OpenAI API key** with access to the Responses API and the image models you intend to use.

---

## Setup

```bash
npm install
cp .env.example .env
# then edit .env and set your real key
```

`.env`:

```dotenv
OPENAI_API_KEY=sk-your-real-key-here
OPENAI_MODEL=gpt-4o-mini
IMAGE_MODEL=gpt-image-2
```

`.env` is loaded with `dotenv` from `src/openai.ts` and is git-ignored. Without `OPENAI_API_KEY` the process exits with:

```
OPENAI_API_KEY is required. Refusing to start with mock/fake credentials.
```

---

## Scripts

| Script | Command | Description |
| --- | --- | --- |
| `npm run build` | `tsc -p tsconfig.json` | Type-checks `src/` (strict mode) and emits JS to `dist/`. |
| `npm start -- <command>` | `node --loader ts-node/esm src/index.ts` | Runs the CLI directly from TypeScript. |
| `npm run ui` | `tsx src/server.ts` | Starts the Express web UI on `PORT` (default `3000`). |
| `npm run audit` | `node audit/check.mjs` | Static no-mock / real-API verification. |

---

## CLI usage

```bash
npm start -- <command> [args]
```

Running with no command (or an unknown one) prints the usage line. All output images are written to the current working directory.

### Responses API — text

| Command | Example | What it does |
| --- | --- | --- |
| `chat` | `npm start -- chat` | Single Responses API call; prints the answer. |
| `chat-followup` | `npm start -- chat-followup` | Two turns chained with `previous_response_id` to prove server-side state. |
| `chat-stream` | `npm start -- chat-stream` | Streams text deltas to stdout, then prints the final text. |
| `structured` | `npm start -- structured` | Structured Output against a strict `{ city, temp_c }` JSON Schema. |
| `tools` | `npm start -- tools` | Function calling: the model invokes a local `multiply` tool and returns the result. |

These five commands use built-in demo prompts and take no arguments.

### gpt-image-2 — Image API

| Command | Example | What it does |
| --- | --- | --- |
| `image` | `npm start -- image` | Text-to-image with the built-in prompt (“A serene mountain lake at sunrise, photorealistic.”); writes `out.png`. |
| `image-stream` | `npm start -- image-stream` | Streamed generation; writes each partial frame as `partial-<i>.png` and the final image as `final.png`. |

### Responses API — image tool

| Command | Example | What it does |
| --- | --- | --- |
| `resp-image` | `npm start -- resp-image` | Generates an image via the built-in `image_generation` tool; writes `resp-image.png`. |
| `resp-image-edit <id> <prompt>` | `npm start -- resp-image-edit resp_abc123 "Make it nighttime."` | Multi-turn edit of the image from a previous response id; writes `resp-image-edit.png`. |
| `resp-image-stream` | `npm start -- resp-image-stream` | Streams tool partial images to `resp-partial-<i>.png`, final to `resp-final.png`. |
| `studio` | `npm start -- studio` | Runs the image-studio agent (Responses API reasoning + gpt-image-2 tools) and prints its final text. |

### Vision

| Command | Example | What it does |
| --- | --- | --- |
| `vision` | `npm start -- vision` | Analyzes a public artwork image at `detail: "high"` and prints the description. |
| `vision-generate` | `npm start -- vision-generate` | Analyzes an image, then feeds the description to gpt-image-2; writes `vision-generated.png`. |
| `upload-vision <path>` | `npm start -- upload-vision ./photo.png` | Uploads a local image to the Files API with `purpose: "vision"` and prints the `file_id`. |
| `vision-stream` | `npm start -- vision-stream` | Streams a vision analysis token-by-token, then prints the response id. |
| `vision-edit [url] [prompt]` | `npm start -- vision-edit https://example.com/pic.png "Make the background a warm sunset."` | Vision-guided gpt-image-2 edit; writes `vision-edit.png`. Both arguments are optional and fall back to defaults. |

### Built-in tools & advanced features

| Command | Example | What it does |
| --- | --- | --- |
| `web-search [q]` | `npm start -- web-search "latest news about renewable energy"` | Live web search; prints the answer and the `url_citation` sources. |
| `file-search <prompt> <vsId>` | `npm start -- file-search "Summarize the document." vs_abc123` | RAG over an existing vector store. |
| `code [q]` | `npm start -- code "Plot a sine wave and return the code."` | Code Interpreter; prints executed code, results, and the answer. |
| `reason [q]` | `npm start -- reason "Solve: if a train travels 60mph for 2.5h, how far?"` | Reasoning with `effort: "medium"`, `summary: "auto"`. |
| `background [q]` | `npm start -- background "Write a detailed 3-paragraph history of coffee."` | Submits an async response; prints its id and status. |
| `response-get <id>` | `npm start -- response-get resp_abc123` | Polls a stored response every 5s until it reaches a terminal state, then prints it. |
| `response-del <id>` | `npm start -- response-del resp_abc123` | Deletes a stored response server-side. |
| `audio [q]` | `npm start -- audio "Read a short poem about the ocean."` | Requests text + audio output; prints the audio id, transcript, and text. |

---

## Web UI

```bash
npm run ui
# Image studio UI running at http://localhost:3000
```

Open <http://localhost:3000>. The UI is plain static HTML/CSS/JS served from `public/` (no build step). Image inputs use a shared picker: choose a local file (read as a base64 data URL) **or** paste an `http(s)` image URL. Errors from the real API are surfaced verbatim in each panel — there is no fallback rendering.

### Tabs

| Tab | Endpoint | Description |
| --- | --- | --- |
| **Generate** | `POST /api/generate` | Text-to-image with gpt-image-2; controls for size, quality, output format, background, and image count. |
| **Live Stream** | `POST /api/generate-stream` (SSE) | Streamed generation; partial frames update in place until the final image arrives. |
| **Edit via Text** | `POST /api/edit` | Edit one source image with a natural-language instruction. |
| **Reference Edit** | `POST /api/edit` (with `references[]`) | Base image plus any number of reference images combined into a new image. |
| **Inpaint (Mask)** | `POST /api/inpaint` | Mask-guided inpainting (white = repaint, black = keep). |
| **Vision Edit** | `POST /api/vision/edit` | The model analyzes the image first, then gpt-image-2 edits it with that context. |
| **Analyze** | `POST /api/analyze` | Ask a question about an image (Responses API vision); returns text. |
| **Studio (Agent)** | `POST /api/studio` | Runs the agent that calls `generate_image` / `edit_image` tools; returns its final text. |
| **Batch** | `POST /api/batch`, `POST /api/batch/:id` | Submit one prompt per line as a Batch job, then poll status/request counts every 8s. |
| **Web Search** | `POST /api/web-search` | Answer with clickable source citations. |
| **File Search** | `POST /api/file-search` | RAG answer for a supplied vector store id. |
| **Code** | `POST /api/code` | Code Interpreter: executed code, results, and answer. |
| **Reason** | `POST /api/reason` | Reasoning with selectable effort and summary style. |
| **Background** | `POST /api/background` | Submits an async response and shows the id plus the poll URL. |
| **Audio** | `POST /api/audio` | Text + audio response; shows the transcript and whether base64 audio was returned. |

### Additional HTTP endpoints

Implemented by `src/server.ts` but not bound to a tab:

- `POST /api/responses-stream` — SSE stream of the Responses-API `image_generation` tool (partial frames + final images).
- `GET /api/responses/:id` — polls a stored response to a terminal state and returns `{ id, status, text }`.
- `DELETE /api/responses/:id` — deletes a stored response.

JSON bodies are limited to 30 MB (data-URL images count against this). All errors are returned as `{ "error": { "message": "…" } }`.

---

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | **Yes** | — | Real OpenAI API key. The app throws at startup if unset. |
| `OPENAI_MODEL` | No | `gpt-4o-mini` | Model used for all Responses API calls. |
| `IMAGE_MODEL` | No | `gpt-image-2` | Model used for `/v1/images/generations` and `/v1/images/edits`. |
| `PORT` | No | `3000` | Port for the Express web UI (`npm run ui`). |

---

## Project structure

```
.
├── src/
│   ├── openai.ts             # Shared OpenAI client; loads .env, enforces OPENAI_API_KEY, exports RESPONSES_MODEL / IMAGE_MODEL
│   ├── responses.ts          # Responses API: text, multi-turn, streaming, structured outputs, function calling, vision, vision uploads
│   ├── images.ts             # gpt-image-2 v2 Image API: generate, stream w/ partials, edit, inpaint, batch create/poll, base64 decode
│   ├── image-editing.ts      # Normalizes any image source (buffer/blob/base64/dataUrl/url/fileId/path/prior result) → edit, reference edit, inpaint
│   ├── conversation.ts       # Responses-API image_generation tool, multi-turn edits, streamed tool images, studio agent, analyze→generate, vision-guided edit
│   ├── responses-tools.ts    # Built-in tools: web search, file search + vector store helpers, code interpreter
│   ├── responses-advanced.ts # Reasoning controls, background responses, retrieve/wait/delete, audio output
│   ├── index.ts              # CLI entry point (command switch, writes output images to disk)
│   └── server.ts             # Express app: JSON + SSE API routes, static UI, centralized error handler
├── public/                   # Static web UI (index.html, app.js, styles.css)
├── audit/check.mjs           # Zero-dependency static no-mock / real-API audit
├── .env.example              # Environment template
└── tsconfig.json             # Strict ES2022 / ESNext config, emits to dist/
```

---

## Audit / quality

```bash
npm run audit
```

`audit/check.mjs` statically scans `src/` (comments and string literals stripped) and fails the build if it finds:

- mock-style identifiers (`mock*`, `fake*`, `dummy*`, `fixture*`, `placeholder*`), `__mocks__` directories, `sample_data`;
- hard-coded `localhost` base URLs;
- test doubles (`jest.mock`, `vi.fn`, `.mockResolvedValue`).

It also asserts that real API usage is present — `openai.responses.create`, `openai.images.generate` / `openai.images.edit`, the `gpt-image-2` model string, and a reference to `process.env.OPENAI_API_KEY` — exiting non-zero on any violation. Combine with `npm run build` for a full type-check + audit gate.

---

## Notes & limitations

- **Real API calls cost real money.** Image generation, streaming (partials are billed frames), code interpreter, web search, and batch jobs are all metered. There is no dry-run mode.
- **`generateImageStream` issues a second, non-streaming generation** to obtain the final image after the partial frames, so a streamed run bills two generations.
- **The Responses API `image_generation` tool picks its own GPT Image model** (currently defaulting to gpt-image-1). Use the Image API paths (`src/images.ts`, `/api/generate`, `/api/edit`, `/api/inpaint`) when you specifically need **gpt-image-2**.
- **Feature availability depends on your model and account.** Reasoning summaries are only emitted by reasoning models (o-series / gpt-5 family) — the default `gpt-4o-mini` will not produce them. Audio output requires an audio-capable model and voice, otherwise the real API error propagates. Web search, file search, code interpreter, and batch access must be enabled for your organization.
- **File search requires an existing vector store id.** Helpers to create a store, upload a file, and attach it live in `src/responses-tools.ts` (`createVectorStore`, `uploadFileForSearch`, `addFileToVectorStore`); the CLI/UI only consume an id you already have.
- **Image endpoints return base64 or a URL.** gpt-image-2 normally returns `b64_json`; the server wraps results as `{ b64Json, url, revisedPrompt, dataUrl }`, where `dataUrl` falls back to `url` when no base64 is present. `decodeImage()` throws if a result is URL-only.
- **`background` responses must be stored** to be retrievable; polling uses real `GET /v1/responses/{id}` requests (5s CLI / server interval, 8s UI interval for batches) and will loop until a terminal status is reached.
- **Some SDK types lag the API.** Streaming image params, batch image endpoints, and audio modalities are passed through deliberate casts in `src/images.ts`, `src/conversation.ts`, and `src/responses-advanced.ts`; behavior follows the live REST API, not the v4 typings.
- **`npm run build` only type-checks/emits.** The CLI runs via `ts-node/esm` and the server via `tsx`, both straight from `src/`.
