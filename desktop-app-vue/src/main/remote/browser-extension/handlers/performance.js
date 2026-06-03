/**
 * Performance command handlers for the ChainlessChain Browser Bridge.
 *
 * Covers the full performance.* namespace, which spanned two source sections
 * (the basic "Performance" section + the Phase 21 "Performance Metrics"
 * section): getMetrics, getEntries, startTrace, stopTrace, getTimeline,
 * getLongTasks, getLayoutShifts, getPaintTiming, getResourceTiming,
 * getNavigationTiming, measureElement, startMark, measureBetweenMarks,
 * clearMarks.
 *
 * Extracted verbatim from background.js (Phase 1 of the split). Most handlers
 * run in page context via executeScript; start/stop trace use the CDP Tracing
 * domain (raw chrome.debugger) and keep per-tab performanceTraces state.
 *
 * NOTE: background.js defined getPerformanceMetrics and getPerformanceEntries
 * TWICE each (basic + Phase 21); hoisting made the Phase 21 versions effective
 * for both switch cases. This module keeps those effective definitions.
 *
 * ESM only. chrome.* is referenced lazily inside the handler bodies.
 */

/* eslint-disable no-undef */
/* global chrome, window, performance, document, Math, Date */

// ---------- Metrics / entries (effective Phase 21 definitions) ----------

export async function getPerformanceMetrics(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const perf = window.performance;
        const nav = perf.getEntriesByType("navigation")[0];
        const paint = perf.getEntriesByType("paint");

        return {
          timing: {
            domContentLoaded: nav?.domContentLoadedEventEnd - nav?.startTime,
            load: nav?.loadEventEnd - nav?.startTime,
            firstPaint: paint.find((p) => p.name === "first-paint")?.startTime,
            firstContentfulPaint: paint.find(
              (p) => p.name === "first-contentful-paint",
            )?.startTime,
            domInteractive: nav?.domInteractive - nav?.startTime,
            domComplete: nav?.domComplete - nav?.startTime,
          },
          memory: window.performance.memory
            ? {
                usedJSHeapSize: window.performance.memory.usedJSHeapSize,
                totalJSHeapSize: window.performance.memory.totalJSHeapSize,
                jsHeapSizeLimit: window.performance.memory.jsHeapSizeLimit,
              }
            : null,
          resources: {
            count: perf.getEntriesByType("resource").length,
            totalSize: perf
              .getEntriesByType("resource")
              .reduce((sum, r) => sum + (r.transferSize || 0), 0),
          },
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

export async function getPerformanceEntries(tabId, type = null) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (entryType) => {
        const entries = entryType
          ? performance.getEntriesByType(entryType)
          : performance.getEntries();

        return entries.slice(0, 100).map((e) => ({
          name: e.name?.slice(0, 100),
          entryType: e.entryType,
          startTime: Math.round(e.startTime),
          duration: Math.round(e.duration),
        }));
      },
      args: [type],
    });
    return { entries: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

// ---------- Tracing (CDP) ----------

const performanceTraces = new Map();

export async function startPerformanceTrace(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    await chrome.debugger.sendCommand({ tabId }, "Tracing.start", {
      categories:
        "devtools.timeline,v8.execute,disabled-by-default-devtools.timeline",
      options: "sampling-frequency=10000",
    });

    performanceTraces.set(tabId, { startTime: Date.now(), events: [] });

    chrome.debugger.onEvent.addListener((source, method, params) => {
      if (source.tabId !== tabId || method !== "Tracing.dataCollected") {
        return;
      }

      const trace = performanceTraces.get(tabId);
      if (trace) {
        trace.events.push(...params.value);
      }
    });

    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

export async function stopPerformanceTrace(tabId) {
  try {
    await chrome.debugger.sendCommand({ tabId }, "Tracing.end");

    const trace = performanceTraces.get(tabId);
    performanceTraces.delete(tabId);

    await chrome.debugger.detach({ tabId });

    return {
      success: true,
      duration: Date.now() - (trace?.startTime || 0),
      eventCount: trace?.events?.length || 0,
    };
  } catch (error) {
    return { error: error.message };
  }
}

// ---------- Phase 21 metrics ----------

export async function getPerformanceTimeline(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const entries = window.performance.getEntries();
        return entries.slice(0, 200).map((entry) => ({
          name: entry.name,
          entryType: entry.entryType,
          startTime: Math.round(entry.startTime),
          duration: Math.round(entry.duration),
        }));
      },
    });
    return { entries: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

export async function getLongTasks(tabId, threshold = 50) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (thresh) => {
        const longTasks = window.performance.getEntriesByType("longtask");
        return longTasks
          .filter((t) => t.duration >= thresh)
          .map((t) => ({
            name: t.name,
            startTime: Math.round(t.startTime),
            duration: Math.round(t.duration),
            attribution: t.attribution?.map((a) => ({
              name: a.name,
              containerType: a.containerType,
              containerSrc: a.containerSrc,
            })),
          }));
      },
      args: [threshold],
    });
    return { tasks: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

export async function getLayoutShifts(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const shifts = window.performance.getEntriesByType("layout-shift");
        let cumulativeScore = 0;

        const entries = shifts.map((s) => {
          cumulativeScore += s.value;
          return {
            startTime: Math.round(s.startTime),
            value: s.value?.toFixed(4),
            hadRecentInput: s.hadRecentInput,
            sources: s.sources?.map((src) => ({
              node: src.node?.tagName,
              previousRect: src.previousRect,
              currentRect: src.currentRect,
            })),
          };
        });

        return { entries, cls: cumulativeScore.toFixed(4) };
      },
    });
    return result[0]?.result || { entries: [], cls: 0 };
  } catch (error) {
    return { error: error.message };
  }
}

export async function getPaintTiming(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const paint = window.performance.getEntriesByType("paint");
        const lcp = window.performance.getEntriesByType(
          "largest-contentful-paint",
        );

        return {
          firstPaint: paint.find((p) => p.name === "first-paint")?.startTime,
          firstContentfulPaint: paint.find(
            (p) => p.name === "first-contentful-paint",
          )?.startTime,
          largestContentfulPaint: lcp[lcp.length - 1]?.startTime,
          lcpElement: lcp[lcp.length - 1]?.element?.tagName,
          lcpSize: lcp[lcp.length - 1]?.size,
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

export async function getResourceTiming(tabId, filter = null) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (filterType) => {
        let resources = window.performance.getEntriesByType("resource");

        if (filterType) {
          resources = resources.filter((r) => r.initiatorType === filterType);
        }

        return resources.slice(0, 100).map((r) => ({
          name: r.name.split("/").pop()?.slice(0, 50),
          url: r.name.slice(0, 100),
          initiatorType: r.initiatorType,
          startTime: Math.round(r.startTime),
          duration: Math.round(r.duration),
          transferSize: r.transferSize,
          encodedBodySize: r.encodedBodySize,
          decodedBodySize: r.decodedBodySize,
          dns: Math.round(r.domainLookupEnd - r.domainLookupStart),
          tcp: Math.round(r.connectEnd - r.connectStart),
          ttfb: Math.round(r.responseStart - r.requestStart),
          download: Math.round(r.responseEnd - r.responseStart),
        }));
      },
      args: [filter],
    });
    return { resources: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

export async function getNavigationTiming(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const nav = window.performance.getEntriesByType("navigation")[0];
        if (!nav) return null;

        return {
          type: nav.type,
          redirectCount: nav.redirectCount,
          redirectTime: Math.round(nav.redirectEnd - nav.redirectStart),
          dnsTime: Math.round(nav.domainLookupEnd - nav.domainLookupStart),
          tcpTime: Math.round(nav.connectEnd - nav.connectStart),
          tlsTime: Math.round(
            nav.secureConnectionStart > 0
              ? nav.connectEnd - nav.secureConnectionStart
              : 0,
          ),
          ttfb: Math.round(nav.responseStart - nav.requestStart),
          downloadTime: Math.round(nav.responseEnd - nav.responseStart),
          domParsing: Math.round(nav.domInteractive - nav.responseEnd),
          deferredScripts: Math.round(
            nav.domContentLoadedEventStart - nav.domInteractive,
          ),
          domContentLoaded: Math.round(
            nav.domContentLoadedEventEnd - nav.startTime,
          ),
          resourceLoading: Math.round(
            nav.domComplete - nav.domContentLoadedEventEnd,
          ),
          loadEvent: Math.round(nav.loadEventEnd - nav.loadEventStart),
          totalTime: Math.round(nav.loadEventEnd - nav.startTime),
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

export async function measureElementPerformance(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const element = document.querySelector(sel);
        if (!element) return { error: "Element not found" };

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        // Measure reflow/repaint cost
        const startMeasure = performance.now();
        element.offsetHeight; // Force reflow
        const reflowTime = performance.now() - startMeasure;

        return {
          selector: sel,
          dimensions: {
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            x: Math.round(rect.x),
            y: Math.round(rect.y),
          },
          layout: {
            display: style.display,
            position: style.position,
            containsText: element.textContent?.length || 0,
            childCount: element.children?.length || 0,
          },
          performance: {
            reflowTime: reflowTime.toFixed(3),
          },
        };
      },
      args: [selector],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

export async function createPerformanceMark(tabId, name) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (markName) => {
        performance.mark(markName);
        return { success: true, name: markName, timestamp: performance.now() };
      },
      args: [name],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

export async function measureBetweenMarks(
  tabId,
  startMark,
  endMark,
  measureName,
) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (start, end, name) => {
        try {
          performance.measure(name, start, end);
          const measure = performance.getEntriesByName(name, "measure")[0];
          return {
            name,
            startMark: start,
            endMark: end,
            duration: measure?.duration,
            startTime: measure?.startTime,
          };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [startMark, endMark, measureName],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

export async function clearPerformanceMarks(tabId, name = null) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (markName) => {
        if (markName) {
          performance.clearMarks(markName);
          performance.clearMeasures(markName);
        } else {
          performance.clearMarks();
          performance.clearMeasures();
        }
        return { success: true };
      },
      args: [name],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

export const performanceHandlers = {
  "performance.getMetrics": ({ tabId }) => getPerformanceMetrics(tabId),
  "performance.getEntries": ({ tabId, type }) =>
    getPerformanceEntries(tabId, type),
  "performance.startTrace": ({ tabId }) => startPerformanceTrace(tabId),
  "performance.stopTrace": ({ tabId }) => stopPerformanceTrace(tabId),
  "performance.getTimeline": ({ tabId }) => getPerformanceTimeline(tabId),
  "performance.getLongTasks": ({ tabId, threshold }) =>
    getLongTasks(tabId, threshold),
  "performance.getLayoutShifts": ({ tabId }) => getLayoutShifts(tabId),
  "performance.getPaintTiming": ({ tabId }) => getPaintTiming(tabId),
  "performance.getResourceTiming": ({ tabId, filter }) =>
    getResourceTiming(tabId, filter),
  "performance.getNavigationTiming": ({ tabId }) => getNavigationTiming(tabId),
  "performance.measureElement": ({ tabId, selector }) =>
    measureElementPerformance(tabId, selector),
  "performance.startMark": ({ tabId, name }) =>
    createPerformanceMark(tabId, name),
  "performance.measureBetweenMarks": ({
    tabId,
    startMark,
    endMark,
    measureName,
  }) => measureBetweenMarks(tabId, startMark, endMark, measureName),
  "performance.clearMarks": ({ tabId, name }) =>
    clearPerformanceMarks(tabId, name),
};
