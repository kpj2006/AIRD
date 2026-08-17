import {
  createSolanaRpc,
  createKeyPairSignerFromBytes,
  address,
  type Address,
  type TransactionSigner,
} from "@solana/kit";
import {
  deriveCredentialPda,
  deriveSchemaPda,
  deriveAttestationPda,
  deriveEventAuthorityAddress,
  getCreateAttestationInstruction,
  getCloseAttestationInstruction,
  fetchSchema,
  serializeAttestationData,
  SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
} from "sas-lib";
import { readFile } from "node:fs/promises";
import { clusterUrl } from "./config.js";

/**
 * Thin wrapper around sas-lib (github.com/solana-foundation/solana-attestation-service,
 * npm: sas-lib) — the real Solana Attestation Service SDK. ard-trust does
 * not reimplement attestation primitives; it derives a content-addressed
 * nonce (the digest_set_root, see digest.ts) and hands it to SAS.
 *
 * NOTE: this wrapper targets sas-lib's Codama-generated instruction
 * builders as of the version pinned in package.json. If accounts
 * resolved automatically differ (e.g. an Async variant that derives
 * `attestation` for you), adjust the calls below to match — the PDA
 * derivation and instruction *shapes* here are taken directly from the
 * upstream source, not guessed.
 */

/**
 * No explicit return-type annotation here on purpose: createKeyPairSignerFromBytes's
 * inferred type carries a generic Address<string> brand that @solana/kit's
 * transaction-signing pipeline (setTransactionMessageFeePayerSigner ->
 * signTransactionMessageWithSigners) requires to compose correctly. An
 * explicit `Promise<TransactionSigner>` annotation erases that generic to
 * the default and breaks type inference three call sites downstream, even
 * though it looks harmless here.
 */
export async function loadSigner(keypairPath: string) {
  const expanded = keypairPath.replace(/^~(?=\/|$)/, process.env.HOME ?? process.env.USERPROFILE ?? "~");
  const raw = JSON.parse(await readFile(expanded, "utf8")) as number[];
  return createKeyPairSignerFromBytes(new Uint8Array(raw));
}

export function rpcFor(cluster: string) {
  return createSolanaRpc(clusterUrl(cluster));
}

/**
 * Derive the attestation PDA for a given credential/schema/digest root,
 * without needing a live signer — this is what makes lookup
 * content-addressed (ard-trust-architecture.md §4): anyone holding the
 * skill bytes can compute this address themselves.
 */
export async function deriveAttestationAddress(params: {
  credential: Address;
  schema: Address;
  digestSetRootHex: string;
}): Promise<{ pda: Address; nonce: Address }> {
  const nonce = digestRootToNonce(params.digestSetRootHex);
  const [pda] = await deriveAttestationPda({
    credential: params.credential,
    schema: params.schema,
    nonce,
  });
  return { pda, nonce };
}

export async function credentialAddress(authority: Address, name: string): Promise<Address> {
  const [pda] = await deriveCredentialPda({ authority, name });
  return pda;
}

export async function schemaAddress(credential: Address, name: string, version: number): Promise<Address> {
  const [pda] = await deriveSchemaPda({ credential, name, version });
  return pda;
}

/**
 * digest_set_root is a 32-byte sha256 output; a Solana Address is also
 * a 32-byte value. SAS's nonce parameter is typed as Address, so the
 * root is used directly — no reinterpretation needed, just base58
 * re-encoding for the type system.
 */
export function digestRootToNonce(hex: string): Address {
  const bytes = Buffer.from(hex, "hex");
  if (bytes.length !== 32) {
    throw new Error(`digest_set_root must be 32 bytes, got ${bytes.length}`);
  }
  return address(bytesToBase58(bytes));
}

// Minimal base58 encoder (Bitcoin alphabet) so this module has no extra
// runtime dependency beyond sas-lib/@solana/kit, which re-export their
// own internally — swap for that internal encoder if you'd rather not
// duplicate it.
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function bytesToBase58(bytes: Buffer): string {
  let digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let leadingZeros = 0;
  for (const byte of bytes) {
    if (byte === 0) leadingZeros++;
    else break;
  }
  return (
    ALPHABET[0].repeat(leadingZeros) +
    digits
      .reverse()
      .map((d) => ALPHABET[d])
      .join("")
  );
}

export async function eventAuthorityAddress(): Promise<Address> {
  return deriveEventAuthorityAddress();
}

export {
  getCreateAttestationInstruction,
  getCloseAttestationInstruction,
  fetchSchema,
  serializeAttestationData,
  SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
  address,
};
