import { createHash } from "node:crypto";
import type { SkillResource } from "./types.js";

/**
 * Fold a skill's per-file digests into a single 32-byte root.
 *
 * N file digests collapse to 32 bytes; those 32 bytes become the
 * attestation's PDA-deriving nonce (ard-trust-architecture.md §4):
 *
 *   1. sort resources[] by uri (deterministic ordering)
 *   2. serialize as compact JSON, sorted keys, no whitespace
 *   3. sha256 the bytes -> one 32-byte root
 *
 * Content-addressed: anyone holding the skill bytes can independently
 * derive the same root, and therefore the same attestation PDA, with
 * no index and no trust in whoever served the files.
 */
export function computeDigestSetRoot(resources: SkillResource[]): string {
  const sorted = [...resources].sort((a, b) => (a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0));
  const canonical = sorted.map((r) => ({ digest: r.digest, uri: r.uri }));
  const serialized = JSON.stringify(canonical);
  return createHash("sha256").update(serialized, "utf8").digest("hex");
}

/** sha256 of raw bytes, formatted as the ard-spec digest string form. */
export function sha256Digest(bytes: Uint8Array | Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/**
 * Verify every resource's declared digest against the bytes actually
 * served. Mirrors the host-side "Recompute" check in
 * ard-trust-architecture.md §7 — the CLI runs the same check at deploy
 * time so a mismatch aborts before anything is attested.
 */
export async function verifyResourceDigests(
  resources: SkillResource[],
  fetchBytes: (uri: string) => Promise<Uint8Array>,
): Promise<{ verified: number; total: number; mismatches: string[] }> {
  const mismatches: string[] = [];
  for (const resource of resources) {
    const bytes = await fetchBytes(resource.uri);
    const actual = sha256Digest(bytes);
    if (actual !== resource.digest) {
      mismatches.push(resource.uri);
    }
  }
  return {
    verified: resources.length - mismatches.length,
    total: resources.length,
    mismatches,
  };
}
