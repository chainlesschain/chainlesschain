<template>
  <div class="ai-chat-page">
    <!-- 右侧：主内容区 -->
    <div class="main-container">
      <!-- 对话内容区 -->
      <div class="conversation-content">
        <!-- 消息列表 -->
        <div ref="messagesContainerRef" class="messages-container">
          <!-- 对话操作栏 -->
          <div v-if="messages.length > 0" class="conversation-actions">
            <a-button
              type="text"
              size="small"
              :loading="savingConversation"
              @click="handleSaveConversation"
            >
              <template #icon>
                <BookOutlined />
              </template>
              保存对话到记忆
            </a-button>
          </div>

          <!-- 欢迎消息 -->
          <div v-if="messages.length === 0" class="welcome-message">
            <div class="welcome-icon">
              <RobotOutlined />
            </div>
            <h2>你好！我是 ChainlessChain AI 助手</h2>
            <p>我可以帮你完成各种任务，比如：</p>
            <div class="welcome-features">
              <div class="feature-tag">💻 代码编写与调试</div>
              <div class="feature-tag">📄 文档生成与编辑</div>
              <div class="feature-tag">📊 数据分析与可视化</div>
              <div class="feature-tag">🌐 网页开发与设计</div>
            </div>
            <p class="welcome-hint">
              输入你的需求开始对话，或使用 @ 来引用知识库和文件
            </p>
            <p class="welcome-hint shortcut-hint">
              <span class="shortcut-key">Ctrl+Shift+M</span> 保存消息到记忆 |
              <span class="shortcut-key">Ctrl+Shift+S</span> 保存对话
            </p>
          </div>

          <!-- 对话消息 -->
          <div
            v-for="message in messages"
            :key="message.id"
            class="message-item"
            :class="`message-${message.role}`"
          >
            <!-- 用户消息 -->
            <div v-if="message.role === 'user'" class="message-wrapper">
              <div class="message-avatar">
                <a-avatar :src="userAvatar" :size="36">
                  <template #icon>
                    <UserOutlined />
                  </template>
                </a-avatar>
              </div>
              <div class="message-content">
                <div class="message-header">
                  <span class="message-author">{{ userName || "你" }}</span>
                  <span class="message-time">{{
                    formatTime(message.timestamp)
                  }}</span>
                </div>
                <div class="message-text">
                  {{ message.content }}
                </div>
              </div>
            </div>

            <!-- AI消息 -->
            <div
              v-else-if="message.role === 'assistant'"
              class="message-wrapper"
            >
              <div class="message-avatar">
                <a-avatar
                  :size="36"
                  style="
                    background: linear-gradient(
                      135deg,
                      #667eea 0%,
                      #764ba2 100%
                    );
                  "
                >
                  <RobotOutlined />
                </a-avatar>
              </div>
              <div class="message-content">
                <div class="message-header">
                  <span class="message-author">AI 助手</span>
                  <span class="message-time">{{
                    formatTime(message.timestamp)
                  }}</span>
                  <a-dropdown :trigger="['click']" class="save-memory-dropdown">
                    <a-button
                      type="text"
                      size="small"
                      class="save-memory-btn"
                      :class="{ saved: message.savedToMemory }"
                    >
                      <template #icon>
                        <CheckOutlined v-if="message.savedToMemory" />
                        <BookOutlined v-else />
                      </template>
                      <span class="btn-text">{{
                        message.savedToMemory ? "已保存" : "保存记忆"
                      }}</span>
                    </a-button>
                    <template #overlay>
                      <a-menu
                        @click="(e) => handleSaveToMemory(message, e.key)"
                      >
                        <a-menu-item key="daily">
                          <SaveOutlined /> 保存到 Daily Notes
                        </a-menu-item>
                        <a-menu-item key="discovery">
                          <BookOutlined /> 保存为技术发现
                        </a-menu-item>
                        <a-menu-item key="solution">
                          <BookOutlined /> 保存为解决方案
                        </a-menu-item>
                      </a-menu>
                    </template>
                  </a-dropdown>
                </div>
                <!-- eslint-disable vue/no-v-html -- sanitized via safeHtml / renderMarkdown / DOMPurify; see AUDIT_2026-04-22.md §3 -->
                <div
                  class="message-text"
                  v-html="renderMarkdown(message.content)"
                />
                <!-- eslint-enable vue/no-v-html -->

                <!-- 执行步骤 -->
                <div
                  v-if="message.steps && message.steps.length > 0"
                  class="message-steps"
                >
                  <StepDisplay
                    v-for="step in message.steps"
                    :key="step.id"
                    :step="step"
                    :default-expanded="
                      step.status === 'running' || step.status === 'failed'
                    "
                    @retry="handleStepRetry"
                    @cancel="handleStepCancel"
                  />
                </div>

                <!-- 预览内容 -->
                <div v-if="message.preview" class="message-preview">
                  <BrowserPreview
                    :preview-type="message.preview.type"
                    :url="message.preview.url"
                    :html-content="message.preview.htmlContent"
                    :image-url="message.preview.imageUrl"
                    :pdf-url="message.preview.pdfUrl"
                    :title="message.preview.title"
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- AI思考中 -->
          <div v-if="isThinking" class="message-item message-assistant">
            <div class="message-wrapper">
              <div class="message-avatar">
                <a-avatar
                  :size="36"
                  style="
                    background: linear-gradient(
                      135deg,
                      #667eea 0%,
                      #764ba2 100%
                    );
                  "
                >
                  <RobotOutlined />
                </a-avatar>
              </div>
              <div class="message-content">
                <div class="message-header">
                  <span class="message-author">AI 助手</span>
                </div>
                <div class="thinking-indicator">
                  <LoadingOutlined spin />
                  <span>思考中...</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 底部：输入框 -->
        <div class="input-container">
          <div class="input-toolbar">
            <a-tooltip
              :title="
                agentMode
                  ? 'Agent Mode ON — AI can use tools autonomously'
                  : 'Agent Mode OFF — regular chat'
              "
            >
              <a-button
                :type="agentMode ? 'primary' : 'default'"
                size="small"
                @click="toggleAgentMode"
              >
                <template #icon>
                  <RobotOutlined />
                </template>
                Agent
              </a-button>
            </a-tooltip>
            <a-tooltip v-if="agentMode" :title="worktreeIsolationTooltip">
              <a-button
                :type="worktreeIsolationEnabled ? 'primary' : 'default'"
                size="small"
                @click="toggleWorktreeIsolation"
              >
                Worktree
              </a-button>
            </a-tooltip>
            <a-button
              v-if="agentMode && currentSessionWorktreeIsolation"
              size="small"
              :loading="
                codingAgentStore.worktreeLoading && worktreeReviewVisible
              "
              @click="handleOpenWorktreeReview"
            >
              Review
            </a-button>
            <a-button
              v-if="agentMode"
              size="small"
              @click="handleEnterPlanMode"
            >
              {{ planActionLabel }}
            </a-button>
          </div>
          <a-alert
            v-if="currentWorktreeAlert"
            class="coding-agent-alert"
            type="info"
            show-icon
            message="Isolated workspace active"
            :description="currentWorktreeAlert"
          />
          <a-alert
            v-if="currentBlockedTool"
            class="coding-agent-alert"
            type="warning"
            show-icon
            :message="`Blocked tool: ${currentBlockedTool.toolName || 'unknown'}`"
            :description="blockedToolDescription"
          />
          <a-alert
            v-if="currentApprovalDenied"
            class="coding-agent-alert"
            type="error"
            show-icon
            :message="`Approval denied: ${currentApprovalDenied.toolName || 'unknown'}`"
            :description="approvalDeniedDescription"
          >
            <template v-if="currentApprovalDenied?.policy === 'strict'" #action>
              <a-button
                size="small"
                type="primary"
                :loading="isRelaxingPolicy"
                @click="handleRelaxApprovalPolicy"
              >
                Switch to Trusted
              </a-button>
            </template>
          </a-alert>
          <div v-if="showHarnessPanel" class="coding-agent-harness-panel">
            <div class="harness-panel-header">
              <div>
                <div class="approval-panel-eyebrow">Coding Agent Harness</div>
                <div class="approval-panel-title">Session operations</div>
                <p class="approval-panel-summary">
                  Track background work and isolated workspace usage for the
                  active coding-agent session.
                </p>
              </div>
              <a-button size="small" @click="handleRefreshHarnessPanel">
                Refresh Harness
              </a-button>
            </div>
            <div class="harness-stat-grid">
              <div class="harness-stat-card">
                <span class="harness-stat-label">Active sessions</span>
                <strong class="harness-stat-value">
                  {{ currentHarnessSessions.active }}
                </strong>
                <span class="harness-stat-meta">
                  {{ currentHarnessSessions.waitingApproval }} waiting approval
                </span>
              </div>
              <div class="harness-stat-card">
                <span class="harness-stat-label">Tracked worktrees</span>
                <strong class="harness-stat-value">
                  {{ currentHarnessWorktrees.tracked }}
                </strong>
                <span class="harness-stat-meta">
                  {{ currentHarnessWorktrees.dirty }} dirty
                </span>
              </div>
              <div class="harness-stat-card">
                <span class="harness-stat-label">Background tasks</span>
                <strong class="harness-stat-value">
                  {{ currentHarnessBackgroundTasks.total }}
                </strong>
                <span class="harness-stat-meta">
                  {{ currentHarnessBackgroundTasks.running }} running /
                  {{ currentHarnessBackgroundTasks.pending }} pending
                </span>
              </div>
            </div>
            <div class="harness-toolbar">
              <div class="harness-filter-group">
                <a-button
                  size="small"
                  :type="
                    harnessTaskStatusFilter === 'active' ? 'primary' : 'default'
                  "
                  @click="handleSetHarnessTaskFilter('active')"
                >
                  Active
                </a-button>
                <a-button
                  size="small"
                  :type="
                    harnessTaskStatusFilter === 'all' ? 'primary' : 'default'
                  "
                  @click="handleSetHarnessTaskFilter('all')"
                >
                  All
                </a-button>
                <a-button
                  size="small"
                  :type="
                    harnessTaskStatusFilter === 'completed'
                      ? 'primary'
                      : 'default'
                  "
                  @click="handleSetHarnessTaskFilter('completed')"
                >
                  Completed
                </a-button>
                <a-button
                  size="small"
                  :type="
                    harnessTaskStatusFilter === 'failed' ? 'primary' : 'default'
                  "
                  @click="handleSetHarnessTaskFilter('failed')"
                >
                  Failed
                </a-button>
              </div>
              <input
                v-model="harnessTaskSearchQuery"
                class="harness-search-input"
                type="text"
                placeholder="Search task title, id, status..."
              />
            </div>
            <div
              v-if="visibleHarnessTasks.length > 0"
              class="approval-panel-section"
            >
              <div class="approval-panel-label">
                Background tasks
                <span class="harness-results-count">
                  {{ filteredHarnessTasks.length }} result(s)
                </span>
              </div>
              <ul class="approval-step-list">
                <li
                  v-for="task in visibleHarnessTasks"
                  :key="task.id"
                  class="approval-step-item"
                >
                  <div class="approval-step-main">
                    <span class="approval-step-title">
                      {{ task.title || task.name || task.id }}
                    </span>
                    <a-tag>
                      {{ task.status || "unknown" }}
                    </a-tag>
                  </div>
                  <div
                    v-if="task.summary || task.description"
                    class="approval-step-description"
                  >
                    {{ task.summary || task.description }}
                  </div>
                  <div class="harness-task-actions">
                    <a-button
                      size="small"
                      @click="handleInspectBackgroundTask(task.id)"
                    >
                      View Details
                    </a-button>
                    <a-button
                      v-if="
                        task.status === 'running' || task.status === 'pending'
                      "
                      size="small"
                      danger
                      @click="handleStopBackgroundTask(task.id)"
                    >
                      Stop Task
                    </a-button>
                  </div>
                </li>
              </ul>
              <div
                v-if="filteredHarnessTasks.length > HARNESS_TASKS_PER_PAGE"
                class="harness-pagination"
              >
                <span class="harness-results-count">
                  Showing {{ harnessTaskPageRange.start }}-{{
                    harnessTaskPageRange.end
                  }}
                </span>
                <div class="harness-task-actions">
                  <a-button
                    size="small"
                    :disabled="harnessTaskPage <= 1"
                    @click="handlePreviousHarnessTaskPage"
                  >
                    Previous Page
                  </a-button>
                  <span class="harness-page-indicator">
                    Page {{ harnessTaskPage }} / {{ harnessTaskPageCount }}
                  </span>
                  <a-button
                    size="small"
                    :disabled="harnessTaskPage >= harnessTaskPageCount"
                    @click="handleNextHarnessTaskPage"
                  >
                    Next Page
                  </a-button>
                </div>
              </div>
            </div>
            <a-empty
              v-else
              description="No background tasks match the current filter."
            />
            <a-alert
              v-if="selectedHarnessTask"
              class="coding-agent-alert"
              type="info"
              show-icon
              message="Task details ready"
              :description="selectedHarnessTaskAlert"
            />
          </div>
          <div v-if="showApprovalPanel" class="coding-agent-approval-panel">
            <div class="approval-panel-header">
              <div>
                <div class="approval-panel-eyebrow">Coding Agent Gate</div>
                <div class="approval-panel-title">
                  {{ approvalPanelTitle }}
                </div>
                <p class="approval-panel-summary">
                  {{ approvalPanelSummary }}
                </p>
              </div>
              <div class="approval-panel-tags">
                <a-tag v-if="currentApprovalRequest" color="blue"> Plan </a-tag>
                <a-tag
                  v-if="needsHighRiskConfirmation && !currentApprovalRequest"
                  color="orange"
                >
                  High Risk
                </a-tag>
                <a-tag v-if="currentSessionWorktreeIsolation" color="cyan">
                  Isolated
                </a-tag>
              </div>
            </div>
            <div
              v-if="approvalPlanItems.length > 0"
              class="approval-panel-section"
            >
              <div class="approval-panel-label">Planned steps</div>
              <ul class="approval-step-list">
                <li
                  v-for="item in approvalPlanItems"
                  :key="item.key"
                  class="approval-step-item"
                >
                  <div class="approval-step-main">
                    <span class="approval-step-title">{{ item.title }}</span>
                    <a-tag v-if="item.tool">
                      {{ item.tool }}
                    </a-tag>
                  </div>
                  <div
                    v-if="item.description"
                    class="approval-step-description"
                  >
                    {{ item.description }}
                  </div>
                </li>
              </ul>
            </div>
            <div
              v-if="
                approvalPolicyMediumTools.length > 0 ||
                approvalPolicyHighTools.length > 0
              "
              class="approval-panel-section"
            >
              <div class="approval-panel-label">Tool access</div>
              <div
                v-if="approvalPolicyMediumTools.length > 0"
                class="approval-tool-row"
              >
                <span class="approval-tool-label">After plan approval</span>
                <div class="approval-tool-tags">
                  <a-tag
                    v-for="tool in approvalPolicyMediumTools"
                    :key="`medium-${tool}`"
                    color="gold"
                  >
                    {{ tool }}
                  </a-tag>
                </div>
              </div>
              <div
                v-if="approvalPolicyHighTools.length > 0"
                class="approval-tool-row"
              >
                <span class="approval-tool-label">Extra high-risk review</span>
                <div class="approval-tool-tags">
                  <a-tag
                    v-for="tool in approvalPolicyHighTools"
                    :key="`high-${tool}`"
                    color="red"
                  >
                    {{ tool }}
                  </a-tag>
                </div>
              </div>
            </div>
            <div
              v-if="needsHighRiskConfirmation && !currentApprovalRequest"
              class="approval-panel-section approval-panel-section-warning"
            >
              <div class="approval-panel-label">High-risk confirmation</div>
              <p class="approval-panel-summary">
                {{ highRiskConfirmationDescription }}
              </p>
            </div>
            <div class="approval-panel-actions">
              <a-button
                v-if="currentApprovalRequest"
                type="primary"
                @click="handleApprovePlan"
              >
                Approve Plan
              </a-button>
              <a-button
                v-if="currentApprovalRequest"
                danger
                @click="handleRejectPlan"
              >
                Reject Plan
              </a-button>
              <a-button
                v-if="needsHighRiskConfirmation && !currentApprovalRequest"
                type="primary"
                danger
                @click="handleConfirmHighRisk"
              >
                Confirm High-Risk Actions
              </a-button>
              <a-button
                v-if="needsHighRiskConfirmation && !currentApprovalRequest"
                @click="handleRejectHighRisk"
              >
                Cancel High-Risk Actions
              </a-button>
            </div>
          </div>
          <div
            v-if="agentMode && subAgentSummaryItems.length > 0"
            class="coding-agent-sub-agent-strip"
          >
            <span class="sub-agent-strip-label">Sub-agents</span>
            <a-tag
              v-for="item in subAgentSummaryItems"
              :key="item.id"
              :color="item.color"
            >
              {{ item.label }}
            </a-tag>
          </div>
          <div
            v-if="agentMode && currentReviewState"
            class="coding-agent-review-strip"
          >
            <a-alert
              :type="reviewAlertType"
              show-icon
              :message="reviewAlertMessage"
              :description="reviewAlertDescription"
            />
            <div
              v-if="currentReviewState.status === 'pending'"
              class="review-strip-actions"
            >
              <a-button
                type="primary"
                size="small"
                @click="handleApproveReview"
              >
                Approve
              </a-button>
              <a-button danger size="small" @click="handleRejectReview">
                Reject
              </a-button>
            </div>
          </div>
          <ConversationInput
            ref="inputRef"
            :placeholder="inputPlaceholder"
            :disabled="isThinking"
            :show-hint="true"
            @submit="handleSubmitAgentAwareMessage"
            @file-upload="handleFileUpload"
          />
        </div>
      </div>
    </div>

    <!-- 重命名对话框 -->
    <a-modal
      v-model:open="renameModalVisible"
      title="重命名对话"
      @ok="handleRenameConfirm"
      @cancel="handleRenameCancel"
    >
      <a-input
        v-model:value="newConversationTitle"
        placeholder="输入新的对话标题"
        @press-enter="handleRenameConfirm"
      />
    </a-modal>
    <a-modal
      v-model:open="worktreeReviewVisible"
      :title="worktreeReviewTitle"
      width="820px"
      :footer="null"
    >
      <div class="worktree-review">
        <div class="worktree-review-actions">
          <a-button
            size="small"
            :loading="codingAgentStore.worktreeLoading"
            @click="handleRefreshWorktreeReview"
          >
            Refresh
          </a-button>
          <a-button
            type="primary"
            size="small"
            :loading="worktreeMergeSubmitting"
            @click="handleMergeCurrentWorktree"
          >
            Merge
          </a-button>
        </div>
        <a-alert
          class="coding-agent-alert"
          type="info"
          show-icon
          message="Session worktree"
          :description="
            currentWorktreeAlert ||
            'This session is using a dedicated worktree.'
          "
        />
        <a-descriptions
          bordered
          size="small"
          :column="1"
          class="worktree-review-meta"
        >
          <a-descriptions-item label="Branch">
            {{ currentSessionWorktreeBranch || "-" }}
          </a-descriptions-item>
          <a-descriptions-item label="Base branch">
            {{ currentSessionWorktree?.baseBranch || "HEAD" }}
          </a-descriptions-item>
          <a-descriptions-item label="Workspace path">
            {{ currentSessionWorktree?.path || "-" }}
          </a-descriptions-item>
        </a-descriptions>
        <div class="worktree-review-section">
          <div class="worktree-review-section-title">Diff summary</div>
          <div class="worktree-summary-grid">
            <div class="worktree-summary-card">
              <span class="worktree-summary-label">Files</span>
              <strong>
                {{
                  currentWorktreeDiffSummary?.filesChanged ??
                  currentWorktreeDiffFiles.length
                }}
              </strong>
            </div>
            <div class="worktree-summary-card">
              <span class="worktree-summary-label">Insertions</span>
              <strong>
                {{ currentWorktreeDiffSummary?.insertions ?? 0 }}
              </strong>
            </div>
            <div class="worktree-summary-card">
              <span class="worktree-summary-label">Deletions</span>
              <strong>
                {{ currentWorktreeDiffSummary?.deletions ?? 0 }}
              </strong>
            </div>
          </div>
        </div>
        <div class="worktree-review-section">
          <div class="worktree-review-section-title">Changed files</div>
          <a-empty
            v-if="currentWorktreeDiffFiles.length === 0"
            description="No worktree diff loaded yet"
          />
          <div v-else class="worktree-file-list">
            <div
              v-for="file in currentWorktreeDiffFiles"
              :key="file.path"
              class="worktree-file-item"
            >
              <div class="worktree-file-header">
                <span class="worktree-file-path">{{ file.path }}</span>
                <div class="worktree-file-actions">
                  <span class="worktree-file-status">{{
                    file.status || "modified"
                  }}</span>
                  <a-button
                    type="link"
                    size="small"
                    class="worktree-preview-button"
                    :loading="
                      isWorktreePreviewRouteLoading({
                        type: 'worktree-diff',
                        branch: currentSessionWorktreeBranch,
                        filePath: file.path,
                      })
                    "
                    @click="
                      handleSelectWorktreePreview(
                        {
                          type: 'worktree-diff',
                          branch: currentSessionWorktreeBranch,
                          filePath: file.path,
                        },
                        { title: file.path },
                      )
                    "
                  >
                    Preview
                  </a-button>
                </div>
              </div>
              <div class="worktree-file-stats">
                +{{ file.insertions || 0 }} / -{{ file.deletions || 0 }}
              </div>
            </div>
          </div>
        </div>
        <div v-if="selectedWorktreePreview" class="worktree-review-section">
          <div class="worktree-review-section-title worktree-preview-header">
            <span>Focused preview</span>
            <a-button
              v-if="selectedWorktreePreview?.route"
              size="small"
              :loading="worktreePreviewLoading"
              @click="handleRefreshSelectedWorktreePreview"
            >
              Refresh preview
            </a-button>
          </div>
          <a-alert
            class="coding-agent-alert"
            type="info"
            show-icon
            :message="selectedWorktreePreviewTitle"
            :description="selectedWorktreePreviewDescription"
          />
          <a-alert
            v-if="worktreePreviewLoading"
            class="coding-agent-alert"
            type="info"
            show-icon
            message="Loading exact preview"
            description="Fetching the latest file-scoped diff from the isolated worktree."
          />
          <pre
            class="worktree-patch-preview"
          ><code>{{ selectedWorktreePreview.content }}</code></pre>
        </div>
        <div class="worktree-review-section">
          <div class="worktree-review-section-title">Patch preview</div>
          <a-empty
            v-if="!currentWorktreeDiffPatch"
            description="No patch text available yet"
          />
          <pre
            v-else
            class="worktree-patch-preview"
          ><code>{{ currentWorktreeDiffPatch }}</code></pre>
        </div>
        <div class="worktree-review-section">
          <div class="worktree-review-section-title">Agent worktrees</div>
          <a-empty
            v-if="availableAgentWorktrees.length === 0"
            description="No isolated agent worktrees found"
          />
          <div v-else class="worktree-file-list">
            <div
              v-for="worktree in availableAgentWorktrees"
              :key="worktree.path || worktree.branch"
              class="worktree-file-item"
            >
              <div class="worktree-file-header">
                <span class="worktree-file-path">{{
                  worktree.branch || "-"
                }}</span>
                <span class="worktree-file-status">{{
                  worktree.hasChanges ? "dirty" : "clean"
                }}</span>
              </div>
              <div class="worktree-file-stats">
                {{ worktree.path || "-" }}
              </div>
            </div>
          </div>
        </div>
        <div v-if="currentWorktreeMergeResult" class="worktree-review-section">
          <div class="worktree-review-section-title">
            {{ currentWorktreeMergeSectionTitle }}
          </div>
          <a-alert
            class="coding-agent-alert"
            :type="currentWorktreeMergeAlertType"
            show-icon
            :message="currentWorktreeMergeAlertMessage"
            :description="
              currentWorktreeMergeResult.message ||
              currentWorktreeMergeAlertDescription
            "
          />
          <a-alert
            v-if="currentWorktreeMergePreviewDelta"
            class="coding-agent-alert"
            :type="currentWorktreeMergePreviewDelta.type"
            show-icon
            :message="currentWorktreeMergePreviewDelta.message"
            :description="currentWorktreeMergePreviewDelta.description"
          />
          <div
            v-if="worktreeDeltaSummaryCards.length > 0"
            class="worktree-delta-summary-grid"
          >
            <button
              v-for="item in worktreeDeltaSummaryCards"
              :key="item.key"
              type="button"
              class="worktree-delta-summary-card"
              :class="[
                `worktree-delta-summary-card--${item.tone}`,
                { 'worktree-delta-summary-card--active': item.active },
              ]"
              :aria-pressed="item.active"
              @click="handleSelectWorktreeDeltaFilter(item.key)"
            >
              <span class="worktree-delta-summary-label">{{ item.label }}</span>
              <strong>{{ item.count }}</strong>
            </button>
          </div>
          <div
            v-if="filteredWorktreeAddedDeltaEntries.length > 0"
            class="worktree-suggestion-list"
          >
            <div class="worktree-review-section-title">New conflict files</div>
            <div class="worktree-delta-route-list">
              <div
                v-for="entry in filteredWorktreeAddedDeltaEntries"
                :key="`added-${entry.filePath}`"
                class="worktree-delta-route-item"
              >
                <a-button
                  type="link"
                  size="small"
                  class="worktree-preview-button"
                  :loading="
                    isWorktreePreviewRouteLoading(
                      buildWorktreeDeltaPreviewRoute(entry.filePath),
                    )
                  "
                  @click="
                    handleSelectWorktreePreview(
                      buildWorktreeDeltaPreviewRoute(entry.filePath),
                      { title: entry.filePath },
                    )
                  "
                >
                  {{ entry.filePath }}
                </a-button>
                <span
                  class="worktree-delta-route-status"
                  :class="`worktree-delta-route-status--${entry.state.tone}`"
                >
                  {{ entry.state.label }}
                </span>
              </div>
            </div>
          </div>
          <div
            v-if="filteredWorktreeResolvedDeltaEntries.length > 0"
            class="worktree-suggestion-list"
          >
            <div class="worktree-review-section-title">Resolved files</div>
            <div class="worktree-delta-route-list">
              <div
                v-for="entry in filteredWorktreeResolvedDeltaEntries"
                :key="`resolved-${entry.filePath}`"
                class="worktree-delta-route-item"
              >
                <a-button
                  type="link"
                  size="small"
                  class="worktree-preview-button"
                  :loading="
                    isWorktreePreviewRouteLoading(
                      buildWorktreeDeltaPreviewRoute(entry.filePath),
                    )
                  "
                  @click="
                    handleSelectWorktreePreview(
                      buildWorktreeDeltaPreviewRoute(entry.filePath),
                      { title: entry.filePath },
                    )
                  "
                >
                  {{ entry.filePath }}
                </a-button>
                <span
                  class="worktree-delta-route-status"
                  :class="`worktree-delta-route-status--${entry.state.tone}`"
                >
                  {{ entry.state.label }}
                </span>
              </div>
            </div>
          </div>
          <div
            v-if="currentWorktreeMergeSuggestions.length > 0"
            class="worktree-suggestion-list"
          >
            <div class="worktree-review-section-title">Next steps</div>
            <div
              v-for="suggestion in currentWorktreeMergeSuggestions"
              :key="suggestion"
              class="worktree-suggestion-item"
            >
              {{ suggestion }}
            </div>
          </div>
          <div
            v-if="currentWorktreePreviewEntrypoints.length > 0"
            class="worktree-suggestion-list"
          >
            <div class="worktree-review-section-title">Preview routes</div>
            <div
              v-for="preview in currentWorktreePreviewEntrypoints"
              :key="formatWorktreePreviewRoute(preview)"
              class="worktree-suggestion-item"
            >
              <a-button
                type="link"
                size="small"
                class="worktree-preview-button"
                :loading="isWorktreePreviewRouteLoading(preview)"
                @click="handleSelectWorktreePreview(preview)"
              >
                {{ formatWorktreePreviewRoute(preview) }}
              </a-button>
            </div>
          </div>
          <div
            v-if="currentWorktreeConflicts.length > 0"
            class="worktree-conflicts"
          >
            <div
              v-for="conflict in currentWorktreeConflicts"
              :key="conflict.path || conflict.filePath"
              class="worktree-file-item"
            >
              <div class="worktree-file-header">
                <span class="worktree-file-path">{{
                  conflict.path || conflict.filePath || "Unknown file"
                }}</span>
                <span class="worktree-file-status">{{
                  conflict.type || "conflict"
                }}</span>
              </div>
              <div class="worktree-file-stats">
                {{
                  conflict.suggestion ||
                  conflict.summary ||
                  "Manual resolution required."
                }}
              </div>
              <div
                v-if="conflict.automationCandidates?.length > 0"
                class="worktree-automation-list"
              >
                <div class="worktree-review-section-title">
                  Suggested actions
                </div>
                <div
                  v-for="candidate in conflict.automationCandidates"
                  :key="`${conflict.path || conflict.filePath || 'conflict'}-${candidate.id}`"
                  class="worktree-automation-item"
                >
                  <div class="worktree-automation-header">
                    <span class="worktree-file-path">{{
                      candidate.label || candidate.id
                    }}</span>
                    <span class="worktree-file-status">{{
                      candidate.confidence || "manual"
                    }}</span>
                  </div>
                  <div class="worktree-file-stats">
                    {{
                      candidate.description ||
                      candidate.command ||
                      "No description available."
                    }}
                  </div>
                  <div
                    v-if="candidate.command"
                    class="worktree-automation-command"
                  >
                    <code>{{ candidate.command }}</code>
                  </div>
                  <div class="worktree-automation-actions">
                    <a-button
                      v-if="canExecuteWorktreeAutomationCandidate(candidate)"
                      size="small"
                      :loading="
                        isWorktreeAutomationCandidateLoading(
                          conflict,
                          candidate,
                        )
                      "
                      @click="
                        handleApplyWorktreeAutomationCandidate(
                          conflict,
                          candidate,
                        )
                      "
                    >
                      Run safe action
                    </a-button>
                    <a-button
                      v-if="candidate.command"
                      size="small"
                      @click="handleCopyWorktreeAutomationCommand(candidate)"
                    >
                      Copy command
                    </a-button>
                    <a-button
                      size="small"
                      type="primary"
                      ghost
                      @click="
                        handlePrepareWorktreeAutomationCandidate(
                          conflict,
                          candidate,
                        )
                      "
                    >
                      Send to agent
                    </a-button>
                  </div>
                </div>
              </div>
              <div
                v-if="conflict.diffPreview?.route"
                class="worktree-file-stats worktree-preview-route"
              >
                <a-button
                  type="link"
                  size="small"
                  class="worktree-preview-button"
                  :loading="
                    isWorktreePreviewRouteLoading(conflict.diffPreview.route)
                  "
                  @click="
                    handleSelectWorktreePreview(conflict.diffPreview.route, {
                      title:
                        conflict.path ||
                        conflict.filePath ||
                        'Conflict preview',
                      snippet: conflict.diffPreview.snippet || '',
                      filePath:
                        conflict.path ||
                        conflict.filePath ||
                        conflict.diffPreview.route.filePath,
                    })
                  "
                >
                  Preview:
                  {{ formatWorktreePreviewRoute(conflict.diffPreview.route) }}
                </a-button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </a-modal>
    <HarnessTaskDrawer
      v-model:open="harnessTaskDrawerVisible"
      :selected-task="selectedHarnessTask"
      :selected-task-history-items="selectedHarnessTaskHistoryItems"
      :selected-task-history-has-more="selectedHarnessTaskHistoryHasMore"
      :selected-task-has-previous="selectedHarnessTaskHasPrevious"
      :selected-task-has-next="selectedHarnessTaskHasNext"
      @load-more-history="handleLoadMoreBackgroundTaskHistory"
      @navigate="handleNavigateHarnessTask"
      @clear-selection="handleClearBackgroundTaskSelection"
    />
  </div>
</template>

<script setup>
import { logger, createLogger } from "@/utils/logger";

import { ref, computed, onMounted, onUnmounted, nextTick, watch } from "vue";
import { message as antMessage } from "ant-design-vue";
import { useAuthStore } from "@/stores/auth";
import {
  RobotOutlined,
  UserOutlined,
  LoadingOutlined,
  BookOutlined,
  SaveOutlined,
  CheckOutlined,
} from "@ant-design/icons-vue";
import ConversationInput from "@/components/projects/ConversationInput.vue";
import BrowserPreview from "@/components/projects/BrowserPreview.vue";
import StepDisplay from "@/components/projects/StepDisplay.vue";
import HarnessTaskDrawer from "@/components/chat/HarnessTaskDrawer.vue";
import { useCodingAgentStore } from "@/stores/coding-agent";
import { useSessionCoreStore } from "@/stores/sessionCore";
import {
  renderMarkdown,
  formatTime,
  enhanceCodeBlocks,
} from "./aiChatPageUtils";
import {
  formatWorktreePreviewRoute,
  getWorktreePreviewRouteKey,
  getWorktreeAutomationCandidateKey,
  canExecuteWorktreeAutomationCandidate,
  buildWorktreePreviewPayload,
} from "./aiChatPageWorktreeUtils";

const authStore = useAuthStore();
const codingAgentStore = useCodingAgentStore();
const sessionCoreStore = useSessionCoreStore();
const agentLogger = createLogger("AIChatPageCodingAgent");

// 响应式状态
const conversations = ref([]);
const activeConversationId = ref("");
const messages = ref([]);
const isThinking = ref(false);
const messagesContainerRef = ref(null);
const inputRef = ref(null);
const savingConversation = ref(false);

// Agent mode state
const agentMode = ref(false);
const codingAgentSessionMap = ref({});
const harnessUiStateByConversation = ref({});
const agentMessageByRequestId = ref({});
const processedCodingAgentEventIds = new Set();
const worktreeIsolationEnabled = ref(false);
const WORKTREE_ISOLATION_STORAGE_KEY =
  "coding-agent-worktree-isolation-enabled";
const WORKTREE_DELTA_FILTER_ALL = "all";
const worktreeReviewVisible = ref(false);
const worktreeMergeSubmitting = ref(false);
const selectedWorktreePreview = ref(null);
const worktreePreviewLoading = ref(false);
const worktreePreviewLoadingKey = ref("");
const worktreeAutomationLoadingKey = ref("");
const worktreeMergePreviewDelta = ref(null);
const worktreeDeltaFilter = ref(WORKTREE_DELTA_FILTER_ALL);
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

const currentCodingAgentSessionId = computed(() => {
  if (!activeConversationId.value) {
    return null;
  }
  return codingAgentSessionMap.value[activeConversationId.value] || null;
});

const currentPlanModeState = computed(() => {
  if (!currentCodingAgentSessionId.value) {
    return null;
  }
  if (codingAgentStore.currentSessionId !== currentCodingAgentSessionId.value) {
    return null;
  }
  return codingAgentStore.currentSession?.planModeState || null;
});

const currentApprovalRequest = computed(() => {
  if (!currentCodingAgentSessionId.value) {
    return null;
  }
  if (codingAgentStore.currentSessionId !== currentCodingAgentSessionId.value) {
    return null;
  }
  if (currentPlanModeState.value !== "plan_ready") {
    return null;
  }
  return codingAgentStore.latestApprovalRequest?.payload || null;
});

const approvalPanelTitle = computed(() => {
  if (currentApprovalRequest.value) {
    return "Plan approval required";
  }

  if (needsHighRiskConfirmation.value) {
    return "High-risk confirmation required";
  }

  return "Approval required";
});

const approvalPanelSummary = computed(() => {
  if (currentApprovalRequest.value) {
    return approvalRequestDescription.value;
  }

  if (needsHighRiskConfirmation.value) {
    return highRiskConfirmationDescription.value;
  }

  return "";
});

const approvalPlanItems = computed(() => {
  const rawItems = Array.isArray(codingAgentStore.currentSession?.lastPlanItems)
    ? codingAgentStore.currentSession.lastPlanItems
    : Array.isArray(currentApprovalRequest.value?.items)
      ? currentApprovalRequest.value.items
      : [];

  return rawItems.map((item, index) => {
    if (typeof item === "string") {
      return {
        key: `plan-item-${index}`,
        title: item,
        tool: null,
        description: null,
      };
    }

    return {
      key: item?.id || `plan-item-${index}`,
      title:
        item?.title ||
        item?.summary ||
        item?.name ||
        item?.action ||
        `Step ${index + 1}`,
      tool: item?.tool || item?.toolName || null,
      description: item?.description || item?.reason || null,
    };
  });
});

const approvalPolicyMediumTools = computed(() => {
  return codingAgentStore.permissionPolicy?.toolsByRisk?.medium || [];
});

const approvalPolicyHighTools = computed(() => {
  return codingAgentStore.permissionPolicy?.toolsByRisk?.high || [];
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

const showApprovalPanel = computed(() => {
  return Boolean(
    currentApprovalRequest.value || needsHighRiskConfirmation.value,
  );
});

const currentBlockedTool = computed(() => {
  if (!currentCodingAgentSessionId.value) {
    return null;
  }
  if (codingAgentStore.currentSessionId !== currentCodingAgentSessionId.value) {
    return null;
  }
  if (
    !currentApprovalRequest.value &&
    !codingAgentStore.requiresHighRiskConfirmation
  ) {
    return null;
  }
  return codingAgentStore.latestBlockedToolEvent?.payload || null;
});

// Phase J+: surface ApprovalGate `approval.denied` events. Distinct from
// `currentBlockedTool` (Plan Mode / Permission Gate) because the recovery
// path is different — the user typically needs to flip the per-session
// policy (strict→trusted) via the session-core API or `cc session policy`.
const currentApprovalDenied = computed(() => {
  if (!currentCodingAgentSessionId.value) {
    return null;
  }
  if (codingAgentStore.currentSessionId !== currentCodingAgentSessionId.value) {
    return null;
  }
  return codingAgentStore.latestApprovalDeniedEvent?.payload || null;
});

const planActionLabel = computed(() => {
  return currentPlanModeState.value && currentPlanModeState.value !== "inactive"
    ? "Show Plan"
    : "Plan";
});

const subAgentSummaryItems = computed(() => {
  const bucket = codingAgentStore.currentSessionSubAgents;
  if (!bucket) {
    return [];
  }
  const active = (bucket.active || []).map((sub) => ({
    id: sub.id,
    color: "processing",
    label: `▶ ${sub.role || "sub"}`,
  }));
  const recent = (bucket.history || []).slice(0, 3).map((sub) => ({
    id: sub.id,
    color: sub.status === "failed" ? "error" : "success",
    label: `${sub.status === "failed" ? "✗" : "✓"} ${sub.role || "sub"}`,
  }));
  return [...active, ...recent];
});

const currentReviewState = computed(
  () => codingAgentStore.currentSessionReviewState,
);

const reviewAlertType = computed(() => {
  const state = currentReviewState.value;
  if (!state) {
    return "info";
  }
  if (state.status === "pending") {
    return "warning";
  }
  if (state.status === "approved") {
    return "success";
  }
  return "error";
});

const reviewAlertMessage = computed(() => {
  const state = currentReviewState.value;
  if (!state) {
    return "";
  }
  if (state.status === "pending") {
    return "Review in progress — new messages blocked";
  }
  if (state.status === "approved") {
    return "Review approved";
  }
  return "Review rejected";
});

const reviewAlertDescription = computed(() => {
  const state = currentReviewState.value;
  if (!state) {
    return "";
  }
  const parts = [];
  if (state.reason) {
    parts.push(state.reason);
  }
  if (state.summary) {
    parts.push(state.summary);
  }
  if (state.checklist?.length) {
    const done = state.checklist.filter((c) => c.done).length;
    parts.push(`Checklist: ${done}/${state.checklist.length}`);
  }
  if (state.comments?.length) {
    parts.push(`${state.comments.length} comment(s)`);
  }
  return parts.join(" · ");
});

async function handleApproveReview() {
  await codingAgentStore.resolveReview({ decision: "approved" });
}

async function handleRejectReview() {
  await codingAgentStore.resolveReview({ decision: "rejected" });
}

const currentSessionWorktree = computed(() => {
  if (!currentCodingAgentSessionId.value) {
    return null;
  }
  if (codingAgentStore.currentSessionId !== currentCodingAgentSessionId.value) {
    return null;
  }
  return codingAgentStore.currentSession?.worktree || null;
});

const currentSessionWorktreeIsolation = computed(() => {
  if (!currentCodingAgentSessionId.value) {
    return false;
  }
  if (codingAgentStore.currentSessionId !== currentCodingAgentSessionId.value) {
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
  const filePaths = currentWorktreeMergePreviewDelta.value?.resolvedPaths || [];
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
    { key: "urgent", label: "Urgent", count: summary.urgent, tone: "conflict" },
    { key: "watch", label: "Watch", count: summary.watch, tone: "warning" },
    { key: "clean", label: "Clean", count: summary.clean, tone: "clean" },
  ]
    .filter((item) => item.key === WORKTREE_DELTA_FILTER_ALL || item.count > 0)
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
    details.push(`Updated: ${selectedWorktreePreview.value.refreshedAtLabel}`);
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

const formatWorktreeConflictTypeDelta = (previousConflicts, nextConflicts) => {
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
    lines.push(`- Preview route: ${formatWorktreePreviewRoute(preview.route)}`);
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

const handleApplyWorktreeAutomationCandidate = async (conflict, candidate) => {
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
    const previousPreviewResult = currentWorktreeMergeResult.value?.previewOnly
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

const approvalRequestDescription = computed(() => {
  const policy = codingAgentStore.permissionPolicy;
  const mediumTools = policy?.toolsByRisk?.medium || [];
  const highTools = policy?.toolsByRisk?.high || [];
  const details = [];

  if (mediumTools.length > 0) {
    details.push(`Plan approval unlocks: ${mediumTools.join(", ")}`);
  }

  if (highTools.length > 0) {
    details.push(
      `High-risk tools still need extra confirmation: ${highTools.join(", ")}`,
    );
  }

  return (
    details.join(". ") ||
    "This plan includes controlled operations. Approve it before the agent can continue."
  );
});

const blockedToolDescription = computed(() => {
  if (!currentBlockedTool.value) {
    return "";
  }

  const riskSuffix = currentBlockedTool.value.riskLevel
    ? `Risk: ${currentBlockedTool.value.riskLevel}.`
    : "";

  return `${currentBlockedTool.value.reason || "The tool was blocked by the desktop permission gate."} ${riskSuffix}`.trim();
});

const isRelaxingPolicy = ref(false);
const handleRelaxApprovalPolicy = async () => {
  const sessionId = currentCodingAgentSessionId.value;
  if (!sessionId) {
    antMessage.warning("No active coding-agent session.");
    return;
  }
  if (isRelaxingPolicy.value) {
    return;
  }
  isRelaxingPolicy.value = true;
  try {
    const result = await sessionCoreStore.setPolicy(sessionId, "trusted");
    if (result) {
      antMessage.success(
        `Session policy set to 'trusted'. Retry the tool to continue.`,
      );
    } else {
      antMessage.error(
        sessionCoreStore.lastError || "Failed to set session policy.",
      );
    }
  } catch (error) {
    antMessage.error(`Failed to set session policy: ${error.message || error}`);
  } finally {
    isRelaxingPolicy.value = false;
  }
};

const approvalDeniedDescription = computed(() => {
  const event = currentApprovalDenied.value;
  if (!event) {
    return "";
  }

  const parts = [];
  if (event.reason) {
    parts.push(event.reason);
  } else {
    parts.push("ApprovalGate denied this tool call.");
  }
  if (event.policy) {
    parts.push(`Policy: ${event.policy}.`);
  }
  if (event.riskLevel) {
    parts.push(`Risk: ${event.riskLevel}.`);
  }
  if (event.policy === "strict") {
    parts.push(
      "Relax the per-session policy (e.g. set to 'trusted') to allow this tool.",
    );
  }
  return parts.join(" ");
});

const currentHighRiskToolNames = computed(() => {
  if (!currentCodingAgentSessionId.value) {
    return [];
  }
  if (codingAgentStore.currentSessionId !== currentCodingAgentSessionId.value) {
    return [];
  }
  return codingAgentStore.currentSession?.highRiskToolNames || [];
});

const needsHighRiskConfirmation = computed(() => {
  if (!currentCodingAgentSessionId.value) {
    return false;
  }
  if (codingAgentStore.currentSessionId !== currentCodingAgentSessionId.value) {
    return false;
  }
  return codingAgentStore.requiresHighRiskConfirmation;
});

const highRiskConfirmationDescription = computed(() => {
  if (currentHighRiskToolNames.value.length === 0) {
    return "This approved plan still needs explicit confirmation before high-risk steps can run.";
  }

  return `Confirm before continuing. High-risk tools: ${currentHighRiskToolNames.value.join(", ")}.`;
});

const toggleAgentMode = () => {
  agentMode.value = !agentMode.value;
  antMessage.info(
    agentMode.value ? "Agent Mode ON — AI can use tools" : "Agent Mode OFF",
  );
};

// 重命名对话相关状态
const renameModalVisible = ref(false);
const toggleWorktreeIsolation = () => {
  worktreeIsolationEnabled.value = !worktreeIsolationEnabled.value;
  localStorage.setItem(
    WORKTREE_ISOLATION_STORAGE_KEY,
    worktreeIsolationEnabled.value ? "true" : "false",
  );

  antMessage.info(
    worktreeIsolationEnabled.value
      ? "Worktree isolation will be used for the next new coding-agent session."
      : "New coding-agent sessions will use the shared workspace.",
  );
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
  const nextPreviewResult = await codingAgentStore.previewCurrentWorktreeMerge({
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
      antMessage.warning("No isolated worktree is available for this session.");
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
      antMessage.warning(result.message || "Worktree merge did not complete.");
    }
  } catch (error) {
    antMessage.error("Failed to merge worktree: " + error.message);
  } finally {
    worktreeMergeSubmitting.value = false;
  }
};

const renameConversation = ref(null);
const newConversationTitle = ref("");

// 用户信息
const userName = computed(() => authStore.currentUser?.username || "用户");
const userAvatar = computed(() => authStore.currentUser?.avatar || "");

// 输入框占位符
const inputPlaceholder = computed(() => {
  if (isThinking.value) {
    return "AI 正在思考中，请稍候...";
  }
  return "给我发消息或描述你的任务...";
});

// 加载对话列表
const findMessageById = (messageId) =>
  messages.value.find((message) => message.id === messageId);

const getPendingAgentMessage = (requestId) => {
  if (!requestId) {
    return null;
  }
  const messageId = agentMessageByRequestId.value[requestId];
  return messageId ? findMessageById(messageId) : null;
};

const ensurePendingAgentMessage = (requestId, sessionId) => {
  const existingMessage = getPendingAgentMessage(requestId);
  if (existingMessage) {
    return existingMessage;
  }

  const assistantMessage = {
    id: `msg-${Date.now()}-agent-${Math.random().toString(36).slice(2, 8)}`,
    role: "assistant",
    content: "",
    timestamp: Date.now(),
    steps: [],
    preview: null,
    savedToMemory: false,
    sessionId,
    requestId,
    persisted: false,
  };

  messages.value.push(assistantMessage);
  if (requestId) {
    agentMessageByRequestId.value = {
      ...agentMessageByRequestId.value,
      [requestId]: assistantMessage.id,
    };
  }
  return assistantMessage;
};

const clearPendingAgentMessage = (requestId) => {
  if (!requestId || !agentMessageByRequestId.value[requestId]) {
    return;
  }

  const nextMapping = { ...agentMessageByRequestId.value };
  delete nextMapping[requestId];
  agentMessageByRequestId.value = nextMapping;
};

const createAgentStep = (event) => ({
  id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  status: "running",
  name: event.payload.display || event.payload.tool || "Tool execution",
  title: event.payload.display || event.payload.tool || "Tool execution",
  tool: event.payload.tool || "",
  description: event.payload.display || "",
  params: event.payload.args || {},
  result: null,
  error: null,
  startedAt: event.timestamp,
  logs: [
    {
      timestamp: event.timestamp,
      level: "info",
      message: `Executing ${event.payload.tool || "tool"}`,
    },
  ],
});

const getLatestRunningStep = (assistantMessage, toolName) => {
  if (!assistantMessage?.steps?.length) {
    return null;
  }

  for (let index = assistantMessage.steps.length - 1; index >= 0; index -= 1) {
    const step = assistantMessage.steps[index];
    if (step.tool === toolName && step.status === "running") {
      return step;
    }
  }

  return null;
};

const finalizeAgentSteps = (assistantMessage) => {
  if (!assistantMessage?.steps?.length) {
    return;
  }

  assistantMessage.steps.forEach((step) => {
    if (step.status === "running") {
      step.status = "completed";
      step.logs = [
        ...(step.logs || []),
        {
          timestamp: new Date().toISOString(),
          level: "success",
          message: "Step completed",
        },
      ];
    }
  });
};

const persistAssistantMessage = async (assistantMessage) => {
  if (
    !assistantMessage ||
    assistantMessage.persisted ||
    !activeConversationId.value
  ) {
    return;
  }

  try {
    await window.electronAPI.conversation.addMessage(
      activeConversationId.value,
      {
        role: "assistant",
        content: assistantMessage.content,
        steps: assistantMessage.steps || [],
        preview: assistantMessage.preview || null,
      },
    );
    assistantMessage.persisted = true;
  } catch (error) {
    agentLogger.error("persistAssistantMessage failed:", error);
  }
};

const updateConversationTitleFromText = async (text) => {
  const conversation = conversations.value.find(
    (c) => c.id === activeConversationId.value,
  );
  const userMessageCount = messages.value.filter(
    (message) => message.role === "user",
  ).length;
  if (!conversation || userMessageCount !== 1) {
    return;
  }

  const newTitle = text.substring(0, 30) + (text.length > 30 ? "..." : "");
  conversation.title = newTitle;
  await window.electronAPI.conversation.update(activeConversationId.value, {
    title: newTitle,
  });
};

const ensureCodingAgentSession = async (
  conversationId = activeConversationId.value,
) => {
  if (!conversationId) {
    throw new Error("No active conversation");
  }

  const existingSessionId = codingAgentSessionMap.value[conversationId];
  if (existingSessionId) {
    if (codingAgentStore.currentSessionId !== existingSessionId) {
      const resumed = await codingAgentStore.resumeSession(existingSessionId);
      if (!resumed) {
        throw new Error(
          codingAgentStore.error || "Failed to resume coding agent session",
        );
      }
    }
    await refreshCodingAgentHarnessPanel({ silent: true });
    return existingSessionId;
  }

  const sessionId = await codingAgentStore.startSession({
    worktreeIsolation: worktreeIsolationEnabled.value,
  });
  if (!sessionId) {
    throw new Error(
      codingAgentStore.error || "Failed to create coding agent session",
    );
  }

  codingAgentSessionMap.value = {
    ...codingAgentSessionMap.value,
    [conversationId]: sessionId,
  };

  await refreshCodingAgentHarnessPanel({ silent: true });
  return sessionId;
};

const continueApprovedPlanExecution = async () => {
  const result = await codingAgentStore.sendMessage(
    "Proceed with the approved plan and carry out the approved changes.",
  );
  if (!result?.success) {
    throw new Error(result?.error || "Failed to continue after plan approval");
  }
  ensurePendingAgentMessage(result.requestId, result.sessionId);
};

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

const persistHarnessUiState = (conversationId = activeConversationId.value) => {
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

const ensureHighRiskConfirmation = async () => {
  if (!codingAgentStore.requiresHighRiskConfirmation) {
    return true;
  }

  antMessage.warning(
    "Confirm the pending high-risk actions in the approval panel before continuing.",
  );
  return false;
};

const handleCodingAgentEvent = async (event) => {
  if (!event?.id || processedCodingAgentEventIds.has(event.id)) {
    return;
  }

  processedCodingAgentEventIds.add(event.id);

  if (
    event.sessionId &&
    event.sessionId !== currentCodingAgentSessionId.value
  ) {
    return;
  }

  switch (event.type) {
    case "tool.call.started":
    case "tool-executing": {
      const assistantMessage = ensurePendingAgentMessage(
        event.requestId,
        event.sessionId,
      );
      assistantMessage.steps = [
        ...(assistantMessage.steps || []),
        createAgentStep(event),
      ];
      break;
    }
    case "tool.call.completed":
    case "tool-result": {
      const assistantMessage = ensurePendingAgentMessage(
        event.requestId,
        event.sessionId,
      );
      const step = getLatestRunningStep(assistantMessage, event.payload.tool);
      if (step) {
        step.status = event.payload.error ? "failed" : "completed";
        step.result = event.payload.error ? step.result : event.payload.result;
        step.error = event.payload.error || null;
        step.logs = [
          ...(step.logs || []),
          {
            timestamp: event.timestamp,
            level: event.payload.error ? "error" : "success",
            message: event.payload.error
              ? `Tool failed: ${event.payload.error}`
              : "Tool completed",
          },
        ];
        if (step.startedAt) {
          step.duration =
            new Date(event.timestamp).getTime() -
            new Date(step.startedAt).getTime();
        }
      }
      break;
    }
    case "plan.approval_required":
    case "plan-ready": {
      const assistantMessage = ensurePendingAgentMessage(
        event.requestId,
        event.sessionId,
      );
      assistantMessage.content = event.payload.summary
        ? `${event.payload.summary}\n\n请审批后继续执行。`
        : "计划已生成，等待审批。";
      assistantMessage.timestamp = Date.now();
      isThinking.value = false;
      break;
    }
    case "approval.requested":
    case "approval-requested": {
      antMessage.info(
        "Plan ready. Approve it before write or shell steps can run.",
      );
      break;
    }
    case "approval.high-risk.requested":
    case "high-risk-confirmation-required": {
      const tools = event.payload.tools || [];
      antMessage.warning(
        tools.length > 0
          ? `High-risk confirmation required for: ${tools.join(", ")}`
          : "High-risk confirmation required before execution can continue.",
      );
      break;
    }
    case "approval.high-risk.granted":
    case "high-risk-confirmed": {
      antMessage.success("High-risk execution confirmed.");
      break;
    }
    case "tool.call.failed":
    case "tool-blocked": {
      const assistantMessage = ensurePendingAgentMessage(
        event.requestId,
        event.sessionId,
      );
      const toolName = event.payload.toolName || "tool";
      let step = getLatestRunningStep(assistantMessage, toolName);

      if (!step) {
        step = {
          id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          status: "failed",
          name: toolName,
          title: toolName,
          tool: toolName,
          description:
            event.payload.reason || "Blocked by coding-agent permission policy",
          params: {},
          result: null,
          error:
            event.payload.reason || "Blocked by coding-agent permission policy",
          startedAt: event.timestamp,
          logs: [],
        };
        assistantMessage.steps = [...(assistantMessage.steps || []), step];
      }

      step.status = "failed";
      step.error =
        event.payload.reason || "Blocked by coding-agent permission policy";
      step.logs = [
        ...(step.logs || []),
        {
          timestamp: event.timestamp,
          level: "warning",
          message: event.payload.reason || `${toolName} was blocked`,
        },
      ];

      if (!assistantMessage.content) {
        assistantMessage.content = `Blocked ${toolName}. Review the plan and approve it before continuing.`;
      }

      antMessage.warning(event.payload.reason || `${toolName} was blocked`);
      break;
    }
    case "assistant.final":
    case "response-complete": {
      const assistantMessage = ensurePendingAgentMessage(
        event.requestId,
        event.sessionId,
      );
      assistantMessage.content =
        event.payload.content || assistantMessage.content || "已完成";
      assistantMessage.timestamp = Date.now();
      finalizeAgentSteps(assistantMessage);
      isThinking.value = false;
      await persistAssistantMessage(assistantMessage);
      clearPendingAgentMessage(event.requestId);
      break;
    }
    case "command-response": {
      const result = event.payload.result || {};
      if (!result.error && event.payload.command === "/plan approve") {
        if (
          currentHighRiskToolNames.value.length > 0 ||
          codingAgentStore.requiresHighRiskConfirmation
        ) {
          isThinking.value = false;
          antMessage.success(
            "Plan approved. Waiting for high-risk confirmation.",
          );
        } else {
          isThinking.value = true;
          antMessage.success("Plan approved. Continuing execution.");
        }
        break;
      }

      if (!result.error && event.payload.command === "/plan reject") {
        isThinking.value = false;
        antMessage.info("Plan rejected.");
        break;
      }

      if (!result.error && result.state === "analyzing") {
        isThinking.value = false;
        antMessage.info(result.message || "Plan mode enabled.");
        break;
      }

      if (result.error) {
        isThinking.value = false;
        antMessage.error(result.error);
      } else if (event.payload.command === "/plan approve") {
        isThinking.value = true;
        antMessage.success("计划已批准，继续执行中");
      } else if (event.payload.command === "/plan reject") {
        isThinking.value = false;
        antMessage.info("计划已拒绝");
      } else if (result.state === "analyzing") {
        isThinking.value = false;
        antMessage.info(result.message || "已进入计划模式");
      }
      break;
    }
    case "approval-granted": {
      if (event.payload.approvalType === "high-risk") {
        antMessage.success("High-risk actions confirmed.");
      } else {
        antMessage.success("Plan approval recorded.");
      }
      break;
    }
    case "approval-denied": {
      // Phase J+: ApprovalGate auto-denies emit the same event type but with
      // payload.source === "approval-gate" (plus a richer policy/via/risk
      // shape). Those flow through the dedicated `currentApprovalDenied`
      // alert + watcher → don't double-toast here, and don't clear the
      // thinking spinner (the agent loop continues against ApprovalGate
      // denies until the user changes policy or aborts).
      if (event.payload?.source === "approval-gate") {
        break;
      }
      isThinking.value = false;
      if (event.payload.approvalType === "high-risk") {
        antMessage.info("High-risk actions were not confirmed.");
      } else {
        antMessage.info("Plan approval was denied.");
      }
      break;
    }
    case "error": {
      const assistantMessage = ensurePendingAgentMessage(
        event.requestId,
        event.sessionId,
      );
      assistantMessage.content = event.payload.message
        ? `抱歉，Agent 执行失败：${event.payload.message}`
        : "抱歉，Agent 执行失败。";
      assistantMessage.timestamp = Date.now();
      const failedStep = getLatestRunningStep(
        assistantMessage,
        assistantMessage.steps?.[assistantMessage.steps.length - 1]?.tool,
      );
      if (failedStep) {
        failedStep.status = "failed";
        failedStep.error = event.payload.message || "Unknown error";
      }
      isThinking.value = false;
      await persistAssistantMessage(assistantMessage);
      clearPendingAgentMessage(event.requestId);
      antMessage.error(event.payload.message || "Coding agent error");
      break;
    }
    default:
      break;
  }
};

const handleEnterPlanMode = async () => {
  try {
    await ensureCodingAgentSession();
    if (
      currentPlanModeState.value &&
      currentPlanModeState.value !== "inactive"
    ) {
      await codingAgentStore.showPlan();
      return;
    }

    await codingAgentStore.enterPlanMode();
  } catch (error) {
    antMessage.error("进入计划模式失败: " + error.message);
  }
};

const handleApprovePlan = async () => {
  try {
    await ensureCodingAgentSession();
    isThinking.value = true;
    await codingAgentStore.respondApproval({
      approvalType: "plan",
      decision: "granted",
    });
    if (codingAgentStore.requiresHighRiskConfirmation) {
      isThinking.value = false;
      antMessage.info(
        "Plan approved. Confirm the high-risk actions in the approval panel to continue.",
      );
      return;
    }
    await continueApprovedPlanExecution();
  } catch (error) {
    isThinking.value = false;
    antMessage.error("批准计划失败: " + error.message);
  }
};

const handleRejectPlan = async () => {
  try {
    await ensureCodingAgentSession();
    await codingAgentStore.respondApproval({
      approvalType: "plan",
      decision: "denied",
    });
    isThinking.value = false;
  } catch (error) {
    antMessage.error("拒绝计划失败: " + error.message);
  }
};

const handleConfirmHighRisk = async () => {
  try {
    await ensureCodingAgentSession();
    isThinking.value = true;
    await codingAgentStore.respondApproval({
      approvalType: "high-risk",
      decision: "granted",
    });
    await continueApprovedPlanExecution();
  } catch (error) {
    isThinking.value = false;
    antMessage.error("确认高风险操作失败: " + error.message);
  }
};

const handleRejectHighRisk = async () => {
  try {
    await ensureCodingAgentSession();
    await codingAgentStore.respondApproval({
      approvalType: "high-risk",
      decision: "denied",
    });
    isThinking.value = false;
    antMessage.info("High-risk actions were cancelled.");
  } catch (error) {
    antMessage.error("取消高风险操作失败: " + error.message);
  }
};

const loadConversations = async () => {
  // 检查 API 是否可用
  if (!window.electronAPI?.conversation?.list) {
    conversations.value = [];
    return;
  }

  try {
    // 从数据库加载对话列表
    const data = await window.electronAPI.conversation.list();
    conversations.value = (data || []).map((conv) => ({
      id: conv.id,
      title: conv.title,
      updated_at: conv.updated_at,
      is_starred: conv.is_starred || false,
    }));

    // 如果有对话，加载第一个
    if (conversations.value.length > 0 && !activeConversationId.value) {
      activeConversationId.value = conversations.value[0].id;
      await loadConversationMessages(conversations.value[0].id);
    }
  } catch (error) {
    // IPC 未就绪时静默处理
    if (error.message?.includes("No handler registered")) {
      conversations.value = [];
      return;
    }
    logger.error("[AIChatPage] 加载对话列表失败:", error);
    antMessage.error("加载对话列表失败");
  }
};

// 加载对话消息
const loadConversationMessages = async (conversationId) => {
  try {
    const data =
      await window.electronAPI.conversation.getMessages(conversationId);
    messages.value = data.map((msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      timestamp: msg.created_at,
      steps: msg.steps || [],
      preview: msg.preview || null,
    }));

    // 滚动到底部
    await nextTick();
    scrollToBottom();
  } catch (error) {
    logger.error("加载对话消息失败:", error);
    antMessage.error("加载对话消息失败");
  }
};

// 新建对话
const handleNewConversation = async () => {
  try {
    persistHarnessUiState();
    const conversation = await window.electronAPI.conversation.create({
      title: "新对话",
    });

    conversations.value.unshift({
      id: conversation.id,
      title: conversation.title,
      updated_at: Date.now(),
      is_starred: false,
    });

    activeConversationId.value = conversation.id;
    messages.value = [];
    await restoreHarnessUiState(conversation.id);

    antMessage.success("创建新对话成功");
  } catch (error) {
    logger.error("创建对话失败:", error);
    antMessage.error("创建对话失败");
  }
};

// 点击对话
const handleConversationClick = async (conversation) => {
  if (activeConversationId.value === conversation.id) {
    return;
  }

  persistHarnessUiState();
  activeConversationId.value = conversation.id;
  await loadConversationMessages(conversation.id);

  const sessionId = codingAgentSessionMap.value[conversation.id];
  if (sessionId) {
    try {
      await codingAgentStore.resumeSession(sessionId);
    } catch (error) {
      agentLogger.warn("resume coding agent session failed:", error);
    }
  }
  await restoreHarnessUiState(conversation.id, {
    hydrateSelectedTask: Boolean(sessionId),
  });
};

// 对话操作
const handleConversationAction = async ({ action, conversation }) => {
  switch (action) {
    case "rename":
      renameConversation.value = conversation;
      newConversationTitle.value = conversation.title;
      renameModalVisible.value = true;
      break;
    case "star":
      try {
        await window.electronAPI.conversation.toggleStar(conversation.id);
        conversation.is_starred = !conversation.is_starred;
      } catch {
        antMessage.error("操作失败");
      }
      break;
    case "delete":
      try {
        const nextHarnessUiState = { ...harnessUiStateByConversation.value };
        delete nextHarnessUiState[conversation.id];
        harnessUiStateByConversation.value = nextHarnessUiState;
        await window.electronAPI.conversation.delete(conversation.id);
        conversations.value = conversations.value.filter(
          (c) => c.id !== conversation.id,
        );
        if (codingAgentSessionMap.value[conversation.id]) {
          const nextSessionMap = { ...codingAgentSessionMap.value };
          delete nextSessionMap[conversation.id];
          codingAgentSessionMap.value = nextSessionMap;
        }
        if (activeConversationId.value === conversation.id) {
          activeConversationId.value = conversations.value[0]?.id || "";
          if (activeConversationId.value) {
            await loadConversationMessages(activeConversationId.value);
            await restoreHarnessUiState(activeConversationId.value, {
              hydrateSelectedTask: Boolean(
                codingAgentSessionMap.value[activeConversationId.value],
              ),
            });
          } else {
            messages.value = [];
            await restoreHarnessUiState("");
          }
        }
        antMessage.success("删除对话成功");
      } catch {
        antMessage.error("删除对话失败");
      }
      break;
  }
};

// 导航点击
const handleNavClick = (item) => {
  logger.info("导航点击:", item);
  // 处理不同的导航项
  if (item.route) {
    // 如果有路由，跳转到对应页面
    window.location.hash = item.route;
  } else if (item.action) {
    // 执行指定的动作
    switch (item.action) {
      case "newChat":
        handleNewConversation();
        break;
      case "settings":
        window.location.hash = "#/settings";
        break;
      case "help":
        window.location.hash = "#/help";
        break;
      default:
        logger.warn("未处理的导航动作:", item.action);
    }
  }
};

// 用户操作
const handleUserAction = (key) => {
  logger.info("用户操作:", key);
  // 处理用户操作
  switch (key) {
    case "settings":
      window.location.hash = "#/settings";
      break;
    case "profile":
      window.location.hash = "#/profile";
      break;
    case "logout":
      authStore.logout();
      window.location.hash = "#/login";
      break;
    case "help":
      window.location.hash = "#/help";
      break;
    default:
      logger.warn("未处理的用户操作:", key);
  }
};

// 提交消息
const handleSubmitMessage = async ({ text, attachments }) => {
  if (!text.trim()) {
    antMessage.warning("请输入消息内容");
    return;
  }

  // 确保有活动对话
  if (!activeConversationId.value) {
    await handleNewConversation();
  }

  // 添加用户消息
  const userMessage = {
    id: `msg-${Date.now()}`,
    role: "user",
    content: text,
    timestamp: Date.now(),
  };
  messages.value.push(userMessage);

  // 滚动到底部
  await nextTick();
  scrollToBottom();

  // 保存用户消息到数据库
  try {
    await window.electronAPI.conversation.addMessage(
      activeConversationId.value,
      {
        role: "user",
        content: text,
      },
    );
  } catch (error) {
    logger.error("保存消息失败:", error);
  }

  // 开始AI思考
  isThinking.value = true;

  try {
    let response;

    if (agentMode.value && window.electronAPI?.conversation?.agentChat) {
      // Agent mode — tool-use loop via conversation:agent-chat
      const conversationHistory = messages.value
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-20)
        .map((m) => ({ role: m.role, content: m.content }));

      response = await window.electronAPI.conversation.agentChat({
        conversationId: activeConversationId.value,
        userMessage: text,
        conversationHistory,
      });

      if (!response.success) {
        throw new Error(response.error || "Agent chat failed");
      }
      response = { content: response.content, steps: [], preview: null };
    } else {
      // Regular chat
      response = await window.electronAPI.llm.chat({
        conversationId: activeConversationId.value,
        message: text,
        attachments: attachments,
      });
    }

    // 添加AI响应
    const assistantMessage = {
      id: `msg-${Date.now()}-ai`,
      role: "assistant",
      content: response.content,
      timestamp: Date.now(),
      steps: response.steps || [],
      preview: response.preview || null,
    };
    messages.value.push(assistantMessage);

    // 保存AI消息到数据库
    await window.electronAPI.conversation.addMessage(
      activeConversationId.value,
      {
        role: "assistant",
        content: response.content,
        steps: response.steps,
        preview: response.preview,
      },
    );

    // 更新对话标题（如果是第一条消息）
    const conversation = conversations.value.find(
      (c) => c.id === activeConversationId.value,
    );
    if (conversation && conversation.title === "新对话") {
      const newTitle = text.substring(0, 30) + (text.length > 30 ? "..." : "");
      conversation.title = newTitle;
      await window.electronAPI.conversation.update(activeConversationId.value, {
        title: newTitle,
      });
    }

    // 滚动到底部
    await nextTick();
    scrollToBottom();
  } catch (error) {
    logger.error("AI响应失败:", error);
    antMessage.error("AI响应失败: " + error.message);

    // 添加错误消息
    messages.value.push({
      id: `msg-${Date.now()}-error`,
      role: "assistant",
      content: "抱歉，我遇到了一些问题，无法完成你的请求。请稍后重试。",
      timestamp: Date.now(),
    });
  } finally {
    isThinking.value = false;
  }
};

// 处理文件上传
const handleSubmitAgentAwareMessage = async ({ text, attachments }) => {
  if (!text.trim()) {
    antMessage.warning("请输入消息内容");
    return;
  }

  if (!activeConversationId.value) {
    await handleNewConversation();
  }

  const userMessage = {
    id: `msg-${Date.now()}`,
    role: "user",
    content: text,
    timestamp: Date.now(),
  };
  messages.value.push(userMessage);

  await nextTick();
  scrollToBottom();

  try {
    await window.electronAPI.conversation.addMessage(
      activeConversationId.value,
      {
        role: "user",
        content: text,
      },
    );
  } catch (error) {
    logger.error("保存消息失败:", error);
  }

  isThinking.value = true;

  try {
    await updateConversationTitleFromText(text);

    // Intercept workflow commands ($deep-interview / $ralplan / $ralph / $team)
    // These run in-process through the skill handlers and bypass the coding
    // agent / LLM pipeline — their state lives in .chainlesschain/sessions/.
    if (/^\s*\$(deep-interview|ralplan|ralph|team)\b/i.test(text)) {
      const wfResult = await window.electronAPI.codingAgent.runWorkflowCommand({
        text,
        sessionId: codingAgentStore.activeSessionId || undefined,
      });

      const body = wfResult?.success
        ? [wfResult.message, wfResult.guidance].filter(Boolean).join("\n\n")
        : `工作流命令执行失败: ${wfResult?.error || "未知错误"}`;

      const wfMessage = {
        id: `msg-${Date.now()}-workflow`,
        role: "assistant",
        content: body,
        timestamp: Date.now(),
        workflow: wfResult?.success
          ? { skill: wfResult.skill, result: wfResult.result }
          : undefined,
      };
      messages.value.push(wfMessage);

      try {
        await window.electronAPI.conversation.addMessage(
          activeConversationId.value,
          { role: "assistant", content: body },
        );
      } catch (error) {
        logger.error("保存工作流消息失败:", error);
      }

      isThinking.value = false;
      await nextTick();
      scrollToBottom();
      return;
    }

    if (agentMode.value) {
      await ensureCodingAgentSession();
      const confirmed = await ensureHighRiskConfirmation();
      if (!confirmed) {
        isThinking.value = false;
        return;
      }
      const result = await codingAgentStore.sendMessage(text);
      if (!result?.success) {
        throw new Error(result?.error || "Failed to send coding agent message");
      }

      ensurePendingAgentMessage(result.requestId, result.sessionId);
      await nextTick();
      scrollToBottom();
      return;
    }

    const response = await window.electronAPI.llm.chat({
      conversationId: activeConversationId.value,
      message: text,
      attachments: attachments,
    });

    const assistantMessage = {
      id: `msg-${Date.now()}-ai`,
      role: "assistant",
      content: response.content,
      timestamp: Date.now(),
      steps: response.steps || [],
      preview: response.preview || null,
    };
    messages.value.push(assistantMessage);

    await window.electronAPI.conversation.addMessage(
      activeConversationId.value,
      {
        role: "assistant",
        content: response.content,
        steps: response.steps,
        preview: response.preview,
      },
    );

    await nextTick();
    scrollToBottom();
  } catch (error) {
    logger.error("AI响应失败:", error);
    antMessage.error("AI响应失败: " + error.message);

    messages.value.push({
      id: `msg-${Date.now()}-error`,
      role: "assistant",
      content: "抱歉，我遇到了一些问题，暂时无法完成你的请求。请稍后重试。",
      timestamp: Date.now(),
    });
    isThinking.value = false;
  } finally {
    if (!agentMode.value) {
      isThinking.value = false;
    }
  }
};

const handleFileUpload = async (files) => {
  logger.info("上传文件:", files);

  if (!files || files.length === 0) {
    return;
  }

  // 验证文件
  const maxSize = 10 * 1024 * 1024; // 10MB
  const allowedTypes = [
    "image/",
    "text/",
    "application/pdf",
    "application/json",
    "application/javascript",
  ];

  for (const file of files) {
    // 检查文件大小
    if (file.size > maxSize) {
      antMessage.warning(`文件 ${file.name} 过大，请选择小于 10MB 的文件`);
      continue;
    }

    // 检查文件类型
    const isAllowed = allowedTypes.some((type) => file.type.startsWith(type));
    if (!isAllowed && file.type) {
      antMessage.warning(`不支持的文件类型: ${file.type}`);
      continue;
    }

    // 读取文件内容
    try {
      if (file.type.startsWith("image/")) {
        // 图片文件：转为 base64
        const reader = new FileReader();
        reader.onload = (e) => {
          const base64 = e.target.result;
          antMessage.success(`图片 ${file.name} 已添加`);
          // 可以将 base64 数据存储起来供后续使用
          logger.info(`图片已加载: ${file.name}, 大小: ${base64.length} bytes`);
        };
        reader.readAsDataURL(file);
      } else {
        // 文本文件：读取内容
        const reader = new FileReader();
        reader.onload = (e) => {
          const content = e.target.result;
          antMessage.success(`文件 ${file.name} 已添加`);
          logger.info(`文件已加载: ${file.name}, 内容长度: ${content.length}`);
        };
        reader.readAsText(file);
      }
    } catch (error) {
      logger.error("读取文件失败:", error);
      antMessage.error(`读取文件 ${file.name} 失败`);
    }
  }
};

// 处理步骤重试
const handleStepRetry = async (step) => {
  logger.info("重试步骤:", step);

  if (!step || !step.action) {
    antMessage.warning("无法重试该步骤");
    return;
  }

  try {
    isThinking.value = true;

    // 重新执行步骤
    const response = await window.electronAPI.llm.retryStep({
      conversationId: activeConversationId.value,
      step: step,
    });

    if (response?.success) {
      // 更新步骤状态
      step.status = "completed";
      step.result = response.result;
      antMessage.success("步骤重试成功");
    } else {
      step.status = "failed";
      step.error = response?.error || "重试失败";
      antMessage.error("步骤重试失败: " + (response?.error || "未知错误"));
    }
  } catch (error) {
    logger.error("重试步骤失败:", error);
    step.status = "failed";
    step.error = error.message;
    antMessage.error("重试失败: " + error.message);
  } finally {
    isThinking.value = false;
  }
};

// 处理步骤取消
const handleStepCancel = async (step) => {
  logger.info("取消步骤:", step);

  if (!step) {
    return;
  }

  try {
    // 如果步骤正在执行，尝试取消
    if (step.status === "running" || step.status === "pending") {
      const response = await window.electronAPI.llm.cancelStep({
        conversationId: activeConversationId.value,
        stepId: step.id,
      });

      if (response?.success) {
        step.status = "cancelled";
        antMessage.info("步骤已取消");
      } else {
        antMessage.warning("无法取消该步骤");
      }
    } else {
      // 步骤已完成，只是标记为跳过
      step.status = "skipped";
      antMessage.info("步骤已跳过");
    }
  } catch (error) {
    logger.error("取消步骤失败:", error);
    antMessage.error("取消失败: " + error.message);
  }
};

// 保存整个对话到记忆
const handleSaveConversation = async () => {
  if (messages.value.length === 0) {
    antMessage.warning("对话为空，无法保存");
    return;
  }

  try {
    savingConversation.value = true;

    if (!window.electronAPI?.invoke) {
      antMessage.warning("IPC 未就绪，无法保存");
      return;
    }

    // 获取对话标题
    const conversation = conversations.value.find(
      (c) => c.id === activeConversationId.value,
    );
    const title = conversation?.title || "对话记录";

    // 调用 IPC 提取并保存对话
    const result = await window.electronAPI.invoke(
      "memory:extract-from-conversation",
      {
        messages: messages.value.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        conversationTitle: title,
      },
    );

    if (result?.success) {
      antMessage.success(
        `已保存到 Daily Notes (${result.result.messageCount} 条消息)`,
      );
    } else {
      antMessage.error(result?.error || "保存失败");
    }
  } catch (error) {
    logger.error("[AIChatPage] 保存对话失败:", error);
    antMessage.error("保存失败: " + error.message);
  } finally {
    savingConversation.value = false;
  }
};

// 保存到永久记忆
const handleSaveToMemory = async (message, type) => {
  if (message.savedToMemory) {
    antMessage.info("该消息已保存到记忆");
    return;
  }

  try {
    // 构建要保存的内容
    const content = message.content;

    // 调用 IPC 保存
    if (!window.electronAPI?.invoke) {
      antMessage.warning("IPC 未就绪，无法保存");
      return;
    }

    const result = await window.electronAPI.invoke("memory:save-to-memory", {
      content,
      type,
    });

    if (result?.success) {
      message.savedToMemory = true;
      const locationText =
        result.result.savedTo === "daily_notes"
          ? "Daily Notes"
          : `MEMORY.md (${result.result.section})`;
      antMessage.success(`已保存到 ${locationText}`);
    } else {
      antMessage.error(result?.error || "保存失败");
    }
  } catch (error) {
    logger.error("[AIChatPage] 保存到记忆失败:", error);
    antMessage.error("保存失败: " + error.message);
  }
};

// 确认重命名对话
const handleRenameConfirm = async () => {
  if (!newConversationTitle.value.trim()) {
    antMessage.warning("请输入对话标题");
    return;
  }

  try {
    await window.electronAPI.conversation.update(renameConversation.value.id, {
      title: newConversationTitle.value.trim(),
    });

    // 更新本地状态
    const conv = conversations.value.find(
      (c) => c.id === renameConversation.value.id,
    );
    if (conv) {
      conv.title = newConversationTitle.value.trim();
    }

    renameModalVisible.value = false;
    renameConversation.value = null;
    newConversationTitle.value = "";

    antMessage.success("重命名成功");
  } catch (error) {
    logger.error("重命名对话失败:", error);
    antMessage.error("重命名失败: " + error.message);
  }
};

// 取消重命名
const handleRenameCancel = () => {
  renameModalVisible.value = false;
  renameConversation.value = null;
  newConversationTitle.value = "";
};

// 滚动到底部
const scrollToBottom = () => {
  if (messagesContainerRef.value) {
    messagesContainerRef.value.scrollTop =
      messagesContainerRef.value.scrollHeight;
  }
};

// 键盘快捷键处理
const handleKeyboard = (e) => {
  // Ctrl+Shift+M: 保存最后一条 AI 消息到记忆
  if (e.ctrlKey && e.shiftKey && e.key === "M") {
    e.preventDefault();
    const lastAiMessage = [...messages.value]
      .reverse()
      .find((m) => m.role === "assistant");
    if (lastAiMessage && !lastAiMessage.savedToMemory) {
      handleSaveToMemory(lastAiMessage, "daily");
    } else if (lastAiMessage?.savedToMemory) {
      antMessage.info("该消息已保存到记忆");
    } else {
      antMessage.warning("没有可保存的 AI 消息");
    }
  }

  // Ctrl+Shift+S: 保存整个对话到记忆
  if (e.ctrlKey && e.shiftKey && e.key === "S") {
    e.preventDefault();
    if (messages.value.length > 0) {
      handleSaveConversation();
    }
  }
};

// 组件挂载时加载数据
onMounted(async () => {
  await loadConversations();
  enhanceCodeBlocks();
  codingAgentStore.initEventListeners();
  await codingAgentStore.refreshStatus();
  await refreshCodingAgentHarnessPanel({ silent: true });
  worktreeIsolationEnabled.value =
    localStorage.getItem(WORKTREE_ISOLATION_STORAGE_KEY) === "true";

  // 注册键盘快捷键
  window.addEventListener("keydown", handleKeyboard);

  // 检查是否有待插入的文本（来自音频转录等功能）
  const pendingText = localStorage.getItem("pendingInsertText");
  if (pendingText) {
    try {
      const data = JSON.parse(pendingText);
      // 检查是否过期（5分钟内有效）
      if (Date.now() - data.timestamp < 5 * 60 * 1000) {
        nextTick(() => {
          if (inputRef.value) {
            inputRef.value.setText(data.text);
          }
        });
      }
      // 无论是否过期，都清除
      localStorage.removeItem("pendingInsertText");
    } catch {
      localStorage.removeItem("pendingInsertText");
    }
  }
});

// 组件卸载时清理
onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyboard);
  codingAgentStore.disposeEventListeners();
});

// 监听消息变化，自动滚动并增强代码块
watch(
  () => messages.value.length,
  () => {
    nextTick(() => {
      scrollToBottom();
      enhanceCodeBlocks();
    });
  },
);

watch(
  () => codingAgentStore.events.length,
  async () => {
    const latestEvent =
      codingAgentStore.events[codingAgentStore.events.length - 1];
    if (!latestEvent) {
      return;
    }

    await handleCodingAgentEvent(latestEvent);
  },
);

// Phase J+: fire a one-shot toast every time a *new* approval-denied event
// arrives — the sticky banner (`currentApprovalDenied`) handles ongoing
// visibility, but the toast catches the user's eye when the deny first lands.
watch(
  () => codingAgentStore.latestApprovalDeniedEvent?.id || null,
  (eventId, previousId) => {
    if (!eventId || eventId === previousId) {
      return;
    }
    const payload = currentApprovalDenied.value;
    if (!payload) {
      return;
    }
    const tool = payload.toolName || "tool";
    const policy = payload.policy ? ` (policy: ${payload.policy})` : "";
    antMessage.warning(`Approval denied for ${tool}${policy}`);
  },
);

watch(harnessTaskSearchQuery, () => {
  if (restoringHarnessUiState.value) {
    return;
  }
  harnessTaskPage.value = 1;
});

watch(
  () => filteredHarnessTasks.value.length,
  () => {
    if (harnessTaskPage.value > harnessTaskPageCount.value) {
      harnessTaskPage.value = harnessTaskPageCount.value;
    }
  },
);

// 暴露给测试使用
watch(
  [
    harnessTaskStatusFilter,
    harnessTaskSearchQuery,
    harnessTaskPage,
    harnessTaskDrawerVisible,
    harnessTaskHistoryLimit,
    () => codingAgentStore.selectedBackgroundTask?.id || null,
  ],
  () => {
    if (restoringHarnessUiState.value) {
      return;
    }
    persistHarnessUiState();
  },
);

defineExpose({
  // 状态
  conversations,
  activeConversationId,
  codingAgentSessionMap,
  messages,
  isThinking,
  messagesContainerRef,
  inputRef,
  savingConversation,
  renameModalVisible,
  renameConversation,
  newConversationTitle,
  // 计算属性
  userName,
  userAvatar,
  inputPlaceholder,
  // 方法
  loadConversations,
  loadConversationMessages,
  handleNewConversation,
  handleConversationClick,
  handleConversationAction,
  handleSubmitMessage,
  handleSubmitAgentAwareMessage,
  handleFileUpload,
  handleNavClick,
  handleStepRetry,
  handleStepCancel,
  handleEnterPlanMode,
  handleApprovePlan,
  handleRejectPlan,
  handleConfirmHighRisk,
  handleRejectHighRisk,
  handleRefreshHarnessPanel,
  handleSetHarnessTaskFilter,
  handleNextHarnessTaskPage,
  handlePreviousHarnessTaskPage,
  persistHarnessUiState,
  restoreHarnessUiState,
  handleInspectBackgroundTask,
  handleLoadMoreBackgroundTaskHistory,
  handleNavigateHarnessTask,
  handleCloseHarnessTaskDrawer,
  handleClearBackgroundTaskSelection,
  handleStopBackgroundTask,
  handleOpenWorktreeReview,
  handleRefreshWorktreeReview,
  handleMergeCurrentWorktree,
  handleCodingAgentEvent,
  handleUserAction,
  renderMarkdown,
  formatTime,
  scrollToBottom,
  enhanceCodeBlocks,
  harnessTaskDrawerVisible,
  harnessTaskHistoryLimit,
  harnessTaskStatusFilter,
  harnessTaskSearchQuery,
  harnessTaskPage,
  harnessUiStateByConversation,
});
</script>

<style scoped lang="scss">
.ai-chat-page {
  height: 100vh;
  display: flex;
  overflow: hidden;
  background: #f5f7fa;
}

.main-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.conversation-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: white;
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  scroll-behavior: smooth;

  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-thumb {
    background: #d1d5db;
    border-radius: 4px;

    &:hover {
      background: #9ca3af;
    }
  }
}

// 对话操作栏
.coding-agent-alert {
  margin: 0 0 12px;
}

.coding-agent-harness-panel {
  margin: 0 0 12px;
  padding: 16px 18px;
  border: 1px solid #bfdbfe;
  border-radius: 12px;
  background: linear-gradient(180deg, #f8fbff 0%, #eef6ff 100%);
  box-shadow: 0 8px 24px rgba(59, 130, 246, 0.08);
}

.harness-panel-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.harness-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.harness-filter-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.harness-search-input {
  min-width: 220px;
  flex: 1 1 220px;
  padding: 8px 10px;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.88);
  color: #0f172a;
}

.harness-results-count {
  margin-left: 8px;
  font-size: 12px;
  font-weight: 500;
  color: #64748b;
}

.harness-stat-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}

.harness-stat-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(147, 197, 253, 0.55);
}

.harness-stat-label {
  font-size: 12px;
  font-weight: 600;
  color: #1d4ed8;
}

.harness-stat-value {
  font-size: 22px;
  line-height: 1;
  color: #1e3a8a;
}

.harness-stat-meta {
  font-size: 12px;
  color: #475569;
}

.harness-task-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.coding-agent-approval-panel {
  margin: 0 0 12px;
  padding: 16px 18px;
  border: 1px solid #f59e0b;
  border-radius: 12px;
  background: linear-gradient(180deg, #fffaf0 0%, #fff7ed 100%);
  box-shadow: 0 8px 24px rgba(245, 158, 11, 0.08);
}

.approval-panel-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.approval-panel-eyebrow {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #b45309;
  margin-bottom: 6px;
}

.approval-panel-title {
  font-size: 18px;
  font-weight: 700;
  color: #7c2d12;
}

.approval-panel-summary {
  margin: 6px 0 0;
  color: #78350f;
  line-height: 1.6;
}

.approval-panel-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: flex-end;
  gap: 8px;
}

.approval-panel-section {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(180, 83, 9, 0.12);
}

.approval-panel-section-warning {
  background: rgba(251, 191, 36, 0.08);
  border-radius: 10px;
  padding: 12px;
}

.approval-panel-label {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #92400e;
  margin-bottom: 10px;
}

.approval-step-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.approval-step-item {
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(245, 158, 11, 0.14);
}

.approval-step-main {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.approval-step-title {
  font-weight: 600;
  color: #1f2937;
}

.approval-step-description {
  margin-top: 6px;
  color: #6b7280;
  line-height: 1.5;
}

.approval-tool-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: flex-start;
}

.approval-tool-row + .approval-tool-row {
  margin-top: 10px;
}

.approval-tool-label {
  min-width: 150px;
  padding-top: 4px;
  font-size: 13px;
  font-weight: 600;
  color: #92400e;
}

.approval-tool-tags {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  gap: 8px;
}

.approval-panel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 16px;
}

@media (max-width: 768px) {
  .harness-panel-header {
    flex-direction: column;
  }

  .harness-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .harness-stat-grid {
    grid-template-columns: 1fr;
  }

  .approval-panel-header {
    flex-direction: column;
  }

  .approval-panel-tags {
    justify-content: flex-start;
  }

  .approval-tool-label {
    min-width: 0;
    width: 100%;
  }
}

.conversation-actions {
  display: flex;
  justify-content: flex-end;
  padding: 8px 0;
  margin-bottom: 16px;
  border-bottom: 1px solid #e5e7eb;

  :deep(.ant-btn) {
    color: #9ca3af;

    &:hover {
      color: #667eea;
    }
  }
}

// 欢迎消息
.welcome-message {
  max-width: 700px;
  margin: 80px auto;
  text-align: center;

  .welcome-icon {
    font-size: 80px;
    color: #667eea;
    margin-bottom: 24px;
  }

  h2 {
    font-size: 28px;
    font-weight: 600;
    color: #1f2937;
    margin: 0 0 16px 0;
  }

  p {
    font-size: 16px;
    color: #6b7280;
    margin: 0 0 24px 0;
  }

  .welcome-hint {
    font-size: 14px;
    color: #9ca3af;
    margin-top: 32px;

    &.shortcut-hint {
      margin-top: 16px;
      font-size: 12px;
    }
  }

  .shortcut-key {
    display: inline-block;
    padding: 2px 6px;
    background: #f3f4f6;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    font-family: monospace;
    font-size: 11px;
    color: #6b7280;
  }
}

.welcome-features {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin: 24px 0;
}

.feature-tag {
  padding: 8px 16px;
  background: linear-gradient(
    135deg,
    rgba(102, 126, 234, 0.1) 0%,
    rgba(118, 75, 162, 0.1) 100%
  );
  border: 1px solid rgba(102, 126, 234, 0.2);
  border-radius: 20px;
  font-size: 14px;
  color: #667eea;
  font-weight: 500;
}

// 消息项
.message-item {
  margin-bottom: 24px;

  &:last-child {
    margin-bottom: 0;
  }
}

.message-wrapper {
  display: flex;
  gap: 12px;
  max-width: 100%;
}

.message-avatar {
  flex-shrink: 0;
}

.message-content {
  flex: 1;
  min-width: 0;
}

.message-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.message-author {
  font-size: 14px;
  font-weight: 600;
  color: #1f2937;
}

.message-time {
  font-size: 12px;
  color: #9ca3af;
}

.save-memory-dropdown {
  margin-left: auto;
}

.save-memory-btn {
  opacity: 0;
  transition: opacity 0.2s ease;
  font-size: 12px;
  color: #9ca3af;

  &:hover {
    color: #667eea;
  }

  &.saved {
    opacity: 1;
    color: #52c41a;
  }

  .btn-text {
    margin-left: 4px;
  }
}

.message-wrapper:hover .save-memory-btn {
  opacity: 1;
}

.message-text {
  font-size: 15px;
  line-height: 1.6;
  color: #374151;
  word-wrap: break-word;

  /* 行内代码 */
  :deep(code) {
    background: #f3f4f6;
    padding: 2px 6px;
    border-radius: 4px;
    font-family: "Courier New", monospace;
    font-size: 13px;
    color: #dc2626;
  }

  /* 增强的代码块容器 */
  :deep(.code-block-wrapper) {
    position: relative;
    margin: 12px 0;
    border: 1px solid #374151;
    border-radius: 8px;
    overflow: hidden;
    background: #1f2937;
    transition: all 0.2s ease;
  }

  :deep(.code-block-wrapper:hover) {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  /* 语言标签 */
  :deep(.code-block-wrapper::before) {
    content: attr(data-language);
    position: absolute;
    top: 8px;
    right: 12px;
    padding: 3px 10px;
    background: rgba(255, 255, 255, 0.1);
    color: #9ca3af;
    font-size: 11px;
    text-transform: uppercase;
    border-radius: 4px;
    z-index: 2;
    font-weight: 600;
    letter-spacing: 0.5px;
  }

  /* 复制按钮（通过JavaScript添加） */
  :deep(.code-copy-btn) {
    position: absolute;
    top: 8px;
    right: 80px;
    padding: 4px 12px;
    background: rgba(255, 255, 255, 0.1);
    color: #9ca3af;
    border: none;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    z-index: 2;
    opacity: 0;
    transition: all 0.2s ease;
  }

  :deep(.code-block-wrapper:hover .code-copy-btn) {
    opacity: 1;
  }

  :deep(.code-copy-btn:hover) {
    background: rgba(255, 255, 255, 0.2);
    color: #fff;
  }

  :deep(pre) {
    background: #1f2937;
    padding: 40px 16px 16px 16px;
    border-radius: 0;
    overflow-x: auto;
    margin: 0;
    position: relative;

    code {
      background: transparent;
      color: #e5e7eb;
      padding: 0;
      font-size: 14px;
      line-height: 1.8;
      font-family: "Consolas", "Monaco", "Courier New", monospace;
    }
  }

  :deep(a) {
    color: #667eea;
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }

  :deep(strong) {
    font-weight: 600;
    color: #1f2937;
  }
}

// 用户消息样式
.message-user {
  .message-text {
    background: #f9fafb;
    padding: 12px 16px;
    border-radius: 12px;
    display: inline-block;
    max-width: 100%;
  }
}

// AI消息步骤
.message-steps {
  margin-top: 16px;
}

// AI消息预览
.message-preview {
  margin-top: 16px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #e5e7eb;
}

// 思考指示器
.thinking-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: #f9fafb;
  border-radius: 12px;
  color: #6b7280;
  font-size: 14px;

  .anticon {
    color: #667eea;
  }
}

// 输入容器
.input-container {
  padding: 16px 24px;
  border-top: 1px solid #e5e7eb;
  background: #ffffff;
}

.input-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.worktree-review-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-bottom: 12px;
}

.worktree-review-meta {
  margin-bottom: 16px;
}

.worktree-review-section {
  margin-top: 16px;
}

.worktree-review-section-title {
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #1f2937;
}

.worktree-summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.worktree-summary-card {
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f9fafb;

  strong {
    display: block;
    margin-top: 6px;
    font-size: 20px;
    color: #111827;
  }
}

.worktree-summary-label {
  font-size: 12px;
  color: #6b7280;
}

.worktree-file-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.worktree-file-item {
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #ffffff;
}

.worktree-file-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}

.worktree-file-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.worktree-file-path {
  font-family: "Consolas", "Monaco", "Courier New", monospace;
  font-size: 12px;
  color: #111827;
  word-break: break-all;
}

.worktree-file-status {
  flex-shrink: 0;
  font-size: 12px;
  color: #6b7280;
  text-transform: uppercase;
}

.worktree-file-stats {
  font-size: 12px;
  color: #6b7280;
  word-break: break-all;
}

.worktree-patch-preview {
  margin: 0;
  max-height: 280px;
  overflow: auto;
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #111827;
  color: #e5e7eb;
  font-size: 12px;
  line-height: 1.6;
  font-family: "Consolas", "Monaco", "Courier New", monospace;
  white-space: pre-wrap;
  word-break: break-word;
}

.worktree-suggestion-list {
  margin-top: 12px;
}

.worktree-delta-summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 8px;
  margin-top: 12px;
}

.worktree-delta-summary-card {
  appearance: none;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 10px 12px;
  width: 100%;
  border-radius: 10px;
  border: 1px solid transparent;
  background: #f9fafb;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;

  strong {
    display: block;
    margin-top: 4px;
    font-size: 20px;
    line-height: 1;
  }
}

.worktree-delta-summary-card:hover {
  transform: translateY(-1px);
}

.worktree-delta-summary-card:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
}

.worktree-delta-summary-card--active {
  box-shadow: 0 0 0 2px rgba(15, 23, 42, 0.08);
}

.worktree-delta-summary-card--all {
  background: #f8fafc;
  border-color: #cbd5e1;
  color: #334155;
}

.worktree-delta-summary-card--conflict {
  background: #fef2f2;
  border-color: #fecaca;
  color: #991b1b;
}

.worktree-delta-summary-card--warning {
  background: #fffbeb;
  border-color: #fde68a;
  color: #92400e;
}

.worktree-delta-summary-card--clean {
  background: #f0fdf4;
  border-color: #bbf7d0;
  color: #166534;
}

.worktree-delta-summary-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.worktree-suggestion-item {
  padding: 8px 12px;
  border-radius: 8px;
  background: #f9fafb;
  color: #374151;
  font-size: 12px;
}

.worktree-delta-route-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.worktree-delta-route-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 999px;
  background: #f9fafb;
}

.worktree-delta-route-status {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  border: 1px solid transparent;
}

.worktree-delta-route-status--clean {
  color: #166534;
  background: #dcfce7;
  border-color: #bbf7d0;
}

.worktree-delta-route-status--resolved {
  color: #065f46;
  background: #d1fae5;
  border-color: #a7f3d0;
}

.worktree-delta-route-status--warning {
  color: #92400e;
  background: #fef3c7;
  border-color: #fde68a;
}

.worktree-delta-route-status--conflict {
  color: #991b1b;
  background: #fee2e2;
  border-color: #fecaca;
}

.worktree-preview-button {
  padding: 0;
  height: auto;
}

.worktree-preview-route {
  margin-top: 6px;
  color: #4b5563;
}

.worktree-automation-list {
  margin-top: 12px;
}

.worktree-automation-item {
  margin-top: 8px;
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f9fafb;
}

.worktree-automation-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}

.worktree-automation-command {
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  background: #111827;
  color: #e5e7eb;
  font-size: 12px;
  line-height: 1.5;
  word-break: break-all;

  code {
    color: inherit;
    background: transparent;
    padding: 0;
  }
}

.worktree-automation-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.worktree-conflicts {
  margin-top: 12px;
}
</style>
