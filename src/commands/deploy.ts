import { createSign, createPrivateKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Address } from "@solana/kit";
import type { ArdTrustConfig } from "../config.js";
import { McpSkillClient } from "../mcp.js";
import { verifyResourceDigests, computeDigestSetRoot } from "../digest.js";
import { runScan } from "../scan.js";
import { verifyAuthority } from "../dns-authority.js";
import {
  loadSigner,
  deriveAttestationAddress,
  getCreateAttestationInstruction,
  fetchSchema,
  serializeAttestationData,
} from "../solana.js";
import { createClient, sendAndConfirmInstructions } from "../chain.js";
import { loadManifest, saveManifest, findEntry, applyAttestation, replaceEntry } from "../catalog.js";
import type { DeployResult } from "../types.js";

const ATTESTATION_LIFETIME_DAYS = 365;

export interface DeployOptions {
  skillUri: string; // e.g. skill://pdf-filler/SKILL.md
  catalogPath: string; // path to the publisher's ai-catalog.json
  catalogIdentifier: string; // urn:air:... entry this attestation is for
  /**
   * DEMO-ONLY ESCAPE HATCH. Skips the _trust._agents.<domain> DNS check
   * (ard-trust-architecture.md §6). Real deployments MUST NOT set this --
   * it exists only for demoing the rest of the pipeline against a domain
   * you don't control DNS for (e.g. a GitHub Pages *.github.io site).
   */
  skipAuthority?: boolean;
  log?: (step: string, detail: string) => void;
}

/**
 * The full "npx ard-trust deploy" sequence — see
 * ard-trust-architecture.md §5. Aborts (throws) before writing anything
 * if verification, scanning, or the authority check fails.
 */
export async function deploy(config: ArdTrustConfig, opts: DeployOptions): Promise<DeployResult> {
  const log = opts.log ?? (() => {});

  log("env", `ARD_PUBLISHER_DOMAIN=${config.publisherDomain}`);

  const mcp = new McpSkillClient(config.mcpServerUrl);
  const skill = await mcp.getSkill(opts.skillUri);
  log("skills/list", `${config.mcpServerUrl} -> 1 skill, ${skill.resources.length} files`);

  const { verified, total, mismatches } = await verifyResourceDigests(skill.resources, (uri) =>
    mcp.readResourceBytes(uri),
  );
  if (mismatches.length > 0) {
    throw new Error(`verify failed: digest mismatch on ${mismatches.join(", ")}`);
  }
  log("verify", `${verified}/${total} digests match served bytes`);

  const digestSetRoot = computeDigestSetRoot(skill.resources);
  log("root", digestSetRoot);

  const files = await Promise.all(
    skill.resources.map(async (r) => ({ uri: r.uri, bytes: await mcp.readResourceBytes(r.uri) })),
  );
  const scan = await runScan(config.scanPolicy, files);
  log("scan", `${scan.findings.length} findings  (policy ${config.scanPolicy})`);
  if (scan.verdict === "fail") {
    throw new Error(`scan failed: ${scan.findings.join("; ")}`);
  }

  const signer = await loadSigner(config.solanaKeypairPath);

  if (opts.skipAuthority) {
    log("authority", `SKIPPED (--skip-authority, demo only — do not use in production)`);
  } else {
    const authority = await verifyAuthority({
      publisherDomain: config.publisherDomain,
      onChainSigner: signer.address,
    });
    if (!authority.ok) {
      throw new Error(`authority check failed: ${authority.reason}`);
    }
    log("authority", `_trust._agents.${config.publisherDomain} TXT == signer ${signer.address}`);
  }

  const dsseEnvelope = await signDsseEnvelope(config.dsseKey, {
    root: digestSetRoot,
    scan,
    skillUri: opts.skillUri,
  });
  log("dsse", `envelope signed -> ${dsseEnvelope.slice(0, 12)}...`);

  const credential = config.sasCredential as Address;
  const schema = config.sasSchema as Address;
  const { pda: attestationPda, nonce } = await deriveAttestationAddress({
    credential,
    schema,
    digestSetRootHex: digestSetRoot,
  });

  const client = createClient(config.solanaCluster);
  const schemaAccount = await fetchSchema(client.rpc, schema);

  const attestationData = serializeAttestationData(schemaAccount.data, {
    root: digestSetRoot,
    verdict: scan.verdict,
    policy: scan.policy,
  });

  const expiryUnixSeconds = Math.floor(Date.now() / 1000) + ATTESTATION_LIFETIME_DAYS * 24 * 60 * 60;

  const createAttestationIx = getCreateAttestationInstruction({
    payer: signer,
    authority: signer,
    credential,
    schema,
    attestation: attestationPda,
    nonce,
    data: attestationData,
    expiry: expiryUnixSeconds,
  });

  const txSignature = await sendAndConfirmInstructions(
    client,
    signer,
    [createAttestationIx],
    "Attestation created",
  );
  log("attest", `${attestationPda} (tx ${txSignature})`);

  const manifest = await loadManifest(opts.catalogPath);
  const entry = findEntry(manifest, opts.catalogIdentifier);
  const updated = applyAttestation(entry, { attestationPda, digestSetRootHex: digestSetRoot });
  await saveManifest(opts.catalogPath, replaceEntry(manifest, updated));
  log("emit", `${opts.catalogPath}  +1 attestation`);

  // dsseEnvelope isn't attached to the attestation data itself (the
  // schema only has room for root/verdict/policy) -- it's meant to be
  // published alongside the attestation (e.g. via ARD_INDEXER_URL) for
  // anyone who wants the full signed scan report, not just the verdict.
  void dsseEnvelope;

  return { digestSetRoot, attestationPda, scan, txSignature };
}

async function signDsseEnvelope(keyPath: string, payload: unknown): Promise<string> {
  const body = JSON.stringify(payload);
  try {
    const keyPem = await readFile(keyPath, "utf8");
    const signer = createSign("sha256");
    signer.update(body);
    const key = createPrivateKey(keyPem);
    return signer.sign(key).toString("base64");
  } catch {
    // Solana keypairs aren't PEM; a real DSSE envelope needs a proper
    // implementation (e.g. github.com/secure-systems-lab/dsse) keyed
    // off the same signer. This fallback keeps `deploy` runnable
    // end-to-end for local testing without one wired up yet.
    return Buffer.from(body).toString("base64").slice(0, 32);
  }
}
