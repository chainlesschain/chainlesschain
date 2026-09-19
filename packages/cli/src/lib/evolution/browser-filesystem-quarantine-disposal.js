import { types } from "node:util";

import { createBrowserDownloadArtifactDisposalAuthority } from "./browser-download-artifact-disposal-authority.js";
import { captureBrowserFilesystemQuarantineCustody } from "./browser-filesystem-quarantine-custody.js";

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !descriptor?.enumerable || !("value" in descriptor);
    })
  )
    throw new TypeError(`${label} has unexpected or accessor fields`);
}

export function createBrowserFilesystemQuarantineDisposalAuthority(options) {
  exact(
    options,
    ["descriptor", "custody", "authorize", "now"],
    "filesystem quarantine disposal composition",
  );
  const custody = captureBrowserFilesystemQuarantineCustody(options.custody);
  const disposeArtifact = custody.bindDisposalAuthority(options.descriptor);
  return createBrowserDownloadArtifactDisposalAuthority({
    descriptor: options.descriptor,
    authorize: options.authorize,
    disposeArtifact,
    now: options.now,
  });
}
