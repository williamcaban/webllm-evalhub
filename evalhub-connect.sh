#!/usr/bin/env bash
# Write evalhub-chat.config.json for cors-proxy.py --config: MCP upstream URL, X-Tenant and a fresh token.
#
# Read-only against the cluster except for minting a short-lived ServiceAccount token (a TokenRequest). It
# creates no RBAC, Secrets or CRs: the ServiceAccount (default mcp-client) must already exist with RBAC to call
# the EvalHub API, and spec.mcp.authSecret must name its token Secret.
# The upstream is the OpenShift Route of the MCP server (the Route whose name contains "mcp").
#
#   ./evalhub-connect.sh -n evalhub-mcp-demo                # mint a 2-hour token
#   ./evalhub-connect.sh -n evalhub-mcp-demo --long-lived   # reuse the CR's non-expiring token Secret
#   ./evalhub-connect.sh -n evalhub-mcp-demo --insecure     # Route whose certificate does not match its host
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NS=""; INSTANCE="evalhub"; SA="mcp-client"; DURATION="2h"; CONTEXT=""; LONG=false; ROUTE_INSECURE=false; SECRET=""
OUT="$HERE/evalhub-chat.config.json"

die()  { echo "error: $*" >&2; exit 1; }
warn() { echo "warning: $*" >&2; }
usage() { sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; cat <<EOF

Options:
  -n, --namespace NS     namespace of the EvalHub CR (default: current oc project)
  -i, --instance NAME    EvalHub CR name (default: $INSTANCE)
  -s, --sa NAME          ServiceAccount to mint the token for (default: $SA)
  -d, --duration DUR     token lifetime (default: $DURATION)
      --context CTX      oc context to use
      --insecure         do not verify the Route's TLS certificate (lab clusters whose router certificate
                         does not match the Route host); the proxy then skips verification for that hop
      --long-lived       read the non-expiring token from the ServiceAccount token Secret
                         (spec.mcp.authSecret) instead of minting a short-lived one
      --secret NAME      Secret to read with --long-lived (default: spec.mcp.authSecret)
  -o, --out FILE         config file to write (default: $OUT)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--namespace) NS="${2:?}"; shift 2 ;;
    -i|--instance)  INSTANCE="${2:?}"; shift 2 ;;
    -s|--sa)        SA="${2:?}"; shift 2 ;;
    -d|--duration)  DURATION="${2:?}"; shift 2 ;;
    --context)      CONTEXT="${2:?}"; shift 2 ;;
    --insecure)     ROUTE_INSECURE=true; shift ;;
    --long-lived)   LONG=true; shift ;;
    --secret)       SECRET="${2:?}"; LONG=true; shift 2 ;;
    -o|--out)       OUT="${2:?}"; shift 2 ;;
    -h|--help)      usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
done

command -v oc >/dev/null || die "oc not found on PATH"
command -v python3 >/dev/null || die "python3 not found on PATH"
OC=(oc); [[ -n "$CONTEXT" ]] && OC+=(--context "$CONTEXT")

"${OC[@]}" whoami >/dev/null 2>&1 || die "not logged in to a cluster: run oc login first"
[[ -n "$NS" ]] || NS="$("${OC[@]}" project -q 2>/dev/null || true)"
[[ -n "$NS" ]] || die "no namespace: pass -n NS"

# 1. The EvalHub CR must have MCP enabled; warn on known failure modes.
enabled="$("${OC[@]}" -n "$NS" get evalhub "$INSTANCE" -o jsonpath='{.spec.mcp.enabled}' 2>/dev/null)" \
  || die "EvalHub '$INSTANCE' not found in namespace '$NS'"
[[ "$enabled" == "true" ]] || die "spec.mcp.enabled is not true on EvalHub '$INSTANCE' in '$NS'"
phase="$("${OC[@]}" -n "$NS" get evalhub "$INSTANCE" -o jsonpath='{.status.mcp.phase}' 2>/dev/null || true)"
[[ "$phase" == "Ready" ]] || warn "MCP phase is '${phase:-unknown}', not Ready yet"
auth="$("${OC[@]}" -n "$NS" get evalhub "$INSTANCE" -o jsonpath='{.spec.mcp.authSecret}' 2>/dev/null || true)"
[[ -n "$auth" ]] || warn "spec.mcp.authSecret is unset: design_collection will likely fail with HTTP 401"

# 2. Get a token for the client ServiceAccount: minted (short-lived) or read from its token Secret (non-expiring).
"${OC[@]}" -n "$NS" get serviceaccount "$SA" >/dev/null 2>&1 \
  || die "ServiceAccount '$SA' not found in '$NS' (it needs RBAC to call the EvalHub API)"
if [[ "$LONG" == "true" ]]; then
  [[ -n "$SECRET" ]] || SECRET="$auth"
  [[ -n "$SECRET" ]] || die "no Secret to read: spec.mcp.authSecret is unset; pass --secret NAME"
  TOKEN="$("${OC[@]}" -n "$NS" get secret "$SECRET" -o json 2>/dev/null | python3 -I -c '
import base64, json, sys
sa = sys.argv[1]
try:
    s = json.load(sys.stdin)
except ValueError:
    sys.exit("secret not found or unreadable")
if s.get("type") != "kubernetes.io/service-account-token":
    sys.exit("secret type is %r, not kubernetes.io/service-account-token" % s.get("type"))
owner = s["metadata"].get("annotations", {}).get("kubernetes.io/service-account.name")
if owner != sa:
    sys.exit("secret belongs to ServiceAccount %r, not %r" % (owner, sa))
tok = base64.b64decode(s.get("data", {}).get("token", "")).decode()
if not tok:
    sys.exit("secret has no token yet")
print(tok, end="")
' "$SA")" || die "cannot use Secret '$SECRET' in '$NS' as a token for '$SA'"
  warn "using the non-expiring token in Secret '$SECRET': anyone who reads $OUT can act as '$SA' until that Secret is deleted"
else
  TOKEN="$("${OC[@]}" -n "$NS" create token "$SA" --duration="$DURATION")" || die "could not create a token for '$SA'"
fi

# 3. The upstream is the Route of the MCP server.
INSECURE=false
host="$("${OC[@]}" -n "$NS" get routes -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.spec.host}{"\n"}{end}' \
        | awk '$1 ~ /mcp/ {print $2; exit}')"
[[ -n "$host" ]] || die "no Route with 'mcp' in its name in '$NS'"
UPSTREAM="https://$host/mcp"
if [[ "$ROUTE_INSECURE" == "true" ]]; then
  INSECURE=true
  warn "TLS verification of the Route is off: use this only on a cluster you trust"
fi

# 4. Write the config (mode 600). The token goes in on stdin so it never appears in the process list.
umask 077
printf '%s' "$TOKEN" | python3 -I -c '
import base64, json, os, sys
from datetime import datetime, timezone
ns, upstream, insecure, out = sys.argv[1:5]
token = sys.stdin.read()
exp = ""
try:
    seg = token.split(".")[1]
    claims = json.loads(base64.urlsafe_b64decode(seg + "=" * (-len(seg) % 4)))
    exp = datetime.fromtimestamp(claims["exp"], timezone.utc).isoformat()
except (IndexError, ValueError, KeyError):
    pass  # opaque token: the proxy simply will not warn about expiry
cfg = {"upstream": upstream, "insecure": insecure == "true", "tenant": ns, "token": token, "expires_at": exp,
       "created_at": datetime.now(timezone.utc).isoformat()}
fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f:
    json.dump(cfg, f, indent=2)
os.chmod(out, 0o600)
print("wrote %s (tenant=%s, token expires %s)" % (out, ns, exp or "unknown"))
' "$NS" "$UPSTREAM" "$INSECURE" "$OUT"

cat <<EOF

Next:
  python3 -I $HERE/cors-proxy.py --config $OUT
  open http://127.0.0.1:8787/
EOF
