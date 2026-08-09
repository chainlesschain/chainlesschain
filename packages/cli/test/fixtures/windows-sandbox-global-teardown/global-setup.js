import fs from "node:fs";
import path from "node:path";
import {
  installWindowsSandboxAdapterTestRoot,
  wrapWindowsSandboxAdapterGlobalTeardown,
} from "../../helpers/windows-sandbox-adapter-temp-root.js";

export default function setupWindowsSandboxContractRoot() {
  const injectLockedHelper =
    process.env.CC_WINDOWS_SANDBOX_CONTRACT_MODE === "locked";
  const fsApi = injectLockedHelper
    ? {
        ...fs,
        unlinkSync(targetPath) {
          if (path.basename(targetPath) === "windows-sandbox-helper.exe") {
            throw Object.assign(
              new Error("injected locked Windows sandbox helper"),
              { code: "EBUSY" },
            );
          }
          return fs.unlinkSync(targetPath);
        },
      }
    : fs;
  const state = installWindowsSandboxAdapterTestRoot({ fsApi });
  const ownerPath = process.env.CC_WINDOWS_SANDBOX_CONTRACT_OWNER;
  if (state.installed && ownerPath) {
    try {
      fs.writeFileSync(ownerPath, `${JSON.stringify(state.capture)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
    } catch (error) {
      state.teardown();
      throw error;
    }
  }
  return state.installed
    ? wrapWindowsSandboxAdapterGlobalTeardown(state.teardown)
    : undefined;
}
