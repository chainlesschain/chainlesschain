const { EventEmitter } = require("node:events");
const { PythonBridge } = require("../python-bridge");

describe("PythonBridge process boundary", () => {
  it("routes probes and tool calls through literal-argv Desktop Broker facades", async () => {
    const spawnSyncProcess = vi.fn(() => ({
      status: 0,
      stdout: "Python 3.12.0",
      stderr: "",
    }));
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    const spawnProcess = vi.fn(() => {
      setTimeout(() => {
        child.stdout.emit("data", Buffer.from('{"success":true}'));
        child.emit("close", 0);
      }, 0);
      return child;
    });
    const bridge = new PythonBridge({ spawnProcess, spawnSyncProcess });

    await expect(
      bridge.callTool("check_environment", { fast: true }),
    ).resolves.toEqual({
      success: true,
    });
    expect(spawnSyncProcess).toHaveBeenCalledWith(
      "python",
      ["--version"],
      expect.objectContaining({
        shell: false,
        origin: "desktop:python-bridge-probe",
      }),
    );
    expect(spawnProcess).toHaveBeenCalledWith(
      "python",
      [expect.stringMatching(/check_environment\.py$/), '{"fast":true}'],
      expect.objectContaining({
        shell: false,
        origin: "desktop:python-bridge-tool",
      }),
    );
  });
});
