import { describe, expect, it, vi } from "vitest";

const {
  DALLEClient,
  DALLEModel,
} = require("../../../src/main/image-gen/dalle-client");

describe("DALLEClient governance", () => {
  it.each([
    ["generate", (client) => client.generate("draw a safe icon")],
    [
      "variation",
      (client) => client.createVariation(Buffer.from("png").toString("base64")),
    ],
    [
      "edit",
      (client) =>
        client.edit(
          Buffer.from("png").toString("base64"),
          "change the background",
          Buffer.from("png").toString("base64"),
        ),
    ],
  ])("fails closed before fetch for %s", async (_name, invoke) => {
    const client = new DALLEClient({
      apiKey: "test-key",
      model: DALLEModel.DALLE_2,
    });
    const fetch = vi.fn();
    client._fetch = fetch;
    client._fetchFormData = fetch;

    await expect(invoke(client)).rejects.toMatchObject({
      code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
