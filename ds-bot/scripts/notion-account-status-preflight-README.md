# Single Notion connection status preflight

Standalone review artifact, default off, not product integration. This document does not authorize authenticated requests.

Leader reports that, following separate user approval and SHA-256 verification of `83cf9d5f6ca0eb76ada6a48604f673b1f864eaea5545873b874b2e332cb9bd3a`, one single-account GET returned exit 0, HTTP 200, `idMatches:true`, `isNotion:true`, `connectionStatus:ACTIVE`, `isDisabled:false`, `authConfigDisabled:false`. The user-approved GET is now exhausted. These observations do not establish ownership, token validity at use time, page access or no fallback. No raw response or account ID was retained in this record.

Separate ledgers: metadata 3/100, Session experiment 7 HTTP, page execution 2 POST, account status 1 GET. None authorizes an additional request.

The official [v3.1 single connected-account API](https://docs.composio.dev/reference/api-reference/connected-accounts/getConnectedAccountsByNanoid.md) specifies `GET /api/v3.1/connected_accounts/{nanoid}` and fields `id`, `toolkit.slug`, `status`, `is_disabled`, and `auth_config.is_disabled`. Its full response can contain OAuth and other sensitive material; this runner never prints or saves raw responses. It inspects only those fields and outputs an integer HTTP status, local request count, ID match boolean/null, Notion match boolean/null, status `ACTIVE`/`INITIALIZING`/`INITIATED`/`unknown`, and two disabled booleans/null. Null means missing, malformed, or unavailable, not false. Status values other than the three enumerated values are unknown. An HTTP 200 alone does not mean the selected connection is valid or ready.

Exactly one user-selected account ID enters through the environment. No listing, pagination, account traversal, tool execution, page access, Session or OAuth is performed. Fixed HTTPS origin, no proxy or redirects, no retry, a 15-second deadline and a 2 MiB response limit apply. Failures count as a request once the GET is attempted. The official schema says `user_id` is deprecated and may no longer be returned, so this result does not prove ownership, page access, token validity at use time, or lack of server fallback.

After independent review and a new explicit authorization for one single-account GET, execute from the `ds-bot` directory with values supplied securely in the environment; neither value appears in argv:

```sh
/opt/homebrew/bin/python3 -c 'import os; os.execve("/usr/local/bin/node", ["/usr/local/bin/node", "scripts/notion-account-status-preflight.mjs", "--run-once"], {"PATH":"/usr/local/bin:/usr/bin:/bin", "COMPOSIO_API_KEY":os.environ["DSH_SECRET_COMPOSIO_API_KEY"], "NOTION_ACCOUNT_ID":os.environ["NOTION_ACCOUNT_ID"]})'
```

Do not save the command's environment, response body, account ID, credentials or error details. The command and its documentation do not authorize execution.
