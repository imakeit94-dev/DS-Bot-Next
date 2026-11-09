# Notion Session discovery review artifact

## Recorded run (reported by Leader, 2026-11-08)

After separate user authorization Leader checked runner SHA-256 `e49a3a8679355d3e0508c6dc971cebedc35dd16b7a92910363ac0924f3a86fef` and ran once with a minimal environment. Exit 0; `sessionVersionVerified:false`, `negativePin:unverified`, `discovery:listed`, `cleanup:deleted`; HTTP counts: total 7, create 2, toolkit 1, MCP 3, Session DELETE 1, business 0. This single Session authorization is exhausted. The separate metadata allowance remains 3/100 used, 97 remaining. This is Leader's report, not an independent replay. Listing proves neither a business response nor account binding; the negative observation is unverified, and deletion is not proof of OAuth revocation or removal of logs.

## Offline preparation

This standalone runner is off unless invoked with exactly `--run-once`. It is not wired into the product. No remote execution is authorized by this document; Session creation requires separate user approval after independent review.

It creates a random isolated user identifier and a synthetic nonexistent account pin. A successful negative create is anomalous: it is cleaned up and no second session is created. An ordinary client rejection is only `unverified`; it is not proof of an account-specific rejection. Timeout, credentials or other ambiguous errors stop the experiment without a second create. The second create omits account selection; a toolkit GET and MCP initialize, initialized notification and tools/list are allowed only while the returned toolkit shape indicates a single Notion toolkit with null connected account. Unknown shapes stop. No accounts are enumerated and no `tools/call` exists.

The runner counts every attempted HTTP request, including failures, notification and MCP DELETE: at most 2 create, 1 toolkit GET, 4 MCP requests, 2 Session DELETE, with total at most 12 and reserved cleanup capacity. No retry, reconnect, pagination, version fallback or redirect is performed. A 30-second work deadline and 40-second total deadline reserve time for cleanup. After a create timeout the runner waits up to one additional request timeout, within the total deadline, for a late response with a valid Session ID and attempts deletion if it arrives. If no ID arrives in that bounded window, cleanup remains uncertain; no subsequent create is attempted. A reported Session deletion is not OAuth revocation or proof of absence of all remote residue.

Session creation has no verified tool-version binding. `sessionVersionVerified` is always false. Previously observed metadata version `20261101_00` is reference only; no unsupported version field is sent. This discovery does not prove the MCP business response, output schema, actual account selection, runtime no-fallback behavior, or page access. Real business remains disabled.

After review and separate authorization, execute from the ds-bot directory using a minimal environment, keeping the key out of argv:

```sh
/opt/homebrew/bin/python3 -c 'import os; os.execve("/usr/local/bin/node", ["/usr/local/bin/node", "scripts/notion-session-discovery.mjs", "--run-once"], {"PATH": "/usr/local/bin:/usr/bin:/bin", "COMPOSIO_API_KEY": os.environ["DSH_SECRET_COMPOSIO_API_KEY"]})'
```

Only fixed result categories, counts and the fixed false version-verification flag are printed; raw HTTP responses, credentials, account IDs, session IDs, URLs and headers are not printed. The request uses fixed-origin TLS without proxy or redirects. This document and command are preparation, not authorization to run them.
