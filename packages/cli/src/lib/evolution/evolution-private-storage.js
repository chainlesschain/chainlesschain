import fs from "node:fs";
import { isUnmodifiedLocalUiEvolutionFileSystem } from "./evolution-windows-directory-durability.js";

export function evolutionPrivateStorageOptions(fsImpl) {
  // The production adapter only adds directory flushing; ACL operations still
  // use Node's original fs. Preserve explicit dependencies for custom ports.
  const production =
    fsImpl === fs || isUnmodifiedLocalUiEvolutionFileSystem(fsImpl);
  return {
    ...(production ? {} : { deps: { fs: fsImpl } }),
    failIfUnavailable: true,
  };
}
