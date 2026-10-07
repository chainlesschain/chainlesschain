// TEST ONLY: real repository ArtifactStore; configured authorities remain local.
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import { EvolutionArtifactPorts } from "../../src/lib/evolution/evolution-artifact-ports.js";
import { evolutionDurableStoreConfiguration } from "./evolution-durable-store.js";
export function openArtifactDirectoryPorts(
  directory,
  {
    artifactTenantId = "directory-artifacts",
    audience = "directory-runtime",
    Ports = EvolutionArtifactPorts,
  } = {},
) {
  const config = evolutionDurableStoreConfiguration(directory, {
    artifactTenantId,
    audience,
  });
  const store = new ArtifactStore({ dir: directory, now: config.clock });
  const ports = new Ports({
    artifactStore: store,
    tenantId: artifactTenantId,
    audience,
    now: config.clock,
    ...config.artifactAuthority,
  });
  return { store, ports };
}
