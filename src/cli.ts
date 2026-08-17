#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { deploy } from "./commands/deploy.js";
import { revoke } from "./commands/revoke.js";
import { address } from "./solana.js";

const VERSION = "0.1.0";

const program = new Command();
program
  .name("ard-trust")
  .description("Solana-anchored attestation layer for MCP skills and ARD catalog entries.")
  .version(VERSION);

program
  .command("deploy")
  .description("Fetch, verify, scan, sign, anchor, and emit an attestation for a skill.")
  .requiredOption("--skill <uri>", "skill:// URI of the skill to attest, e.g. skill://pdf-filler/SKILL.md")
  .requiredOption("--catalog <path>", "path to the publisher's ai-catalog.json")
  .requiredOption("--entry <urn>", "urn:air:... identifier of the catalog entry to attest")
  .option(
    "--skip-authority",
    "DEMO ONLY: skip the _trust._agents.<domain> DNS check (e.g. you don't control DNS for a *.github.io demo site). Never use in production.",
    false,
  )
  .action(async (options) => {
    console.log(`  ard-trust v${VERSION}`);
    const config = loadConfig();
    console.log(`                          cluster: ${config.solanaCluster}`);
    if (options.skipAuthority) {
      console.log(`  [warn] --skip-authority set: publisher-authority check is DISABLED for this run.`);
    }
    try {
      const result = await deploy(config, {
        skillUri: options.skill,
        catalogPath: options.catalog,
        catalogIdentifier: options.entry,
        skipAuthority: options.skipAuthority,
        log: (step, detail) => console.log(`  [ok]   ${step.padEnd(11)} ${detail}`),
      });
      console.log(`  done. root ${result.digestSetRoot}, attestation ${result.attestationPda}`);
    } catch (err) {
      console.error(`  [fail] ${(err as Error).message}`);
      process.exitCode = 1;
    }
  });

program
  .command("revoke")
  .description("Revoke a previously written attestation.")
  .requiredOption("--root <hex>", "digest_set_root of the attestation to revoke")
  .requiredOption("--attestation <pda>", "base58 attestation PDA to close")
  .requiredOption("--reason <text>", "human-readable revocation reason, recorded off-chain")
  .action(async (options) => {
    const config = loadConfig();
    try {
      await revoke(config, {
        root: options.root,
        attestationPda: address(options.attestation),
        reason: options.reason,
        log: (message) => console.log(`  ${message}`),
      });
    } catch (err) {
      console.error(`  [fail] ${(err as Error).message}`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
