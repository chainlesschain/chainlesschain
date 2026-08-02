import { spawn } from "node:child_process";
import { renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const markerPath = process.env.CC_MCP_HEADERS_HELPER_TREE_MARKER;
const nonce = process.env.CC_MCP_HEADERS_HELPER_TREE_NONCE;
const mode = process.argv[2];

if (mode === "grandchild") {
  if (!markerPath || !nonce) {
    process.exitCode = 2;
  } else {
    const temporaryMarker = `${markerPath}.${process.pid}.tmp`;
    writeFileSync(
      temporaryMarker,
      JSON.stringify({
        nonce,
        parentPid: process.ppid,
        grandchildPid: process.pid,
      }),
      "utf8",
    );
    renameSync(temporaryMarker, markerPath);
    setInterval(() => {}, 1_000);
  }
} else {
  const fixturePath = fileURLToPath(import.meta.url);
  const grandchild = spawn(process.execPath, [fixturePath, "grandchild"], {
    detached: false,
    env: process.env,
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });
  grandchild.once("error", () => {
    process.exitCode = 3;
  });
  setInterval(() => {}, 1_000);
}
