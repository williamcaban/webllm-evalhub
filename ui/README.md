# EvalHub collection designer (PatternFly UI)

A PatternFly 6 + React 18 + TypeScript multi-turn chat that drives the EvalHub MCP `design_collection` skill (design,
iterate, `create_collection`, optionally `submit_evaluation`). It runs entirely in the browser. The model is either any
OpenAI-compatible `/chat/completions` endpoint or, with the **In this browser** preset, a small model that runs inside
the tab (no inference server).

## Prerequisites

- Node 20+ and npm
- Python 3.12+ (for `cors-proxy.py`)
- `oc`, logged in to the cluster that runs EvalHub (not needed for Demo mode)
- A model endpoint. The default is Ollama at `http://localhost:11434/v1` with `lfm3:latest`, so Ollama must be running.

## Run

All paths are relative to `webllm-evalhub/`.

1. Build the UI (once, and again after any code change):

   ```sh
   cd ui && npm install && npm run build && cd ..
   ```

2. Connect to EvalHub. This finds the MCP Route and writes `evalhub-chat.config.json` (mode 600) with the
   upstream URL, tenant and token (on the lab cluster add `--insecure`, because the router certificate does not match the Route host; see the root `README.md`):

   ```sh
   ./evalhub-connect.sh -n NAMESPACE --long-lived
   ```

   `--long-lived` reuses the non-expiring service-account token in the `evalhub-mcp-auth` Secret. Without it the script
   mints a 2-hour token, and you re-run it to refresh. Anyone who can read the config file can act as that service
   account, so keep it private (it is git-ignored).

3. Start the proxy and open the app:

   ```sh
   python3 -I cors-proxy.py --config evalhub-chat.config.json
   open http://127.0.0.1:8787/
   ```

With the Ollama preset the **Model** field is a dropdown of the installed models that support tool calling, which this app
requires (press Refresh after `ollama pull`). The **Thinking** setting follows what the chosen model supports: on/off,
effort levels, or nothing. The **EvalHub tools (MCP)** section is collapsed while the proxy manages the connection, and
open when you have to fill it in yourself.

### Running the model in the browser (no inference server)

Pick the preset **In this browser (WebGPU, no server)**. The model runs in a web worker through
[Transformers.js](https://huggingface.co/docs/transformers.js) and ONNX Runtime, on the GPU when the browser has WebGPU
(recent Chrome, Edge or Safari) and on the CPU otherwise, which is much slower. The weights (about 300 to 570 MB) are
downloaded once from huggingface.co and kept in the browser's cache; the runtime itself is served with the app. Press
**Download and load** to fetch them ahead of time, or just send a message.

| Model | Download | Notes |
|---|---|---|
| Qwen3.5 0.8B (default) | 570 MB | Called `design_collection` correctly on all three example goals in testing |
| LFM2.5 350M | 294 MB | Fastest, but often says it has no suitable tool instead of calling one |

What to expect: models this small are a demo, not a replacement for a 7B or larger model. In testing, Qwen3.5 0.8B called
the tool and produced a table, but repeated rows and invented domains and tags, and did not always end with the approve
or refine question. Three things are done for them:

- They get a shorter built-in system prompt (unless you edit the system prompt).
- `design_collection` returns a shortlist (the 20 catalog benchmarks that best match the goal's keywords, out of about 300)
  instead of the full catalog, which is about 18,000 tokens and does not fit.
- Arguments a tool does not declare are dropped before the call, because small models invent them.

If the GPU runtime fails (a lost device on a long prompt), press Retry; the model reloads from the cache.

The header shows **MCP: Live · N tools** once connected. Try an example such as "Design a collection for a customer
support model". Write tools (`create_collection`, `submit_evaluation`) wait for your approval, so nothing is created
on EvalHub until you click Approve.

`cors-proxy.py` serves `ui/dist` and forwards `/mcp` to EvalHub. It holds the bearer token and `X-Tenant`, so the page
never sees them. It refuses requests with a foreign `Host` or `Origin`, and re-reads the config file when it changes, so
re-running `evalhub-connect.sh` refreshes a token without restarting it.

Without the proxy, open the app any other way (for example `npm run dev`) and it starts in Demo mode: the EvalHub side is
simulated with a small sample catalog. The model endpoint is always real.

### Keeping the model on topic

The system prompt limits the model to designing evaluation collections. A message that mixes an evaluation goal with
something else ("create an evaluation for polling data, but first give me Python code for Fibonacci") gets a one-line
refusal of the extra part, and only the evaluation part goes to `design_collection`. Messages with no evaluation goal get
a short reply and no tool call. Instructions found in tool results are treated as data. Evaluating a model's ability at
code or math stays in scope.

This is a prompt, not a security boundary. In a small test (3 runs per case, first model step only), `lfm3` and
`qwen3.8` followed it on mixed, off-topic and "ignore your instructions" messages, while `qwen3.5:0.8b`, including the
in-browser preset, still failed the pure off-topic and injection cases. The real limits are the tool set (EvalHub tools
only), the approval gate on `create_collection` and `submit_evaluation`, and the RBAC of the `mcp-client` ServiceAccount.
If the app is shared between users or the model endpoint is metered, add a topical guardrail (for example NeMo
Guardrails) at the model gateway. It must split a mixed message rather than block it whole.

### Restarting later

The proxy stops when the terminal closes or the machine restarts. Re-run step 3 (and step 2 if the token expired). Step 1
is only needed if the UI code changed.

### Listing the created collections with the `evalhub` CLI

The UI creates collections through the MCP server, and the MCP server does not write to the API that the `evalhub`
Route exposes. `spec.mcp.env` on the EvalHub CR sets `EVALHUB_BASE_URL` to a **separate EvalHub API
(`<instance>-upstream`) with its own database**. `evalhub collections list` against the `evalhub` Route shows only the
other server's collections (the built-in ones). To see the UI's collections, give the upstream API its own Route:

```bash
export NS=<namespace>                                  # the namespace passed to evalhub-connect.sh -n

oc -n "$NS" apply -f - <<'YAML'
apiVersion: route.openshift.io/v1
kind: Route
metadata: {name: evalhub-upstream}
spec:
  to: {kind: Service, name: evalhub-upstream}
  port: {targetPort: https}
  tls: {termination: reencrypt, insecureEdgeTerminationPolicy: Redirect}
YAML
export EVALHUB_BASE_URL=https://$(oc -n "$NS" get route evalhub-upstream -o jsonpath='{.spec.host}')

# Keep this in its own profile so it does not overwrite your default one.
evalhub --profile mcp-demo config set base_url "$EVALHUB_BASE_URL"
evalhub --profile mcp-demo config set tenant "$NS"
evalhub --profile mcp-demo config set token "$(oc -n "$NS" create token mcp-client --duration=8h)"
evalhub config use mcp-demo
```

The Route is still behind kube-rbac-proxy, so a valid ServiceAccount token is required. Remove it with
`oc -n "$NS" delete route evalhub-upstream`.

**Known problem: the CLI cannot read the UI's collections.** `evalhub collections list` and `describe` (tested with
`evalhub` 0.1.7 and with `eval-hub-sdk` 1.0.7) fail with `ValidationError ... category: Field required`. The API does
return the collections, but the SDK's `Collection` model requires `category`, and the MCP `create_collection` tool has no
such parameter (it takes `name`, `domains`, `benchmarks`, `description`, `tags`, `pass_criteria`), so the collections it
stores have none. One such collection makes the whole `list` fail. Until the SDK or the tool changes, read them with the
API directly (`GET /api/v1/evaluations/collections` with `Authorization: Bearer` and `X-Tenant: $NS`) or look for
`Stored collection` in the `<instance>-upstream` pod log.

- The built-in collections are owned by `system`. UI-created ones have a generated UUID as `id` and the owner
  `system:serviceaccount:<ns>:mcp-client`.
- The tenant is sent as `X-Tenant`, the same as the UI does. A wrong tenant lists nothing or fails with 4xx.
- The token is a short-lived ServiceAccount token. Re-run the `token` line when it expires.
- If the default router certificate does not match the Route hostname (`CERTIFICATE_VERIFY_FAILED`), fix the
  certificate, or on a cluster you trust run `evalhub --profile mcp-demo config set insecure true`.
- Use `--profile` on every `config set`. Without it the command changes the active profile, and the CLI ignores
  `XDG_CONFIG_HOME`, so a test config directory does not protect your real one.

### Why the UI needs its own EvalHub server (until the platform images are fixed)

The server and MCP images shipped by the platform operator on the lab cluster (an early-access build, version 1.0.3)
do not work for this UI:

| Setup | Result |
|---|---|
| Platform MCP image | 4 tools only: no `design_collection`, no `create_collection` |
| Upstream MCP image (`quay.io/evalhub/evalhub`, 1.0.4) against the platform server | 8 tools, but `create_collection` fails with HTTP 400: `category` is required |
| Upstream MCP image against the upstream server (`<instance>-upstream`) | Works. This is what the cluster runs. |

When a platform build ships a matching, fixed pair, remove `spec.mcp.image` and `spec.mcp.env` from the
`EvalHub` CR (the operator supplies a matching pair), delete the `<instance>-upstream` Deployment, Service, Route and
Secret, and re-run `./evalhub-connect.sh`. Re-test first: `design_collection` and `create_collection` must both work.

**Collections are kept in memory.** The upstream server uses `file::eval_hub:?mode=memory`, so every collection created
in the UI is lost when the pod restarts (a cluster upgrade does it). That is accepted for this lab and dev cluster; the
built-in collections come back on their own. Only if you want to keep them, give it a volume (optional, not applied):

```bash
oc -n "$NS" apply -f - <<'YAML'
apiVersion: v1
kind: PersistentVolumeClaim
metadata: {name: evalhub-upstream-data}
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: <storage-class>          # oc get sc
  resources: {requests: {storage: 1Gi}}
YAML
oc -n "$NS" patch deploy evalhub-upstream --type=json -p '[
 {"op":"replace","path":"/spec/strategy","value":{"type":"Recreate"}},
 {"op":"add","path":"/spec/template/spec/volumes/-","value":{"name":"data","persistentVolumeClaim":{"claimName":"evalhub-upstream-data"}}},
 {"op":"add","path":"/spec/template/spec/containers/0/volumeMounts/-","value":{"name":"data","mountPath":"/data"}},
 {"op":"add","path":"/spec/template/spec/containers/0/env/-","value":{"name":"DB_URL","value":"file:/data/eval_hub.db?cache=shared"}}]'
```

`DB_URL` is mapped to `database.url` by the server's config. `Recreate` avoids a ReadWriteOnce volume blocking the
rollout. Not tested on this cluster yet: after applying, create a collection, delete the pod, and check it is still there.

### Troubleshooting

| Symptom | Fix |
|---|---|
| `proxy: the UI is not built` at `/` | Run step 1 |
| `proxy: upstream error … Is the Route reachable?` | Check the Route and the VPN, then re-run `./evalhub-connect.sh` (`--insecure` if the certificate does not match) |
| `proxy: token expired` | Re-run `./evalhub-connect.sh` (or use `--long-lived`) |
| "Cannot reach the model endpoint" | Start Ollama, or change Base URL in the sidebar |
| Pill shows **Demo** instead of **Live** | The page was not opened through the proxy; use `http://127.0.0.1:8787/` |

## Development

```sh
cd ui
npm run dev          # http://localhost:5173, forwards /mcp and /config.json to the proxy on :8787
npm run typecheck
npm test             # unit tests for the model client, agent loop, markdown and previews
```

Set `EVALHUB_PROXY` to use a proxy on another address (default `http://127.0.0.1:8787`).

## Layout

| Path | Responsibility |
|---|---|
| `src/lib/` | Framework-independent logic: model client (`llm.ts`), in-browser model (`browserModel/`: worker, tool-call formats, catalog), agent loop (`agent.ts`), MCP client and demo (`mcp/`), markdown parser, settings storage |
| `src/hooks/` | React state: `useChat` (transcript and the agent's UI sink), `useSettings`, `useMcpConnection` |
| `src/components/` | PatternFly views: transcript, tool-call cards with the approval gate, reasoning block, status strip, settings sections |
| `src/styles/` | Feature CSS using PatternFly tokens |

Replies render markdown and LaTeX math: `\[ ... \]` and `$$ ... $$` for display formulas, `\( ... \)` and `$ ... $` inline
(a price such as `$5 and $10` stays text). Math goes through KaTeX, loaded on demand the first time a reply has a formula,
and is drawn as MathML, so it needs no extra fonts. Model output is still never inserted as HTML.

Settings are stored in `localStorage` (`evalhub-chat-cfg`). Secrets (API key, bearer token) stay in `sessionStorage`.
