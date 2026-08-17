# ard-trust: Architecture on the Current ARD Stack

**Scope note:** everything in this document binds only to what is published and
merged today — the live `ai-catalog` standard, `ard-spec` main branch (v0.9),
`ard-connectors`, and `agenticresourcediscovery.org`. It deliberately does **not**
depend on `ard-spec` PR #70 ("v0.91 draft"): that revision is an open, unmerged
proposal (JSON-LD entries, the `trustSchema` pluggable-framework field, the
ARD-entry/catalog-entry split), and building against it now would mean building
against a moving target with no guarantee of landing as-is. §8 below notes
exactly what changes for ard-trust *if and when* v0.91 merges, but nothing here
requires it.

---

## 1. The stack ard-trust sits on

```
┌─────────────────────────────────────────────────────────┐
│  ai-catalog (external spec, Agent-Card/ai-catalog)       │
│  base artifact-agnostic manifest + trustManifest model   │
└─────────────────────────────────────────────────────────┘
                          │  extended by
┌─────────────────────────────────────────────────────────┐
│  ARD (ards-project/ard-spec, v0.9, spec/ard.md)          │
│  URN identifiers, search API, federation                │
└─────────────────────────────────────────────────────────┘
                          │  consumed by
┌─────────────────────────────────────────────────────────┐
│  ard-connectors — client-side Skills/MCP configs         │
│  (Claude, ChatGPT, Copilot, Gemini, Cursor)               │
└─────────────────────────────────────────────────────────┘
                          │  documented at
┌─────────────────────────────────────────────────────────┐
│  ard-docs → agenticresourcediscovery.org                 │
└─────────────────────────────────────────────────────────┘
```

**ard-trust adds one thing to this stack: a fourth, independent, staked party
who can write a verifiable "I checked this" claim that nothing above already
provides.** It does not replace any layer, does not require a schema change,
and does not require the client or registry to run new code to keep working —
only to get *more* out of what's already there if they choose to check it.

---

## 2. What already exists today (no ard-trust involved)

From `ard-docs` and `ard-spec` main:

- **Manifest**: a publisher hosts `ai-catalog.json` at
  `https://<domain>/.well-known/ai-catalog.json`. Root fields: `specVersion`,
  `host {displayName, identifier}`, `entries[]`, `collections[]`.
- **Entry**: `identifier` (`urn:air:<publisher>:<namespace>:<agent-name>`),
  `displayName`, `type` (IANA media type), `url`/`data`, `capabilities`,
  `description`, `representativeQueries`, `metadata`, `trustManifest`.
- **trustManifest** (optional, per entry):
  - `identity` — SPIFFE ID, `did:web`, or HTTPS domain
  - `identityType` — hint for the above
  - `attestations[]` — `{type, uri, mediaType?, digest?}`
  - `provenance[]` — `{relation, sourceId, sourceDigest?}`
  - `signature` — detached JWS over the manifest content
- **Discovery mechanisms**: `.well-known` path (primary); DNS `TXT` at
  `_catalog._agents.<domain>` for a custom manifest location; DNS `SRV` at
  `_search._agents.<domain>` for a dynamic search endpoint.
- **Search API**: `POST /search` (required), `POST /explore` (optional),
  `GET /agents` (optional). `federation`: `auto` / `referrals` / `none`.
- **Client verification duty** (`how_to_build_a_client.md`, Step 4): extract the
  domain from the URN, verify `trustManifest.identity` is bound to it, audit
  `attestations[]`, verify the detached JWS `signature`. **ARD communicates
  these signals; it does not itself confer trust** — the registry's curation
  policy and the client's verification are the actual trust boundary (per the
  ARD FAQ, verbatim).
- **The relevance `score` on a search result is explicitly not a trust,
  compliance, or safety rating** — restated in the spec, the client guide, and
  the FAQ. This is load-bearing: it's the exact gap ard-trust exists to fill.

**Already-live prior art in this exact spot**: [Ora Directory](https://ora.ai)
runs a real ARD discovery service today where every entry's
`trustManifest.attestations[]` references a signed "agent-readiness scorecard"
— Ed25519 detached JWS, verifiable against a published JWKS
(`ora.ai/.well-known/jwks.json`). This proves the attestation slot in the
current schema is not theoretical; a production registry already writes
third-party verdicts into it. Ora's model has one property ard-trust changes:
**the verifier is Ora itself** — a single, centrally-trusted signer. There is
no economic cost to Ora if a verdict is wrong; you trust the scorecard because
you trust Ora. ard-trust's differentiator is not "third-party attestation" —
that exists — it's **making the verifier's identity a staked, slashable
on-chain account**, so a false "clean" verdict costs the verifier something
concrete, and that cost is independently checkable by anyone, not vouched for
by one company's reputation.

---

## 3. What ard-trust adds, and exactly where it writes

No new top-level fields. No schema change. Four write targets, all inside
mechanisms `ard-spec` v0.9 already defines:

| # | Target | Field / location | Who reads it |
|---|--------|-------------------|--------------|
| 1 | `ai-catalog.json` entry | `trustManifest.attestations[]` — new element: `{type: "solana-sas/ard.attestation.v1", uri: "solana:<pda>", digest: "sha256:<digest_set_root>"}` | Any ARD-compliant client/registry doing normal `attestations[]` auditing (Step 4 of the client guide) |
| 2 | `ai-catalog.json` entry | `trustManifest.provenance[]` — new element: `{relation: "attestedBy", sourceId: "solana:<pda>"}` | Same |
| 3 | DNS | `_trust._agents.<domain>` TXT — `"v=ard-trust1; key=<solana-pubkey>"` | ard-trust CLI/verifiers only, at deploy and verify time |
| 4 | MCP skill resource | `_meta["org.aossie.ard/attestation"]` — `{pda, root, verdict, expiry}` | MCP hosts implementing the skills extension (SEP-2640), independent of ARD |

Row 3 is the one deliberate naming change from the original deck: the
publisher-authority TXT record now lives under `_trust._agents.<domain>`,
matching the namespace `how_to_publish.md` already established for
`_catalog._agents.<domain>` and `_search._agents.<domain>` — instead of the
previous ad hoc `_ard.<domain>` prefix, which invented a new naming
convention next to one that already existed.

Row 4 is a different spec entirely (MCP's skill extension, not ARD) — it's
included here because the deploy flow writes to both in one pass, not because
ARD requires it.

---

## 4. Digest computation (unaffected by v0.9 vs v0.91)

Confirmed identical in both `ard-spec` main and the open v0.91 draft's actual
schema file (`ard-entry.schema.json` on `origin/ard-v0.91-draft`) — `digest` is
a plain `sha256:<hex>` string in both, so this doesn't need to hedge against
which version lands:

1. Collect the skill's file-level `{uri, digest}` pairs.
2. Sort by `uri` (deterministic ordering).
3. Serialize as compact JSON, sorted keys, no whitespace.
4. `sha256` the bytes → `digest_set_root` (32 bytes).
5. Use `digest_set_root` as the nonce deriving the Solana Attestation Service
   (SAS) PDA. Attestation lookup becomes content-addressed: anyone holding the
   skill bytes can independently derive the address of every verdict about it
   — no index, no registry, no trust in whoever served the file.

---

## 5. Deploy flow (`npx ard-trust deploy`)

1. **env** — read `ARD_PUBLISHER_DOMAIN`, `ARD_MCP_SERVER_URL`,
   `ARD_SOLANA_CLUSTER`, `ARD_SAS_CREDENTIAL`, `ARD_SAS_SCHEMA`,
   `ARD_SCAN_POLICY`, `ARD_DSSE_KEY`, `ARD_INDEXER_URL`,
   `ARD_REVOCATION_WATCH`. No config file, no dashboard.
2. **skills/list** — fetch the skill's file manifest from the MCP server.
3. **verify** — recompute each file's digest; confirm it matches what was
   served.
4. **root** — compute `digest_set_root` (§4).
5. **scan** — run the configured policy (`ARD_SCAN_POLICY`) against the
   fetched bytes; record findings.
6. **authority** — cross-check three independent claims (§6) before writing
   anything.
7. **dsse** — sign a DSSE envelope over the scan result.
8. **attest** — write the SAS attestation account on Solana, keyed by the
   nonce from step 4.
9. **emit** — write rows 1–2 (§3) into `ai-catalog.json`, and row 4 into the
   MCP skill's `_meta`.

Same command runs in CI on every release tag; a changed skill gets a new root
and therefore a new attestation — nothing is mutated in place.

---

## 6. "Is it the same publisher?" — the authority check

Three independent claims must agree, or the deploy aborts and nothing is
written:

| Claim | Source | What it proves |
|---|---|---|
| Catalog identifier | `urn:air:<publisher>:...` on the ARD entry | Who the catalog *says* this is |
| DNS record | `_trust._agents.<domain> TXT "v=ard-trust1; key=<pubkey>"` | The domain owner authorized this specific signer |
| On-chain signer | SAS-authorized signer on the attestation account | Who *actually* signed |

If the DNS-declared key and the on-chain signer disagree, the deploy fails
closed. This is ard-trust's implementation of the same principle the ARD FAQ
already states as a requirement of any ARD-compliant registry ("a registry
MUST verify that a manifest is actually hosted on — or cryptographically bound
to — the domain it claims") — ard-trust doesn't invent this obligation, it
gives the domain owner a concrete, checkable way to bind a *Solana* signer to
it specifically, which nothing in the base spec does on its own.

---

## 7. Verify flow (host-side, at use — not at list)

1. **Recompute** — hash the served files, fold to a root.
2. **Look up** — derive the SAS PDA from the root; read every verdict on it.
3. **Weigh** — is the signer in my policy? Is its stake sufficient?
4. **Gate** — revoked means refuse; unknown means prompt.

Two invariants:

- **Revocation is checked at use, never at list.** A cached search result or
  skill index with any TTL must not be able to suppress a revocation that
  happened after it was cached.
- **Chain liveness is never on the critical path.** A confirmed revocation
  fails closed; an unreachable indexer fails open with a warning — a skill
  that silently refuses to load is its own kind of broken agent.

---

## 8. Explicit non-dependency on v0.91

If/when `ard-spec` PR #70 merges, one seam becomes available that isn't there
today: a formal `trustManifest.trustSchema` object
(`{identifier, version, governanceUri, verificationMethods[]}`) that lets an
entry declare which trust framework it conforms to, with ARD itself reading
only `identity` and delegating everything else. At that point, ard-trust could
register as a named `trustSchema` (e.g. `org.aossie.ard-trust`) instead of
relying on `attestations[]`/`provenance[]` conventions alone. **Nothing in §3–7
requires this.** It's a future upgrade path, not a current dependency — the
whole design above works unchanged against what's merged right now.

---

## 9. What ard-trust deliberately does not do

- It does not decide what's "safe" — per the ARD FAQ, that's not a property a
  discovery protocol (or an attestation layer sitting next to one) can
  compute. It reports a policy-scoped scan verdict from a named, staked
  verifier; the registry and client still make the call.
- It does not replace registry curation or client-side verification (§2) —
  it's additional evidence those two existing trust boundaries can weigh.
- It does not touch the search-relevance `score` — that stays relevance-only,
  as the spec requires.
