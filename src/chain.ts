import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  sendAndConfirmTransactionFactory,
  airdropFactory,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  assertIsFullySignedTransaction,
  assertIsTransactionWithinSizeLimit,
  lamports,
  type Address,
  type Instruction,
  type Signature,
  type TransactionSigner,
  type Rpc,
  type SolanaRpcApi,
  type RpcSubscriptions,
  type SolanaRpcSubscriptionsApi,
} from "@solana/kit";
import { clusterUrl } from "./config.js";

/**
 * Transaction plumbing, following the pattern in the official sas-lib
 * example (solana-attestation-service/examples/typescript/
 * attestation-flow-guides/src/kit/sas-standard-kit-demo.ts) minus its
 * compute-budget instructions -- these SAS instructions are small enough
 * that devnet's default compute limit is sufficient, and pulling in
 * @solana-program/compute-budget here conflicts with sas-lib's pinned
 * @solana/kit peer range.
 */
export interface Client {
  rpc: Rpc<SolanaRpcApi>;
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>;
}

function wssUrlFor(cluster: string): string {
  const http = clusterUrl(cluster);
  if (http.startsWith("https://api.")) return http.replace("https://api.", "wss://api.");
  return http.replace(/^http/, "ws");
}

export function createClient(cluster: string): Client {
  return {
    rpc: createSolanaRpc(clusterUrl(cluster)),
    rpcSubscriptions: createSolanaRpcSubscriptions(wssUrlFor(cluster)),
  };
}

export async function ensureFunded(client: Client, address: Address, minLamports = 500_000_000n): Promise<void> {
  const { value: balance } = await client.rpc.getBalance(address).send();
  if (balance >= minLamports) return;
  const airdrop = airdropFactory(client);
  const sig = await airdrop({
    commitment: "confirmed",
    lamports: lamports(1_000_000_000n),
    recipientAddress: address,
  });
  console.log(`  airdrop: ${sig}`);
}

export async function sendAndConfirmInstructions(
  client: Client,
  payer: TransactionSigner<string>,
  instructions: Instruction[],
  description: string,
): Promise<Signature> {
  const { value: latestBlockhash } = await client.rpc.getLatestBlockhash().send();

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(payer, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions(instructions, tx),
  );

  const signedTransaction = await signTransactionMessageWithSigners(message);
  assertIsFullySignedTransaction(signedTransaction);
  assertIsTransactionWithinSizeLimit(signedTransaction);

  const signature = getSignatureFromTransaction(signedTransaction);

  const sendAndConfirm = sendAndConfirmTransactionFactory(client);
  await sendAndConfirm(signedTransaction, { commitment: "confirmed" });

  console.log(`  ${description} -> ${signature}`);
  return signature;
}
