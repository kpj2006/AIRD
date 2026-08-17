import "dotenv/config";

export interface ArdTrustConfig {
  publisherDomain: string;
  mcpServerUrl: string;
  solanaCluster: string;
  solanaKeypairPath: string;
  sasCredential: string;
  sasSchema: string;
  scanPolicy: string;
  dsseKey: string;
  indexerUrl: string;
  revocationWatch: boolean;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. See .env.example.`,
    );
  }
  return value;
}

/**
 * Everything the CLI needs lives in the environment — no config file,
 * no dashboard. See ard-trust-architecture.md §5 ("Configure once").
 */
export function loadConfig(): ArdTrustConfig {
  return {
    publisherDomain: required("ARD_PUBLISHER_DOMAIN"),
    mcpServerUrl: required("ARD_MCP_SERVER_URL"),
    solanaCluster: process.env.ARD_SOLANA_CLUSTER ?? "devnet",
    solanaKeypairPath: required("ARD_SOLANA_KEYPAIR"),
    sasCredential: required("ARD_SAS_CREDENTIAL"),
    sasSchema: process.env.ARD_SAS_SCHEMA ?? "ard.attestation.v1",
    scanPolicy: process.env.ARD_SCAN_POLICY ?? "default",
    dsseKey: process.env.ARD_DSSE_KEY ?? required("ARD_SOLANA_KEYPAIR"),
    indexerUrl: process.env.ARD_INDEXER_URL ?? "",
    revocationWatch: (process.env.ARD_REVOCATION_WATCH ?? "false") === "true",
  };
}

export function clusterUrl(cluster: string): string {
  switch (cluster) {
    case "devnet":
      return "https://api.devnet.solana.com";
    case "testnet":
      return "https://api.testnet.solana.com";
    case "mainnet-beta":
      return "https://api.mainnet-beta.solana.com";
    default:
      // Allow passing a raw RPC URL directly.
      return cluster;
  }
}
