/**
 * Stable file identity checks for packer transactions.
 *
 * Node 22.12 ships libuv 1.49.1. On affected Windows hosts, lstat(path)
 * can project a different device value than fstat(fd) for the same file.
 * Never drop the volume/file-index check to bridge that incompatibility.
 * Instead, reopen the pathname and compare the two handle identities exactly;
 * the path API is then used to prove that the non-link pathname stayed stable
 * around that second open. Only the known libuv 1.49/1.50 device projection
 * mismatch is tolerated between path and handle samples.
 */

import fs from "node:fs";
import {
  samePathHandleFileIdentity,
  withTrustedFileParentSync,
} from "../secure-file-identity.js";

const BIGINT_STAT_OPTIONS = Object.freeze({ bigint: true });
const FULL_STATE_FIELDS = Object.freeze([
  "mode",
  "nlink",
  "size",
  "mtimeNs",
  "ctimeNs",
]);

export function hasPreciseFileIdentity(stat) {
  return Boolean(
    stat &&
    typeof stat.dev === "bigint" &&
    stat.dev >= 0n &&
    typeof stat.ino === "bigint" &&
    stat.ino > 0n,
  );
}

export function sameOpenedFileIdentity(left, right, stateFields = []) {
  return Boolean(
    hasPreciseFileIdentity(left) &&
    hasPreciseFileIdentity(right) &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    stateFields.every(
      (field) =>
        FULL_STATE_FIELDS.includes(field) && left[field] === right[field],
    ),
  );
}

function isRegularNonLink(stat) {
  return Boolean(
    stat &&
    typeof stat.isSymbolicLink === "function" &&
    !stat.isSymbolicLink() &&
    typeof stat.isFile === "function" &&
    stat.isFile(),
  );
}

/**
 * Prove that filePath still names expectedIdentity.
 *
 * expectedIdentity must come from an opened descriptor. On Windows, the
 * pathname is reopened and its fstat identity is compared exactly with that
 * descriptor identity, retaining both the volume serial (dev) and file index
 * (ino). Path samples before and after the open must also remain byte-for-byte
 * stable across all identity/mutation fields.
 */
export function pathMatchesOpenedFileIdentitySync(
  filePath,
  expectedIdentity,
  { fileSystem = fs, runtime = undefined, stateFields = [] } = {},
) {
  if (!hasPreciseFileIdentity(expectedIdentity)) return false;
  if (
    !Array.isArray(stateFields) ||
    stateFields.some((field) => !FULL_STATE_FIELDS.includes(field))
  ) {
    return false;
  }

  try {
    return withTrustedFileParentSync(
      fileSystem,
      filePath,
      ({ canonicalPath, parentDevice }) => {
        // The independently opened parent/volume-root authority prevents the
        // affected Windows bridge from accepting an attacker-selected device.
        if (String(expectedIdentity.dev) !== String(parentDevice)) return false;

        const noFollow = Number(fileSystem.constants?.O_NOFOLLOW || 0);
        const readOnly = Number(
          fileSystem.constants?.O_RDONLY ?? fs.constants.O_RDONLY,
        );
        let descriptor = null;
        try {
          const pathBefore = fileSystem.lstatSync(
            canonicalPath,
            BIGINT_STAT_OPTIONS,
          );
          if (!isRegularNonLink(pathBefore)) return false;

          descriptor = fileSystem.openSync(canonicalPath, readOnly | noFollow);
          const openedBefore = fileSystem.fstatSync(
            descriptor,
            BIGINT_STAT_OPTIONS,
          );
          if (
            !openedBefore.isFile() ||
            !sameOpenedFileIdentity(
              expectedIdentity,
              openedBefore,
              stateFields,
            ) ||
            !samePathHandleFileIdentity(
              pathBefore,
              openedBefore,
              parentDevice,
              runtime,
            )
          ) {
            return false;
          }

          const openedAfter = fileSystem.fstatSync(
            descriptor,
            BIGINT_STAT_OPTIONS,
          );
          const pathAfter = fileSystem.lstatSync(
            canonicalPath,
            BIGINT_STAT_OPTIONS,
          );
          return Boolean(
            openedAfter.isFile() &&
            isRegularNonLink(pathAfter) &&
            sameOpenedFileIdentity(
              openedBefore,
              openedAfter,
              FULL_STATE_FIELDS,
            ) &&
            sameOpenedFileIdentity(
              expectedIdentity,
              openedAfter,
              stateFields,
            ) &&
            sameOpenedFileIdentity(pathBefore, pathAfter, FULL_STATE_FIELDS) &&
            samePathHandleFileIdentity(
              pathAfter,
              openedAfter,
              parentDevice,
              runtime,
            ),
          );
        } finally {
          if (descriptor !== null) {
            try {
              fileSystem.closeSync(descriptor);
            } catch {
              /* the surrounding identity result remains authoritative */
            }
          }
        }
      },
      { runtime },
    );
  } catch {
    return false;
  }
}
