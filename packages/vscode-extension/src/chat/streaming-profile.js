/** Test-driver measurement in the installed Webview. Only the authenticated
 * host DOM relay invokes this; ordinary conversations do not collect metrics.
 * Uses the production renderer, Markdown parser, code controls and scroll hook.
 */
async function measureStreamingProfile({
  document,
  log,
  chars,
  createRenderer,
  renderMarkdown,
  decorate,
  follow,
  signal,
  onProgress = () => {},
}) {
  if (![10_000, 100_000, 200_000].includes(chars))
    throw new TypeError("Unsupported streaming profile size");
  const requestedAt = performance.now();
  const deadline = requestedAt + 75_000;
  let samplingStarted = false;
  let completedFrames = 0;
  const visible = () =>
    document.visibilityState === "visible" && log.getClientRects().length > 0;
  const progress = (stage) =>
    onProgress({
      chars,
      stage,
      completedFrames,
      visibilityState: document.visibilityState,
      visible: visible(),
      elapsedMs: performance.now() - requestedAt,
    });
  const frame = (frameDeadline = deadline) =>
    new Promise((resolve, reject) => {
      let frameId;
      let timer;
      let settled = false;
      const finish = (error, at) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (frameId !== undefined) cancelAnimationFrame(frameId);
        signal?.removeEventListener("abort", aborted);
        document.removeEventListener("visibilitychange", visibilityChanged);
        if (error) reject(error);
        else resolve(at);
      };
      const aborted = () => finish(new Error("Streaming profile cancelled"));
      const visibilityChanged = () => {
        if (samplingStarted && !visible())
          finish(new Error("Streaming profile became hidden during sampling"));
      };
      if (signal?.aborted) {
        aborted();
        return;
      }
      if (samplingStarted && !visible()) {
        visibilityChanged();
        return;
      }
      const remaining = frameDeadline - performance.now();
      if (remaining <= 0) {
        finish(
          new Error("Streaming profile exceeded its bounded frame deadline"),
        );
        return;
      }
      signal?.addEventListener("abort", aborted, { once: true });
      document.addEventListener("visibilitychange", visibilityChanged);
      timer = setTimeout(
        () =>
          finish(
            new Error(
              "Streaming profile timed out waiting for a real animation frame",
            ),
          ),
        remaining,
      );
      frameId = requestAnimationFrame((at) => {
        if (signal?.aborted) aborted();
        else if (performance.now() >= frameDeadline)
          finish(
            new Error("Streaming profile exceeded its bounded frame deadline"),
          );
        else if (samplingStarted && !visible()) visibilityChanged();
        else finish(null, at);
      });
    });
  progress("waiting-visible");
  // No timer-generated frames: a visible DOM and a real browser frame must
  // precede measurement. A suspended/hidden renderer fails within 15 seconds.
  try {
    do {
      await frame(Math.min(deadline, requestedAt + 15_000));
    } while (!visible());
  } catch (error) {
    progress("failed");
    throw error;
  }
  samplingStarted = true;
  progress("visible");
  const originalScrollTop = log.scrollTop;
  const element = document.createElement("div");
  element.className = "msg assistant";
  log.appendChild(element);
  const durations = [];
  const frames = [];
  let parseCalls = 0;
  let parseChars = 0;
  let finalizing = false;
  const finalizationStagesMs = {
    markdown: 0,
    decorate: 0,
    follow: 0,
    residualIncludingDomAndOverhead: 0,
  };
  function measureFinalizationStage(stage, callback) {
    const before = performance.now();
    try {
      return callback();
    } finally {
      finalizationStagesMs[stage] += performance.now() - before;
    }
  }
  let childMutations = 0;
  let textMutations = 0;
  let longestTaskMs = 0;
  let observer = null;
  const mutations = new MutationObserver((records) => {
    childMutations += records.filter((r) => r.type === "childList").length;
    textMutations += records.filter((r) => r.type === "characterData").length;
  });
  mutations.observe(element, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  const longTasksSupported =
    typeof PerformanceObserver !== "undefined" &&
    PerformanceObserver.supportedEntryTypes.includes("longtask");
  if (longTasksSupported) {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        longestTaskMs = Math.max(longestTaskMs, entry.duration);
    });
    observer.observe({ type: "longtask", buffered: false });
  }
  const selection = document.getSelection();
  if (!selection || !selection.isCollapsed) {
    mutations.disconnect();
    observer?.disconnect();
    element.remove();
    throw new Error("Streaming profile requires an idle selection");
  }
  const originalRanges = Array.from({ length: selection.rangeCount }, (_, i) =>
    selection.getRangeAt(i).cloneRange(),
  );
  const renderer = createRenderer({
    document,
    renderMarkdown(text) {
      parseCalls++;
      parseChars += text.length;
      return finalizing
        ? measureFinalizationStage("markdown", () => renderMarkdown(text))
        : renderMarkdown(text);
    },
    decorate(element) {
      return finalizing
        ? measureFinalizationStage("decorate", () => decorate(element))
        : decorate(element);
    },
    follow() {
      return finalizing
        ? measureFinalizationStage("follow", () => follow())
        : follow();
    },
  });
  const seed =
    "Plain text 中文😀 with a stable selection.\n\n```js\nconst value = 42;\n```\n";
  const text = seed.repeat(Math.ceil(chars / seed.length)).slice(0, chars);
  let selectionStable = true;
  let streamingParseCalls;
  let previousFrame;
  let selectedNode;
  let selectedText;
  const started = performance.now();
  try {
    // 64 actual frames for every size keep cadence comparable. Frame intervals
    // include browser scheduling/layout; update durations measure renderer work.
    for (let i = 1; i <= 64; i++) {
      const at = await frame();
      if (previousFrame !== undefined) frames.push(at - previousFrame);
      previousFrame = at;
      const before = performance.now();
      renderer.update(element, text.slice(0, Math.ceil((chars * i) / 64)));
      durations.push(performance.now() - before);
      if (i === 1) {
        selectedNode = element.firstChild;
        const range = document.createRange();
        range.setStart(selectedNode, 0);
        range.setEnd(selectedNode, 10);
        selection.addRange(range);
        selectedText = selection.toString();
      } else {
        selectionStable =
          selectionStable &&
          element.firstChild === selectedNode &&
          selection.toString() === selectedText;
      }
      completedFrames = i;
      if (i === 1 || i % 16 === 0) progress("sampling");
    }
    streamingParseCalls = parseCalls;
    progress("finalizing");
    const beforeFinish = performance.now();
    finalizing = true;
    renderer.finish(element, text);
    const deferredWhileSelected =
      parseCalls === 0 && element.firstChild === selectedNode;
    selection.removeAllRanges();
    // Exercise the same selection-change callback used by ordinary replies.
    document.dispatchEvent(new Event("selectionchange"));
    const finalizationMs = performance.now() - beforeFinish;
    finalizing = false;
    // This residual includes innerHTML assignment, selection checks/clearing,
    // event dispatch and instrumentation overhead; it is NOT pure DOM time.
    // follow can include forced style/layout from the production scroll hook.
    finalizationStagesMs.residualIncludingDomAndOverhead =
      finalizationMs -
      finalizationStagesMs.markdown -
      finalizationStagesMs.decorate -
      finalizationStagesMs.follow;
    const controls = element.querySelectorAll(".codebar button").length;
    const beforeRepeat = parseCalls;
    renderer.finish(element, text);
    const finalizationIdempotent = parseCalls === beforeRepeat;
    await frame();
    await frame();
    if (observer)
      for (const entry of observer.takeRecords())
        longestTaskMs = Math.max(longestTaskMs, entry.duration);
    progress("completed");
    const percentile = (values, p) =>
      [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
    return {
      schema: "cc-ide-streaming-profile/v2",
      chars,
      samples: durations.length,
      frameSamples: frames.length,
      frameIntervalsMs: frames,
      updateDurationsMs: durations,
      frameP95Ms: percentile(frames, 0.95),
      updateP95Ms: percentile(durations, 0.95),
      longestUpdateMs: Math.max(...durations),
      finalizationMs,
      finalizationStagesMs,
      longTasksSupported,
      longestTaskMs: longTasksSupported ? longestTaskMs : null,
      streamingParseCalls,
      parseCalls,
      parseChars,
      childMutations,
      textMutations,
      selectionStable,
      deferredWhileSelected,
      finalizationIdempotent,
      codeControls: controls,
      elapsedMs: performance.now() - started,
      performanceGate: false,
    };
  } catch (error) {
    progress("failed");
    throw error;
  } finally {
    selection.removeAllRanges();
    for (const range of originalRanges) selection.addRange(range);
    renderer.dispose();
    mutations.disconnect();
    observer?.disconnect();
    element.remove();
    log.scrollTop = originalScrollTop;
  }
}

module.exports = { measureStreamingProfile };
