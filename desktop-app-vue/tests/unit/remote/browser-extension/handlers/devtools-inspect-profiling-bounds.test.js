import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEVTOOLS_PROFILING_LIMITS,
  getCSSCoverageResults,
  getJSCoverageResults,
  startCSSCoverage,
  startJSCoverage,
  startMemorySampling,
  stopCSSCoverage,
  stopJSCoverage,
  stopMemorySampling,
} from "../../../../../src/main/remote/browser-extension/handlers/devtools-inspect.js";

function installChromeMock(sendCommand) {
  const debuggerApi = {
    attach: vi.fn().mockResolvedValue(undefined),
    sendCommand: vi.fn(sendCommand),
    onEvent: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  };
  vi.stubGlobal("chrome", { debugger: debuggerApi });
  return debuggerApi;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DevTools profiling retention bounds", () => {
  it("retains bounded JS coverage summaries instead of raw function ranges", async () => {
    const scripts = Array.from(
      { length: DEVTOOLS_PROFILING_LIMITS.maxRetainedJSScripts + 2 },
      (_value, index) => ({
        scriptId: `${index}`,
        url: `https://example.test/${"x".repeat(3000)}`,
        functions: [{ ranges: [{ startOffset: 0, endOffset: 10, count: 1 }] }],
      }),
    );
    installChromeMock(async (_source, method) => {
      if (method === "Profiler.takePreciseCoverage") {
        return { result: scripts };
      }
      return undefined;
    });

    await startJSCoverage(301);
    await expect(stopJSCoverage(301)).resolves.toMatchObject({
      success: true,
      summary: {
        totalScripts: scripts.length,
        totalBytes: scripts.length * 10,
        coveredBytes: scripts.length * 10,
      },
    });
    const retained = getJSCoverageResults(301);
    expect(retained).toMatchObject({
      totalScripts: scripts.length,
      truncated: true,
    });
    expect(retained.scripts).toHaveLength(
      DEVTOOLS_PROFILING_LIMITS.maxRetainedJSScripts,
    );
    expect(retained.scripts[0]).toEqual({
      scriptId: "0",
      url: scripts[0].url.slice(
        0,
        DEVTOOLS_PROFILING_LIMITS.maxCoverageUrlChars,
      ),
      functions: 1,
    });
  });

  it("retains only the bounded CSS rule prefix and exact total", async () => {
    const rules = Array.from(
      { length: DEVTOOLS_PROFILING_LIMITS.maxRetainedCSSRules + 5 },
      (_value, index) => ({ styleSheetId: `${index}`, used: index % 2 === 0 }),
    );
    installChromeMock(async (_source, method) => {
      if (method === "CSS.stopRuleUsageTracking") {
        return { ruleUsage: rules };
      }
      return undefined;
    });

    await startCSSCoverage(302);
    await stopCSSCoverage(302);
    const retained = getCSSCoverageResults(302);
    expect(retained).toMatchObject({
      totalRules: rules.length,
      truncated: true,
    });
    expect(retained.rules).toHaveLength(
      DEVTOOLS_PROFILING_LIMITS.maxRetainedCSSRules,
    );
  });

  it("serializes memory sampling and releases admission after summary", async () => {
    installChromeMock(async (_source, method) => {
      if (method === "HeapProfiler.stopSampling") {
        return { profile: { samples: [{ size: 5 }, { size: 6 }] } };
      }
      return undefined;
    });

    await expect(
      startMemorySampling(303, { samplingInterval: Number.MAX_SAFE_INTEGER }),
    ).resolves.toMatchObject({
      success: true,
      samplingInterval: DEVTOOLS_PROFILING_LIMITS.maxMemorySamplingInterval,
    });
    await expect(startMemorySampling(303)).resolves.toMatchObject({
      accepted: false,
      code: "OVERLOADED",
      scope: "memory_sampling_tab",
    });
    await expect(stopMemorySampling(303)).resolves.toMatchObject({
      success: true,
      summary: {
        sampleCount: 2,
        totalAllocatedSize: 11,
        totalAllocatedSizeExact: true,
      },
    });
    await expect(startMemorySampling(303)).resolves.toMatchObject({
      success: true,
    });
    await stopMemorySampling(303);
  });

  it("keeps start and stop failures bounded and retryable", async () => {
    let failStart = true;
    let failStop = true;
    installChromeMock(async (_source, method) => {
      if (method === "HeapProfiler.startSampling" && failStart) {
        throw new Error("start failed");
      }
      if (method === "HeapProfiler.stopSampling" && failStop) {
        throw new Error("stop failed");
      }
      if (method === "HeapProfiler.stopSampling") {
        return { profile: { samples: [] } };
      }
      return undefined;
    });

    await expect(startMemorySampling(304)).resolves.toEqual({
      error: "start failed",
    });
    failStart = false;
    await expect(startMemorySampling(304)).resolves.toMatchObject({
      success: true,
    });
    await expect(stopMemorySampling(304)).resolves.toEqual({
      error: "stop failed",
    });
    failStop = false;
    await expect(stopMemorySampling(304)).resolves.toMatchObject({
      success: true,
    });
  });

  it("does not retain a raw allocation profile in module state", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/main/remote/browser-extension/handlers/devtools-inspect.js",
      ),
      "utf8",
    );
    const stopSamplingSource = source.slice(
      source.indexOf("export async function stopMemorySampling"),
      source.indexOf("export async function forceGarbageCollection"),
    );

    expect(stopSamplingSource).not.toMatch(/memoryState\.set/);
  });
});
