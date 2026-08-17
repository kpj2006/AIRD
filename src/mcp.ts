import type { SkillListEntry } from "./types.js";

/**
 * Minimal MCP client for what ard-trust needs: reading a skill's
 * resource manifest and fetching individual file bytes. This is not a
 * general-purpose MCP SDK — for anything beyond skills/resources, use
 * the official TypeScript SDK (@modelcontextprotocol/sdk) instead.
 *
 * Talks JSON-RPC 2.0 over the server's streamable-HTTP endpoint, per
 * the MCP base spec. Skill listing follows the skills-over-MCP
 * extension (SEP-2640) shape referenced in ard-trust-architecture.md.
 */
export class McpSkillClient {
  private nextId = 1;

  constructor(private readonly serverUrl: string) {}

  private async call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const res = await fetch(this.serverUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params }),
    });
    if (!res.ok) {
      throw new Error(`MCP server ${this.serverUrl} returned ${res.status} for ${method}`);
    }
    const body = (await res.json()) as { result?: T; error?: { message: string } };
    if (body.error) {
      throw new Error(`MCP error calling ${method}: ${body.error.message}`);
    }
    if (body.result === undefined) {
      throw new Error(`MCP response for ${method} had no result`);
    }
    return body.result;
  }

  /** Fetch a single skill's resource manifest by its skill:// URI. */
  async getSkill(skillUri: string): Promise<SkillListEntry> {
    const result = await this.call<{ contents: Array<{ uri: string; text: string }> }>(
      "resources/read",
      { uri: skillUri },
    );
    const content = result.contents[0];
    if (!content) {
      throw new Error(`No content returned for ${skillUri}`);
    }
    return JSON.parse(content.text) as SkillListEntry;
  }

  /** Fetch raw bytes for one file within a skill, for digest verification. */
  async readResourceBytes(uri: string): Promise<Uint8Array> {
    const result = await this.call<{ contents: Array<{ uri: string; blob?: string; text?: string }> }>(
      "resources/read",
      { uri },
    );
    const content = result.contents[0];
    if (!content) {
      throw new Error(`No content returned for ${uri}`);
    }
    if (content.blob) {
      return Buffer.from(content.blob, "base64");
    }
    return Buffer.from(content.text ?? "", "utf8");
  }
}
