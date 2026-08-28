import { describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  DID_INVITATION_PROTOCOL,
  MAX_DID_INVITATION_BYTES,
  MAX_CONCURRENT_DID_INVITATION_STREAMS,
  DIDInvitationManager,
} = require("../did-invitation-manager.js");

function createManager() {
  const node = {
    handle: vi.fn().mockResolvedValue(undefined),
    unhandle: vi.fn().mockResolvedValue(undefined),
  };
  const manager = new DIDInvitationManager({ exec: vi.fn() }, {}, { node }, {});
  return { manager, node };
}

describe("DIDInvitationManager lifecycle", () => {
  it("registers one stable protocol handler and detaches it idempotently", async () => {
    const { manager, node } = createManager();
    manager.registerP2PHandlers();
    expect(node.handle).toHaveBeenCalledTimes(1);
    expect(node.handle).toHaveBeenCalledWith(
      DID_INVITATION_PROTOCOL,
      manager.protocolHandler,
    );

    await manager.close();
    await manager.close();
    expect(node.unhandle).toHaveBeenCalledTimes(1);
    expect(node.unhandle).toHaveBeenCalledWith(DID_INVITATION_PROTOCOL);
  });

  it("rejects an oversized protocol stream before invitation handling", async () => {
    const { manager, node } = createManager();
    manager.handleIncomingInvitation = vi.fn();
    const abort = vi.fn().mockResolvedValue(undefined);
    const stream = {
      source: (async function* () {
        yield new Uint8Array(MAX_DID_INVITATION_BYTES);
        yield new Uint8Array(1);
      })(),
      write: vi.fn(),
      close: vi.fn(),
      abort,
    };
    const handler = node.handle.mock.calls[0][1];

    await handler({
      stream,
      connection: { remotePeer: { toString: () => "peer-1" } },
    });
    expect(manager.handleIncomingInvitation).not.toHaveBeenCalled();
    expect(stream.write).not.toHaveBeenCalled();
    expect(abort).toHaveBeenCalledWith(
      expect.objectContaining({ code: "OVERLOADED" }),
    );
    await manager.close();
  });

  it("rejects protocol streams above the concurrent admission limit", async () => {
    const { manager, node } = createManager();
    for (
      let index = 0;
      index < MAX_CONCURRENT_DID_INVITATION_STREAMS;
      index++
    ) {
      manager.inFlightHandlers.add(new Promise(() => {}));
    }
    const abort = vi.fn().mockResolvedValue(undefined);
    const handler = node.handle.mock.calls[0][1];

    handler({ stream: { abort }, connection: {} });
    expect(abort).toHaveBeenCalledWith(
      expect.objectContaining({ code: "OVERLOADED" }),
    );

    manager.inFlightHandlers.clear();
    await manager.close();
  });
});
