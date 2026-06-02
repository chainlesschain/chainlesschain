import { ref, computed, nextTick } from "vue";
import { message as antMessage } from "ant-design-vue";
import { createLogger } from "@/utils/logger";

/**
 * AIChatPage 的 harness 任务面板逻辑 (FAMILY-... SFC 拆分第四步)。
 *
 * coding-agent 后台任务/会话/worktree 状态镜像 + 任务列表过滤/分页/历史 + 抽屉导航 +
 * 每会话 UI 状态 persist/restore。从 AIChatPage.vue 抽出。
 *
 * **不含** ensureCodingAgentSession (session) 与事件分发 (useCodingAgentEvents) ——
 * 本 composable 与它们零调用耦合; refreshCodingAgentHarnessPanel 被页面的
 * ensureCodingAgentSession 反向调用 (经返回值)。
 *
 * 注入 (页面拥有的 store / ref):
 *  - codingAgentStore: harness 数据源
 *  - currentCodingAgentSessionId: 当前会话 id 的 computed
 *  - activeConversationId: 当前会话 (persist/restore key)
 */
export function useAiChatHarness({
  codingAgentStore,
  currentCodingAgentSessionId,
  activeConversationId,
}) {
  const agentLogger = createLogger("AIChatPageCodingAgent");

  const harnessUiStateByConversation = ref({});
  const harnessTaskDrawerVisible = ref(false);
  const harnessTaskHistoryLimit = ref(10);
  const harnessTaskStatusFilter = ref("active");
  const harnessTaskSearchQuery = ref("");
  const harnessTaskPage = ref(1);
  const restoringHarnessUiState = ref(false);
  const HARNESS_TASKS_PER_PAGE = 5;
  const createDefaultHarnessUiState = () => ({
    statusFilter: "active",
    searchQuery: "",
    page: 1,
    drawerVisible: false,
    selectedTaskId: null,
    historyLimit: 10,
  });

  const currentHarnessStatus = computed(() => {
    if (!currentCodingAgentSessionId.value) {
      return null;
    }
    return codingAgentStore.harnessStatus || null;
  });

  const currentHarnessSessions = computed(() => {
    return (
      currentHarnessStatus.value?.sessions || {
        total: 0,
        running: 0,
        waitingApproval: 0,
        active: 0,
      }
    );
  });

  const currentHarnessWorktrees = computed(() => {
    return (
      currentHarnessStatus.value?.worktrees || {
        tracked: 0,
        isolated: 0,
        dirty: 0,
      }
    );
  });

  const currentHarnessBackgroundTasks = computed(() => {
    return (
      currentHarnessStatus.value?.backgroundTasks || {
        total: 0,
        pending: 0,
        running: 0,
        completed: 0,
        failed: 0,
        timeout: 0,
      }
    );
  });

  const filteredHarnessTasks = computed(() => {
    const tasks = Array.isArray(codingAgentStore.backgroundTasks)
      ? codingAgentStore.backgroundTasks
      : [];

    const search = harnessTaskSearchQuery.value.trim().toLowerCase();

    return tasks.filter((task) => {
      const status = task?.status || "unknown";
      const matchesStatus =
        harnessTaskStatusFilter.value === "all"
          ? true
          : harnessTaskStatusFilter.value === "active"
            ? status === "running" || status === "pending"
            : status === harnessTaskStatusFilter.value;

      if (!matchesStatus) {
        return false;
      }

      if (!search) {
        return true;
      }

      const haystack = [
        task?.title,
        task?.name,
        task?.id,
        task?.status,
        task?.summary,
        task?.description,
        task?.type,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(search);
    });
  });

  const harnessTaskPageCount = computed(() => {
    return Math.max(
      1,
      Math.ceil(filteredHarnessTasks.value.length / HARNESS_TASKS_PER_PAGE),
    );
  });

  const visibleHarnessTasks = computed(() => {
    const start = (harnessTaskPage.value - 1) * HARNESS_TASKS_PER_PAGE;
    return filteredHarnessTasks.value.slice(
      start,
      start + HARNESS_TASKS_PER_PAGE,
    );
  });

  const harnessTaskPageRange = computed(() => {
    if (filteredHarnessTasks.value.length === 0) {
      return { start: 0, end: 0 };
    }

    const start = (harnessTaskPage.value - 1) * HARNESS_TASKS_PER_PAGE + 1;
    const end = Math.min(
      filteredHarnessTasks.value.length,
      start + HARNESS_TASKS_PER_PAGE - 1,
    );

    return { start, end };
  });

  const selectedHarnessTask = computed(() => {
    return codingAgentStore.selectedBackgroundTask || null;
  });

  const selectedHarnessTaskHistoryItems = computed(() => {
    const history = codingAgentStore.selectedBackgroundTaskHistory;
    if (Array.isArray(history)) {
      return history;
    }
    if (Array.isArray(history?.items)) {
      return history.items;
    }
    return [];
  });

  const selectedHarnessTaskHistoryTotal = computed(() => {
    const history = codingAgentStore.selectedBackgroundTaskHistory;
    if (typeof history?.total === "number") {
      return history.total;
    }
    return selectedHarnessTaskHistoryItems.value.length;
  });

  const selectedHarnessTaskHistoryHasMore = computed(() => {
    return (
      selectedHarnessTaskHistoryItems.value.length <
      selectedHarnessTaskHistoryTotal.value
    );
  });

  const selectedHarnessTaskIndex = computed(() => {
    if (!selectedHarnessTask.value) {
      return -1;
    }
    return filteredHarnessTasks.value.findIndex(
      (task) => task?.id === selectedHarnessTask.value?.id,
    );
  });

  const selectedHarnessTaskHasPrevious = computed(() => {
    return selectedHarnessTaskIndex.value > 0;
  });

  const selectedHarnessTaskHasNext = computed(() => {
    return (
      selectedHarnessTaskIndex.value >= 0 &&
      selectedHarnessTaskIndex.value < filteredHarnessTasks.value.length - 1
    );
  });

  const selectedHarnessTaskAlert = computed(() => {
    if (!selectedHarnessTask.value) {
      return "";
    }
    const details = [`Task ID: ${selectedHarnessTask.value.id}`];
    if (selectedHarnessTask.value.type) {
      details.push(`Type: ${selectedHarnessTask.value.type}`);
    }
    details.push(
      `${selectedHarnessTaskHistoryItems.value.length} history item(s) loaded`,
    );
    return details.join(" | ");
  });

  const showHarnessPanel = computed(() => {
    return Boolean(
      currentCodingAgentSessionId.value &&
      (currentHarnessStatus.value || filteredHarnessTasks.value.length > 0),
    );
  });

  const refreshCodingAgentHarnessPanel = async (options = {}) => {
    const { silent = false } = options;
    try {
      await codingAgentStore.refreshHarnessStatus();
      await codingAgentStore.loadBackgroundTasks();
      if (!silent) {
        antMessage.success("Coding-agent harness refreshed.");
      }
    } catch (error) {
      if (!silent) {
        antMessage.error("Failed to refresh coding-agent harness.");
      }
      agentLogger.warn("refresh coding agent harness failed:", error);
    }
  };

  const handleRefreshHarnessPanel = async () => {
    await refreshCodingAgentHarnessPanel();
  };

  const handleSetHarnessTaskFilter = (status) => {
    harnessTaskStatusFilter.value = status;
    harnessTaskPage.value = 1;
  };

  const handleNextHarnessTaskPage = () => {
    harnessTaskPage.value = Math.min(
      harnessTaskPage.value + 1,
      harnessTaskPageCount.value,
    );
  };

  const handlePreviousHarnessTaskPage = () => {
    harnessTaskPage.value = Math.max(1, harnessTaskPage.value - 1);
  };

  const persistHarnessUiState = (
    conversationId = activeConversationId.value,
  ) => {
    if (!conversationId) {
      return;
    }

    harnessUiStateByConversation.value = {
      ...harnessUiStateByConversation.value,
      [conversationId]: {
        statusFilter: harnessTaskStatusFilter.value,
        searchQuery: harnessTaskSearchQuery.value,
        page: harnessTaskPage.value,
        drawerVisible: harnessTaskDrawerVisible.value,
        selectedTaskId: codingAgentStore.selectedBackgroundTask?.id || null,
        historyLimit: harnessTaskHistoryLimit.value,
      },
    };
  };

  const handleInspectBackgroundTask = async (taskId, options = {}) => {
    const { openDrawer = true, silent = false, limit = 10 } = options;
    try {
      harnessTaskHistoryLimit.value = limit;
      await codingAgentStore.fetchBackgroundTask(taskId);
      await codingAgentStore.fetchBackgroundTaskHistory(taskId, {
        limit: harnessTaskHistoryLimit.value,
      });
      harnessTaskDrawerVisible.value = openDrawer;
    } catch (error) {
      if (!silent) {
        antMessage.error("Failed to load background task details.");
      }
      agentLogger.warn("inspect background task failed:", error);
    }
  };

  const restoreHarnessUiState = async (conversationId, options = {}) => {
    const { hydrateSelectedTask = false } = options;
    const state =
      harnessUiStateByConversation.value[conversationId] ||
      createDefaultHarnessUiState();

    restoringHarnessUiState.value = true;
    try {
      harnessTaskStatusFilter.value = state.statusFilter || "active";
      harnessTaskSearchQuery.value = state.searchQuery || "";
      harnessTaskPage.value = Math.max(1, state.page || 1);
      harnessTaskDrawerVisible.value = state.drawerVisible === true;
      harnessTaskHistoryLimit.value = state.historyLimit || 10;

      if (!state.selectedTaskId || !hydrateSelectedTask) {
        codingAgentStore.selectedBackgroundTask = null;
        codingAgentStore.selectedBackgroundTaskHistory = null;
        return;
      }

      await handleInspectBackgroundTask(state.selectedTaskId, {
        openDrawer: state.drawerVisible === true,
        silent: true,
        limit: state.historyLimit || 10,
      });
    } finally {
      await nextTick();
      restoringHarnessUiState.value = false;
    }
  };

  const handleLoadMoreBackgroundTaskHistory = async () => {
    const taskId = codingAgentStore.selectedBackgroundTask?.id;
    if (!taskId) {
      return;
    }

    try {
      harnessTaskHistoryLimit.value += 10;
      await codingAgentStore.fetchBackgroundTaskHistory(taskId, {
        limit: harnessTaskHistoryLimit.value,
      });
    } catch (error) {
      antMessage.error("Failed to load more task history.");
      agentLogger.warn("load more background task history failed:", error);
    }
  };

  const handleNavigateHarnessTask = async (direction) => {
    if (!selectedHarnessTask.value) {
      return;
    }

    const nextIndex = selectedHarnessTaskIndex.value + direction;
    const nextTask = filteredHarnessTasks.value[nextIndex];
    if (!nextTask?.id) {
      return;
    }

    await handleInspectBackgroundTask(nextTask.id);
  };

  const handleCloseHarnessTaskDrawer = () => {
    harnessTaskDrawerVisible.value = false;
  };

  const handleClearBackgroundTaskSelection = () => {
    harnessTaskDrawerVisible.value = false;
    harnessTaskHistoryLimit.value = 10;
    codingAgentStore.selectedBackgroundTask = null;
    codingAgentStore.selectedBackgroundTaskHistory = null;
  };

  const handleStopBackgroundTask = async (taskId) => {
    try {
      await codingAgentStore.stopBackgroundTask(taskId);
      if (codingAgentStore.selectedBackgroundTask?.id === taskId) {
        await handleInspectBackgroundTask(taskId);
      }
      antMessage.success("Background task stopped.");
    } catch (error) {
      antMessage.error("Failed to stop background task.");
      agentLogger.warn("stop background task failed:", error);
    }
  };

  return {
    harnessUiStateByConversation,
    harnessTaskDrawerVisible,
    harnessTaskHistoryLimit,
    harnessTaskStatusFilter,
    harnessTaskSearchQuery,
    harnessTaskPage,
    restoringHarnessUiState,
    HARNESS_TASKS_PER_PAGE,
    currentHarnessSessions,
    currentHarnessWorktrees,
    currentHarnessBackgroundTasks,
    filteredHarnessTasks,
    harnessTaskPageCount,
    visibleHarnessTasks,
    harnessTaskPageRange,
    selectedHarnessTask,
    selectedHarnessTaskHistoryItems,
    selectedHarnessTaskHistoryHasMore,
    selectedHarnessTaskHasPrevious,
    selectedHarnessTaskHasNext,
    selectedHarnessTaskAlert,
    showHarnessPanel,
    refreshCodingAgentHarnessPanel,
    handleRefreshHarnessPanel,
    handleSetHarnessTaskFilter,
    handleNextHarnessTaskPage,
    handlePreviousHarnessTaskPage,
    persistHarnessUiState,
    handleInspectBackgroundTask,
    restoreHarnessUiState,
    handleLoadMoreBackgroundTaskHistory,
    handleNavigateHarnessTask,
    handleCloseHarnessTaskDrawer,
    handleClearBackgroundTaskSelection,
    handleStopBackgroundTask,
  };
}
