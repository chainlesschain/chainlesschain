import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";

// Execute the actual pre-bundle port, not a modern port configured to imitate
// it. Only import URLs change; the authority, writer and collector stay frozen.
export async function loadLegacySegmentedMemoryPort() {
  const bytes = fs.readFileSync(
    new URL("../fixtures/segmented-memory-port-e7.mjs.txt", import.meta.url),
  );
  const provenance = JSON.parse(
    fs.readFileSync(
      new URL(
        "../fixtures/segmented-memory-port-e7.provenance.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(
    provenance.sourceCommit,
    "e7a6f2585d62949794596767869423b0eb670104",
  );
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    provenance.sha256,
  );
  // Preserve the old dependency behavior as well as the old class. A future
  // dependency edit must not silently turn this evidence into a hybrid port.
  for (const dependency of provenance.dependencies) {
    const dependencyBytes = fs.readFileSync(
      new URL(`../../../../${dependency.path}`, import.meta.url),
    );
    const blob = createHash("sha1")
      .update(`blob ${dependencyBytes.length}\0`)
      .update(dependencyBytes)
      .digest("hex");
    assert.equal(
      blob,
      dependency.gitBlob,
      `Legacy dependency changed: ${dependency.path}`,
    );
  }
  const imports = [
    [
      "@chainlesschain/context-memory-kernel",
      import.meta.resolve("@chainlesschain/context-memory-kernel"),
    ],
    ...[
      "durable-memory-port.js",
      "memory-query-index.js",
      "memory-query-control.js",
      "memory-shard-snapshots.js",
    ].map((name) => [
      `./${name}`,
      new URL(`../../src/lib/context-memory-kernel/${name}`, import.meta.url)
        .href,
    ]),
  ];
  let source = bytes.toString("utf8");
  for (const [specifier, url] of imports) {
    const token = `from ${JSON.stringify(specifier)}`;
    assert.equal(
      source.split(token).length,
      2,
      "Legacy import binding changed",
    );
    source = source.replace(token, `from ${JSON.stringify(url)}`);
  }
  const module = await import(
    /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );
  return module.SegmentedMemoryPort;
}
