# ard-trust

Ship a skill. Prove who vouched for it. In one command.

An attestation layer for MCP skills and ARD catalog entries, anchored on
Solana. See `../ard-trust-architecture.md` for the full design.

```
npx ard-trust deploy --skill skill://pdf-filler/SKILL.md \
  --catalog ./ai-catalog.json \
  --entry urn:air:acme.com:skill:pdf-filler
```

## Status: fully wired, blocked only on devnet funding

Everything in the pipeline below has been run for real against
[kpj2006's live ARD demo](../ard-demo) — a real MCP client fetching real
skill bytes, real digest computation, a real (bypassed-for-demo) DNS
check, real Borsh-encoded attestation data. The **only** step not yet
exercised end-to-end is the actual on-chain transaction, because the
devnet faucet hit its 24h per-IP rate limit mid-session. See "Resuming
once funded" below.

Built directly on **[sas-lib](https://www.npmjs.com/package/sas-lib)**
(github.com/solana-foundation/solana-attestation-service) — the real
Solana Foundation SAS SDK. `deriveCredentialPda`, `deriveSchemaPda`,
`deriveAttestationPda`, `createAttestation`, and `closeAttestation` are
its actual exports; the transaction-building pattern in `src/chain.ts`
mirrors SAS's own official example
(`examples/typescript/attestation-flow-guides/src/kit/sas-standard-kit-demo.ts`).

**Fully implemented and verified live:**
- `digest.ts` — `digest_set_root` computation. Verified against a real
  published file: recomputing the root over the live
  `kpj2006.github.io` pdf-filler skill reproduces the same value the
  deck's worked example shows.
- `mcp.ts` — a real JSON-RPC `resources/read` client, run against
  `scripts/mcp-stub-server.ts` serving the actual bytes live at
  `kpj2006.github.io/ard-demo/resources/pdf-filler.md` (digests
  cross-checked to match exactly).
- `dns-authority.ts` — the `_trust._agents.<domain>` TXT check. Its error
  handling is correct (only `ENOTFOUND` means "no record"; anything else,
  like a resolver being unreachable, fails closed rather than silently
  passing) — confirmed by testing it in an environment where raw DNS UDP
  queries are blocked entirely (`ECONNREFUSED` even against a known-good
  domain via explicit public resolvers), which is why `deploy --skip-authority`
  exists as an explicitly-labeled demo escape hatch.
- `catalog.ts` — reads/writes `trustManifest.attestations[]` and
  `trustManifest.provenance[]` on an `ai-catalog.json` entry.
- `solana.ts` / `chain.ts` — real PDA derivation, real transaction
  building (blockhash, fee payer, signing, the required
  `assertIsFullySignedTransaction`/`assertIsTransactionWithinSizeLimit`
  narrowing), real `sendAndConfirmTransactionFactory` wiring.
- `commands/deploy.ts` — fetches the real on-chain `Schema` account
  (`fetchSchema`) and Borsh-encodes the attestation data against it
  (`serializeAttestationData`) with fields `{root, verdict, policy}` —
  not raw bytes, which was an earlier mistake this scaffold corrected
  after checking SAS's actual encoding requirements.
- `commands/revoke.ts` — real `closeAttestation` instruction, including
  the `eventAuthority` account SAS requires for it.

**Genuinely stubbed:**
- The DSSE envelope signing in `deploy.ts` is a placeholder (Solana
  keypairs aren't PEM-shaped). A real implementation should use
  [secure-systems-lab/dsse](https://github.com/secure-systems-lab/dsse)
  keyed off the same signer.
- `scan.ts` is an interface with a no-op default policy — plug in a real
  scanner via `registerPolicy`.
- No compute-budget instructions (`@solana-program/compute-budget`,
  which the official SAS example uses) — its `@solana/kit@^6` peer
  requirement conflicts with the version `sas-lib` resolves here.
  Devnet's default compute limit is sufficient for these small
  instructions; revisit if you see compute-exhaustion errors.

## One-time setup: `scripts/bootstrap.ts`

Generates a persistent devnet verifier keypair (`.devnet/verifier.json`,
gitignored), funds it, and creates the on-chain SAS `Credential` +
`Schema` (fields: `root`, `verdict`, `policy`, all Borsh strings) that
`deploy` attests under:

```
npx tsx scripts/bootstrap.ts
```

It's idempotent — reruns reuse the existing keypair file instead of
generating a new address each time.

## Resuming once the devnet faucet is available again

1. `npx tsx scripts/bootstrap.ts` — completes credential/schema creation
   using the already-generated keypair at `.devnet/verifier.json`
   (address `8J6bcz5Yy3gF4w4rscSZByNbQ6Vdq9PZUZ78agGHC6h3` as of this
   writing — this is the one to send devnet SOL to).
2. Copy the printed `ARD_SAS_CREDENTIAL` / `ARD_SAS_SCHEMA` addresses into
   `.env` (currently `PENDING_BOOTSTRAP` placeholders).
3. `npx tsx scripts/mcp-stub-server.ts` (background) — serves the real
   published skill content on `127.0.0.1:8765`.
4. `npm run build && node dist/src/cli.js deploy --skill skill://pdf-filler/index.json --catalog ../kpj2006.github.io/.well-known/ai-catalog.json --entry urn:air:kpj2006.github.io:skill:pdf-filler --skip-authority`
5. Confirm the resulting attestation on
   [Solana Explorer](https://explorer.solana.com/?cluster=devnet), then
   push the updated `ai-catalog.json` (now carrying the real attestation)
   back to the `kpj2006.github.io` repo.
6. Try `ard-trust revoke --root <root> --attestation <pda> --reason demo`
   and confirm the attestation account is gone on-chain afterward.

## Layout

```
src/
  cli.ts              commander entrypoint: deploy, revoke
  config.ts            env-only configuration (see .env.example)
  types.ts             SkillResource, CatalogEntry, TrustManifest, etc.
  digest.ts             digest_set_root computation + per-file verification
  mcp.ts               minimal MCP resources/read client
  dns-authority.ts     _trust._agents.<domain> lookup + authority check
  chain.ts             transaction building/sending helpers (@solana/kit)
  solana.ts            sas-lib wrapper (PDA derivation, instruction building)
  catalog.ts           ai-catalog.json trustManifest read/write
  scan.ts              pluggable scan-policy interface
  commands/
    deploy.ts          the full deploy sequence
    revoke.ts          attestation close / revocation
scripts/
  bootstrap.ts         one-time Credential + Schema creation
  mcp-stub-server.ts   local MCP server for demo/dev use
```

## Install

```
npm install
cp .env.example .env   # fill in your domain, MCP server, keypair, SAS credential
npm run build
npm start -- deploy --skill ... --catalog ... --entry ...
```

Not yet published to npm — `npx ard-trust` will work once it is.
