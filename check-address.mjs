import { createKeyPairSignerFromBytes } from "@solana/kit";
import { readFileSync } from "node:fs";

const raw = JSON.parse(readFileSync(".devnet/verifier.json", "utf8"));
const signer = await createKeyPairSignerFromBytes(new Uint8Array(raw));
console.log("address:", signer.address);
