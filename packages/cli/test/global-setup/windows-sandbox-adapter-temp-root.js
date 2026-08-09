import {
  installWindowsSandboxAdapterTestRoot,
  wrapWindowsSandboxAdapterGlobalTeardown,
} from "../helpers/windows-sandbox-adapter-temp-root.js";

export default function setupWindowsSandboxAdapterTempRoot() {
  const state = installWindowsSandboxAdapterTestRoot();
  return state.installed
    ? wrapWindowsSandboxAdapterGlobalTeardown(state.teardown)
    : undefined;
}
