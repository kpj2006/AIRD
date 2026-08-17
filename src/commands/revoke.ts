import type { Address } from "@solana/kit";
import type { ArdTrustConfig } from "../config.js";
import {
  loadSigner,
  getCloseAttestationInstruction,
  eventAuthorityAddress,
  SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
} from "../solana.js";
import { createClient, sendAndConfirmInstructions } from "../chain.js";

export interface RevokeOptions {
  root: string; // digest_set_root hex, as printed by `deploy`
  reason: string;
  attestationPda: Address;
  log?: (message: string) => void;
}

/**
 * "And when it goes wrong" (ard-trust-architecture.md, deck slide 10).
 *
 * Closes the SAS attestation account for a given digest root. Any host
 * checking at use-time (not just at list-time — see architecture §7)
 * sees the attestation gone on its next lookup; there is no separate
 * registry to notify and no cache to invalidate on ard-trust's side.
 *
 * `closeAttestation` is a real sas-lib instruction
 * (github.com/solana-foundation/solana-attestation-service) — this
 * wraps it rather than reimplementing revocation.
 */
export async function revoke(config: ArdTrustConfig, opts: RevokeOptions): Promise<string> {
  const log = opts.log ?? (() => {});
  const signer = await loadSigner(config.solanaKeypairPath);
  const client = createClient(config.solanaCluster);

  const eventAuthority = await eventAuthorityAddress();
  const closeAttestationIx = getCloseAttestationInstruction({
    payer: signer,
    authority: signer,
    credential: config.sasCredential as Address,
    attestation: opts.attestationPda,
    eventAuthority,
    attestationProgram: SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
  });

  const txSignature = await sendAndConfirmInstructions(
    client,
    signer,
    [closeAttestationIx],
    `Revoking --root ${opts.root} --reason ${opts.reason}`,
  );

  log(`revoked. tx ${txSignature}`);
  log("propagation to every host that checks: <1s, 0 registries need to cooperate");
  return txSignature;
}
