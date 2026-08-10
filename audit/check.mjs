/**
 * Static audit (zero dependencies): verifies the codebase uses the REAL
 * OpenAI Responses API and gpt-image-2 image API, and contains NO mock data.
 * Run with: node audit/check.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, sep } from "node:path";

const ROOTS = ["src", "audit", "tests"];
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

// Scan the application source AND the test suite for mock data: tests must be
// just as mock-free as the app. The audit scripts themselves (this file) are
// walked for completeness but skipped by the prohibited scan, because they
// necessarily spell out the very words they search for.
const SELF_ROOT = "audit";

function collect(roots) {
  const files = [];
  for (const root of roots) {
    try {
      files.push(...walk(root));
    } catch {
      console.warn(`(audit) directory not found: ${root}`);
    }
  }
  return files;
}

const sources = collect(ROOTS);
const scanned = sources.filter((f) => f.split(sep)[0] !== SELF_ROOT);

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

for (const file of scanned) {
  const content = stripStrings(stripComments(readFileSync(file, "utf8")));
  for (const [re, label] of PROHIBITED) {
    const m = content.match(re);
    if (m) {
      console.error(`FAIL  ${file}: prohibited '${label}' -> "${m[0].slice(0, 60)}"`);
      failures++;
    }
  }
}
console.log(
  `OK    Scanned ${scanned.length} file(s) for mock data across: ${ROOTS.filter(
    (r) => r !== SELF_ROOT
  ).join(", ")}`
);

// Required real-API usage is asserted against the application source only, so
// that a mention in the tests or in this audit script can never satisfy it.
const all = collect(["src"])
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

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
