import { once } from "node:events";
import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import { captureDecisionProviderAuthority } from "../../src/lib/decision-layer/provider-authority.js";
import {
  createDecisionProvider,
  resolveDecisionProviderOptions,
} from "../../src/lib/decision-layer/providers.js";

const REQUEST = {
  internalTrace: "do not send this",
  payload: {
    state: { task: "repair tests" },
    questions: {
      verdict: { type: "noul", instructions: "Is this relevant?" },
    },
    privateMetadata: "do not send this either",
  },
};

function successfulFetch(body = {}) {
  return vi.fn(async () => ({ ok: true, json: async () => body }));
}

async function withLocalServer(handler, operation) {
  const server = createServer(handler);
  try {
    const listening = once(server, "listening");
    server.listen(0, "127.0.0.1");
    await listening;
    return await operation(`http://127.0.0.1:${server.address().port}`);
  } finally {
    if (server.listening) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    }
  }
}

afterEach(() => vi.unstubAllEnvs());

describe("decision provider options", () => {
  it("preserves the existing TypeSafe defaults", () => {
    expect(resolveDecisionProviderOptions()).toEqual({
      provider: "typesafe",
      model: "jev-latest",
      baseUrl: "https://api.typesafe.ai",
    });
  });

  it("selects a local Laya server without TypeSafe defaults", () => {
    expect(
      resolveDecisionProviderOptions({ decisionProvider: "laya" }),
    ).toEqual({
      provider: "laya",
      model: "laya",
      baseUrl: "http://127.0.0.1:8000",
    });
  });

  it("accepts an explicitly configured System One model", () => {
    expect(
      resolveDecisionProviderOptions({
        decisionProvider: "system-one",
        decisionModel: "custom-open-model",
        decisionBaseUrl: "https://decisions.example.com/v1",
      }),
    ).toEqual({
      provider: "system-one",
      model: "custom-open-model",
      baseUrl: "https://decisions.example.com/v1",
    });
  });

  it.each(["unknown", "toString", "__proto__"])(
    "rejects unknown provider %s",
    (decisionProvider) => {
      expect(() =>
        resolveDecisionProviderOptions({ decisionProvider }),
      ).toThrow("unknown decision provider");
    },
  );

  it.each([
    [{ decisionBaseUrl: "http://localhost:8000" }, "decision model"],
    [{ decisionModel: "custom" }, "decision base URL"],
  ])("requires both generic server options: %o", (options, message) => {
    expect(() =>
      resolveDecisionProviderOptions({
        decisionProvider: "system-one",
        ...options,
      }),
    ).toThrow(message);
  });

  it.each(["", " ", "model\nname", "m".repeat(161)])(
    "rejects an invalid model %j",
    (decisionModel) => {
      expect(() => resolveDecisionProviderOptions({ decisionModel })).toThrow(
        "decision model",
      );
    },
  );
});

describe("System One transport", () => {
  it("brands the Laya provider and sends only the typed payload on demand", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "unrelated-cloud-secret");
    vi.stubEnv("CHAINLESSCHAIN_DECISION_API_KEY", "unselected-secret");
    const answers = { verdict: { type: "noul", noul: 0.8 } };
    const usage = { input_tokens: 5, output_tokens: 1 };
    const fetchImpl = successfulFetch({ model: "laya-3b", answers, usage });
    const provider = createDecisionProvider({ provider: "laya", fetchImpl });

    expect(captureDecisionProviderAuthority(provider)).toBe(provider);
    expect(provider).toMatchObject({ provider: "laya", model: "laya" });
    expect(fetchImpl).not.toHaveBeenCalled();

    expect(await provider.decide(REQUEST)).toEqual({
      provider: "laya",
      model: "laya-3b",
      answers,
      usage,
    });
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8000/v1/systemone");
    expect(options).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
      redirect: "error",
    });
    expect(options.headers).not.toHaveProperty("authorization");
    expect(JSON.parse(options.body)).toEqual({
      model: "laya",
      state: REQUEST.payload.state,
      questions: REQUEST.payload.questions,
    });
  });

  it.each(["typesafe", "laya", "system-one"])(
    "uses only the explicit API key for %s",
    async (provider) => {
      const fetchImpl = successfulFetch();
      await createDecisionProvider({
        provider,
        model: "custom",
        baseUrl: "http://localhost:8000",
        apiKey: "explicit-key",
        fetchImpl,
      }).decide(REQUEST);
      expect(fetchImpl.mock.calls[0][1].headers).toEqual({
        authorization: "Bearer explicit-key",
        "content-type": "application/json",
      });
    },
  );

  it("allows a generic local model without credentials and reports its identity", async () => {
    const fetchImpl = successfulFetch({ answers: { verdict: true } });
    const result = await createDecisionProvider({
      provider: "system-one",
      model: "custom-open-model",
      baseUrl: "http://[::1]:9000",
      fetchImpl,
    }).decide(REQUEST);
    expect(result).toEqual({
      provider: "system-one",
      model: "custom-open-model",
      answers: { verdict: true },
      usage: undefined,
    });
    expect(fetchImpl.mock.calls[0][1].headers).not.toHaveProperty(
      "authorization",
    );
  });

  it("continues to require an explicit TypeSafe API key", () => {
    vi.stubEnv("TYPESAFE_API_KEY", "not-read-by-the-factory");
    expect(() => createDecisionProvider()).toThrow(
      "TypeSafe API key is required",
    );
  });

  it.each(["", " ", "key\r\ninjected: value", "x".repeat(8193)])(
    "rejects invalid explicit credentials",
    (apiKey) => {
      expect(() =>
        createDecisionProvider({ provider: "laya", apiKey }),
      ).toThrow("API key");
    },
  );

  it.each([
    ["http://127.0.0.1:8000", "http://127.0.0.1:8000/v1/systemone"],
    ["http://localhost:8000/", "http://localhost:8000/v1/systemone"],
    ["http://[::1]:8000/v1", "http://[::1]:8000/v1/systemone"],
    ["http://localhost:8000/v1/", "http://localhost:8000/v1/systemone"],
    [
      "http://localhost:8000/v1/systemone",
      "http://localhost:8000/v1/systemone",
    ],
    [
      "http://localhost:8000/v1/systemone/",
      "http://localhost:8000/v1/systemone",
    ],
    [
      "https://localhost:8000/proxy",
      "https://localhost:8000/proxy/v1/systemone",
    ],
    [
      "https://localhost:8000/proxy/v1",
      "https://localhost:8000/proxy/v1/systemone",
    ],
  ])("normalizes endpoint %s", async (baseUrl, endpoint) => {
    const fetchImpl = successfulFetch();
    await createDecisionProvider({
      provider: "laya",
      baseUrl,
      fetchImpl,
    }).decide(REQUEST);
    expect(fetchImpl.mock.calls[0][0]).toBe(endpoint);
  });

  it.each([
    "ftp://localhost:8000",
    "file:///v1/systemone",
    "http://user:secret@localhost:8000",
    "http://localhost:8000?api_key=secret",
    "http://localhost:8000#secret",
    "http://localhost:8000?",
    "http://localhost:8000#",
  ])("rejects unsafe endpoint %s before fetching", (baseUrl) => {
    const fetchImpl = successfulFetch();
    expect(() =>
      createDecisionProvider({ provider: "laya", baseUrl, fetchImpl }),
    ).toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    "http://example.com:8000",
    "https://example.com:8000",
    "http://localhost.example.com:8000",
    "http://0.0.0.0:8000",
  ])("keeps Laya on loopback: %s", (baseUrl) => {
    expect(() => createDecisionProvider({ provider: "laya", baseUrl })).toThrow(
      "must use loopback",
    );
  });

  it("permits a remote System One server only with HTTPS", async () => {
    const options = { provider: "system-one", model: "open-model" };
    expect(() =>
      createDecisionProvider({ ...options, baseUrl: "http://example.com" }),
    ).toThrow("HTTPS or loopback");
    const fetchImpl = successfulFetch();
    await createDecisionProvider({
      ...options,
      baseUrl: "https://example.com/v1/systemone",
      fetchImpl,
    }).decide(REQUEST);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://example.com/v1/systemone");
  });

  it("reports the status without reading or exposing an error response body", async () => {
    const json = vi.fn(async () => ({
      secret: "provider diagnostic credentials",
    }));
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503, json }));
    const provider = createDecisionProvider({ provider: "laya", fetchImpl });
    await expect(provider.decide(REQUEST)).rejects.toMatchObject({
      message: "Laya decision request failed with status 503",
      code: "CC_DECISION_PROVIDER_HTTP_ERROR",
      status: 503,
    });
    expect(json).not.toHaveBeenCalled();
  });

  it("passes cancellation through to the request", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(
      async (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const provider = createDecisionProvider({ provider: "laya", fetchImpl });
    const pending = provider.decide(REQUEST, { signal: controller.signal });
    const canceled = new Error("decision deadline exceeded");
    controller.abort(canceled);
    await expect(pending).rejects.toBe(canceled);
    expect(fetchImpl.mock.calls[0][1].signal).toBe(controller.signal);
  });
});

describe("Laya loopback HTTP transport", () => {
  it("round trips the real protocol and preserves zero output tokens and server model", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "unrelated-cloud-secret");
    const received = [];
    const answers = { verdict: { type: "noul", noul: 0.8 } };
    await withLocalServer(
      (request, response) => {
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk) => {
          body += chunk;
        });
        request.on("end", () => {
          received.push({
            path: request.url,
            method: request.method,
            authorization: request.headers.authorization,
            contentType: request.headers["content-type"],
            body,
          });
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              model: "laya-multilingual",
              answers,
              usage: { input_tokens: 12, output_tokens: 0 },
            }),
          );
        });
      },
      async (baseUrl) => {
        const provider = createDecisionProvider({ provider: "laya", baseUrl });
        const result = await provider.decide(REQUEST, {
          signal: AbortSignal.timeout(5000),
        });
        expect(result).toEqual({
          provider: "laya",
          model: "laya-multilingual",
          answers,
          usage: { input_tokens: 12, output_tokens: 0 },
        });
        expect(received).toHaveLength(1);
        expect(received[0]).toMatchObject({
          path: "/v1/systemone",
          method: "POST",
          authorization: undefined,
          contentType: "application/json",
        });
        expect(JSON.parse(received[0].body)).toEqual({
          model: "laya",
          state: REQUEST.payload.state,
          questions: REQUEST.payload.questions,
        });
      },
    );
  });

  it("rejects an HTTP redirect without sending a second request", async () => {
    const receivedPaths = [];
    await withLocalServer(
      (request, response) => {
        receivedPaths.push(request.url);
        request.resume();
        if (request.url === "/v1/systemone") {
          response.writeHead(302, { location: "/redirect-target" });
        } else {
          response.writeHead(200, { "content-type": "application/json" });
        }
        response.end("{}");
      },
      async (baseUrl) => {
        const provider = createDecisionProvider({
          provider: "laya",
          baseUrl,
          apiKey: "explicit-local-key",
        });
        await expect(
          provider.decide(REQUEST, { signal: AbortSignal.timeout(5000) }),
        ).rejects.toThrow();
        expect(receivedPaths).toEqual(["/v1/systemone"]);
      },
    );
  });
});
