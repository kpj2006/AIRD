import type { ScanResult } from "./types.js";

export interface ScanPolicy {
  name: string;
  run(files: Array<{ uri: string; bytes: Uint8Array }>): Promise<string[]>; // findings
}

/**
 * Placeholder policy: real deployments plug in a static-analysis /
 * secret-scanning / policy-as-code engine here (e.g. Semgrep rules,
 * an allowed-tools allowlist check, a secrets scanner). ard-trust
 * itself does not decide what's safe — see
 * ard-trust-architecture.md §9 — it runs whatever policy the operator
 * configures via ARD_SCAN_POLICY and reports the verdict.
 */
export const defaultPolicy: ScanPolicy = {
  name: "default",
  async run() {
    return [];
  },
};

const registry = new Map<string, ScanPolicy>([["default", defaultPolicy]]);

export function registerPolicy(policy: ScanPolicy): void {
  registry.set(policy.name, policy);
}

export async function runScan(
  policyId: string,
  files: Array<{ uri: string; bytes: Uint8Array }>,
): Promise<ScanResult> {
  const policy = registry.get(policyId) ?? defaultPolicy;
  const findings = await policy.run(files);
  return {
    policy: policyId,
    verdict: findings.length === 0 ? "pass" : "fail",
    findings,
  };
}
