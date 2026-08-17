/** A single file within a skill's resource manifest, as served over MCP. */
export interface SkillResource {
  uri: string;
  digest: string; // "sha256:<hex>"
}

/** The subset of an MCP skills/list entry ard-trust cares about. */
export interface SkillListEntry {
  uri: string;
  frontmatter: {
    name: string;
    [key: string]: unknown;
  };
  resources: SkillResource[];
}

/** ai-catalog.json trustManifest.attestations[] element (ard-spec v0.9). */
export interface Attestation {
  type: string;
  uri: string;
  mediaType?: string;
  digest?: string;
}

/** ai-catalog.json trustManifest.provenance[] element (ard-spec v0.9). */
export interface ProvenanceLink {
  relation: string;
  sourceId: string;
  sourceDigest?: string;
}

export interface TrustManifest {
  identity?: string;
  identityType?: string;
  attestations?: Attestation[];
  provenance?: ProvenanceLink[];
  signature?: string;
}

export interface CatalogEntry {
  identifier: string;
  displayName: string;
  type: string;
  url?: string;
  data?: Record<string, unknown>;
  capabilities?: string[];
  description?: string;
  representativeQueries?: string[];
  metadata?: Record<string, unknown>;
  trustManifest?: TrustManifest;
}

export interface AiCatalogManifest {
  specVersion: string;
  host: { displayName: string; identifier: string };
  entries: CatalogEntry[];
  collections?: unknown[];
}

export type ScanVerdict = "pass" | "fail";

export interface ScanResult {
  policy: string;
  verdict: ScanVerdict;
  findings: string[];
}

export interface DeployResult {
  digestSetRoot: string; // hex, no "sha256:" prefix
  attestationPda: string; // base58
  scan: ScanResult;
  txSignature: string;
}
