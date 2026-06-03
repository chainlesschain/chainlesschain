import { ref, onUnmounted } from "vue";
import { message, Modal } from "ant-design-vue";
import { logger } from "@/utils/logger";

/**
 * Git operations + modal state for ProjectDetailPage. Owns:
 *   - 1 status ref + 4 modal/commit-state refs
 *   - 9 handlers (refresh, init-check, init, commit dialog flow, push, pull,
 *     dispatcher with init-prompt fallback)
 *   - polling interval lifecycle (auto-cleanup on unmount)
 *
 * @param {Object} ctx
 * @param {import('vue').Ref<string>}  ctx.projectId       Active project id (.value).
 * @param {import('vue').Ref<Object>}  ctx.currentProject  Project record with root_path (.value).
 * @param {Object}                     ctx.projectStore    Pinia project store (gitCommit/gitPush/gitPull/initGit).
 * @param {() => Promise<void>}        [ctx.onRefreshFiles] Called after a successful pull, to re-scan the file tree.
 * @param {number}                     [ctx.pollIntervalMs=30000]
 */
export function useProjectGit({
  projectId,
  currentProject,
  projectStore,
  onRefreshFiles,
  pollIntervalMs = 30000,
}) {
  const gitStatus = ref({});
  const showGitStatusModal = ref(false);
  const showGitHistoryModal = ref(false);
  const showGitCommitModal = ref(false);
  const commitMessage = ref("");
  const committing = ref(false);

  let gitStatusInterval = null;

  const refreshGitStatus = async () => {
    if (!currentProject.value?.root_path) {
      return;
    }
    try {
      const status = await window.electronAPI.project.gitStatus(
        currentProject.value.root_path,
      );
      if (status) {
        gitStatus.value = status;
      }
    } catch (error) {
      // Silent — project may not be a Git repo, that's fine.
      logger.error("[ProjectGit] 获取 Git 状态失败:", error);
    }
  };

  const checkGitInitialized = async () => {
    if (!currentProject.value?.root_path) {
      return false;
    }
    try {
      const exists = await window.electronAPI.file.exists(
        currentProject.value.root_path + "/.git",
      );
      return exists;
    } catch (error) {
      logger.error("[ProjectGit] 检查 Git 初始化状态失败:", error);
      return false;
    }
  };

  const initializeGitRepo = async () => {
    try {
      await projectStore.initGit(projectId.value);
      message.success("Git 仓库初始化成功");
      return true;
    } catch (error) {
      logger.error("[ProjectGit] Git 初始化失败:", error);
      message.error("Git 初始化失败：" + error.message);
      return false;
    }
  };

  const showGitStatus = async () => {
    showGitStatusModal.value = true;
  };

  const handleShowCommitDialog = () => {
    showGitStatusModal.value = false;
    showGitCommitModal.value = true;
  };

  const handleConfirmCommit = async () => {
    if (!commitMessage.value.trim()) {
      message.warning("请输入提交信息");
      return;
    }
    committing.value = true;
    try {
      await projectStore.gitCommit(projectId.value, commitMessage.value);
      message.success("提交成功");
      showGitCommitModal.value = false;
      commitMessage.value = "";
    } catch (error) {
      logger.error("[ProjectGit] commit failed:", error);
      message.error("提交失败：" + error.message);
    } finally {
      committing.value = false;
    }
  };

  const handleGitPush = async () => {
    try {
      await projectStore.gitPush(currentProject.value.root_path);
      message.success("推送成功");
    } catch (error) {
      logger.error("[ProjectGit] push failed:", error);
      message.error("推送失败：" + error.message);
    }
  };

  const handleGitPull = async () => {
    try {
      await projectStore.gitPull(currentProject.value.root_path);
      message.success("拉取成功");
      if (onRefreshFiles) {
        await onRefreshFiles();
      }
    } catch (error) {
      logger.error("[ProjectGit] pull failed:", error);
      message.error("拉取失败：" + error.message);
    }
  };

  const executeGitAction = async (key) => {
    switch (key) {
      case "status":
        await showGitStatus();
        break;
      case "history":
        showGitHistoryModal.value = true;
        break;
      case "commit":
        showGitCommitModal.value = true;
        break;
      case "push":
        await handleGitPush();
        break;
      case "pull":
        await handleGitPull();
        break;
    }
  };

  const handleGitAction = async ({ key }) => {
    const needsGitInit = ["commit", "push", "pull", "history", "status"];
    if (needsGitInit.includes(key)) {
      const isInitialized = await checkGitInitialized();
      if (!isInitialized) {
        Modal.confirm({
          title: "Git 仓库未初始化",
          content: "当前项目还未初始化 Git 仓库，是否立即初始化？",
          okText: "立即初始化",
          cancelText: "取消",
          onOk: async () => {
            const success = await initializeGitRepo();
            if (success) {
              await executeGitAction(key);
            }
          },
        });
        return;
      }
    }
    await executeGitAction(key);
  };

  /** Start the recurring git-status poll. Caller invokes from onMounted. */
  const startStatusPolling = async () => {
    await refreshGitStatus();
    gitStatusInterval = setInterval(() => {
      refreshGitStatus().catch((err) => {
        logger.error("[ProjectGit] poll error:", err);
      });
    }, pollIntervalMs);
  };

  // Composable owns its own teardown — caller doesn't need to track the timer.
  onUnmounted(() => {
    if (gitStatusInterval) {
      clearInterval(gitStatusInterval);
      gitStatusInterval = null;
    }
  });

  return {
    // state
    gitStatus,
    showGitStatusModal,
    showGitHistoryModal,
    showGitCommitModal,
    commitMessage,
    committing,
    // actions
    refreshGitStatus,
    startStatusPolling,
    handleGitAction,
    handleShowCommitDialog,
    handleConfirmCommit,
  };
}
