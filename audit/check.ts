/**
 * Static audit: verifies the codebase uses the REAL OpenAI Responses API and
 * gpt-image-2 image API, and contains NO mock/fake/hardcoded data.
 *
 * Run with: npm run audit
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOTS = ["src", "audit"];
const PROHIBITED = [
  /\bmock\b/i,
  /\bfake\b/i,
  /\bdummy\b/i,
  /\bfixture\b/i,
  /\bsample[_-]?data\b/i,
  /\bplaceholder\b/i,
  /localhost/i,
  /\bhttp:\/\/(?!platform\.openai\.com)/i,
  /return\s+["'`]\s*\{[\s\S]*"\s*:\s*"/, // suspicious hardcoded JSON object literals
];

const REQUIRED_API_PATTERNS = [
  /openai\.responses\.create/, // Responses API
  /openai\.images\.(generate|edit)/, // v2 images API
  /gpt-image-2/, // gpt-image-2 model reference
];

function walk(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, files);
    else if ([".ts", ".js", ".tsx", ".jsx"].includes(extname(full))) files.push(full);
  }
  return files;
}

function main() {
  const sources: string[] = [];
  for (const root of ROOTS) {
    try {
      sources.push(...walk(root));
    } catch {
      console.warn(`(audit) directory not found: ${root}`);
    }
  }

  let failures = 0;

  // 1. Mock detection
  for (const file of sources) {
    const content = readFileSync(file, "utf8");
    for (const re of PROHIBITED) {
      const m = content.match(re);
      if (m) {
        console.error(`FAIL  ${file}: matches prohibited pattern ${re} -> "${m[0]}"`);
        failures++;
      }
    }
  }

  const all = sources.map((f) => readFileSync(f, "utf8")).join("\n");

  // 2. Required real-API usage
  for (const re of REQUIRED_API_PATTERNS) {
    if (!re.test(all)) {
      console.error(`FAIL  Required real API usage missing: ${re}`);
      failures++;
    } else {
      console.log(`OK    Real API usage present: ${re}`);
    }
  }

  // 3. No missing API key fallback to fake data
  if (/process\.env\.OPENAI_API_KEY/.test(all) === false) {
    console.error("FAIL  Application does not reference OPENAI_API_KEY.");
    failures++;
  }

  if (failures > 0) {
    console.error(`\nAUDIT FAILED with ${failures} issue(s).`);
    process.exit(1);
  }

  console.log("\nAUDIT PASSED: no mock data detected; real APIs in use.");
}

main();
