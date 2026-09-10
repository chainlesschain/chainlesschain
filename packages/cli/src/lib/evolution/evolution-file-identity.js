import path from "node:path";

import {
  isAffectedWindowsZeroDeviceStatRuntime,
  sameFileStatIdentity,
  samePathHandleFileIdentity,
  samePathHandleStableFileIdentity,
  withTrustedFileParentSync,
} from "../secure-file-identity.js";

// Keep ordinary same-API comparisons exact. Only affected Windows runtimes
// bridge path/handle device projections, with a separately held directory
// device; neither file inode nor mutation metadata is relaxed.
export function withEvolutionFileIdentity(
  fsImpl,
  filePath,
  operation,
  runtime = undefined,
) {
  if (!isAffectedWindowsZeroDeviceStatRuntime(runtime)) {
    return operation(sameFileStatIdentity, (pathStat, handleStat) =>
      samePathHandleStableFileIdentity(
        pathStat,
        handleStat,
        pathStat.dev,
        runtime,
      ),
    );
  }
  return withTrustedFileParentSync(
    fsImpl,
    filePath,
    ({ parentDevice }) =>
      operation(
        (pathStat, handleStat) =>
          samePathHandleFileIdentity(
            pathStat,
            handleStat,
            parentDevice,
            runtime,
          ),
        (pathStat, handleStat) =>
          samePathHandleStableFileIdentity(
            pathStat,
            handleStat,
            parentDevice,
            runtime,
          ),
      ),
    { runtime },
  );
}

// Verify any number of children while holding one authenticated parent
// directory identity. This keeps the affected Windows/libuv device bridge
// exact without reopening the volume root and parent once per child.
export function withEvolutionDirectoryFileIdentity(
  fsImpl,
  directoryPath,
  operation,
  runtime = undefined,
) {
  if (typeof operation !== "function") {
    throw new TypeError("evolution directory identity operation is required");
  }
  const sentinel = path.join(path.resolve(directoryPath), ".identity-scope");
  return withTrustedFileParentSync(
    fsImpl,
    sentinel,
    ({ parentDevice, parentPath }) =>
      operation(
        isAffectedWindowsZeroDeviceStatRuntime(runtime)
          ? (pathStat, handleStat) =>
              samePathHandleFileIdentity(
                pathStat,
                handleStat,
                parentDevice,
                runtime,
              )
          : sameFileStatIdentity,
        (pathStat, handleStat) =>
          samePathHandleStableFileIdentity(
            pathStat,
            handleStat,
            parentDevice,
            runtime,
          ),
        Object.freeze({ parentPath }),
      ),
    { runtime },
  );
}
