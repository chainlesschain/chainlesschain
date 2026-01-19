/**
 * 项目管理页面改进示例
 * 展示如何集成 errorHandler 和 loadingManager
 */

/* eslint-disable */
// This is an example/documentation file - not meant to be executed

// 在 <script setup> 中导入工具
import {
  handleError,
  withRetry,
  ErrorType,
  ErrorLevel,
} from "@/utils/errorHandler";
import { useLoading, withLoading } from "@/utils/loadingManager";

// 使用加载状态
const {
  isLoading: isLoadingProjects,
  start: startLoadingProjects,
  finish: finishLoadingProjects,
} = useLoading("projects");
const {
  isLoading: isCreatingProject,
  start: startCreatingProject,
  finish: finishCreatingProject,
} = useLoading("createProject");

// ===== 改进前的代码 =====
/*
async function loadProjects() {
  try {
    const userId = authStore.currentUser?.id || 'default-user';
    await projectStore.fetchProjects(userId);
    await loadRecentConversations();
  } catch (error) {
    console.error('Failed to load projects:', error);
    message.error('加载项目失败：' + error.message);
  }
}
*/

// ===== 改进后的代码 =====
async function loadProjects() {
  await withLoading(
    "projects",
    async () => {
      const userId = authStore.currentUser?.id || "default-user";
      await projectStore.fetchProjects(userId);
      await loadRecentConversations();
    },
    {
      message: "加载项目列表...",
      errorMessage: "加载项目失败",
      showError: true,
    },
  ).catch((error) => {
    handleError(error, {
      showMessage: true,
      logToFile: true,
      context: { function: "loadProjects", userId: authStore.currentUser?.id },
    });
  });
}

// ===== 改进前的代码 =====
/*
async function handleConversationalCreate(userInput) {
  try {
    message.loading({ content: '正在创建项目...', key: 'ai-create', duration: 0 });

    const result = await window.electronAPI.projects.createProjectFromConversation({
      userInput,
      userId: authStore.currentUser?.id || 'default-user',
    });

    if (result.success) {
      message.success({ content: '项目创建成功！', key: 'ai-create', duration: 2 });
      router.push(`/projects/${result.projectId}`);
    }
  } catch (error) {
    console.error('Failed to create project:', error);
    message.error({ content: '创建失败：' + error.message, key: 'ai-create', duration: 3 });
  }
}
*/

// ===== 改进后的代码 =====
async function handleConversationalCreate(userInput) {
  try {
    const result = await withLoading(
      "createProject",
      async (updateProgress) => {
        // 添加用户消息到对话
        conversationMessages.value.push({
          type: "user",
          content: userInput,
          timestamp: Date.now(),
        });

        // 开始创建
        updateProgress(20);

        const result =
          await window.electronAPI.projects.createProjectFromConversation({
            userInput,
            userId: authStore.currentUser?.id || "default-user",
          });

        updateProgress(80);

        if (!result.success) {
          throw new Error(result.error || "项目创建失败");
        }

        return result;
      },
      {
        message: "正在创建项目...",
        successMessage: "项目创建成功！",
        errorMessage: "项目创建失败",
        showSuccess: true,
        showError: false, // 我们会自定义错误处理
      },
    );

    // 添加成功消息
    conversationMessages.value.push({
      type: "success",
      content: "项目创建成功！",
      projectId: result.projectId,
      timestamp: Date.now(),
    });

    // 跳转到项目详情
    setTimeout(() => {
      router.push(`/projects/${result.projectId}`);
    }, 500);
  } catch (error) {
    // 添加错误消息到对话
    conversationMessages.value.push({
      type: "error",
      content: "项目创建失败",
      error: error.message,
      timestamp: Date.now(),
    });

    // 统一错误处理
    handleError(error, {
      showMessage: true,
      showNotification: false,
      logToFile: true,
      context: {
        function: "handleConversationalCreate",
        userInput,
        userId: authStore.currentUser?.id,
      },
    });
  }
}

// ===== 改进前的代码 =====
/*
async function handleDeleteProject(projectId) {
  try {
    await projectStore.deleteProject(projectId);
    message.success('项目已删除');
  } catch (error) {
    console.error('Delete project failed:', error);
    message.error('删除失败：' + error.message);
  }
}
*/

// ===== 改进后的代码（带重试机制）=====
async function handleDeleteProject(projectId) {
  try {
    await withRetry(() => projectStore.deleteProject(projectId), {
      maxRetries: 2,
      retryDelay: 1000,
      onRetry: (error, attempt) => {
        console.log(`删除项目重试 ${attempt + 1}/2...`);
      },
      shouldRetry: (error) => {
        // 只在网络错误时重试
        return (
          error.message.includes("network") || error.message.includes("timeout")
        );
      },
    });

    message.success("项目已删除");

    // 刷新项目列表
    await loadProjects();
  } catch (error) {
    handleError(error, {
      showMessage: true,
      logToFile: true,
      context: { function: "handleDeleteProject", projectId },
    });
  }
}

// ===== 改进前的代码 =====
/*
async function handleRenameConversation(conversationId, oldTitle) {
  try {
    const newTitle = await showRenameDialog(oldTitle);
    if (newTitle && newTitle !== oldTitle) {
      await window.electronAPI.conversation.renameConversation(conversationId, newTitle);
      await loadConversations();
    }
  } catch (error) {
    console.error('[ProjectsPage] 重命名失败:', error);
    let errorMessage = '重命名失败';
    if (error.message.includes('已存在')) {
      errorMessage = '该名称已存在，请使用其他名称';
    }
    message.error(errorMessage);
  }
}
*/

// ===== 改进后的代码 =====
async function handleRenameConversation(conversationId, oldTitle) {
  try {
    const newTitle = await showRenameDialog(oldTitle);

    if (!newTitle || newTitle === oldTitle) {
      return; // 用户取消或未修改
    }

    await withLoading(
      `rename-${conversationId}`,
      async () => {
        await window.electronAPI.conversation.renameConversation(
          conversationId,
          newTitle,
        );
        await loadConversations();
      },
      {
        message: "重命名中...",
        successMessage: "重命名成功",
        showSuccess: true,
      },
    );
  } catch (error) {
    // 根据错误类型提供更友好的提示
    let errorType = ErrorType.UNKNOWN;
    let errorMessage = "重命名失败";

    if (error.message.includes("已存在")) {
      errorType = ErrorType.VALIDATION;
      errorMessage = "该名称已存在，请使用其他名称";
    } else if (error.message.includes("权限")) {
      errorType = ErrorType.PERMISSION;
      errorMessage = "没有权限修改此对话";
    }

    handleError(
      new AppError(errorMessage, errorType, ErrorLevel.WARNING, {
        originalError: error,
      }),
      {
        showMessage: true,
        logToFile: false,
        context: {
          function: "handleRenameConversation",
          conversationId,
          oldTitle,
          newTitle,
        },
      },
    );
  }
}

// ===== 在模板中使用加载状态 =====
/*
<template>
  <div class="projects-page">
    <!-- 加载状态 -->
    <div v-if="isLoadingProjects" class="loading-container">
      <a-spin size="large" tip="加载项目列表..." />
    </div>

    <!-- 项目列表 -->
    <div v-else class="projects-list">
      <!-- 项目内容 -->
    </div>

    <!-- 创建按钮（禁用状态） -->
    <a-button
      type="primary"
      :loading="isCreatingProject"
      :disabled="isCreatingProject"
      @click="handleConversationalCreate"
    >
      {{ isCreatingProject ? '创建中...' : '创建项目' }}
    </a-button>
  </div>
</template>
*/

// ===== 组件挂载时加载数据 =====
onMounted(async () => {
  // 并行加载多个资源
  await Promise.all([loadProjects(), loadTemplates(), loadCategories()]);
});

// ===== 加载模板（带超时处理）=====
async function loadTemplates() {
  try {
    await withTimeout(
      withLoading("templates", () => templateStore.fetchTemplates(), {
        message: "加载模板...",
        errorMessage: "加载模板失败",
      }),
      10000, // 10秒超时
      "加载模板超时，请检查网络连接",
    );
  } catch (error) {
    handleError(error, {
      showMessage: true,
      logToFile: true,
      context: { function: "loadTemplates" },
    });
  }
}

export default {
  name: "ProjectsPageImproved",
  // ... 其他配置
};
