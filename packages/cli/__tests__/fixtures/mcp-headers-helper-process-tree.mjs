import { spawn } from "node:child_process";
import { renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const markerPath = process.env.CC_MCP_HEADERS_HELPER_TREE_MARKER;
const nonce = process.env.CC_MCP_HEADERS_HELPER_TREE_NONCE;
const mode = process.argv[2];

if (mode === "grandchild") {
  setInterval(() => {}, 1_000);
} else {
  const publishedMarkerPath = process.argv[2] || markerPath;
  const publishedNonce = process.argv[3] || nonce;
  if (!publishedMarkerPath || !publishedNonce) {
    process.exitCode = 2;
  } else {
    const fixturePath = fileURLToPath(import.meta.url);
    const grandchild = spawn(process.execPath, [fixturePath, "grandchild"], {
      detached: false,
      env: process.env,
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    grandchild.once("spawn", () => {
      const temporaryMarker = `${publishedMarkerPath}.${process.pid}.tmp`;
      writeFileSync(
        temporaryMarker,
        JSON.stringify({
          nonce: publishedNonce,
          parentPid: process.pid,
          grandchildPid: grandchild.pid,
        }),
        "utf8",
      );
      renameSync(temporaryMarker, publishedMarkerPath);
    });
    grandchild.once("error", () => {
      process.exitCode = 3;
    });
    setInterval(() => {}, 1_000);
  }
}
