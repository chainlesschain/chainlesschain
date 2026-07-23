const { EventEmitter } = require("node:events");
const PreviewManager = require("../preview-manager");

describe("PreviewManager process boundary", () => {
  it("routes dev servers through the injected Desktop Broker facade", async () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    const spawnProcess = vi.fn(() => child);
    const manager = new PreviewManager(null, {
      spawnProcess,
      startupDelayMs: 0,
    });

    const result = await manager.startDevServer(
      "project-1",
      "C:/workspace",
      "npm run dev",
    );

    expect(result.process).toBe(child);
    expect(spawnProcess).toHaveBeenCalledWith(
      "npm",
      ["run", "dev"],
      expect.objectContaining({
        cwd: "C:/workspace",
        shell: true,
        origin: "desktop:preview-dev-server",
      }),
    );
  });
});
