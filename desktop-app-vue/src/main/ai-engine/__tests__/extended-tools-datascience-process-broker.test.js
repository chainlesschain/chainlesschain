import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

const DataScienceToolsHandler = require("../extended-tools-datascience.js");

describe("DataScienceToolsHandler process execution", () => {
  it("rejects ML training before writing or starting a model process", async () => {
    const spawnProcess = vi.fn();
    const fsPromises = {
      writeFile: vi.fn(),
      unlink: vi.fn(),
    };
    const handler = new DataScienceToolsHandler({ fsPromises, spawnProcess });

    await expect(
      handler.tool_ml_model_trainer({
        dataPath: "/tmp/private-data.csv",
        targetColumn: "label",
        modelType: "random_forest",
        taskType: "classification",
        modelOutputPath: "/tmp/model.joblib",
      }),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
    expect(fsPromises.writeFile).not.toHaveBeenCalled();
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("routes Python scripts through the desktop process broker boundary", async () => {
    const process = new EventEmitter();
    process.stdout = new EventEmitter();
    process.stderr = new EventEmitter();
    const spawnProcess = vi.fn(() => process);
    const fsPromises = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      unlink: vi.fn().mockResolvedValue(undefined),
    };
    const handler = new DataScienceToolsHandler({ fsPromises, spawnProcess });

    const resultPromise = handler.executePythonScript("print('ok')", [
      "literal arg",
      "& echo ignored",
    ]);
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledOnce());
    process.stdout.emit("data", Buffer.from("ok\n"));
    process.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      stdout: "ok\n",
      stderr: "",
    });
    const scriptPath = fsPromises.writeFile.mock.calls[0][0];
    expect(spawnProcess).toHaveBeenCalledWith(
      "python",
      [scriptPath, "literal arg", "& echo ignored"],
      {
        windowsHide: true,
        origin: "desktop:data-science-python",
      },
    );
    await vi.waitFor(() =>
      expect(fsPromises.unlink).toHaveBeenCalledWith(scriptPath),
    );
  });
});
