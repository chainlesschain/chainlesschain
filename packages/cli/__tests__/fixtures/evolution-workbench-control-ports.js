import { revocationTestMutationAuthorities } from "./skill-revocation-release-registry.js";

// Only external TEST authorities are assembled here. The genuine production
// factory constructs request/capability/controller and same-Ledger audit ports.
export function workbenchControlOptions(h, fileResources, overrides = {}) {
  return {
    descriptor: fileResources.runtimeResources.descriptor,
    fileResources,
    candidateRegistry: h.release.candidateRegistry,
    ...revocationTestMutationAuthorities(),
    ...overrides,
  };
}
