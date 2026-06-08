#!/usr/bin/env node
/**
 * iwant.fyi demand-side protocol Conformance Test Kit (v1.1)
 *
 * Points at any MCP server (and optional HTTP fallback) and verifies the spec
 * section 15 conformance criteria -- v1.0 core PLUS the v1.1 additions (signed
 * webhooks, partial-result transparency, retryable error taxonomy, idempotency,
 * capabilities discovery, deterministic ordering, published schemas).
 *
 * Run:
 *   npx @iwantfyi/conformance-kit \
 *     --mcp https://iwant.fyi/api/mcp \
 *     --http https://iwant.fyi/api/v1 \
 *     --api-key iwant_ak_...
 *
 * Spec: https://iwant.fyi/protocol/v1
 */

type Args = {
  mcp?: string;
  http?: string;
  apiKey?: string;
  verbose?: boolean;
  help?: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mcp") out.mcp = argv[++i];
    else if (a === "--http") out.http = argv[++i];
    else if (a === "--api-key") out.apiKey = argv[++i];
    else if (a === "--verbose" || a === "-v") out.verbose = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

const USAGE = `
iwant.fyi demand-side protocol Conformance Test Kit (v1.1)

Usage:
  npx @iwantfyi/conformance-kit --mcp <url> --api-key <key> [--http <url>] [--verbose]

Arguments:
  --mcp <url>       MCP endpoint to test (e.g., https://iwant.fyi/api/mcp)
  --http <url>      Optional HTTP fallback root (e.g., https://iwant.fyi/api/v1)
                    If provided, additional section 9 conformance is checked.
  --api-key <key>   Bearer API key for the implementation
  --verbose, -v     Print request/response details
  --help, -h        Show this help

Spec: https://iwant.fyi/protocol/v1
`;

const REQUIRED_TOOLS = ["demand.create_want", "demand.search", "demand.get_want", "demand.record_outcome"];
const RECOMMENDED_TOOLS = ["demand.list_verticals", "demand.list_constraints", "demand.health", "demand.capabilities"];

type Check = { section: string; description: string; pass: boolean; required: boolean; detail: string };
const checks: Check[] = [];

function record(section: string, description: string, pass: boolean, required: boolean, detail: string) {
  checks.push({ section, description, pass, required, detail });
  const tag = pass ? "PASS" : required ? "FAIL" : "WARN";
  console.log(`[${tag}] ${section} -- ${description} -- ${detail}`);
}

let rpcId = 0;

type RpcBody = { result?: unknown; error?: { code: number; message: string; data?: { error_type?: string; retryable?: boolean } } };

async function rpc(
  mcpUrl: string,
  apiKey: string | undefined,
  method: string,
  params?: Record<string, unknown>,
): Promise<{ status: number; body: RpcBody }> {
  const id = ++rpcId;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const res = await fetch(mcpUrl, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: { code: -32700, message: "non-JSON response: " + text.slice(0, 100) } };
  }
  return { status: res.status, body: body as RpcBody };
}

/** Unwrap an MCP tools/call text-content envelope into the tool's JSON result. */
function toolJson(body: RpcBody): Record<string, unknown> | null {
  const content = (body.result as { content?: Array<{ text?: string }> })?.content?.[0]?.text;
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function checkRequiredTools(mcpUrl: string, apiKey: string): Promise<string[]> {
  const r = await rpc(mcpUrl, apiKey, "tools/list");
  const tools = (r.body.result as { tools?: Array<{ name: string }> })?.tools ?? [];
  const names = tools.map((t) => t.name);

  const requiredPresent = REQUIRED_TOOLS.every((t) => names.includes(t));
  record("section 8.1", "required MCP tools present", requiredPresent, true,
    `found ${names.filter((n) => REQUIRED_TOOLS.includes(n)).length}/${REQUIRED_TOOLS.length}`);

  const recommendedCount = RECOMMENDED_TOOLS.filter((t) => names.includes(t)).length;
  record("section 8.2", "recommended MCP tools present", recommendedCount > 0, false,
    `found ${recommendedCount}/${RECOMMENDED_TOOLS.length} (recommended)`);

  return names;
}

async function checkErrorShape(mcpUrl: string): Promise<void> {
  // tools/call with no auth MUST be rejected with a conforming error.
  const r = await rpc(mcpUrl, undefined, "tools/call", { name: "demand.search", arguments: { title: "x" } });
  const err = r.body.error;
  const hasBase = !!err && typeof err.code === "number" && typeof err.message === "string";
  record("section 10.1 + 11", "rejects unauth with conforming JSON-RPC error", hasBase, true,
    hasBase ? `error.code=${err!.code}` : "no JSON-RPC error returned");

  // v1.1 §11.2: error.data carries a stable error_type + retryable flag.
  const hasTaxonomy = !!err?.data && typeof err.data.error_type === "string" && typeof err.data.retryable === "boolean";
  record("section 11.2", "error carries v1.1 taxonomy (error_type + retryable)", hasTaxonomy, false,
    hasTaxonomy ? `error_type=${err!.data!.error_type}, retryable=${err!.data!.retryable}` : "data.error_type / data.retryable missing");
}

async function checkCapabilities(mcpUrl: string, apiKey: string): Promise<void> {
  const r = await rpc(mcpUrl, apiKey, "tools/call", { name: "demand.capabilities", arguments: {} });
  const caps = toolJson(r.body);
  if (!caps) {
    record("section 8.2", "demand.capabilities returns a capability doc", false, false, "no/!json response (v1.1 recommended)");
    return;
  }
  const features = Array.isArray(caps.features) ? (caps.features as string[]) : [];
  record("section 8.2", "demand.capabilities returns version + features", typeof caps.protocol_version === "string" && features.length > 0, false,
    `protocol=${caps.protocol_version}, features=[${features.join(",")}]`);
}

/** §6 match-response shape via demand.search (no claim required -- universal). */
async function checkSearchAndMatchShape(mcpUrl: string, apiKey: string): Promise<void> {
  const r = await rpc(mcpUrl, apiKey, "tools/call", {
    name: "demand.search",
    arguments: { title: '[conformance] torque wrench, 1/4" drive', price_cents: 15000, price_currency: "USD", category: "goods" },
  });
  if (r.body.error) {
    record("section 6", "Match response shape valid (via demand.search)", false, true, r.body.error.message);
    return;
  }
  const mr = toolJson(r.body) as
    | { matches?: unknown; match_count?: unknown; degraded?: unknown; incomplete_source_count?: unknown; next_cursor?: unknown }
    | null;
  const matchesArr = Array.isArray(mr?.matches) ? (mr!.matches as Array<{ id?: string; score?: number }>) : [];
  const hasMatchShape = !!mr && Array.isArray(mr.matches) && typeof mr.match_count === "number";
  record("section 6", "Match response shape valid (via demand.search)", hasMatchShape, true,
    hasMatchShape ? `match_count=${mr!.match_count}` : "missing matches array / match_count");

  // v1.1 §6.1 partial-result transparency fields.
  const hasTransparency = !!mr && typeof mr.degraded === "boolean" && typeof mr.incomplete_source_count === "number";
  record("section 6.1", "response carries v1.1 transparency (degraded + incomplete_source_count)", hasTransparency, false,
    hasTransparency ? `degraded=${mr!.degraded}, incomplete=${mr!.incomplete_source_count}` : "fields missing");

  // v1.1 §6.3 deterministic order: scores non-increasing + a next_cursor field present.
  const scores = matchesArr.map((m) => (typeof m.score === "number" ? m.score : NaN));
  const ordered = scores.every((s, i) => i === 0 || s <= scores[i - 1]);
  record("section 6.3", "matches in non-increasing score order + next_cursor present", ordered && !!mr && "next_cursor" in mr, false,
    matchesArr.length > 1 ? `${matchesArr.length} matches, next_cursor present` : "few matches; next_cursor checked");
}

/**
 * §4 Want creation (write path). iwant.fyi gates posting behind a claim
 * (progressive trust), so an UNCLAIMED key yields claim_required -- recorded as a
 * WARN with guidance, not a hard fail. Returns the want id only when it persisted.
 */
async function checkWantCreation(mcpUrl: string, apiKey: string): Promise<{ wantId: string | null; matchId: string | null; needsClaim: boolean }> {
  const r = await rpc(mcpUrl, apiKey, "tools/call", {
    name: "demand.create_want",
    arguments: {
      title: '[conformance] torque wrench, 1/4" drive, 25-100 ft-lb',
      description: "Created by @iwantfyi/conformance-kit. Safe to delete.",
      price_cents: 15000,
      price_currency: "USD",
      category: "goods",
      vertical: "tools",
      mode: "any",
      constraints: { rules: { price_max: 15000, condition_min: "good" }, negotiable: ["price_max"] },
      origin: { agent_id: "conformance-kit", agent_name: "iwant.fyi conformance test" },
    },
  });

  const parsed = toolJson(r.body);
  const errText = r.body.error?.message ?? (typeof parsed?.error === "string" ? (parsed.error as string) : "");
  if (/claim_required/i.test(errText)) {
    record("section 4", "Want creation (write path)", false, false,
      "claim_required: this implementation gates posting behind a claimed key. Re-run with a CLAIMED key to verify §4/§7/§8.4.");
    return { wantId: null, matchId: null, needsClaim: true };
  }
  if (r.body.error || !parsed) {
    record("section 4", "Want creation accepts canonical shape", false, true, r.body.error?.message ?? "no content in response");
    return { wantId: null, matchId: null, needsClaim: false };
  }

  const wantId = (parsed.want as { id?: string })?.id ?? null;
  record("section 4", "Want creation accepts canonical shape", !!wantId, true, wantId ? `created want ${wantId}` : "no want.id in response");
  const mr = parsed.matches as { matches?: Array<{ id?: string }> } | undefined;
  const matchId = mr?.matches?.[0]?.id ?? "synthetic-test-match-id";
  return { wantId, matchId, needsClaim: false };
}

async function checkOutcomeEvent(mcpUrl: string, apiKey: string, wantId: string, matchId: string): Promise<void> {
  const r = await rpc(mcpUrl, apiKey, "tools/call", {
    name: "demand.record_outcome",
    arguments: { want_id: wantId, match_id: matchId, event: "viewed", timestamp: new Date().toISOString() },
  });
  if (r.body.error) {
    record("section 7", "Outcome event accepted", false, true, r.body.error.message);
    return;
  }
  const parsed = toolJson(r.body);
  record("section 7", "Outcome event accepted", !!parsed?.received, true,
    parsed?.received ? "received: true" : "unexpected response");
}

async function checkIdempotency(mcpUrl: string, apiKey: string): Promise<void> {
  const token = `conformance-${rpcId}-${Math.floor(Date.now() / 1000)}`;
  const args = {
    name: "demand.create_want",
    arguments: {
      title: "[conformance] idempotency probe",
      price_cents: 10000,
      price_currency: "USD",
      category: "goods",
      client_token: token,
    },
  };
  const a = toolJson((await rpc(mcpUrl, apiKey, "tools/call", args)).body);
  const b = toolJson((await rpc(mcpUrl, apiKey, "tools/call", args)).body);
  const idA = (a?.want as { id?: string })?.id;
  const idB = (b?.want as { id?: string })?.id;
  const same = !!idA && idA === idB;
  record("section 8.4", "client_token is idempotent (no duplicate Want)", same, false,
    same ? `both calls -> ${idA}` : `got ${idA} vs ${idB} (v1.1 idempotency not honored)`);
}

async function checkStandingWant(mcpUrl: string, apiKey: string, toolNames: string[]): Promise<void> {
  if (!toolNames.includes("demand.create_watch")) {
    record("section 16", "Standing Want tools present", false, false, "demand.create_watch absent (v1.1)");
    return;
  }
  const created = toolJson((await rpc(mcpUrl, apiKey, "tools/call", {
    name: "demand.create_watch",
    arguments: { title: "[conformance] standing want probe", webhook_url: "https://example.com/iwantfyi-conformance", check_interval_minutes: 1440 },
  })).body);
  const secret = typeof created?.webhook_secret === "string" ? (created.webhook_secret as string) : "";
  const signed = secret.startsWith("whsec_");
  record("section 16.3", "create_watch returns a one-time webhook signing secret", signed, false,
    signed ? "whsec_ secret returned" : "no whsec_ secret (signed webhooks not supported)");

  // Best-effort cleanup.
  const watchId = (created?.watch as { id?: string })?.id;
  if (watchId) await rpc(mcpUrl, apiKey, "tools/call", { name: "demand.cancel_watch", arguments: { watch_id: watchId } });
}

async function checkPublishedArtifacts(origin: string): Promise<void> {
  // §15 (v1.1): published JSON Schema + live conformance self-report.
  const schemaUrl = `${origin}/.well-known/iwantfyi/schemas/1.1/match-response.json`;
  try {
    const res = await fetch(schemaUrl);
    const json = res.ok ? await res.json().catch(() => null) : null;
    const ok = !!json && typeof json === "object" && "properties" in json;
    record("section 15", "published JSON Schema reachable", ok, false, ok ? schemaUrl : `status ${res.status}`);
  } catch {
    record("section 15", "published JSON Schema reachable", false, false, "fetch failed");
  }
  try {
    const res = await fetch(`${origin}/api/v1/conformance`);
    const json = res.ok ? await res.json().catch(() => null) : null;
    const ok = !!json && typeof (json as { conformance?: unknown }).conformance === "string";
    record("section 15", "live conformance self-report reachable", ok, false,
      ok ? `${(json as { conformance: string }).conformance}` : `status ${res.status}`);
  } catch {
    record("section 15", "live conformance self-report reachable", false, false, "fetch failed");
  }
}

async function checkHttpFallback(httpRoot: string, apiKey: string): Promise<void> {
  for (const path of ["/health", "/verticals", "/constraints", "/capabilities"]) {
    const res = await fetch(`${httpRoot}${path}`);
    record("section 9", `HTTP GET ${path} responds`, res.ok, path === "/capabilities" ? false : true, `status ${res.status}`);
  }
  const wantsRes = await fetch(`${httpRoot}/wants`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ title: "[conformance http] torque wrench test", price_cents: 15000, price_currency: "USD", vertical: "tools", location: { text: "Brooklyn, NY" } }),
  });
  // 403 here is the claim gate (progressive trust), not a fallback defect -> WARN.
  if (wantsRes.status === 403) {
    record("section 9", "HTTP POST /wants (write path)", false, false, "403 claim_required -- re-run with a claimed key to verify");
  } else {
    record("section 9", "HTTP POST /wants creates with Bearer auth", wantsRes.ok || wantsRes.status === 201, true, `status ${wantsRes.status}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.mcp) {
    console.log(USAGE);
    process.exit(args.help ? 0 : 1);
  }
  if (!args.apiKey) {
    console.error("--api-key is required for compliance checks (section 10.1 needs auth)");
    process.exit(1);
  }

  console.log(`=== iwant.fyi demand-side protocol v1.1 Conformance Report ===`);
  console.log(`Target MCP: ${args.mcp}`);
  if (args.http) console.log(`Target HTTP: ${args.http}`);
  console.log();

  let origin = "";
  try {
    origin = new URL(args.mcp).origin;
  } catch {
    /* leave blank; artifact checks will simply fail */
  }

  try {
    await checkErrorShape(args.mcp);
    const toolNames = await checkRequiredTools(args.mcp, args.apiKey);
    await checkCapabilities(args.mcp, args.apiKey);
    await checkSearchAndMatchShape(args.mcp, args.apiKey);
    const { wantId, matchId, needsClaim } = await checkWantCreation(args.mcp, args.apiKey);
    if (wantId && matchId) await checkOutcomeEvent(args.mcp, args.apiKey, wantId, matchId);
    if (needsClaim) {
      record("section 8.4", "client_token idempotency (write path)", false, false, "skipped -- needs a claimed key (see §4)");
    } else {
      await checkIdempotency(args.mcp, args.apiKey);
    }
    await checkStandingWant(args.mcp, args.apiKey, toolNames);
    if (origin) {
      console.log();
      await checkPublishedArtifacts(origin);
    }
    if (args.http) {
      console.log();
      await checkHttpFallback(args.http, args.apiKey);
    }
  } catch (e) {
    console.error("Test run crashed:", e);
    process.exit(2);
  }

  const requiredFailed = checks.filter((c) => c.required && !c.pass);
  const warnings = checks.filter((c) => !c.required && !c.pass);
  const passed = checks.filter((c) => c.pass).length;

  console.log();
  console.log(`=== Summary: ${passed}/${checks.length} checks passed, ${warnings.length} v1.1 warning(s) ===`);
  if (requiredFailed.length === 0) {
    const httpChecks = checks.filter((c) => c.section.startsWith("section 9"));
    // A claim-gated write-path WARN (required:false) must not downgrade the level.
    const httpAll = httpChecks.length > 0 && httpChecks.filter((c) => c.required).every((c) => c.pass);
    const v11 = warnings.length === 0;
    const level = httpAll ? "COMPLIANT v1.0+httpFallback" : httpChecks.length > 0 ? "COMPLIANT v1.0 (HTTP fallback partial)" : "COMPLIANT v1.0";
    console.log(v11 ? `${level} -- all v1.1 checks passed` : `${level} -- ${warnings.length} v1.1 feature(s) not detected (see WARN above)`);
    process.exit(0);
  }
  console.log(`NON-COMPLIANT -- ${requiredFailed.length} required check(s) failed:`);
  for (const f of requiredFailed) console.log(`  - ${f.section}: ${f.description} -- ${f.detail}`);
  process.exit(1);
}

main();
