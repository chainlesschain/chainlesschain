// TEST ONLY: repository store/ports and local HMAC authorities, no production grant.
import fs from "node:fs";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import { EvolutionArtifactPorts } from "../../src/lib/evolution/evolution-artifact-ports.js";
import { evolutionDurableStoreConfiguration } from "./evolution-durable-store.js";

export function openArtifactByteFixture(
  directory,
  {
    Store = ArtifactStore,
    value = { text: "genuine bounded artifact bytes" },
  } = {},
) {
  const config = evolutionDurableStoreConfiguration(directory, {
    artifactTenantId: "bytes-artifacts",
    audience: "bytes-runtime",
  });
  const store = new Store({ dir: directory, now: config.clock });
  const ports = new EvolutionArtifactPorts({
    artifactStore: store,
    tenantId: "bytes-artifacts",
    audience: "bytes-runtime",
    now: config.clock,
    ...config.artifactAuthority,
  });
  const publication = ports.putCanonical("evolution-ledger-v2-journal", value, {
    purpose: "evolution-ledger",
    retention: "ledger",
  });
  const entries = fs
    .readFileSync(store._indexFile(), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const id = publication.ref.ref.slice("cc-evolution-artifact:".length);
  const entry = entries.find((entry) => entry.id === id);
  if (!entry)
    throw new Error("fixture could not find genuine artifact index entry");
  const target = store.storedPath(entry);
  const request = {
    tenantId: "bytes-artifacts",
    ledgerId: "bytes-ledger",
    epoch: "bytes-epoch",
    ref: publication.ref,
  };
  const resolver = ports.createEvolutionLedgerArtifactResolver({
    purpose: "evolution-ledger",
  });
  return {
    store,
    ports,
    publication,
    entry,
    target,
    request,
    read: () => resolver(request),
  };
}
