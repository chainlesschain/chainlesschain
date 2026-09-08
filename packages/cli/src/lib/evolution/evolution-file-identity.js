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
