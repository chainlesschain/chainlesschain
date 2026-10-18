/** Stable manifest windows; no retention, installation or graph grant. */
import path from "node:path";
import {
  createEvolutionPhysicalStateReader,
  captureEvolutionPhysicalStateReaderDirectoryBoundary,
} from "./evolution-physical-state-reader.js";

const DIRECTORY_BOUNDARIES = new WeakMap();

export const EVOLUTION_MANIFEST_STATE_READ_FAILED_CODE =
  "CC_EVOLUTION_MANIFEST_STATE_READ_FAILED";

export function createEvolutionManifestStateReader({
  file,
  fsImpl,
  maximumBytes,
  label,
}) {
  if (
    typeof file !== "string" ||
    !path.isAbsolute(file) ||
    path.resolve(file) !== file ||
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1 ||
    typeof label !== "string" ||
    !label ||
    !fsImpl
  )
    throw new TypeError(
      "manifest state reader requires a canonical file, filesystem and byte limit",
    );
  const reader = createEvolutionPhysicalStateReader({
    directoryPath: path.dirname(file),
    fsImpl,
    maximumBytes,
    label,
    errorCode: EVOLUTION_MANIFEST_STATE_READ_FAILED_CODE,
  });
  const stateReader = Object.freeze({
    read: () => reader.read(file, { allowAbsent: true }),
    recheck: reader.recheck,
  });
  DIRECTORY_BOUNDARIES.set(
    stateReader,
    captureEvolutionPhysicalStateReaderDirectoryBoundary(reader),
  );
  return stateReader;
}

export function captureEvolutionManifestStateReaderDirectoryBoundary(reader) {
  if (arguments.length !== 1)
    throw new TypeError("manifest directory capture takes one original reader");
  const boundary = DIRECTORY_BOUNDARIES.get(reader);
  if (!boundary)
    throw new TypeError("an original manifest state reader is required");
  boundary.recheck();
  return boundary;
}
