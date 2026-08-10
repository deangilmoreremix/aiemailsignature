# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# openai-real-api-app — production image for the Express UI.
#
# Build:  docker build -t openai-real-api-app .
# Run:    docker run --init --rm -p 3000:3000 -e OPENAI_API_KEY=sk-... \
#                 openai-real-api-app
#
# The application talks to the REAL OpenAI API and refuses to start without a
# valid OPENAI_API_KEY. No key is ever baked into the image; it is supplied at
# run time (-e / --env-file / your orchestrator's secret store).
# ---------------------------------------------------------------------------


# ===========================================================================
# Stage 1 — builder: install every dependency and compile/type-check the app.
# ===========================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# devDependencies (typescript) are required for `npm run build`.
ENV NODE_ENV=development

# Copy the manifests first so this layer stays cached until the lockfile moves.
COPY package.json package-lock.json ./

# The `prepare` script installs the lefthook git hooks; there is no .git inside
# the build context, so drop it for this layer only (dependencies are
# untouched, the lockfile stays in sync and `npm ci` keeps working).
RUN npm pkg delete scripts.prepare && npm ci

# Copy the rest of the application sources.
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
COPY audit ./audit

# `tsc -p tsconfig.json` — emits dist/ and fails the build on any type error.
RUN npm run build

# Strip devDependencies so the runtime stage inherits a production-only tree.
# `tsx` is a regular dependency, so `npm run ui` still works after pruning.
RUN npm prune --omit=dev


# ===========================================================================
# Stage 2 — runtime: slim image containing only what the server needs to run.
# ===========================================================================
FROM node:20-alpine AS runtime

# Own the app directory as the unprivileged user: the image-generation entry
# points write their PNG output into the working directory.
RUN mkdir -p /app && chown node:node /app
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Production dependency tree and the compiled output from the builder stage.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist

# `npm run ui` executes `tsx src/server.ts`, so the TypeScript sources must be
# present at run time (the compiled dist/ above is kept as a build artifact).
# The Express app also serves ./public relative to the working directory.
COPY --chown=node:node package.json package-lock.json tsconfig.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node audit ./audit

# Drop root privileges — the node:20-alpine image ships an unprivileged `node`.
USER node

EXPOSE 3000

# Reports unhealthy while the server is down, e.g. when OPENAI_API_KEY is
# missing and the startup guard aborts the process.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/" || exit 1

# Start the web UI. Run the container with `--init` (or an orchestrator that
# provides PID 1 reaping) so SIGTERM reaches the server through npm.
CMD ["npm", "run", "ui"]
