<template>
  <div class="collaborative-editor">
    <!-- Toolbar with active users -->
    <div class="editor-toolbar">
      <div class="active-users">
        <a-tooltip
          v-for="user in activeUsers"
          :key="user.clientId"
          :title="user.name"
        >
          <a-avatar
            :style="{ backgroundColor: user.color, cursor: 'pointer' }"
            :size="32"
          >
            {{ user.name.charAt(0).toUpperCase() }}
          </a-avatar>
        </a-tooltip>
        <span class="user-count">{{ activeUsers.length }} editing</span>
      </div>

      <div class="editor-actions">
        <a-button :loading="saving" @click="saveSnapshot">
          <SaveOutlined /> Save Version
        </a-button>
        <a-button @click="showVersionHistory">
          <HistoryOutlined /> History
        </a-button>
        <a-button @click="showComments">
          <CommentOutlined /> Comments ({{ commentCount }})
        </a-button>
      </div>
    </div>

    <!-- Editor container -->
    <div ref="editorContainer" class="editor-container">
      <!-- Remote cursors -->
      <div
        v-for="user in activeUsers.filter((u) => u.clientId !== 'local')"
        :key="user.clientId"
        class="remote-cursor"
        :style="getCursorStyle(user)"
      >
        <div class="cursor-flag" :style="{ backgroundColor: user.color }">
          {{ user.name }}
        </div>
      </div>

      <!-- Monaco Editor -->
      <div ref="monacoEditor" class="monaco-editor-wrapper" />
    </div>

    <!-- Version History Modal -->
    <a-modal
      v-model:open="versionHistoryVisible"
      title="Version History"
      width="800px"
      :footer="null"
    >
      <a-timeline>
        <a-timeline-item
          v-for="version in versionHistory"
          :key="version.id"
          :color="version.id === currentVersionId ? 'green' : 'blue'"
        >
          <template #dot>
            <ClockCircleOutlined v-if="version.id === currentVersionId" />
          </template>
          <div class="version-item">
            <div class="version-header">
              <strong>{{ formatDate(version.createdAt) }}</strong>
              <span class="version-author"
                >by {{ version.metadata.author }}</span
              >
            </div>
            <div class="version-description">
              {{ version.metadata.description || "No description" }}
            </div>
            <div class="version-actions">
              <a-button size="small" @click="previewVersion(version.id)">
                Preview
              </a-button>
              <a-button
                v-if="version.id !== currentVersionId"
                size="small"
                type="primary"
                @click="restoreVersion(version.id)"
              >
                Restore
              </a-button>
            </div>
          </div>
        </a-timeline-item>
      </a-timeline>
    </a-modal>

    <!-- Comments Panel -->
    <a-drawer
      v-model:open="commentsVisible"
      title="Comments"
      placement="right"
      width="400"
    >
      <div class="comments-list">
        <div v-for="comment in comments" :key="comment.id" class="comment-item">
          <div class="comment-header">
            <a-avatar :size="24">
              {{ comment.author_name.charAt(0) }}
            </a-avatar>
            <span class="comment-author">{{ comment.author_name }}</span>
            <span class="comment-time">{{
              formatTime(comment.created_at)
            }}</span>
          </div>
          <div class="comment-content">
            {{ comment.content }}
          </div>
          <div class="comment-actions">
            <a-button
              size="small"
              type="link"
              @click="replyToComment(comment.id)"
            >
              Reply
            </a-button>
            <a-button
              v-if="comment.status === 'open'"
              size="small"
              type="link"
              @click="resolveComment(comment.id)"
            >
              Resolve
            </a-button>
          </div>
          <!-- Replies -->
          <div
            v-if="comment.replies && comment.replies.length > 0"
            class="comment-replies"
          >
            <div
              v-for="reply in comment.replies"
              :key="reply.id"
              class="reply-item"
            >
              <div class="reply-header">
                <a-avatar :size="20">
                  {{ reply.author_name.charAt(0) }}
                </a-avatar>
                <span class="reply-author">{{ reply.author_name }}</span>
              </div>
              <div class="reply-content">
                {{ reply.content }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Add Comment Form -->
      <div class="add-comment-form">
        <a-textarea
          v-model:value="newCommentText"
          placeholder="Add a comment..."
          :rows="3"
        />
        <a-button
          type="primary"
          :disabled="!newCommentText.trim()"
          @click="addComment"
        >
          Add Comment
        </a-button>
      </div>
    </a-drawer>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, onMounted, onUnmounted, computed, watch } from "vue";
import { message } from "ant-design-vue";
import {
  SaveOutlined,
  HistoryOutlined,
  CommentOutlined,
  ClockCircleOutlined,
} from "@ant-design/icons-vue";
import * as monaco from "monaco-editor";
import { useIdentityStore } from "@/stores/identityStore";

const props = defineProps({
  knowledgeId: {
    type: String,
    required: true,
  },
  organizationId: {
    type: String,
    default: null,
  },
  initialContent: {
    type: String,
    default: "",
  },
  language: {
    type: String,
    default: "markdown",
  },
  readOnly: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits([
  "content-changed",
  "save",
  "user-joined",
  "user-left",
]);

// Stores
const identityStore = useIdentityStore();

// Refs
const editorContainer = ref(null);
const monacoEditor = ref(null);
let editor = null;
const ydoc = null;
const ytext = null;
const awareness = null;

// State
const activeUsers = ref([]);
const versionHistory = ref([]);
const comments = ref([]);
const versionHistoryVisible = ref(false);
const commentsVisible = ref(false);
const saving = ref(false);
const newCommentText = ref("");
const currentVersionId = ref(null);
const replyingToComment = ref(null); // 当前正在回复的评论

// Computed
const commentCount = computed(() => {
  return comments.value.filter((c) => c.status === "open").length;
});

// Initialize collaborative editor
onMounted(async () => {
  try {
    // Initialize Monaco Editor
    editor = monaco.editor.create(monacoEditor.value, {
      value: props.initialContent,
      language: props.language,
      theme: "vs-dark",
      readOnly: props.readOnly,
      automaticLayout: true,
      minimap: { enabled: true },
      fontSize: 14,
      lineNumbers: "on",
      scrollBeyondLastLine: false,
      wordWrap: "on",
    });

    // Initialize Yjs collaboration
    await initializeCollaboration();

    // Load version history
    await loadVersionHistory();

    // Load comments
    await loadComments();

    // Listen for cursor changes
    editor.onDidChangeCursorPosition((e) => {
      updateCursorPosition(e.position);
    });

    // Listen for selection changes
    editor.onDidChangeCursorSelection((e) => {
      updateSelection(e.selection);
    });
  } catch (error) {
    logger.error("Error initializing collaborative editor:", error);
    message.error("Failed to initialize collaborative editor");
  }
});

// Clean up on unmount
onUnmounted(async () => {
  if (ydoc) {
    await window.electron.ipcRenderer.invoke("collab:close-document", {
      docId: props.knowledgeId,
    });
  }

  if (editor) {
    editor.dispose();
  }
});

// Initialize Yjs collaboration
async function initializeCollaboration() {
  try {
    // Open document for collaboration
    const result = await window.electron.ipcRenderer.invoke(
      "collab:open-document",
      {
        docId: props.knowledgeId,
        organizationId: props.organizationId,
      },
    );

    if (!result.success) {
      throw new Error(result.error);
    }

    // Set up awareness listener
    window.electron.on("collab:awareness-updated", (data) => {
      if (data.docId === props.knowledgeId) {
        updateActiveUsers(data.users);
      }
    });

    // Set up document update listener
    window.electron.on("collab:document-updated", (data) => {
      if (data.docId === props.knowledgeId) {
        // Document was updated by another user
        syncEditorContent();
      }
    });

    // Initial sync
    await syncEditorContent();
  } catch (error) {
    logger.error("Error initializing collaboration:", error);
    throw error;
  }
}

// Sync editor content with Yjs document
async function syncEditorContent() {
  try {
    const result = await window.electron.ipcRenderer.invoke(
      "collab:get-content",
      {
        docId: props.knowledgeId,
      },
    );

    if (result.success && result.content !== editor.getValue()) {
      editor.setValue(result.content);
    }
  } catch (error) {
    logger.error("Error syncing editor content:", error);
  }
}

// Update cursor position
async function updateCursorPosition(position) {
  try {
    await window.electron.ipcRenderer.invoke("collab:update-cursor", {
      docId: props.knowledgeId,
      cursor: {
        line: position.lineNumber,
        column: position.column,
      },
    });
  } catch (error) {
    logger.error("Error updating cursor:", error);
  }
}

// Update selection
async function updateSelection(selection) {
  try {
    await window.electron.ipcRenderer.invoke("collab:update-cursor", {
      docId: props.knowledgeId,
      cursor: {
        line: selection.startLineNumber,
        column: selection.startColumn,
      },
      selection: {
        startLine: selection.startLineNumber,
        startColumn: selection.startColumn,
        endLine: selection.endLineNumber,
        endColumn: selection.endColumn,
      },
    });
  } catch (error) {
    logger.error("Error updating selection:", error);
  }
}

// Update active users
function updateActiveUsers(users) {
  activeUsers.value = users;

  // Emit events for user join/leave
  users.forEach((user) => {
    if (!activeUsers.value.find((u) => u.clientId === user.clientId)) {
      emit("user-joined", user);
    }
  });

  activeUsers.value.forEach((user) => {
    if (!users.find((u) => u.clientId === user.clientId)) {
      emit("user-left", user);
    }
  });
}

// Get cursor style for remote user
function getCursorStyle(user) {
  if (!user.cursor) {
    return { display: "none" };
  }

  const position = editor.getScrolledVisiblePosition({
    lineNumber: user.cursor.line,
    column: user.cursor.column,
  });

  if (!position) {
    return { display: "none" };
  }

  return {
    left: `${position.left}px`,
    top: `${position.top}px`,
    display: "block",
  };
}

// Save snapshot
async function saveSnapshot() {
  try {
    saving.value = true;

    const description = await new Promise((resolve) => {
      // Show input dialog for version description
      const desc = prompt("Enter version description (optional):");
      resolve(desc || "Manual save");
    });

    const result = await window.electron.ipcRenderer.invoke(
      "collab:create-snapshot",
      {
        docId: props.knowledgeId,
        metadata: {
          description,
          author:
            identityStore.currentIdentity?.display_name ||
            identityStore.currentUserDID ||
            "Anonymous",
          timestamp: Date.now(),
        },
      },
    );

    if (result.success) {
      message.success("Version saved successfully");
      await loadVersionHistory();
      currentVersionId.value = result.snapshotId;
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    logger.error("Error saving snapshot:", error);
    message.error("Failed to save version");
  } finally {
    saving.value = false;
  }
}

// Load version history
async function loadVersionHistory() {
  try {
    const result = await window.electron.ipcRenderer.invoke(
      "collab:get-version-history",
      {
        docId: props.knowledgeId,
        limit: 50,
      },
    );

    if (result.success) {
      versionHistory.value = result.versions;
    }
  } catch (error) {
    logger.error("Error loading version history:", error);
  }
}

// Show version history
function showVersionHistory() {
  versionHistoryVisible.value = true;
}

// Preview version
async function previewVersion(versionId) {
  try {
    const result = await window.electron.ipcRenderer.invoke(
      "collab:preview-version",
      {
        docId: props.knowledgeId,
        versionId,
      },
    );

    if (result.success) {
      // Open in new window or show diff
      message.info("Preview feature coming soon");
    }
  } catch (error) {
    logger.error("Error previewing version:", error);
    message.error("Failed to preview version");
  }
}

// Restore version
async function restoreVersion(versionId) {
  try {
    const confirmed = confirm(
      "Are you sure you want to restore this version? Current changes will be saved as a new version.",
    );

    if (!confirmed) {
      return;
    }

    const result = await window.electron.ipcRenderer.invoke(
      "collab:restore-version",
      {
        docId: props.knowledgeId,
        versionId,
      },
    );

    if (result.success) {
      message.success("Version restored successfully");
      await syncEditorContent();
      await loadVersionHistory();
      versionHistoryVisible.value = false;
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    logger.error("Error restoring version:", error);
    message.error("Failed to restore version");
  }
}

// Load comments
async function loadComments() {
  try {
    const result = await window.electron.ipcRenderer.invoke(
      "knowledge:get-comments",
      {
        knowledgeId: props.knowledgeId,
        orgId: props.organizationId,
      },
    );

    if (result.success) {
      comments.value = result.comments;
    }
  } catch (error) {
    logger.error("Error loading comments:", error);
  }
}

// Show comments
function showComments() {
  commentsVisible.value = true;
}

// Add comment
async function addComment() {
  try {
    const selection = editor.getSelection();

    const result = await window.electron.ipcRenderer.invoke(
      "knowledge:add-comment",
      {
        knowledgeId: props.knowledgeId,
        orgId: props.organizationId,
        content: newCommentText.value,
        positionStart: selection
          ? editor.getModel().getOffsetAt(selection.getStartPosition())
          : null,
        positionEnd: selection
          ? editor.getModel().getOffsetAt(selection.getEndPosition())
          : null,
      },
    );

    if (result.success) {
      message.success("Comment added");
      newCommentText.value = "";
      await loadComments();
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    logger.error("Error adding comment:", error);
    message.error("Failed to add comment");
  }
}

// Reply to comment
function replyToComment(commentId) {
  // 设置正在回复的评论
  const comment = comments.value.find((c) => c.id === commentId);
  if (comment) {
    replyingToComment.value = comment;
    newCommentText.value = `@${comment.author || "User"} `;
    // 聚焦到评论输入框
    message.info("请输入回复内容");
  }
}

// 取消回复
function cancelReply() {
  replyingToComment.value = null;
  newCommentText.value = "";
}

// 发送回复
async function submitReply() {
  if (!replyingToComment.value || !newCommentText.value.trim()) {
    return;
  }

  try {
    const result = await window.electron.ipcRenderer.invoke(
      "knowledge:add-comment",
      {
        knowledgeId: props.knowledgeId,
        orgId: props.organizationId,
        content: newCommentText.value,
        parentId: replyingToComment.value.id, // 父评论ID
        positionStart: replyingToComment.value.positionStart,
        positionEnd: replyingToComment.value.positionEnd,
      },
    );

    if (result.success) {
      message.success("Reply added");
      cancelReply();
      await loadComments();
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    logger.error("Error adding reply:", error);
    message.error("Failed to add reply");
  }
}

// Resolve comment
async function resolveComment(commentId) {
  try {
    const result = await window.electron.ipcRenderer.invoke(
      "knowledge:resolve-comment",
      {
        commentId,
      },
    );

    if (result.success) {
      message.success("Comment resolved");
      await loadComments();
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    logger.error("Error resolving comment:", error);
    message.error("Failed to resolve comment");
  }
}

// Format date
function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString();
}

// Format time
function formatTime(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60000) {
    return "Just now";
  }
  if (diff < 3600000) {
    return `${Math.floor(diff / 60000)}m ago`;
  }
  if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)}h ago`;
  }
  return new Date(timestamp).toLocaleDateString();
}
</script>

<style scoped lang="scss">
.collaborative-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1e1e1e;

  .editor-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    background: #252526;
    border-bottom: 1px solid #3e3e42;

    .active-users {
      display: flex;
      align-items: center;
      gap: 8px;

      .user-count {
        margin-left: 8px;
        color: #cccccc;
        font-size: 13px;
      }
    }

    .editor-actions {
      display: flex;
      gap: 8px;
    }
  }

  .editor-container {
    position: relative;
    flex: 1;
    overflow: hidden;

    .monaco-editor-wrapper {
      width: 100%;
      height: 100%;
    }

    .remote-cursor {
      position: absolute;
      pointer-events: none;
      z-index: 1000;

      &::before {
        content: "";
        position: absolute;
        width: 2px;
        height: 20px;
        background: currentColor;
      }

      .cursor-flag {
        position: absolute;
        top: -20px;
        left: 2px;
        padding: 2px 6px;
        border-radius: 3px;
        color: white;
        font-size: 11px;
        white-space: nowrap;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
      }
    }
  }

  .version-item {
    .version-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;

      .version-author {
        color: #888;
        font-size: 12px;
      }
    }

    .version-description {
      color: #666;
      font-size: 13px;
      margin-bottom: 8px;
    }

    .version-actions {
      display: flex;
      gap: 8px;
    }
  }

  .comments-list {
    .comment-item {
      padding: 12px;
      border-bottom: 1px solid #f0f0f0;

      .comment-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;

        .comment-author {
          font-weight: 500;
          font-size: 13px;
        }

        .comment-time {
          color: #888;
          font-size: 12px;
          margin-left: auto;
        }
      }

      .comment-content {
        font-size: 14px;
        line-height: 1.5;
        margin-bottom: 8px;
      }

      .comment-actions {
        display: flex;
        gap: 8px;
      }

      .comment-replies {
        margin-top: 12px;
        padding-left: 32px;
        border-left: 2px solid #e8e8e8;

        .reply-item {
          margin-bottom: 8px;

          .reply-header {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 4px;

            .reply-author {
              font-weight: 500;
              font-size: 12px;
            }
          }

          .reply-content {
            font-size: 13px;
            color: #666;
          }
        }
      }
    }
  }

  .add-comment-form {
    position: sticky;
    bottom: 0;
    padding: 16px;
    background: white;
    border-top: 1px solid #f0f0f0;

    .ant-btn {
      margin-top: 8px;
      width: 100%;
    }
  }
}
</style>
