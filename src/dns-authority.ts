import { resolveTxt } from "node:dns/promises";

const RECORD_PREFIX = "v=ard-trust1;";

/**
 * "Is it the same publisher?" (ard-trust-architecture.md §6).
 *
 * Looks up _trust._agents.<domain> TXT, in the same DNS namespace ARD
 * already uses for _catalog._agents.<domain> and
 * _search._agents.<domain> (ard-docs/how_to_publish.md), rather than
 * inventing a separate prefix.
 *
 * Record shape: "v=ard-trust1; key=<solana-pubkey-base58>"
 */
export async function resolveAuthorizedSigner(domain: string): Promise<string | null> {
  const host = `_trust._agents.${domain}`;
  let records: string[][];
  try {
    records = await resolveTxt(host);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOTFOUND") {
      return null;
    }
    throw err;
  }

  for (const chunks of records) {
    const value = chunks.join("");
    if (!value.startsWith(RECORD_PREFIX)) continue;
    const match = /key=([1-9A-HJ-NP-Za-km-z]+)/.exec(value);
    if (match) return match[1];
  }
  return null;
}

/**
 * The three-way authority check from ard-trust-architecture.md §6:
 * catalog identifier's publisher, the DNS-declared signer, and the
 * on-chain signer must all agree, or nothing is written.
 */
export async function verifyAuthority(params: {
  publisherDomain: string;
  onChainSigner: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const declared = await resolveAuthorizedSigner(params.publisherDomain);
  if (!declared) {
    return {
      ok: false,
      reason: `No _trust._agents.${params.publisherDomain} TXT record found`,
    };
  }
  if (declared !== params.onChainSigner) {
    return {
      ok: false,
      reason: `authority _trust._agents.${params.publisherDomain} TXT != signer ${params.onChainSigner}`,
    };
  }
  return { ok: true };
}
