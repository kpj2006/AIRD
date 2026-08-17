import { readFile, writeFile } from "node:fs/promises";
import type { AiCatalogManifest, CatalogEntry } from "./types.js";

/**
 * Reads and writes the two fields ard-trust touches on an ai-catalog.json
 * entry: trustManifest.attestations[] and trustManifest.provenance[].
 * No new top-level fields, no schema change — see
 * ard-trust-architecture.md §3.
 */
export async function loadManifest(path: string): Promise<AiCatalogManifest> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as AiCatalogManifest;
}

export async function saveManifest(path: string, manifest: AiCatalogManifest): Promise<void> {
  await writeFile(path, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

export function findEntry(manifest: AiCatalogManifest, identifier: string): CatalogEntry {
  const entry = manifest.entries.find((e) => e.identifier === identifier);
  if (!entry) {
    throw new Error(`No entry with identifier ${identifier} in manifest`);
  }
  return entry;
}

export interface AttestParams {
  attestationPda: string; // base58
  digestSetRootHex: string;
}

/**
 * Write (or replace) this entry's ard-trust attestation and provenance
 * link. Idempotent per digest root: redeploying the same skill content
 * updates the existing solana-sas/ard.attestation.v1 element in place
 * rather than accumulating duplicates; a changed skill produces a new
 * root and is appended as a new attestation.
 */
export function applyAttestation(entry: CatalogEntry, params: AttestParams): CatalogEntry {
  const trustManifest = entry.trustManifest ?? {};
  const attestations = (trustManifest.attestations ?? []).filter(
    (a) => a.type !== "solana-sas/ard.attestation.v1",
  );
  attestations.push({
    type: "solana-sas/ard.attestation.v1",
    uri: `solana:${params.attestationPda}`,
    digest: `sha256:${params.digestSetRootHex}`,
  });

  const provenance = (trustManifest.provenance ?? []).filter(
    (p) => p.relation !== "attestedBy",
  );
  provenance.push({
    relation: "attestedBy",
    sourceId: `solana:${params.attestationPda}`,
  });

  return {
    ...entry,
    trustManifest: { ...trustManifest, attestations, provenance },
  };
}

export function replaceEntry(manifest: AiCatalogManifest, updated: CatalogEntry): AiCatalogManifest {
  return {
    ...manifest,
    entries: manifest.entries.map((e) => (e.identifier === updated.identifier ? updated : e)),
  };
}
