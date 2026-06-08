# @iwantfyi/conformance-kit

Conformance test kit for the [iwant.fyi demand-side protocol](https://iwant.fyi/protocol/v1). Point it
at any MCP server (and optional HTTP fallback) and it verifies the [spec section 15](https://iwant.fyi/protocol/v1#15-conformance)
criteria — the v1.0 core **plus** the v1.1 additions (signed webhooks, partial-result transparency,
retryable error taxonomy, idempotency, capability discovery, deterministic ordering, published schemas).

Licensed Apache-2.0. Works against any implementation of the protocol, not just iwant.fyi.

## Usage

```bash
# Test an implementation (MCP + HTTP fallback)
npx @iwantfyi/conformance-kit \
  --mcp https://iwant.fyi/api/mcp \
  --http https://iwant.fyi/api/v1 \
  --api-key iwant_ak_yourkey

# MCP only
npx @iwantfyi/conformance-kit --mcp https://example.com/api/mcp --api-key your_key
```

| Argument | |
|---|---|
| `--mcp <url>` | MCP endpoint to test (required) |
| `--http <url>` | Optional HTTP fallback root; enables the §9 checks |
| `--api-key <key>` | Bearer API key for the implementation (required) |
| `--verbose`, `-v` | Verbose output |
| `--help`, `-h` | Help |

Exit code is `0` when all **required** checks pass, non-zero otherwise. v1.1 feature gaps are reported
as `WARN` (they do not fail the run), so a v1.0 server still passes while you see what it's missing.

### A note on write-path checks

Some implementations (including iwant.fyi) gate *posting a Want* behind a claimed key (progressive
trust) while search/matching work with any valid key. With an **unclaimed** key the write-path checks
(§4 create_want, §7 outcome, §8.4 idempotency, and HTTP `POST /wants`) report `WARN: claim_required`.
Re-run with a **claimed** key to verify the full write path. The read/match path is verified either way
(§6 shape is checked via `demand.search`, which needs no claim).

## What it checks

Core (v1.0, required — these fail the run):
1. **§8.1** all required MCP tools present (`demand.create_want`, `demand.search`, `demand.get_want`, `demand.record_outcome`)
2. **§6** Match response shape (via `demand.search`)
3. **§4 / §7** Want creation + outcome events (write path; conditional on a claimed key)
4. **§10.1 / §11** rejects unauthenticated calls with a conforming JSON-RPC error

v1.1 additions (reported, `WARN` if absent):
5. **§11.2** error carries the retryable taxonomy (`data.error_type` + `retryable`)
6. **§8.2** `demand.capabilities` returns `protocol_version` + `features`
7. **§6.1** Match response carries `degraded` + `incomplete_source_count`
8. **§6.3** matches in non-increasing score order + `next_cursor` present
9. **§8.4** `client_token` is idempotent (no duplicate Want)
10. **§16.3** `demand.create_watch` returns a one-time `whsec_` signing secret
11. **§15** published JSON Schema + live `/v1/conformance` self-report reachable
12. **§9** HTTP fallback endpoints respond (`/health`, `/verticals`, `/constraints`, `/capabilities`, `/wants`)

> Full webhook *signature* verification needs a receiver endpoint; the kit checks that a signing
> secret is issued. To verify signatures end-to-end, point a Standing Want at a server you control and
> validate `X-IWantFyi-Signature` per spec §16.3.

## Output

```
=== iwant.fyi demand-side protocol v1.1 Conformance Report ===
[PASS] section 8.1 -- required MCP tools present -- found 4/4
[PASS] section 6   -- Match response shape valid (via demand.search) -- match_count=10
[PASS] section 11.2 -- error carries v1.1 taxonomy (error_type + retryable)
...
=== Summary: 15/18 checks passed, 3 v1.1 warning(s) ===
COMPLIANT v1.0+httpFallback -- 3 v1.1 feature(s) not detected (see WARN above)
```

## Development

```bash
npm install      # devDeps: typescript, @types/node
npm run build    # tsc -> dist/index.js
node dist/index.js --help
```

Spec: <https://iwant.fyi/protocol/v1> · JSON Schema: `https://iwant.fyi/.well-known/iwantfyi/schemas/1.1/`
