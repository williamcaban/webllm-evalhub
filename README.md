# webllm-evalhub

A chat UI for the EvalHub MCP `design_collection` skill: describe an evaluation goal, iterate on the proposed benchmark
collection, then `create_collection` and optionally `submit_evaluation`. The page is a PatternFly 6 + React app that runs
in the browser. A small local proxy keeps the cluster credentials out of the browser.

```
browser tab (ui/dist) ----------------> model endpoint
  |        chat completions               Ollama 127.0.0.1:11434, or the model inside the tab (WebGPU)
  |
  | http://127.0.0.1:8787  (the page and /mcp)
  v
cors-proxy.py              adds Authorization: Bearer <token> and X-Tenant
  |
  | https  (internet or VPN)
  v
=============================== OpenShift cluster, namespace $NS ===============================
Route evalhub-mcp          (router, TLS)
  |
  v
Service evalhub-mcp :8443  ->  kube-rbac-proxy (checks the mcp-client token)  ->  MCP server :8445
  |
  | https, inside the cluster
  v
Service evalhub-upstream :8443  ->  EvalHub API + database  (creates and stores the collections)
```

The browser only ever talks to `127.0.0.1`. The proxy holds the token and sends it to the Route. The MCP server then calls
`evalhub-upstream` inside the cluster. The proxy is needed because the MCP Route sends no CORS headers: a page in the
browser may not call another origin unless that server allows it, and the proxy also keeps the token out of the page.

The model is any OpenAI-compatible endpoint (Ollama by default), or a small model that runs inside the browser tab with
WebGPU, with no inference server. The details of the UI, the model options and troubleshooting are in
[`ui/README.md`](ui/README.md).

## Contents

| Path | What it is |
|---|---|
| `ui/` | The PatternFly chat app (TypeScript, Vite). Built output goes to `ui/dist`. |
| `cors-proxy.py` | Local proxy: serves `ui/dist`, forwards `/mcp` with the token and tenant injected. Loopback only. |
| `evalhub-connect.sh` | Gets a ServiceAccount token, finds the MCP Route, writes `evalhub-chat.config.json` (mode 600, git-ignored). |
| `pyproject.toml`, `uv.lock` | A Python 3.12 environment with the `evalhub` CLI (`eval-hub-sdk[cli]`), run with `uv run evalhub ...`. |

## Quick start

Needs Node 20+, Python 3.12+, `oc` logged in to the cluster, and a model endpoint (Ollama running, or pick the in-browser
preset).

```bash
# 1. Build the UI (once, and after any UI code change)
(cd ui && npm install && npm run build)

# 2. Connect to EvalHub: find the MCP Route, get a token, write the config file.
#    --insecure is needed on the lab cluster (see "TLS" below)
./evalhub-connect.sh -n evalhub-mcp-demo --insecure --long-lived

# 3. Start the proxy and open the app
python3 -I cors-proxy.py --config evalhub-chat.config.json
open http://127.0.0.1:8787/
```

- The proxy calls the Route whose name contains `mcp`. Nothing runs in the background, so the connection survives
  reboots and cluster upgrades as long as the Route and your network do.
- `--long-lived` reads the non-expiring token from the `evalhub-mcp-auth` Secret. Without it the script mints a 2-hour
  token and you re-run it to refresh (the proxy picks up the new file without a restart).
- Anyone who can read `evalhub-chat.config.json` can act as the `mcp-client` ServiceAccount. Keep it private.
- **TLS and `--insecure`:** by default the proxy verifies the Route's certificate. On the lab cluster the router
  certificate does not match the Route hostname, so without `--insecure` the page shows `proxy: upstream error` (HTTP 502).
  `--insecure` writes `"insecure": true` into `evalhub-chat.config.json`, and the proxy then skips certificate
  verification for the hop to the Route. The token and the traffic are still encrypted, but the proxy can no longer tell
  the real Route from an impostor on the network path, so use it only on a lab or dev cluster you trust. The script prints
  a warning when it is on. Re-run the command whenever the token expires or the Route changes; leaving the flag off
  writes `"insecure": false` again.
- **Why the certificate does not match (lab cluster).** The router's default certificate is not a wildcard. It is a Let's
  Encrypt certificate that cert-manager issues for an explicit list of hostnames (HTTP-01 challenges cannot issue
  wildcards). The Route hosts of this project (the MCP Route, and the `evalhub` and `evalhub-upstream` Routes the CLI
  uses) are not in that list, so verification fails. To remove the need for `--insecure`, add those hostnames to the
  `dnsNames` of the cluster's ingress `Certificate` (a cluster-wide change that re-issues the shared router
  certificate), or set a certificate on the Route itself. Not applied here.

## The cluster setup (lab and dev)

The `EvalHub` CR in the demo namespace (`evalhub-mcp-demo`) runs MCP with the upstream image and points it at a
separate EvalHub server, `evalhub-upstream`.

Why: the server and MCP images shipped by the platform operator on the lab cluster (an early-access OpenShift AI build)
do not work for this UI.

| Setup | Result |
|---|---|
| Platform MCP image (`odh-eval-hub-rhel9`, 1.0.3) | 4 tools only: no `design_collection`, no `create_collection` |
| Upstream MCP image (1.0.4) against the platform server | 8 tools, but `create_collection` fails with HTTP 400: `category` is required |
| Upstream MCP image against the upstream server (`evalhub-upstream`, 1.0.4) | Works. **This is what runs.** |

Until a platform build ships a matching, fixed server and MCP image, the CR carries two overrides under `spec.mcp`:
`image` (the upstream image digest) and `env` (`EVALHUB_BASE_URL` set to the `evalhub-upstream` Service), and
`evalhub-upstream` runs as a copy of the platform server Deployment with the upstream image. When the platform images
work, remove both overrides, delete `evalhub-upstream` (Deployment, Service, Route, Secret), re-run
`./evalhub-connect.sh`, and re-test that `design_collection` and `create_collection` both work.

**Collections are in memory.** `evalhub-upstream` stores them in `file::eval_hub:?mode=memory`, so they disappear when its
pod restarts, a cluster upgrade included. That is accepted for this lab. The built-in collections reload by themselves. A
PVC-backed variant is described, but not applied, in `ui/README.md`.

## Listing the created collections with the `evalhub` CLI

The UI writes to `evalhub-upstream`, which has its own database. The default `evalhub` Route does not show those
collections, so the CLI needs a Route to the upstream server and a profile for it:

```bash
export NS=evalhub-mcp-demo

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

# Use a named profile on every `config set`; without --profile it overwrites the active one.
uv run evalhub --profile mcp-demo config set base_url "$EVALHUB_BASE_URL"
uv run evalhub --profile mcp-demo config set tenant "$NS"
uv run evalhub --profile mcp-demo config set token "$(oc -n "$NS" create token mcp-client --duration=8h)"
uv run evalhub config use mcp-demo
```

The Route is still behind kube-rbac-proxy, so the ServiceAccount token is required. If the router certificate does not
match the Route hostname (`CERTIFICATE_VERIFY_FAILED`), fix the certificate or, on a cluster you trust, run
`uv run evalhub --profile mcp-demo config set insecure true`. Remove the Route with
`oc -n "$NS" delete route evalhub-upstream`. The CLI keeps its settings in `~/.config/evalhub/config.yaml` and ignores
`XDG_CONFIG_HOME`.

**Known problem: `evalhub collections list` fails on the UI's collections** with
`ValidationError ... category: Field required` (`eval-hub-sdk` 1.0.7 and the older 0.1.7). The SDK requires `category`,
the MCP `create_collection` tool has no such parameter, and the upstream server accepts a collection without one. A
single such collection breaks the whole list, and the API itself returns them fine. Until the SDK or the tool changes,
read them from the API (`GET /api/v1/evaluations/collections` with `Authorization: Bearer` and `X-Tenant: $NS`), or look
for `Stored collection` in the `evalhub-upstream` pod log. Collections created with a category, for example from a spec
file with `evalhub collections create`, are not affected.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Page shows **Demo**, not **Live** | Open it through the proxy: `http://127.0.0.1:8787/` |
| `proxy: upstream error` (HTTP 502) | Route not reachable, or its certificate does not match the host: re-run `evalhub-connect.sh` with `--insecure` (see TLS above) |
| `proxy: token expired` | Re-run `evalhub-connect.sh`, or use `--long-lived` |
| `unknown tool "design_collection"` | The MCP server is the 4-tool platform image; restore the `spec.mcp.image` override |
| `create_collection` fails with HTTP 400 `category` | MCP is writing to the platform server; restore the `spec.mcp.env` override |
| Collections you created are gone | The `evalhub-upstream` pod restarted (in-memory database); create them again |
