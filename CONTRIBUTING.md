# Contributing

Contributions are welcome. This project talks exclusively to the **real OpenAI API** — there is no test-mode, no sandbox, and no synthetic data anywhere in the codebase.

## No mock data

This repository forbids all mock, fake, dummy, or recorded data. Every call must hit the real OpenAI Responses API and gpt-image-2 image API.

This rule exists for a reason: the entire value of this project is that it exercises the genuine OpenAI API end to end. Introducing mock data would silently break that guarantee and make the app's results untrustworthy.

The rule is **enforced automatically**, not just by convention:

- `audit/check.mjs` statically scans `src/`, `audit/`, and `tests/` for prohibited patterns.
- A lefthook `pre-commit` hook runs `npm run audit` on every commit and blocks the commit if it fails.

When adding or editing code, avoid these prohibited words/patterns:

- `mock`, `fake`, `dummy`, `fixture`, `placeholder`, `sample_data`
- `localhost` (only the dev web UI binds locally; do not hardcode it in API paths)
- `jest.mock`, `vi.fn`, `.mockResolvedValue`

If the audit flags your change, fix the code — do not bypass the hook.

## Getting started

1. Fork and clone the repository.
2. Install dependencies:
   ```sh
   npm install
   ```
3. Copy the example env file and set a **real** key (get one from https://platform.openai.com/api-keys):
   ```sh
   cp .env.example .env
   ```
   Then edit `.env` and set `OPENAI_API_KEY=sk-...` to your real key. The app refuses to start if `OPENAI_API_KEY` is missing or still equals the `.env.example` sample (`sk-your-real-key-here`).

## Development workflow

- Before pushing, run the combined gate:
  ```sh
  npm run verify
  ```
  This runs `npm run build` (tsc), `npm run audit`, and `npm test`.
- The pre-commit hook already runs `npm run audit` automatically on every commit.
- If the hook blocks your commit, it means mock/fake data (or a prohibited pattern) was introduced. Fix it and recommit — never bypass the hook (e.g. with `--no-verify`).

## Running the app

- Web UI (Express) on http://localhost:3000:
  ```sh
  npm run ui
  ```
- CLI (see the README for available commands):
  ```sh
  npm start -- <command>
  ```

## Tests

Tests use [vitest](https://vitest.dev/) (`npm test`).

- Unit tests cover pure functions and must not touch the network or fake anything.
- Integration tests that need the API are guarded so they only run with a real key and never fake responses:
  ```ts
  describe.skipIf(!process.env.OPENAI_API_KEY)("integration", () => { ... })
  ```
- Contributors must keep tests mock-free: no `jest.mock`/`vi.fn`, no recorded or fixture data. Integration tests either hit the real API or skip.

## Pull request checklist

- [ ] `npm run build` passes (no TypeScript errors).
- [ ] `npm run audit` passes (no mock/fake data or prohibited patterns).
- [ ] `npm test` passes.
- [ ] No mock/fake/dummy/recorded data introduced.
- [ ] The real API key is **not** committed — `.env` is gitignored, only `.env.example` is tracked.
