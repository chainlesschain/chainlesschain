// Test-only evaluator of the actual private cache functions. No production
// export or cache inspection capability is added to EvolutionArtifactPorts.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { types } from "node:util";

export function loadActualIndexCache() {
  const source = fs.readFileSync(
    new URL(
      "../../src/lib/evolution/evolution-artifact-ports.js",
      import.meta.url,
    ),
    "utf8",
  );
  const sourceSha256 = crypto.createHash("sha256").update(source).digest("hex");
  const constants = [
    "MAX_RETAINED_INDEX_LAYOUTS",
    "MAX_RETAINED_INDEX_ROWS",
    "MAX_RETAINED_INDEX_BYTES",
    "MAX_RETAINED_INDEX_MEMORY",
    "MAX_CANONICAL_DEPTH",
    "MAX_CANONICAL_NODES",
    "MAX_ARRAY_ENTRIES",
    "MAX_OBJECT_FIELDS",
    "MAX_KEY_CHARS",
    "MAX_STRING_CHARS",
    "MAX_INDEX_ENTRY_BYTES",
    "EVOLUTION_ARTIFACT_MAX_CANONICAL_BYTES",
    "EVOLUTION_ARTIFACT_MAX_INDEX_ENTRIES",
    "EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE",
    "EVOLUTION_ARTIFACT_STORE_FAILED_CODE",
    "EVOLUTION_ARTIFACT_INVALID_CODE",
  ];
  const definitions = constants
    .map((name) => {
      const matches = [
        ...source.matchAll(
          new RegExp(`(?:export )?const ${name} =\\s*[\\s\\S]*?;`, "g"),
        ),
      ];
      assert.equal(matches.length, 1, `unique constant ${name}`);
      return matches[0][0].replace(/^export /u, "");
    })
    .reverse()
    .join("\n");
  const between = (start, end) => {
    assert.equal(source.split(start).length, 2, `unique start ${start}`);
    assert.equal(source.split(end).length, 2, `unique end ${end}`);
    return source.slice(source.indexOf(start), source.indexOf(end));
  };
  const errorClass = between(
    "export class EvolutionArtifactPortError",
    "function isEvolutionArtifactPortError",
  ).replace("export class", "class");
  const helpers =
    between(
      "function artifactError(",
      "function frozenCanonicalClone(",
    ).replace("function canonicalJson(", "function originalCanonicalJson(") +
    "\nfunction canonicalJson(...args) { counts.canonical += 1; return originalCanonicalJson(...args); }";
  const cache = between(
    "function parsedIndexMemory(",
    "function readTrustedIndexSnapshot(",
  )
    .replaceAll(
      /((?:retainedIndexMemory|reservedIndexMemory) \+= [^;]+;)/gu,
      "$1 observeBudget();",
    )
    .replace(
      "reservedIndexMemory += memory;",
      "reservedIndexMemory += memory; observeReservation(prefix, memory);",
    );
  const result = new Function(
    "crypto",
    "Buffer",
    "isProxy",
    `
    const counts = { parse: 0, canonical: 0 };
    const JSON = Object.create(globalThis.JSON);
    JSON.parse = (...args) => { counts.parse += 1; return globalThis.JSON.parse(...args); };
    ${definitions}
    ${errorClass}
    ${helpers}
    const TRUSTED_INDEX_PARSES = new Map();
    let retainedIndexMemory = 0;
    let reservedIndexMemory = 0;
    let peakAccounted = 0;
    const reservations = [];
    function observeReservation(prefix, candidateMemory) {
      reservations.push({
        candidateMemory,
        pinnedCompactMemory: prefix?.memory || 0,
        pinnedHotMemory: prefix?.hot?.memory || 0,
        retainedIndexMemory,
        reservedIndexMemory,
        total: retainedIndexMemory + reservedIndexMemory,
      });
    }
    function observeBudget() {
      const total = retainedIndexMemory + reservedIndexMemory;
      if (total > MAX_RETAINED_INDEX_MEMORY) throw new Error('cache accounting exceeded budget');
      peakAccounted = Math.max(peakAccounted, total);
    }
    ${cache}
    return {
      run: reuseTrustedIndexParse,
      counts,
      dropHot: () => { for (const entry of TRUSTED_INDEX_PARSES.values()) downgradeTrustedIndexParse(entry); },
      state: () => ({
        layouts: TRUSTED_INDEX_PARSES.size, retainedIndexMemory, reservedIndexMemory, peakAccounted,
        reservations: reservations.map(entry => ({ ...entry })),
        sum: [...TRUSTED_INDEX_PARSES.values()].reduce((sum, entry) => sum + entry.memory + (entry.hot?.memory || 0), 0),
        compact: [...TRUSTED_INDEX_PARSES.values()].reduce((sum, entry) => sum + entry.memory, 0),
        hot: [...TRUSTED_INDEX_PARSES.values()].reduce((sum, entry) => sum + (entry.hot?.memory || 0), 0),
      })
    };
  `,
  )(crypto, Buffer, types.isProxy);
  return { ...result, sourceSha256 };
}
