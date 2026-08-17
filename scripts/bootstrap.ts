#!/usr/bin/env -S npx tsx
/**
 * One-time setup: generate a devnet verifier keypair, fund it, and create
 * the on-chain SAS Credential + Schema ard-trust attests under.
 *
 * This is the piece README.md flagged as "not yet scripted" -- it's the
 * real createCredential/createSchema flow from sas-lib's own example
 * (attestation-flow-guides/src/kit/sas-standard-kit-demo.ts), adapted to
 * a persistent file-based keypair instead of an ephemeral one.
 *
 * Usage: npx tsx scripts/bootstrap.ts
 */
import { writeFile, mkdir, access } from "node:fs/promises";
import { randomBytes, webcrypto } from "node:crypto";
import { createKeyPairFromPrivateKeyBytes } from "@solana/kit";
import { deriveCredentialPda, deriveSchemaPda, getCreateCredentialInstruction, getCreateSchemaInstruction } from "sas-lib";
import { createClient, ensureFunded, sendAndConfirmInstructions } from "../src/chain.js";
import { loadSigner } from "../src/solana.js";

const CLUSTER = process.env.ARD_SOLANA_CLUSTER ?? "devnet";
const KEYPAIR_PATH = ".devnet/verifier.json";
const CREDENTIAL_NAME = "kpj2006-ard-trust";
const SCHEMA_NAME = "ard.attestation.v1";
const SCHEMA_VERSION = 1;

// root, verdict, policy -- all encoded as Borsh strings (type code 12).
// See src/utils reference: compactLayoutMapping in sas-lib.
const SCHEMA_FIELDS = ["root", "verdict", "policy"];
const SCHEMA_LAYOUT = Buffer.from([12, 12, 12]);

async function main() {
  const client = createClient(CLUSTER);

  await mkdir(".devnet", { recursive: true });

  const alreadyExists = await access(KEYPAIR_PATH).then(() => true).catch(() => false);
  if (alreadyExists) {
    console.log(`1. Reusing existing keypair at ${KEYPAIR_PATH}...`);
  } else {
    console.log(`1. Generating verifier keypair (devnet)...`);
    // generateKeyPairSigner() produces a non-extractable CryptoKeyPair, so
    // we can't persist it. Instead: make our own 32-byte seed, derive an
    // *extractable* keypair from it, export the public key, and write the
    // standard 64-byte [seed..., pubkey...] Solana keypair.json format --
    // the same format loadSigner() (src/solana.ts) already reads.
    const seed = randomBytes(32);
    const { publicKey } = await createKeyPairFromPrivateKeyBytes(seed, /* extractable */ true);
    const pubKeyBytes = new Uint8Array(await webcrypto.subtle.exportKey("raw", publicKey));
    const secretKeyBytes = [...seed, ...pubKeyBytes];
    await writeFile(KEYPAIR_PATH, JSON.stringify(secretKeyBytes));
  }

  const verifier = await loadSigner(KEYPAIR_PATH);
  console.log(`   address: ${verifier.address}`);

  console.log(`\n2. Requesting devnet airdrop...`);
  await ensureFunded(client, verifier.address);

  console.log(`\n3. Creating Credential "${CREDENTIAL_NAME}"...`);
  const [credentialPda] = await deriveCredentialPda({ authority: verifier.address, name: CREDENTIAL_NAME });
  const createCredentialIx = getCreateCredentialInstruction({
    payer: verifier,
    credential: credentialPda,
    authority: verifier,
    name: CREDENTIAL_NAME,
    signers: [verifier.address],
  });
  await sendAndConfirmInstructions(client, verifier, [createCredentialIx], "Credential created");
  console.log(`   credential PDA: ${credentialPda}`);

  console.log(`\n4. Creating Schema "${SCHEMA_NAME}" v${SCHEMA_VERSION}...`);
  const [schemaPda] = await deriveSchemaPda({ credential: credentialPda, name: SCHEMA_NAME, version: SCHEMA_VERSION });
  const createSchemaIx = getCreateSchemaInstruction({
    payer: verifier,
    authority: verifier,
    credential: credentialPda,
    schema: schemaPda,
    name: SCHEMA_NAME,
    description: "ard-trust skill/entry attestation: digest root, scan verdict, policy id",
    fieldNames: SCHEMA_FIELDS,
    layout: SCHEMA_LAYOUT,
  });
  await sendAndConfirmInstructions(client, verifier, [createSchemaIx], "Schema created");
  console.log(`   schema PDA: ${schemaPda}`);

  console.log(`\nDone. Add these to .env:\n`);
  console.log(`ARD_SOLANA_KEYPAIR=${KEYPAIR_PATH}`);
  console.log(`ARD_SOLANA_CLUSTER=${CLUSTER}`);
  console.log(`ARD_SAS_CREDENTIAL=${credentialPda}`);
  console.log(`ARD_SAS_SCHEMA=${schemaPda}`);
}

main().catch((err) => {
  console.error("bootstrap failed:", err);
  process.exit(1);
});
