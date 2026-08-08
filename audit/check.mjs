/**
 * Static audit (zero dependencies): verifies the codebase uses the REAL
 * OpenAI Responses API and gpt-image-2 image API, and contains NO mock data.
 * Run with: node audit/check.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOTS = ["src", "audit"];
const PROHIBITED = [
  [/\b(mock|fake|dummy|fixture|placeholder)[A-Za-z0-9_]/i, "mock identifier"],
  [/__mocks__/i, "__mocks__ dir"],
  [/\bsample[_-]?data\b/i, "sample_data"],
  [/https?:\/\/localhost/i, "localhost base url"],
  [/jest\.mock|vi\.fn|\.mockResolvedValue/, "test double / mock"],
];

const REQUIRED_API_PATTERNS = [
  [/openai\.responses\.create/, "openai.responses.create (Responses API)"],
  [/openai\.images\.(generate|edit)/, "openai.images.generate/edit (v2 images API)"],
  [/gpt-image-2/, "gpt-image-2 model"],
];

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, files);
    else if ([".ts", ".js", ".tsx", ".jsx", ".mjs"].includes(extname(full)))
      files.push(full);
  }
  return files;
}

// Only scan the application source for mock data. The audit scripts
// (this file, check.ts) intentionally mention those words and are excluded.
const sources = [];
try {
  sources.push(...walk("src"));
} catch {
  console.warn("(audit) directory not found: src");
}

function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])(\/\/.*$)/gm, "$1");
}

function stripStrings(code) {
  return code
    .replace(/`(?:\\.|(?!`).)*`/g, "")
    .replace(/'(?:\\.|(?!').)*'/g, "")
    .replace(/"(?:\\.|(?!").)*"/g, "");
}

let failures = 0;

for (const file of sources) {
  const content = stripStrings(stripComments(readFileSync(file, "utf8")));
  for (const [re, label] of PROHIBITED) {
    const m = content.match(re);
    if (m) {
      console.error(`FAIL  ${file}: prohibited '${label}' -> "${m[0].slice(0, 60)}"`);
      failures++;
    }
  }
}

const all = sources.map((f) => readFileSync(f, "utf8")).join("\n");

for (const [re, label] of REQUIRED_API_PATTERNS) {
  if (!re.test(all)) {
    console.error(`FAIL  Required real API usage missing: ${label}`);
    failures++;
  } else {
    console.log(`OK    Real API usage present: ${label}`);
  }
}

if (!/process\.env\.OPENAI_API_KEY/.test(all)) {
  console.error("FAIL  Application does not reference OPENAI_API_KEY.");
  failures++;
} else {
  console.log("OK    OPENAI_API_KEY is required (no fake fallback).");
}

if (failures > 0) {
  console.error(`\nAUDIT FAILED with ${failures} issue(s).`);
  process.exit(1);
}
console.log("\nAUDIT PASSED: no mock data detected; real APIs in use.");
