#!/usr/bin/env -S npx tsx
/**
 * A minimal local MCP JSON-RPC server for the ard-trust demo. Serves the
 * REAL, currently-published pdf-filler skill file (the same bytes live at
 * https://kpj2006.github.io/ard-demo/resources/pdf-filler.md) over
 * resources/read, so `ard-trust deploy` verifies and attests genuine
 * content rather than a hardcoded fixture.
 *
 * This stands in for a real MCP server implementation -- ard-trust's
 * mcp.ts client only needs resources/read to behave per the base MCP
 * spec, which this does.
 *
 * Usage: npx tsx scripts/mcp-stub-server.ts [port]
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8765);
const SKILL_FILE_PATH = path.resolve("../kpj2006.github.io/ard-demo/resources/pdf-filler.md");
const SKILL_INDEX_URI = "skill://pdf-filler/index.json";
const SKILL_FILE_URI = "skill://pdf-filler/SKILL.md";

function sha256(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function main() {
  const fileBytes = await readFile(SKILL_FILE_PATH);
  const fileDigest = sha256(fileBytes);
  console.log(`Serving real file: ${SKILL_FILE_PATH}`);
  console.log(`  digest: ${fileDigest}`);

  const skillIndexJson = JSON.stringify({
    uri: SKILL_INDEX_URI,
    frontmatter: { name: "pdf-filler" },
    resources: [{ uri: SKILL_FILE_URI, digest: fileDigest }],
  });

  const server = createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const rpc = JSON.parse(body);
        console.log(`  [mcp-stub] ${rpc.method} ${JSON.stringify(rpc.params ?? {})}`);

        if (rpc.method !== "resources/read") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, error: { message: `Unknown method ${rpc.method}` } }));
          return;
        }

        const uri = rpc.params?.uri;
        let contents;
        if (uri === SKILL_INDEX_URI) {
          contents = [{ uri, text: skillIndexJson }];
        } else if (uri === SKILL_FILE_URI) {
          contents = [{ uri, text: fileBytes.toString("utf8") }];
        } else {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, error: { message: `No such resource: ${uri}` } }));
          return;
        }

        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { contents } }));
      } catch (err) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { message: String(err) } }));
      }
    });
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`\nMCP stub listening on http://127.0.0.1:${PORT}`);
    console.log(`  skill index: ${SKILL_INDEX_URI}`);
    console.log(`  ARD_MCP_SERVER_URL=http://127.0.0.1:${PORT}`);
    console.log(`  --skill ${SKILL_INDEX_URI}\n`);
  });
}

main().catch((err) => {
  console.error("mcp-stub-server failed:", err);
  process.exit(1);
});
