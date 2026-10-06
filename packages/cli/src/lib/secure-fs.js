// One owner-only path/ACL implementation shared by CLI and native desktop hosts.
import storage from "@chainlesschain/session-core/private-storage";
export const {
  PRIVATE_DIRECTORY_MODE,
  PRIVATE_FILE_MODE,
  assertSafeOwnerOnlyPath,
  _deps,
  _windowsAclWorkingDirectory,
  _resolveWindowsAclTimeout,
  inspectPrivatePaths,
  repairPrivatePaths,
  inspectPrivatePath,
  repairPrivatePath,
  ensurePrivateDirectory,
  ensurePrivateFile,
} = storage;
