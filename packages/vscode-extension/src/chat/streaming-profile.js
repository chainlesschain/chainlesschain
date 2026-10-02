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
}) {
  if (![10_000, 100_000, 200_000].includes(chars))
    throw new TypeError("Unsupported streaming profile size");
  const element = document.createElement("div");
  element.className = "msg assistant";
  log.appendChild(element);
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
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
    }
    streamingParseCalls = parseCalls;
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
  } finally {
    selection.removeAllRanges();
    renderer.dispose();
    mutations.disconnect();
    observer?.disconnect();
    element.remove();
  }
}

module.exports = { measureStreamingProfile };
