import {
  installWindowsSandboxAdapterTestRoot,
  wrapWindowsSandboxAdapterGlobalTeardown,
} from "../helpers/windows-sandbox-adapter-temp-root.js";
import { installCanonicalWindowsTestTemp } from "../helpers/canonical-windows-test-temp.js";

export default function setupWindowsSandboxAdapterTempRoot() {
  // Vitest workers and child CLIs inherit this before any fixture allocation.
  const temporaryEnvironment = installCanonicalWindowsTestTemp();
  let state;
  try {
    state = installWindowsSandboxAdapterTestRoot();
  } catch (error) {
    temporaryEnvironment.teardown?.();
    throw error;
  }
  if (!state.installed && !temporaryEnvironment.installed) return undefined;
  return wrapWindowsSandboxAdapterGlobalTeardown(() => {
    try {
      state.teardown?.();
    } finally {
      temporaryEnvironment.teardown?.();
    }
  });
}
