import fs from "node:fs";
import { isUnmodifiedLocalUiEvolutionFileSystem } from "./evolution-windows-directory-durability.js";

export function isProductionEvolutionFileSystem(fsImpl) {
  return fsImpl === fs || isUnmodifiedLocalUiEvolutionFileSystem(fsImpl);
}

export function evolutionPrivateStorageOptions(fsImpl, { file = false } = {}) {
  // The production adapter only adds directory flushing; ACL operations still
  // use Node's original fs. Preserve explicit dependencies for custom ports.
  const production = isProductionEvolutionFileSystem(fsImpl);
  return {
    ...(production ? {} : { deps: { fs: fsImpl } }),
    // An elevated Windows token can give a new file its administrator-group
    // owner even when its DACL inherits only the user's private directory rule.
    // Explicit repair binds both the file owner and ACL to the current user.
    ...(file ? { applyWindowsAcl: true } : {}),
    failIfUnavailable: true,
  };
}
