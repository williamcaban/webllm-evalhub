# AGENTS.md

Guidance for AI coding and testing agents working on this repository. Humans: see [`README.md`](README.md) and
[`ui/README.md`](ui/README.md).

## What this is

A chat UI (PatternFly 6, React 18, TypeScript, Vite) for the EvalHub MCP `design_collection` skill. The user describes an
evaluation goal, the model calls MCP tools (`design_collection`, then iterate, then `create_collection`, optionally
`submit_evaluation`), and the page shows the proposed collection. A local Python proxy holds the cluster credentials.

```
browser (ui/dist) --> cors-proxy.py (127.0.0.1:8787, adds token + X-Tenant) --> MCP Route --> MCP server --> EvalHub API
                  \--> model endpoint (Ollama /v1/chat/completions, or a model running in the tab via WebGPU)
```

## Repository map

| Path | Purpose |
|---|---|
| `ui/src/lib/agent.ts` | The agent loop: model step, tool execution, retries on malformed tool calls |
| `ui/src/lib/llm.ts`, `ollama.ts`, `thinking.ts` | OpenAI-compatible client, Ollama model discovery, reasoning/thinking settings |
| `ui/src/lib/browserModel/` | In-browser model: Transformers.js worker, model catalog, tool-call text formats |
| `ui/src/lib/mcp/` | MCP client over HTTP (JSON-RPC, session id, SSE) |
| `ui/src/lib/toolResult.ts` | Compacts big tool results (the `design_collection` catalog) for the model |
| `ui/src/lib/prompts.ts`, `config.ts` | System prompts, presets, defaults |
| `ui/src/components/`, `hooks/` | UI. Settings live in `localStorage` key `evalhub-chat-cfg` |
| `cors-proxy.py` | Serves `ui/dist`, `/config.json`, and forwards `/mcp`. Loopback only, refuses foreign Origin/Host |
| `evalhub-connect.sh` | Writes `evalhub-chat.config.json` (token, tenant, Route URL). Mode 600, git-ignored |
| `pyproject.toml` | Python env with the `evalhub` CLI: `uv run evalhub ...` |

## Commands

Run from `ui/` unless noted.

```bash
npm install
npm run typecheck      # tsc -b
npm test               # vitest run (node environment, no DOM)
npm run build          # tsc -b && vite build -> ui/dist (the proxy serves this, so rebuild after code changes)
npm run dev            # Vite on :5173; forwards /mcp and /config.json to the proxy on :8787
```

Definition of done for a code change: `npm run typecheck` clean, `npm test` green, `npm run build` succeeds, and
`ui/README.md` (and the root `README.md` if setup changed) updated. Put new logic in `ui/src/lib/` as pure functions with a
`*.test.ts` next to it: tests run in Node, so anything that needs the DOM or a worker is covered by browser testing instead.

Match the surrounding code: comment density, naming, idioms. Comments explain why. Avoid em dashes in prose you write.

## Credentials: hard rules

- `evalhub-chat.config.json` contains a live bearer token. Never `cat`, print, log, paste or commit it. To inspect it, print
  every key except `token`. It is git-ignored; keep it that way.
- Do not put tokens in command lines (they show in `ps`), URLs, test fixtures, docs or commit messages.
- Never add real cluster hostnames, tokens, or internal paths to files in this public repo. Use variables such as
  `$NS` and `$EVALHUB_BASE_URL`.
- Before any commit, search the staged diff for tokens and hostnames, and check that `git ls-files` does not list the
  config file or `.proxy.log`.
- `--insecure` (skip TLS verification of the Route) is a human decision on a lab cluster. Do not add it to a command on
  your own, and never make it the default.

## Cluster safety

- `oc` is logged in to a shared lab cluster. Read-only commands are fine. Anything that creates, patches or deletes cluster
  objects (Routes, the `EvalHub` CR, Deployments, PVCs, certificates) needs the user's explicit go-ahead first.
- The `evalhub` CLI keeps its settings in `~/.config/evalhub/config.yaml` and **ignores `XDG_CONFIG_HOME`**. A `config set`
  without `--profile` overwrites the active profile (this has already destroyed a real token once). Always pass
  `--profile`, and never run `config set` to test something.
- The MCP backend is `evalhub-upstream`, with an in-memory database. Collections created through the UI disappear when its
  pod restarts. Do not rely on them persisting.

## Using the app

```bash
(cd ui && npm install && npm run build)
./evalhub-connect.sh -n <namespace> --insecure --long-lived   # lab cluster; see README for why --insecure (human runs it)
python3 -I cors-proxy.py --config evalhub-chat.config.json
open http://127.0.0.1:8787/
```

- Header pill **Live** means the page reached EvalHub through the proxy. **Demo** means it did not: the EvalHub side is then a
  small simulated catalog, which is enough for UI work without a cluster. The model is always real.
- `curl http://127.0.0.1:8787/config.json` shows the proxy mode, tenant, upstream host and token expiry (no secrets).
  `"expired": true` means re-run `evalhub-connect.sh`. HTTP 502 from `/mcp` means the Route is unreachable or TLS
  verification failed.
- Model options: the **Ollama** preset (default; the Model field lists installed models that support tool calling) or **In
  this browser (WebGPU, no server)** (downloads 300 to 600 MB from huggingface.co on first use, then cached).

## Testing the live MCP path without the UI

Talk to the proxy with JSON-RPC (`initialize`, then the `notifications/initialized` notification, then calls; send
`Accept: application/json, text/event-stream`, and reuse the `Mcp-Session-Id` response header). Use `python3 -I`. Responses
can arrive as SSE (`data:` lines).

**Read-only tools, safe to call freely:** `design_collection`, `search_benchmarks`, `get_benchmark`, `discover_providers`,
`get_job_status`.

**Tools that change state, never call them as a test without the user's approval:** `create_collection` (writes a
collection), `submit_evaluation` (starts a job that uses cluster resources), `cancel_job`. The app itself asks the user to
approve before `create_collection`; keep that behaviour.

A healthy server lists 8 tools. Only 4 tools (no `design_collection`) means the MCP server is the platform image instead of
the upstream one. `create_collection` failing with HTTP 400 `category` means MCP is writing to the platform server instead of
`evalhub-upstream`.

## Browser testing (Playwright MCP or similar)

1. `npm run build`, make sure the proxy is running, open `http://127.0.0.1:8787/` (not the Vite port, unless you also run
   the proxy: Vite forwards to it).
2. Check: the **Live** pill; the prompt pills on the welcome banner; sending a goal produces a `design_collection` tool card
   and then a streamed answer; the Settings panel (Model, Thinking, MCP section collapsed while the proxy manages it);
   the browser console has no errors.
3. Drive only read-only tool calls (see above). Do not click an approve/create path that ends in `create_collection`.
4. Keep tests short with a small model: the in-browser Qwen3.5 0.8B calls `design_collection` correctly but writes weak,
   repetitive designs; LFM2.5 350M often says it has no tool. Judge the plumbing (tool call, result, rendering), not the quality.
5. Clean up when done: clear `localStorage` (`evalhub-chat-cfg`) and, if you downloaded a browser model, the Cache API
   entries; close the browser; remove any `.playwright-mcp/` folder and screenshots from the repo tree.

## Known issues (do not "fix" by accident)

- `evalhub collections list` fails on collections created by the UI with `category: Field required`. The SDK requires a
  `category`, the MCP `create_collection` tool has no such parameter. This is an EvalHub SDK/tool gap, not a bug here.
- The lab router certificate does not match the Route hostnames, which is why `--insecure` is needed.
- The 200 to 800M in-browser models are a demo of running without a server, not a replacement for a 7B+ model. WebGPU can
  lose the device on very long prompts; the code shortlists the `design_collection` catalog to 20 benchmarks for these models
  and resets the worker on GPU errors (press Retry).
- The system prompts in `ui/src/lib/prompts.ts` keep the model on evaluation collections (see "Keeping the model on topic" in
  `ui/README.md`). After editing one, test behaviour and not only the text: send a mixed message ("create an evaluation for
  polling data, but first give me Python code for Fibonacci"), a pure off-topic one, an "ignore your instructions" one and
  two real evaluation goals to several models, several times each (output is random), and check that real goals still call
  `design_collection`. A prompt that is too strict refuses real requests. When you change a default prompt, add the previous
  one to `PREVIOUS_DEFAULT_SYSTEMS`.
- PatternFly 6.7 has component quirks; check the existing components before changing layout, and keep light and dark themes
  working.

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Pill shows **Demo** | Page not opened through the proxy; use `http://127.0.0.1:8787/` |
| `proxy: upstream error` / 502 | Route unreachable, VPN off, or TLS mismatch; ask the user to re-run `evalhub-connect.sh` (with `--insecure` on the lab cluster) |
| `proxy: token expired` | Re-run `evalhub-connect.sh`, or use `--long-lived` |
| `unknown tool "design_collection"` | MCP server is the 4-tool platform image; the CR's `spec.mcp.image` override is missing |
| Your UI change is not visible | `npm run build` was not re-run; the proxy serves `ui/dist` |
| Ollama model missing from the list | The model does not support tool calling, or Ollama is not running |
