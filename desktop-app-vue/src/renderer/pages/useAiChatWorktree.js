import { ref, computed, nextTick } from "vue";
import { message as antMessage } from "ant-design-vue";
import {
  formatWorktreePreviewRoute,
  getWorktreePreviewRouteKey,
  getWorktreeAutomationCandidateKey,
  buildWorktreePreviewPayload,
} from "./aiChatPageWorktreeUtils";

/**
 * AIChatPage 的隔离 worktree 评审逻辑 (review / merge / diff / delta / preview /
 * conflict / safe-automation)。从 AIChatPage.vue 抽出以缩减 SFC (5183 起拆分)。
 *
 * 依赖由页面 setup 注入:
 *  - codingAgentStore: Pinia store (worktree actions + 会话状态)
 *  - currentCodingAgentSessionId: 当前会话 id 的 computed ref
 *  - worktreeIsolationEnabled: 用户开关 ref (所有权留在页面;此处只读)
 *  - ensureCodingAgentSession: async fn (lazy — 页面用 () => ensureCodingAgentSession() 包装,
 *    打破 composable 调用早于该函数定义的环依赖)
 */
export function useAiChatWorktree({
  codingAgentStore,
  currentCodingAgentSessionId,
  worktreeIsolationEnabled,
  ensureCodingAgentSession,
  inputRef,
  agentMode,
}) {
  const WORKTREE_DELTA_FILTER_ALL = "all";
  const worktreeReviewVisible = ref(false);
  const worktreeMergeSubmitting = ref(false);
  const selectedWorktreePreview = ref(null);
  const worktreePreviewLoading = ref(false);
  const worktreePreviewLoadingKey = ref("");
  const worktreeAutomationLoadingKey = ref("");
  const worktreeMergePreviewDelta = ref(null);
  const worktreeDeltaFilter = ref(WORKTREE_DELTA_FILTER_ALL);

  const currentSessionWorktree = computed(() => {
    if (!currentCodingAgentSessionId.value) {
      return null;
    }
    if (
      codingAgentStore.currentSessionId !== currentCodingAgentSessionId.value
    ) {
      return null;
    }
    return codingAgentStore.currentSession?.worktree || null;
  });

  const currentSessionWorktreeIsolation = computed(() => {
    if (!currentCodingAgentSessionId.value) {
      return false;
    }
    if (
      codingAgentStore.currentSessionId !== currentCodingAgentSessionId.value
    ) {
      return false;
    }
    return codingAgentStore.currentSession?.worktreeIsolation === true;
  });

  const currentSessionWorktreeBranch = computed(() => {
    return (
      currentSessionWorktree.value?.branch ||
      codingAgentStore.currentSessionWorktreeDiff?.branch ||
      null
    );
  });

  const worktreeIsolationTooltip = computed(() => {
    if (currentSessionWorktreeIsolation.value) {
      return currentSessionWorktree.value?.path
        ? `Current session is isolated in ${currentSessionWorktree.value.path}. Toggling now only affects the next new agent session.`
        : "Current session is isolated. Toggling now only affects the next new agent session.";
    }

    return worktreeIsolationEnabled.value
      ? "New coding-agent sessions will start in a dedicated git worktree when the project is a git repo."
      : "Use the shared workspace for new coding-agent sessions. Enable this before the first agent message if you want isolated edits.";
  });

  const currentWorktreeAlert = computed(() => {
    if (!currentSessionWorktreeIsolation.value) {
      return "";
    }

    const details = [];
    const worktreePath = currentSessionWorktree.value?.path || null;
    const baseProjectRoot =
      codingAgentStore.currentSession?.baseProjectRoot || null;

    if (worktreePath) {
      details.push(`Workspace: ${worktreePath}`);
    }

    if (baseProjectRoot) {
      details.push(`Base project: ${baseProjectRoot}`);
    }

    return (
      details.join(" | ") ||
      "This coding-agent session is running inside an isolated git worktree."
    );
  });

  const worktreeReviewTitle = computed(() => {
    return currentSessionWorktreeBranch.value
      ? `Review Worktree: ${currentSessionWorktreeBranch.value}`
      : "Review Worktree";
  });

  const availableAgentWorktrees = computed(() => {
    return codingAgentStore.worktrees || [];
  });

  const currentWorktreeDiff = computed(() => {
    return codingAgentStore.currentSessionWorktreeDiff || null;
  });

  const currentWorktreeDiffFiles = computed(() => {
    return currentWorktreeDiff.value?.files || [];
  });

  const currentWorktreeDiffPathSet = computed(() => {
    return new Set(
      currentWorktreeDiffFiles.value
        .map((file) => file?.path || null)
        .filter(Boolean),
    );
  });

  const currentWorktreeDiffSummary = computed(() => {
    return (
      currentWorktreeDiff.value?.summary ||
      currentSessionWorktree.value?.summary ||
      null
    );
  });

  const currentWorktreeDiffPatch = computed(() => {
    return currentWorktreeDiff.value?.diff || "";
  });

  const currentWorktreeMergeResult = computed(() => {
    return codingAgentStore.currentSessionWorktreeMergeResult || null;
  });

  const currentWorktreeMergeSectionTitle = computed(() => {
    return currentWorktreeMergeResult.value?.previewOnly
      ? "Latest merge preview"
      : "Latest merge result";
  });

  const currentWorktreeMergeAlertType = computed(() => {
    return currentWorktreeMergeResult.value?.success ? "success" : "warning";
  });

  const currentWorktreeMergeAlertMessage = computed(() => {
    if (!currentWorktreeMergeResult.value) {
      return "";
    }

    if (currentWorktreeMergeResult.value.previewOnly) {
      return currentWorktreeMergeResult.value.success
        ? "Merge preview is clean"
        : "Merge preview needs attention";
    }

    return currentWorktreeMergeResult.value.success
      ? "Merge completed"
      : "Merge needs attention";
  });

  const currentWorktreeMergeAlertDescription = computed(() => {
    if (!currentWorktreeMergeResult.value) {
      return "No merge message available.";
    }

    if (currentWorktreeMergeResult.value.previewOnly) {
      return currentWorktreeMergeResult.value.success
        ? "No conflicts are currently predicted for this worktree merge."
        : "Conflicts are currently predicted for this worktree merge.";
    }

    return "No merge message available.";
  });

  const currentWorktreeMergePreviewDelta = computed(() => {
    if (!currentWorktreeMergeResult.value?.previewOnly) {
      return null;
    }

    return worktreeMergePreviewDelta.value;
  });

  const sortedWorktreeAddedDeltaEntries = computed(() => {
    const filePaths = currentWorktreeMergePreviewDelta.value?.addedPaths || [];
    return buildSortedWorktreeDeltaEntries(filePaths, "added");
  });

  const sortedWorktreeResolvedDeltaEntries = computed(() => {
    const filePaths =
      currentWorktreeMergePreviewDelta.value?.resolvedPaths || [];
    return buildSortedWorktreeDeltaEntries(filePaths, "resolved");
  });

  const filteredWorktreeAddedDeltaEntries = computed(() => {
    return sortedWorktreeAddedDeltaEntries.value.filter((entry) => {
      return matchesWorktreeDeltaFilter(entry, worktreeDeltaFilter.value);
    });
  });

  const filteredWorktreeResolvedDeltaEntries = computed(() => {
    return sortedWorktreeResolvedDeltaEntries.value.filter((entry) => {
      return matchesWorktreeDeltaFilter(entry, worktreeDeltaFilter.value);
    });
  });

  const worktreeDeltaSummaryCards = computed(() => {
    const entries = [
      ...sortedWorktreeAddedDeltaEntries.value,
      ...sortedWorktreeResolvedDeltaEntries.value,
    ];
    if (entries.length === 0) {
      return [];
    }

    const summary = {
      urgent: 0,
      watch: 0,
      clean: 0,
    };

    for (const entry of entries) {
      const bucket = mapWorktreeDeltaToneToSummaryBucket(entry.state.tone);
      summary[bucket] += 1;
    }

    return [
      {
        key: WORKTREE_DELTA_FILTER_ALL,
        label: "All",
        count: entries.length,
        tone: "all",
      },
      {
        key: "urgent",
        label: "Urgent",
        count: summary.urgent,
        tone: "conflict",
      },
      { key: "watch", label: "Watch", count: summary.watch, tone: "warning" },
      { key: "clean", label: "Clean", count: summary.clean, tone: "clean" },
    ]
      .filter(
        (item) => item.key === WORKTREE_DELTA_FILTER_ALL || item.count > 0,
      )
      .map((item) => ({
        ...item,
        active: item.key === worktreeDeltaFilter.value,
      }));
  });

  const currentWorktreeMergeSuggestions = computed(() => {
    return currentWorktreeMergeResult.value?.suggestions || [];
  });

  const currentWorktreePreviewEntrypoints = computed(() => {
    return currentWorktreeMergeResult.value?.previewEntrypoints || [];
  });

  const selectedWorktreePreviewTitle = computed(() => {
    if (!selectedWorktreePreview.value) {
      return "";
    }

    return selectedWorktreePreview.value.title || "Focused preview";
  });

  const selectedWorktreePreviewRouteLabel = computed(() => {
    if (!selectedWorktreePreview.value?.route) {
      return "";
    }

    return formatWorktreePreviewRoute(selectedWorktreePreview.value.route);
  });

  const selectedWorktreePreviewDescription = computed(() => {
    if (!selectedWorktreePreview.value) {
      return "Preview generated from the current worktree diff.";
    }

    const details = [];
    if (selectedWorktreePreviewRouteLabel.value) {
      details.push(selectedWorktreePreviewRouteLabel.value);
    }
    if (selectedWorktreePreview.value.sourceLabel) {
      details.push(`Source: ${selectedWorktreePreview.value.sourceLabel}`);
    }
    if (selectedWorktreePreview.value.filePath) {
      details.push(`File: ${selectedWorktreePreview.value.filePath}`);
    }
    if (selectedWorktreePreview.value.refreshedAtLabel) {
      details.push(
        `Updated: ${selectedWorktreePreview.value.refreshedAtLabel}`,
      );
    }

    return (
      details.join(" | ") || "Preview generated from the current worktree diff."
    );
  });

  const currentWorktreeConflicts = computed(() => {
    if (currentWorktreeMergeResult.value?.conflicts?.length) {
      return currentWorktreeMergeResult.value.conflicts;
    }

    return currentSessionWorktree.value?.conflicts || [];
  });

  const getWorktreeConflictPath = (conflict) => {
    return conflict?.path || conflict?.filePath || null;
  };

  const getWorktreeConflictType = (conflict) => {
    return conflict?.type || "unmerged";
  };

  const formatWorktreeConflictTypeLabel = (type) => {
    return String(type || "unmerged").replace(/_/g, " ");
  };

  const buildWorktreeConflictTypeCountMap = (conflicts) => {
    return (conflicts || []).reduce((accumulator, conflict) => {
      const type = getWorktreeConflictType(conflict);
      accumulator[type] = (accumulator[type] || 0) + 1;
      return accumulator;
    }, {});
  };

  const formatWorktreeConflictTypeDelta = (
    previousConflicts,
    nextConflicts,
  ) => {
    const previousCounts = buildWorktreeConflictTypeCountMap(previousConflicts);
    const nextCounts = buildWorktreeConflictTypeCountMap(nextConflicts);
    const changedTypes = [
      ...new Set([...Object.keys(previousCounts), ...Object.keys(nextCounts)]),
    ]
      .filter((type) => (previousCounts[type] || 0) !== (nextCounts[type] || 0))
      .sort();

    if (changedTypes.length === 0) {
      return "";
    }

    return changedTypes
      .map((type) => {
        return `${formatWorktreeConflictTypeLabel(type)}: ${previousCounts[type] || 0} -> ${nextCounts[type] || 0}`;
      })
      .join("; ");
  };

  const buildWorktreeMergePreviewDelta = (previousResult, nextResult) => {
    if (!previousResult?.previewOnly || !nextResult?.previewOnly) {
      return null;
    }

    const previousPaths = new Set(
      (previousResult.conflicts || [])
        .map((conflict) => getWorktreeConflictPath(conflict))
        .filter(Boolean),
    );
    const nextPaths = new Set(
      (nextResult.conflicts || [])
        .map((conflict) => getWorktreeConflictPath(conflict))
        .filter(Boolean),
    );

    const resolvedPaths = [...previousPaths].filter(
      (filePath) => !nextPaths.has(filePath),
    );
    const addedPaths = [...nextPaths].filter(
      (filePath) => !previousPaths.has(filePath),
    );
    const previousCount = previousPaths.size;
    const currentCount = nextPaths.size;
    const typeDelta = formatWorktreeConflictTypeDelta(
      previousResult.conflicts || [],
      nextResult.conflicts || [],
    );

    if (
      resolvedPaths.length === 0 &&
      addedPaths.length === 0 &&
      previousCount === currentCount &&
      !typeDelta
    ) {
      return null;
    }

    const detailParts = [`Conflicts: ${previousCount} -> ${currentCount}`];
    if (typeDelta) {
      detailParts.push(`Types: ${typeDelta}`);
    }

    if (currentCount === 0 && previousCount > 0) {
      return {
        type: "success",
        message: "Conflict preview is now clean",
        description: detailParts.join(" | "),
        resolvedPaths,
        addedPaths,
      };
    }

    if (currentCount < previousCount) {
      return {
        type: "success",
        message: "Conflict count dropped",
        description: detailParts.join(" | "),
        resolvedPaths,
        addedPaths,
      };
    }

    return {
      type: "info",
      message: "Conflict set changed",
      description: detailParts.join(" | "),
      resolvedPaths,
      addedPaths,
    };
  };

  const buildWorktreeDeltaPreviewRoute = (filePath) => {
    return {
      type: "worktree-diff",
      branch:
        currentWorktreeMergeResult.value?.branch ||
        currentSessionWorktreeBranch.value ||
        undefined,
      filePath,
    };
  };

  const getWorktreeDeltaFileStateMeta = (filePath, kind) => {
    const stillChanged = currentWorktreeDiffPathSet.value.has(filePath);

    if (kind === "resolved") {
      return stillChanged
        ? { label: "resolved, diff remains", tone: "resolved" }
        : { label: "resolved and clean", tone: "clean" };
    }

    return stillChanged
      ? { label: "new conflict, diff remains", tone: "conflict" }
      : { label: "new conflict", tone: "warning" };
  };

  const getWorktreeDeltaFileStatePriority = (kind, state) => {
    if (kind === "added") {
      return state.tone === "conflict" ? 0 : 1;
    }

    return state.tone === "resolved" ? 2 : 3;
  };

  const mapWorktreeDeltaToneToSummaryBucket = (tone) => {
    switch (tone) {
      case "conflict":
        return "urgent";
      case "warning":
      case "resolved":
        return "watch";
      case "clean":
      default:
        return "clean";
    }
  };

  const matchesWorktreeDeltaFilter = (entry, filterKey) => {
    if (!entry || filterKey === WORKTREE_DELTA_FILTER_ALL) {
      return true;
    }

    return mapWorktreeDeltaToneToSummaryBucket(entry.state.tone) === filterKey;
  };

  const buildSortedWorktreeDeltaEntries = (filePaths, kind) => {
    return [...(filePaths || [])]
      .map((filePath) => {
        const state = getWorktreeDeltaFileStateMeta(filePath, kind);
        return {
          filePath,
          state,
          priority: getWorktreeDeltaFileStatePriority(kind, state),
        };
      })
      .sort((left, right) => {
        if (left.priority !== right.priority) {
          return left.priority - right.priority;
        }
        return left.filePath.localeCompare(right.filePath);
      });
  };

  const handleSelectWorktreeDeltaFilter = (filterKey) => {
    if (!filterKey || filterKey === worktreeDeltaFilter.value) {
      worktreeDeltaFilter.value = WORKTREE_DELTA_FILTER_ALL;
      return;
    }

    worktreeDeltaFilter.value = filterKey;
  };

  // Pure worktree helpers moved to ./aiChatPageWorktreeUtils.js. Two
  // reactive predicates stay below — they read live refs/store state.

  const isWorktreePreviewRouteLoading = (preview) => {
    return (
      worktreePreviewLoading.value &&
      worktreePreviewLoadingKey.value === getWorktreePreviewRouteKey(preview)
    );
  };

  const isWorktreeAutomationCandidateLoading = (conflict, candidate) => {
    return (
      codingAgentStore.worktreeLoading &&
      worktreeAutomationLoadingKey.value ===
        getWorktreeAutomationCandidateKey(conflict, candidate)
    );
  };

  const handleSelectWorktreePreview = async (preview, options = {}) => {
    worktreePreviewLoading.value = true;
    worktreePreviewLoadingKey.value = getWorktreePreviewRouteKey(preview);

    try {
      if (preview?.type === "worktree-diff" && preview?.filePath) {
        try {
          const result = await codingAgentStore.loadWorktreePreview({
            branch:
              preview.branch || currentSessionWorktreeBranch.value || undefined,
            baseBranch: currentSessionWorktree.value?.baseBranch || undefined,
            filePath: preview.filePath,
          });

          selectedWorktreePreview.value = buildWorktreePreviewPayload(preview, {
            ...options,
            title: options.title || preview.filePath,
            snippet: result.diff || options.snippet || "",
            filePath: preview.filePath,
            source: "host-file-diff",
            refreshedAt: new Date().toISOString(),
            currentDiffPatch: currentWorktreeDiffPatch.value,
          });
          return;
        } catch (error) {
          antMessage.warning(
            "Failed to load file-specific preview, falling back to the cached diff: " +
              error.message,
          );
        }
      }

      selectedWorktreePreview.value = buildWorktreePreviewPayload(preview, {
        ...options,
        source: options.snippet ? "conflict-snippet" : "cached-diff",
        refreshedAt: new Date().toISOString(),
        currentDiffPatch: currentWorktreeDiffPatch.value,
      });
    } finally {
      worktreePreviewLoading.value = false;
      worktreePreviewLoadingKey.value = "";
    }
  };

  const handleRefreshSelectedWorktreePreview = async () => {
    if (!selectedWorktreePreview.value?.route) {
      return;
    }

    await handleSelectWorktreePreview(selectedWorktreePreview.value.route, {
      title: selectedWorktreePreview.value.title,
      filePath: selectedWorktreePreview.value.filePath,
      snippet:
        selectedWorktreePreview.value.source === "conflict-snippet"
          ? selectedWorktreePreview.value.content
          : "",
    });
  };

  const truncateWorktreePreviewContent = (value, maxLength = 1800) => {
    if (!value) {
      return "";
    }

    const text = String(value).trim();
    if (text.length <= maxLength) {
      return text;
    }

    return `${text.slice(0, maxLength)}\n... [preview truncated]`;
  };

  const getRelevantConflictPreview = (conflict) => {
    const targetPath = conflict?.path || conflict?.filePath || null;
    const selectedRoute = selectedWorktreePreview.value?.route || null;
    const selectedMatchesTarget =
      targetPath &&
      (selectedRoute?.filePath === targetPath ||
        selectedWorktreePreview.value?.title === targetPath);

    if (selectedMatchesTarget && selectedWorktreePreview.value?.content) {
      return {
        route: selectedRoute,
        content: selectedWorktreePreview.value.content,
      };
    }

    if (conflict?.diffPreview?.snippet) {
      return {
        route: conflict.diffPreview.route || null,
        content: conflict.diffPreview.snippet,
      };
    }

    if (selectedWorktreePreview.value?.content) {
      return {
        route: selectedRoute,
        content: selectedWorktreePreview.value.content,
      };
    }

    return null;
  };

  const buildWorktreeAutomationPrompt = (conflict, candidate) => {
    const targetPath =
      conflict?.path || conflict?.filePath || "the conflicted file";
    const preview = getRelevantConflictPreview(conflict);
    const lines = [
      `Resolve the merge conflict for ${targetPath}.`,
      "",
      "Conflict context:",
      `- File: ${targetPath}`,
      `- Conflict type: ${conflict?.type || "unknown"}`,
      `- Recommended approach: ${candidate?.label || candidate?.id || "manual resolution"}`,
    ];

    if (candidate?.confidence) {
      lines.push(`- Candidate confidence: ${candidate.confidence}`);
    }

    if (conflict?.suggestion) {
      lines.push(`- Conflict guidance: ${conflict.suggestion}`);
    }

    if (candidate?.description) {
      lines.push(`- Candidate context: ${candidate.description}`);
    }

    if (candidate?.command) {
      lines.push(`- Proposed command: ${candidate.command}`);
    }

    if (preview?.route) {
      lines.push(
        `- Preview route: ${formatWorktreePreviewRoute(preview.route)}`,
      );
    }

    if (preview?.content) {
      lines.push("");
      lines.push("Relevant diff preview:");
      lines.push("```diff");
      lines.push(truncateWorktreePreviewContent(preview.content));
      lines.push("```");
    }

    lines.push("");
    lines.push("Instructions:");
    lines.push("- Explain the conflict and the chosen resolution briefly.");
    lines.push("- Apply the resolution inside the isolated worktree.");
    lines.push(
      "- If shell commands are needed, follow the normal plan approval and high-risk confirmation flow before execution.",
    );
    lines.push(
      "- After resolving, summarize the final file state and any remaining risks.",
    );

    return lines.join("\n");
  };

  const handleCopyWorktreeAutomationCommand = async (candidate) => {
    if (!candidate?.command) {
      antMessage.warning("No automation command is available for this action.");
      return;
    }

    try {
      await navigator.clipboard.writeText(candidate.command);
      antMessage.success("Automation command copied.");
    } catch (error) {
      antMessage.error("Failed to copy automation command: " + error.message);
    }
  };

  const handlePrepareWorktreeAutomationCandidate = async (
    conflict,
    candidate,
  ) => {
    const prompt = buildWorktreeAutomationPrompt(conflict, candidate);
    if (!inputRef.value?.setText) {
      antMessage.warning("The conversation input is not ready yet.");
      return;
    }

    agentMode.value = true;
    inputRef.value.setText(prompt);
    await nextTick();
    inputRef.value.focus?.();
    antMessage.info(
      "Suggested conflict resolution has been added to the input box.",
    );
  };

  const handleApplyWorktreeAutomationCandidate = async (
    conflict,
    candidate,
  ) => {
    const filePath = conflict?.path || conflict?.filePath || null;
    if (!filePath || !candidate?.id) {
      antMessage.warning(
        "This automation candidate is missing the required file context.",
      );
      return;
    }

    const confirmed = await window.electronAPI.dialog.showConfirm(
      "Run Safe Worktree Action",
      `Apply "${candidate.label || candidate.id}" to ${filePath} inside the isolated agent worktree? This updates the agent branch only and clears the current conflict preview until you review the merge again.`,
    );
    if (!confirmed) {
      return;
    }

    worktreeAutomationLoadingKey.value = getWorktreeAutomationCandidateKey(
      conflict,
      candidate,
    );

    try {
      await ensureCodingAgentSession();
      const previousPreviewResult = currentWorktreeMergeResult.value
        ?.previewOnly
        ? currentWorktreeMergeResult.value
        : null;
      const result = await codingAgentStore.applyWorktreeAutomationCandidate({
        branch: currentSessionWorktreeBranch.value || undefined,
        baseBranch: currentSessionWorktree.value?.baseBranch || undefined,
        filePath,
        candidateId: candidate.id,
        conflictType: conflict?.type || null,
      });

      if (
        selectedWorktreePreview.value?.filePath &&
        selectedWorktreePreview.value.filePath === filePath
      ) {
        await handleRefreshSelectedWorktreePreview();
      }

      const nextPreviewResult =
        await codingAgentStore.previewCurrentWorktreeMerge({
          branch: currentSessionWorktreeBranch.value || undefined,
          baseBranch: currentSessionWorktree.value?.baseBranch || undefined,
        });
      worktreeMergePreviewDelta.value = buildWorktreeMergePreviewDelta(
        previousPreviewResult,
        nextPreviewResult,
      );

      antMessage.success(
        result.message ||
          `Applied ${candidate.label || candidate.id} in the isolated worktree.`,
      );
    } catch (error) {
      antMessage.error(
        "Failed to apply the safe worktree action: " + error.message,
      );
    } finally {
      worktreeAutomationLoadingKey.value = "";
    }
  };

  const loadWorktreeReview = async () => {
    const previousPreviewResult = currentWorktreeMergeResult.value?.previewOnly
      ? currentWorktreeMergeResult.value
      : null;
    const branch = currentSessionWorktreeBranch.value;
    await codingAgentStore.listWorktrees();
    await codingAgentStore.loadCurrentWorktreeDiff({
      branch: branch || undefined,
      baseBranch: currentSessionWorktree.value?.baseBranch || undefined,
    });
    const nextPreviewResult =
      await codingAgentStore.previewCurrentWorktreeMerge({
        branch: branch || undefined,
        baseBranch: currentSessionWorktree.value?.baseBranch || undefined,
      });
    worktreeMergePreviewDelta.value = buildWorktreeMergePreviewDelta(
      previousPreviewResult,
      nextPreviewResult,
    );

    if (selectedWorktreePreview.value?.route) {
      await handleSelectWorktreePreview(selectedWorktreePreview.value.route, {
        title: selectedWorktreePreview.value.title,
      });
    }
  };

  const handleOpenWorktreeReview = async () => {
    try {
      await ensureCodingAgentSession();
      if (!currentSessionWorktreeIsolation.value) {
        antMessage.info(
          "The current coding-agent session is not using an isolated worktree.",
        );
        return;
      }

      worktreeReviewVisible.value = true;
      worktreeDeltaFilter.value = WORKTREE_DELTA_FILTER_ALL;
      selectedWorktreePreview.value = null;
      worktreeMergePreviewDelta.value = null;
      await loadWorktreeReview();
    } catch (error) {
      antMessage.error("Failed to load worktree review: " + error.message);
    }
  };

  const handleRefreshWorktreeReview = async () => {
    try {
      await loadWorktreeReview();
      antMessage.success("Worktree review refreshed.");
    } catch (error) {
      antMessage.error("Failed to refresh worktree review: " + error.message);
    }
  };

  const handleMergeCurrentWorktree = async () => {
    try {
      await ensureCodingAgentSession();
      if (
        !currentSessionWorktreeIsolation.value ||
        !currentSessionWorktreeBranch.value
      ) {
        antMessage.warning(
          "No isolated worktree is available for this session.",
        );
        return;
      }

      const confirmed = await window.electronAPI.dialog.showConfirm(
        "Merge Worktree",
        `Merge ${currentSessionWorktreeBranch.value} back into ${currentSessionWorktree.value?.baseBranch || "HEAD"}?`,
      );

      if (!confirmed) {
        return;
      }

      worktreeMergeSubmitting.value = true;
      worktreeMergePreviewDelta.value = null;
      const result = await codingAgentStore.mergeCurrentWorktree({
        branch: currentSessionWorktreeBranch.value,
        strategy: "merge",
        commitMessage: `Merge ${currentSessionWorktreeBranch.value} (coding agent session)`,
      });

      await codingAgentStore.listWorktrees();

      if (result.success) {
        antMessage.success(result.message || "Worktree merged successfully.");
      } else if (result.conflicts.length > 0) {
        antMessage.warning(result.message || "Merge conflicts detected.");
      } else {
        antMessage.warning(
          result.message || "Worktree merge did not complete.",
        );
      }
    } catch (error) {
      antMessage.error("Failed to merge worktree: " + error.message);
    } finally {
      worktreeMergeSubmitting.value = false;
    }
  };

  return {
    worktreeReviewVisible,
    worktreeMergeSubmitting,
    selectedWorktreePreview,
    worktreePreviewLoading,
    currentSessionWorktree,
    currentSessionWorktreeIsolation,
    currentSessionWorktreeBranch,
    worktreeIsolationTooltip,
    currentWorktreeAlert,
    worktreeReviewTitle,
    availableAgentWorktrees,
    currentWorktreeDiffFiles,
    currentWorktreeDiffSummary,
    currentWorktreeDiffPatch,
    currentWorktreeMergeResult,
    currentWorktreeMergeSectionTitle,
    currentWorktreeMergeAlertType,
    currentWorktreeMergeAlertMessage,
    currentWorktreeMergeAlertDescription,
    currentWorktreeMergePreviewDelta,
    filteredWorktreeAddedDeltaEntries,
    filteredWorktreeResolvedDeltaEntries,
    worktreeDeltaSummaryCards,
    currentWorktreeMergeSuggestions,
    currentWorktreePreviewEntrypoints,
    selectedWorktreePreviewTitle,
    selectedWorktreePreviewDescription,
    currentWorktreeConflicts,
    buildWorktreeDeltaPreviewRoute,
    handleSelectWorktreeDeltaFilter,
    isWorktreePreviewRouteLoading,
    isWorktreeAutomationCandidateLoading,
    handleSelectWorktreePreview,
    handleRefreshSelectedWorktreePreview,
    handleCopyWorktreeAutomationCommand,
    handlePrepareWorktreeAutomationCandidate,
    handleApplyWorktreeAutomationCandidate,
    handleOpenWorktreeReview,
    handleRefreshWorktreeReview,
    handleMergeCurrentWorktree,
  };
}
