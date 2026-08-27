import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("WebRTC handler extraction", () => {
  it("removes the legacy unbounded background implementation", () => {
    const background = readFileSync(
      resolve(process.cwd(), "src/main/remote/browser-extension/background.js"),
      "utf8",
    );
    const registry = readFileSync(
      resolve(
        process.cwd(),
        "src/main/remote/browser-extension/handlers/index.js",
      ),
      "utf8",
    );

    expect(background).not.toContain('case "webrtc.getPeerConnections"');
    expect(background).not.toContain('case "webrtc.monitorConnection"');
    expect(background).not.toContain(
      "async function getWebRTCPeerConnections(",
    );
    expect(background).not.toContain(
      "async function getWebRTCConnectionStats(",
    );
    expect(background).not.toContain("async function monitorWebRTCConnection(");
    expect(background).not.toContain("async function closeWebRTCConnection(");
    expect(registry).toContain('import { webRTCHandlers } from "./webrtc.js"');
    expect(registry).toContain("...webRTCHandlers");
  });
});
