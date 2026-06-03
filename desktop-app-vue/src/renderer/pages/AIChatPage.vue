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
                <!-- eslint-disable vue/no-v-html -- sanitized via safeHtml / renderMarkdown / DOMPurify; see docs/audits/AUDIT_2026-04-22.md §3 -->
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
  canExecuteWorktreeAutomationCandidate,
} from "./aiChatPageWorktreeUtils";
import { useAiChatWorktree } from "./useAiChatWorktree";
import { useCodingAgentEvents } from "./useCodingAgentEvents";
import { useAiChatHarness } from "./useAiChatHarness";
import { useAgentApprovals } from "./useAgentApprovals";

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
const agentMessageByRequestId = ref({});
const processedCodingAgentEventIds = new Set();
const worktreeIsolationEnabled = ref(false);
const WORKTREE_ISOLATION_STORAGE_KEY =
  "coding-agent-worktree-isolation-enabled";

const currentCodingAgentSessionId = computed(() => {
  if (!activeConversationId.value) {
    return null;
  }
  return codingAgentSessionMap.value[activeConversationId.value] || null;
});

// FAMILY-... 审批面板逻辑抽到 useAgentApprovals composable (SFC 拆分,须在 event composable 前)
const {
  currentApprovalRequest,
  approvalPanelTitle,
  approvalPanelSummary,
  approvalPlanItems,
  approvalPolicyMediumTools,
  approvalPolicyHighTools,
  showApprovalPanel,
  currentBlockedTool,
  currentApprovalDenied,
  planActionLabel,
  subAgentSummaryItems,
  blockedToolDescription,
  isRelaxingPolicy,
  handleRelaxApprovalPolicy,
  approvalDeniedDescription,
  currentHighRiskToolNames,
  needsHighRiskConfirmation,
  highRiskConfirmationDescription,
  ensureHighRiskConfirmation,
  handleEnterPlanMode,
  handleApprovePlan,
  handleRejectPlan,
  handleConfirmHighRisk,
  handleRejectHighRisk,
} = useAgentApprovals({
  codingAgentStore,
  sessionCoreStore,
  currentCodingAgentSessionId,
  isThinking,
  ensureCodingAgentSession: () => ensureCodingAgentSession(),
  ensurePendingAgentMessage: (...args) => ensurePendingAgentMessage(...args),
});

// FAMILY-... harness 任务面板抽到 useAiChatHarness composable (SFC 拆分)
const {
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
} = useAiChatHarness({
  codingAgentStore,
  currentCodingAgentSessionId,
  activeConversationId,
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

// FAMILY-... worktree 评审逻辑抽到 useAiChatWorktree composable (SFC 拆分)
const {
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
} = useAiChatWorktree({
  codingAgentStore,
  currentCodingAgentSessionId,
  worktreeIsolationEnabled,
  ensureCodingAgentSession: () => ensureCodingAgentSession(),
  inputRef,
  agentMode,
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
// FAMILY-... coding-agent 事件处理抽到 useCodingAgentEvents composable (SFC 拆分)
const { handleCodingAgentEvent, ensurePendingAgentMessage } =
  useCodingAgentEvents({
    codingAgentStore,
    currentCodingAgentSessionId,
    messages,
    activeConversationId,
    agentMessageByRequestId,
    processedCodingAgentEventIds,
    isThinking,
    currentHighRiskToolNames,
  });

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

<style scoped lang="scss" src="./AIChatPage.styles.scss"></style>
