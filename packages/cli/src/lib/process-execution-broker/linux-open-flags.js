// Linux defines O_TMPFILE as __O_TMPFILE | O_DIRECTORY. O_DIRECTORY is
// architecture-specific (0x4000 on ARM64, 0x10000 on x64), while Node does
// not expose O_TMPFILE on every supported build.
const LINUX_ANONYMOUS_TMPFILE_BIT = 0x400000;

export function linuxTmpfileFlag(constants) {
  const directoryFlag = constants?.O_DIRECTORY;
  if (
    !Number.isSafeInteger(directoryFlag) ||
    directoryFlag <= 0 ||
    (directoryFlag & (directoryFlag - 1)) !== 0
  ) {
    throw new Error("linux_o_directory_unavailable");
  }

  const fallbackFlag = LINUX_ANONYMOUS_TMPFILE_BIT | directoryFlag;
  const tmpfileFlag = constants.O_TMPFILE ?? fallbackFlag;
  if (
    !Number.isSafeInteger(tmpfileFlag) ||
    (tmpfileFlag & LINUX_ANONYMOUS_TMPFILE_BIT) === 0 ||
    (tmpfileFlag & directoryFlag) !== directoryFlag
  ) {
    throw new Error("linux_o_tmpfile_invalid");
  }
  return tmpfileFlag;
}
