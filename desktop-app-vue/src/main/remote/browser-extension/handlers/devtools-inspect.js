/**
 * DevTools "inspect" command handlers for the ChainlessChain Browser Bridge.
 *
 * Phase 17 inspection surface, four sub-areas:
 *  - Animation Control (CDP Animation + page Web Animations API): list/pause/
 *    play/setSpeed/seekTo/cancel
 *  - Layout Inspection (page context + CDP CSS.forcePseudoState): box model,
 *    computed layout, node highlight, node info, force element state
 *  - Coverage Analysis (CDP Profiler/CSS rule usage): start/stop/get JS & CSS
 *    coverage; keeps per-tab coverageState
 *  - Memory Profiling (page performance.memory + CDP HeapProfiler): info, heap
 *    snapshot, allocation sampling, force GC; keeps memoryState
 *
 * Extracted verbatim from background.js (Phase 1 of the split). Imports the
 * shared CDP helper and keeps its own module-level state (coverageState,
 * memoryState) — once-imported ES module singletons, identical to the original
 * background.js top-level declarations. All chrome.* / debugger listeners are
 * referenced lazily inside function bodies, so the module imports cleanly
 * outside an extension context.
 *
 * ESM only.
 */

/* eslint-disable no-undef */
/* global chrome, document, getComputedStyle, parseFloat, parseInt, Math, performance, Date */

import { ensureDebuggerAttached } from "./_shared.js";

// ---------- Animation Control ----------

export async function listAnimations(tabId) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "Animation.enable");

    // Get current animations via page execution
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const animations = document.getAnimations();
        return animations.map((anim, index) => ({
          id: anim.id || `anim-${index}`,
          playState: anim.playState,
          currentTime: anim.currentTime,
          playbackRate: anim.playbackRate,
          effect: anim.effect
            ? {
                target: anim.effect.target?.tagName,
                targetSelector: anim.effect.target?.id
                  ? `#${anim.effect.target.id}`
                  : anim.effect.target?.className
                    ? `.${anim.effect.target.className.split(" ")[0]}`
                    : null,
              }
            : null,
        }));
      },
    });
    return { animations: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

export async function pauseAnimation(tabId, animationId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (animId) => {
        const animations = document.getAnimations();
        const anim = animations.find(
          (a) => a.id === animId || animations.indexOf(a) === parseInt(animId),
        );
        if (anim) {
          anim.pause();
          return { success: true, playState: anim.playState };
        }
        return { error: "Animation not found" };
      },
      args: [animationId],
    });
    return result[0]?.result || { error: "Failed to pause" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function playAnimation(tabId, animationId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (animId) => {
        const animations = document.getAnimations();
        const anim = animations.find(
          (a) => a.id === animId || animations.indexOf(a) === parseInt(animId),
        );
        if (anim) {
          anim.play();
          return { success: true, playState: anim.playState };
        }
        return { error: "Animation not found" };
      },
      args: [animationId],
    });
    return result[0]?.result || { error: "Failed to play" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function setAnimationSpeed(tabId, animationId, playbackRate) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (animId, rate) => {
        const animations = document.getAnimations();
        const anim = animations.find(
          (a) => a.id === animId || animations.indexOf(a) === parseInt(animId),
        );
        if (anim) {
          anim.playbackRate = rate;
          return { success: true, playbackRate: anim.playbackRate };
        }
        return { error: "Animation not found" };
      },
      args: [animationId, playbackRate],
    });
    return result[0]?.result || { error: "Failed to set speed" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function seekAnimation(tabId, animationId, currentTime) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (animId, time) => {
        const animations = document.getAnimations();
        const anim = animations.find(
          (a) => a.id === animId || animations.indexOf(a) === parseInt(animId),
        );
        if (anim) {
          anim.currentTime = time;
          return { success: true, currentTime: anim.currentTime };
        }
        return { error: "Animation not found" };
      },
      args: [animationId, currentTime],
    });
    return result[0]?.result || { error: "Failed to seek" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function cancelAnimation(tabId, animationId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (animId) => {
        const animations = document.getAnimations();
        const anim = animations.find(
          (a) => a.id === animId || animations.indexOf(a) === parseInt(animId),
        );
        if (anim) {
          anim.cancel();
          return { success: true };
        }
        return { error: "Animation not found" };
      },
      args: [animationId],
    });
    return result[0]?.result || { error: "Failed to cancel" };
  } catch (error) {
    return { error: error.message };
  }
}

// ---------- Layout Inspection ----------

export async function getBoxModel(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const el = document.querySelector(sel);
        if (!el) return { error: "Element not found" };

        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);

        return {
          content: {
            x:
              rect.left +
              parseFloat(style.paddingLeft) +
              parseFloat(style.borderLeftWidth),
            y:
              rect.top +
              parseFloat(style.paddingTop) +
              parseFloat(style.borderTopWidth),
            width:
              rect.width -
              parseFloat(style.paddingLeft) -
              parseFloat(style.paddingRight) -
              parseFloat(style.borderLeftWidth) -
              parseFloat(style.borderRightWidth),
            height:
              rect.height -
              parseFloat(style.paddingTop) -
              parseFloat(style.paddingBottom) -
              parseFloat(style.borderTopWidth) -
              parseFloat(style.borderBottomWidth),
          },
          padding: {
            top: parseFloat(style.paddingTop),
            right: parseFloat(style.paddingRight),
            bottom: parseFloat(style.paddingBottom),
            left: parseFloat(style.paddingLeft),
          },
          border: {
            top: parseFloat(style.borderTopWidth),
            right: parseFloat(style.borderRightWidth),
            bottom: parseFloat(style.borderBottomWidth),
            left: parseFloat(style.borderLeftWidth),
          },
          margin: {
            top: parseFloat(style.marginTop),
            right: parseFloat(style.marginRight),
            bottom: parseFloat(style.marginBottom),
            left: parseFloat(style.marginLeft),
          },
          boundingRect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
        };
      },
      args: [selector],
    });
    return result[0]?.result || { error: "Failed to get box model" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function getComputedLayout(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const el = document.querySelector(sel);
        if (!el) return { error: "Element not found" };

        const style = getComputedStyle(el);
        return {
          display: style.display,
          position: style.position,
          float: style.float,
          clear: style.clear,
          overflow: style.overflow,
          overflowX: style.overflowX,
          overflowY: style.overflowY,
          zIndex: style.zIndex,
          flexDirection: style.flexDirection,
          flexWrap: style.flexWrap,
          justifyContent: style.justifyContent,
          alignItems: style.alignItems,
          gridTemplateColumns: style.gridTemplateColumns,
          gridTemplateRows: style.gridTemplateRows,
          gap: style.gap,
          width: style.width,
          height: style.height,
          minWidth: style.minWidth,
          maxWidth: style.maxWidth,
          minHeight: style.minHeight,
          maxHeight: style.maxHeight,
        };
      },
      args: [selector],
    });
    return result[0]?.result || { error: "Failed to get layout" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function highlightNode(tabId, selector, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel, opts) => {
        const el = document.querySelector(sel);
        if (!el) return { error: "Element not found" };

        // Remove existing highlight
        const existing = document.getElementById("__chainless_highlight__");
        if (existing) existing.remove();

        const rect = el.getBoundingClientRect();
        const highlight = document.createElement("div");
        highlight.id = "__chainless_highlight__";
        highlight.style.cssText = `
          position: fixed;
          left: ${rect.left}px;
          top: ${rect.top}px;
          width: ${rect.width}px;
          height: ${rect.height}px;
          background: ${opts.backgroundColor || "rgba(111, 168, 220, 0.66)"};
          border: ${opts.border || "2px solid rgb(111, 168, 220)"};
          pointer-events: none;
          z-index: 999999;
          box-sizing: border-box;
        `;
        document.body.appendChild(highlight);

        if (opts.showInfo !== false) {
          const info = document.createElement("div");
          info.style.cssText = `
            position: fixed;
            left: ${rect.left}px;
            top: ${Math.max(0, rect.top - 25)}px;
            background: rgb(111, 168, 220);
            color: white;
            padding: 2px 6px;
            font-size: 12px;
            font-family: monospace;
            z-index: 1000000;
          `;
          info.textContent = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.className ? `.${el.className.split(" ")[0]}` : ""} | ${Math.round(rect.width)}×${Math.round(rect.height)}`;
          highlight.appendChild(info);
        }

        return { success: true };
      },
      args: [selector, options],
    });
    return result[0]?.result || { error: "Failed to highlight" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function hideHighlight(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const highlight = document.getElementById("__chainless_highlight__");
        if (highlight) highlight.remove();
      },
    });
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

export async function getNodeInfo(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const el = document.querySelector(sel);
        if (!el) return { error: "Element not found" };

        return {
          tagName: el.tagName.toLowerCase(),
          id: el.id,
          className: el.className,
          attributes: Array.from(el.attributes).map((attr) => ({
            name: attr.name,
            value: attr.value,
          })),
          childElementCount: el.childElementCount,
          textContent: el.textContent?.substring(0, 200),
          innerHTML: el.innerHTML?.substring(0, 500),
          outerHTML: el.outerHTML?.substring(0, 1000),
          parentSelector: el.parentElement
            ? `${el.parentElement.tagName.toLowerCase()}${el.parentElement.id ? `#${el.parentElement.id}` : ""}`
            : null,
          siblingCount: el.parentElement?.childElementCount || 0,
          indexAmongSiblings: el.parentElement
            ? Array.from(el.parentElement.children).indexOf(el)
            : -1,
        };
      },
      args: [selector],
    });
    return result[0]?.result || { error: "Failed to get node info" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function forceElementState(tabId, selector, state) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "DOM.enable");

    // Get the node ID
    const doc = await chrome.debugger.sendCommand({ tabId }, "DOM.getDocument");
    const nodeResult = await chrome.debugger.sendCommand(
      { tabId },
      "DOM.querySelector",
      {
        nodeId: doc.root.nodeId,
        selector: selector,
      },
    );

    if (!nodeResult.nodeId) {
      return { error: "Element not found" };
    }

    // Force the state
    await chrome.debugger.sendCommand({ tabId }, "CSS.enable");
    await chrome.debugger.sendCommand({ tabId }, "CSS.forcePseudoState", {
      nodeId: nodeResult.nodeId,
      forcedPseudoClasses: Array.isArray(state) ? state : [state],
    });

    return { success: true, forcedState: state };
  } catch (error) {
    return { error: error.message };
  }
}

// ---------- Coverage Analysis ----------

const coverageState = new Map();

export async function startJSCoverage(tabId, options = {}) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "Profiler.enable");
    await chrome.debugger.sendCommand(
      { tabId },
      "Profiler.startPreciseCoverage",
      {
        callCount: options.callCount !== false,
        detailed: options.detailed !== false,
      },
    );

    coverageState.set(`js-${tabId}`, { started: Date.now() });
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

export async function stopJSCoverage(tabId) {
  try {
    const result = await chrome.debugger.sendCommand(
      { tabId },
      "Profiler.takePreciseCoverage",
    );
    await chrome.debugger.sendCommand(
      { tabId },
      "Profiler.stopPreciseCoverage",
    );

    const state = coverageState.get(`js-${tabId}`);
    coverageState.set(`js-${tabId}`, {
      ...state,
      result: result.result,
      stopped: Date.now(),
    });

    // Calculate summary
    let totalBytes = 0;
    let coveredBytes = 0;
    result.result.forEach((script) => {
      script.functions.forEach((fn) => {
        fn.ranges.forEach((range) => {
          const rangeSize = range.endOffset - range.startOffset;
          totalBytes += rangeSize;
          if (range.count > 0) {
            coveredBytes += rangeSize;
          }
        });
      });
    });

    return {
      success: true,
      summary: {
        totalScripts: result.result.length,
        totalBytes,
        coveredBytes,
        coveragePercent:
          totalBytes > 0 ? ((coveredBytes / totalBytes) * 100).toFixed(2) : 0,
      },
    };
  } catch (error) {
    return { error: error.message };
  }
}

export async function startCSSCoverage(tabId) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "CSS.enable");
    await chrome.debugger.sendCommand({ tabId }, "CSS.startRuleUsageTracking");

    coverageState.set(`css-${tabId}`, { started: Date.now() });
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

export async function stopCSSCoverage(tabId) {
  try {
    const result = await chrome.debugger.sendCommand(
      { tabId },
      "CSS.stopRuleUsageTracking",
    );

    const state = coverageState.get(`css-${tabId}`);
    coverageState.set(`css-${tabId}`, {
      ...state,
      result: result.ruleUsage,
      stopped: Date.now(),
    });

    // Calculate summary
    const usedRules = result.ruleUsage.filter((r) => r.used).length;
    const totalRules = result.ruleUsage.length;

    return {
      success: true,
      summary: {
        totalRules,
        usedRules,
        unusedRules: totalRules - usedRules,
        coveragePercent:
          totalRules > 0 ? ((usedRules / totalRules) * 100).toFixed(2) : 0,
      },
    };
  } catch (error) {
    return { error: error.message };
  }
}

export function getJSCoverageResults(tabId) {
  const state = coverageState.get(`js-${tabId}`);
  if (!state?.result) {
    return { error: "No JS coverage data available" };
  }
  return {
    scripts: state.result.map((script) => ({
      scriptId: script.scriptId,
      url: script.url,
      functions: script.functions.length,
    })),
    started: state.started,
    stopped: state.stopped,
  };
}

export function getCSSCoverageResults(tabId) {
  const state = coverageState.get(`css-${tabId}`);
  if (!state?.result) {
    return { error: "No CSS coverage data available" };
  }
  return {
    rules: state.result.slice(0, 100), // Limit to first 100 rules
    totalRules: state.result.length,
    started: state.started,
    stopped: state.stopped,
  };
}

// ---------- Memory Profiling ----------

const memoryState = new Map();

export async function getMemoryInfo(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (performance.memory) {
          return {
            jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
            totalJSHeapSize: performance.memory.totalJSHeapSize,
            usedJSHeapSize: performance.memory.usedJSHeapSize,
            usedPercent: (
              (performance.memory.usedJSHeapSize /
                performance.memory.jsHeapSizeLimit) *
              100
            ).toFixed(2),
          };
        }
        return {
          error:
            "Memory info not available (requires Chrome with --enable-precise-memory-info)",
        };
      },
    });
    return result[0]?.result || { error: "Failed to get memory info" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function takeHeapSnapshot(tabId) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "HeapProfiler.enable");

    let chunks = [];
    const listener = (source, method, params) => {
      if (
        source.tabId === tabId &&
        method === "HeapProfiler.addHeapSnapshotChunk"
      ) {
        chunks.push(params.chunk);
      }
    };

    chrome.debugger.onEvent.addListener(listener);

    await chrome.debugger.sendCommand(
      { tabId },
      "HeapProfiler.takeHeapSnapshot",
      {
        reportProgress: false,
      },
    );

    chrome.debugger.onEvent.removeListener(listener);

    const snapshot = chunks.join("");
    const snapshotSize = snapshot.length;

    // Store snapshot reference (don't store full data due to size)
    const snapshotId = `snapshot-${Date.now()}`;
    memoryState.set(snapshotId, {
      tabId,
      size: snapshotSize,
      timestamp: Date.now(),
    });

    return {
      success: true,
      snapshotId,
      size: snapshotSize,
      sizeFormatted: `${(snapshotSize / 1024 / 1024).toFixed(2)} MB`,
    };
  } catch (error) {
    return { error: error.message };
  }
}

export async function startMemorySampling(tabId, options = {}) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "HeapProfiler.enable");
    await chrome.debugger.sendCommand({ tabId }, "HeapProfiler.startSampling", {
      samplingInterval: options.samplingInterval || 32768,
    });

    memoryState.set(`sampling-${tabId}`, { started: Date.now() });
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

export async function stopMemorySampling(tabId) {
  try {
    const result = await chrome.debugger.sendCommand(
      { tabId },
      "HeapProfiler.stopSampling",
    );

    const state = memoryState.get(`sampling-${tabId}`);
    memoryState.set(`sampling-${tabId}`, {
      ...state,
      result: result.profile,
      stopped: Date.now(),
    });

    // Calculate summary
    const samples = result.profile.samples || [];
    const totalSize = samples.reduce((sum, s) => sum + (s.size || 0), 0);

    return {
      success: true,
      summary: {
        sampleCount: samples.length,
        totalAllocatedSize: totalSize,
        duration: state ? Date.now() - state.started : 0,
      },
    };
  } catch (error) {
    return { error: error.message };
  }
}

export async function forceGarbageCollection(tabId) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "HeapProfiler.enable");
    await chrome.debugger.sendCommand({ tabId }, "HeapProfiler.collectGarbage");
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

export const devtoolsInspectHandlers = {
  // Animation Control
  "animation.list": ({ tabId }) => listAnimations(tabId),
  "animation.pause": ({ tabId, animationId }) =>
    pauseAnimation(tabId, animationId),
  "animation.play": ({ tabId, animationId }) =>
    playAnimation(tabId, animationId),
  "animation.setSpeed": ({ tabId, animationId, playbackRate }) =>
    setAnimationSpeed(tabId, animationId, playbackRate),
  "animation.seekTo": ({ tabId, animationId, currentTime }) =>
    seekAnimation(tabId, animationId, currentTime),
  "animation.cancel": ({ tabId, animationId }) =>
    cancelAnimation(tabId, animationId),
  // Layout Inspection
  "layout.getBoxModel": ({ tabId, selector }) => getBoxModel(tabId, selector),
  "layout.getComputedLayout": ({ tabId, selector }) =>
    getComputedLayout(tabId, selector),
  "layout.highlightNode": ({ tabId, selector, options }) =>
    highlightNode(tabId, selector, options),
  "layout.hideHighlight": ({ tabId }) => hideHighlight(tabId),
  "layout.getNodeInfo": ({ tabId, selector }) => getNodeInfo(tabId, selector),
  "layout.forceElementState": ({ tabId, selector, state }) =>
    forceElementState(tabId, selector, state),
  // Coverage Analysis
  "coverage.startJSCoverage": ({ tabId, options }) =>
    startJSCoverage(tabId, options),
  "coverage.stopJSCoverage": ({ tabId }) => stopJSCoverage(tabId),
  "coverage.startCSSCoverage": ({ tabId }) => startCSSCoverage(tabId),
  "coverage.stopCSSCoverage": ({ tabId }) => stopCSSCoverage(tabId),
  "coverage.getJSCoverage": ({ tabId }) => getJSCoverageResults(tabId),
  "coverage.getCSSCoverage": ({ tabId }) => getCSSCoverageResults(tabId),
  // Memory Profiling
  "memory.getInfo": ({ tabId }) => getMemoryInfo(tabId),
  "memory.takeHeapSnapshot": ({ tabId }) => takeHeapSnapshot(tabId),
  "memory.startSampling": ({ tabId, options }) =>
    startMemorySampling(tabId, options),
  "memory.stopSampling": ({ tabId }) => stopMemorySampling(tabId),
  "memory.forceGC": ({ tabId }) => forceGarbageCollection(tabId),
};
