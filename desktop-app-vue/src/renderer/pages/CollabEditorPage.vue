<template>
  <div class="collab-editor-page">
    <a-spin :spinning="store.loading">
      <!-- Header Bar -->
      <div class="editor-header">
        <div class="header-left">
          <a-button
            type="text"
            @click="handleBack"
          >
            <template #icon>
              <ArrowLeftOutlined />
            </template>
          </a-button>
          <div class="doc-title-area">
            <h2 class="doc-title">
              {{ currentDoc?.title || 'Untitled Document' }}
            </h2>
            <a-tag
              v-if="currentDoc?.contentType"
              color="blue"
            >
              {{ currentDoc.contentType }}
            </a-tag>
            <a-tag
              v-if="currentDoc?.visibility"
              :color="visibilityColor"
            >
              {{ currentDoc.visibility }}
            </a-tag>
          </div>
        </div>

        <div class="header-center">
          <!-- Collaborator Avatars -->
          <div class="collaborator-avatars">
            <a-tooltip
              v-for="cursor in store.remoteCursors"
              :key="cursor.did"
              :title="cursor.name"
            >
              <a-avatar
                :size="28"
                :style="{ backgroundColor: cursor.color, marginLeft: '-4px' }"
              >
                {{ cursor.name?.charAt(0)?.toUpperCase() || '?' }}
              </a-avatar>
            </a-tooltip>
            <a-badge
              v-if="store.remoteCursors.length > 0"
              :count="store.remoteCursors.length"
              :number-style="{ backgroundColor: '#52c41a', fontSize: '10px' }"
              :offset="[-2, 0]"
            />
          </div>
        </div>

        <div class="header-right">
          <a-button
            size="small"
            @click="handleSaveVersion"
          >
            <template #icon>
              <SaveOutlined />
            </template>
            Save Version
          </a-button>
          <a-button
            size="small"
            @click="handleInvite"
          >
            <template #icon>
              <UserAddOutlined />
            </template>
            Invite
          </a-button>
          <a-button
            size="small"
            @click="toggleSidebar"
          >
            <template #icon>
              <MenuOutlined />
            </template>
          </a-button>
        </div>
      </div>

      <!-- Main Content Area -->
      <div class="editor-body">
        <!-- Editor Area -->
        <div
          class="editor-area"
          :class="{ 'with-sidebar': sidebarVisible }"
        >
          <div
            ref="editorWrapperRef"
            class="editor-wrapper"
          >
            <!-- Cursor Overlay for remote cursors -->
            <CursorOverlay
              :cursors="store.remoteCursors"
              :editor-ref="editorContentRef"
            />

            <!-- Editable Content Area -->
            <div
              ref="editorContentRef"
              class="editor-content"
              contenteditable="true"
              :placeholder="placeholderText"
              @input="handleInput"
              @keyup="handleCursorChange"
              @mouseup="handleCursorChange"
              @click="handleCursorChange"
              @focus="handleEditorFocus"
              @blur="handleEditorBlur"
            />
          </div>

          <!-- Editor Footer / Status Bar -->
          <div class="editor-status-bar">
            <span class="status-item">
              <span class="status-label">Line</span>
              {{ cursorLine + 1 }}
            </span>
            <span class="status-item">
              <span class="status-label">Col</span>
              {{ cursorColumn + 1 }}
            </span>
            <span class="status-item">
              <span class="status-label">Collaborators</span>
              {{ store.remoteCursors.length }}
            </span>
            <span class="status-item">
              <span class="status-label">Versions</span>
              {{ store.versions.length }}
            </span>
          </div>
        </div>

        <!-- Sidebar -->
        <div
          v-if="sidebarVisible"
          class="editor-sidebar"
        >
          <a-tabs
            v-model:active-key="sidebarTab"
            size="small"
          >
            <!-- Collaborators Tab -->
            <a-tab-pane
              key="collaborators"
              tab="Collaborators"
            >
              <div class="sidebar-section">
                <div
                  v-if="store.collaborators.length === 0 && store.remoteCursors.length === 0"
                  class="empty-state"
                >
                  <TeamOutlined style="font-size: 32px; color: #bfbfbf" />
                  <p>No collaborators online</p>
                </div>

                <a-list
                  v-else
                  :data-source="allCollaborators"
                  size="small"
                >
                  <template #renderItem="{ item }">
                    <a-list-item>
                      <a-list-item-meta>
                        <template #avatar>
                          <a-avatar
                            :size="32"
                            :style="{ backgroundColor: item.color || '#1890ff' }"
                          >
                            {{ item.name?.charAt(0)?.toUpperCase() || '?' }}
                          </a-avatar>
                        </template>
                        <template #title>
                          {{ item.name || item.did?.substring(0, 16) + '...' }}
                        </template>
                        <template #description>
                          <a-badge
                            status="success"
                            text="Online"
                          />
                        </template>
                      </a-list-item-meta>
                    </a-list-item>
                  </template>
                </a-list>
              </div>
            </a-tab-pane>

            <!-- Version History Tab -->
            <a-tab-pane
              key="versions"
              tab="Versions"
            >
              <div class="sidebar-section">
                <a-button
                  type="dashed"
                  block
                  size="small"
                  style="margin-bottom: 12px"
                  @click="handleSaveVersion"
                >
                  <template #icon>
                    <PlusOutlined />
                  </template>
                  Create Snapshot
                </a-button>

                <div
                  v-if="store.versions.length === 0"
                  class="empty-state"
                >
                  <HistoryOutlined style="font-size: 32px; color: #bfbfbf" />
                  <p>No versions yet</p>
                </div>

                <a-timeline v-else>
                  <a-timeline-item
                    v-for="version in store.versions"
                    :key="version.id"
                    :color="version.versionNumber === store.latestVersionNumber ? 'green' : 'gray'"
                  >
                    <div class="version-item">
                      <div class="version-header">
                        <strong>v{{ version.versionNumber }}</strong>
                        <a-button
                          type="link"
                          size="small"
                          @click="handleRollback(version)"
                        >
                          Restore
                        </a-button>
                      </div>
                      <div class="version-description">
                        {{ version.description }}
                      </div>
                      <div class="version-meta">
                        {{ formatTime(version.createdAt) }}
                      </div>
                    </div>
                  </a-timeline-item>
                </a-timeline>
              </div>
            </a-tab-pane>
          </a-tabs>
        </div>
      </div>
    </a-spin>

    <!-- Invite Modal -->
    <a-modal
      v-model:open="inviteModalVisible"
      title="Invite Collaborator"
      :confirm-loading="inviteLoading"
      @ok="handleInviteSubmit"
    >
      <a-form layout="vertical">
        <a-form-item label="Collaborator DID">
          <a-input
            v-model:value="inviteForm.inviteeDid"
            placeholder="Enter the DID of the person to invite"
          />
        </a-form-item>
        <a-form-item label="Permission">
          <a-select v-model:value="inviteForm.permission">
            <a-select-option value="editor">
              Editor
            </a-select-option>
            <a-select-option value="commenter">
              Commenter
            </a-select-option>
            <a-select-option value="viewer">
              Viewer
            </a-select-option>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- Save Version Modal -->
    <a-modal
      v-model:open="saveVersionModalVisible"
      title="Save Version"
      :confirm-loading="saveVersionLoading"
      @ok="handleSaveVersionSubmit"
    >
      <a-form layout="vertical">
        <a-form-item label="Description">
          <a-input
            v-model:value="versionDescription"
            placeholder="Describe what changed in this version"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import {
  ArrowLeftOutlined,
  SaveOutlined,
  UserAddOutlined,
  MenuOutlined,
  TeamOutlined,
  HistoryOutlined,
  PlusOutlined,
} from '@ant-design/icons-vue';
import { useSocialCollabStore } from '@/stores/socialCollab';
import CursorOverlay from '@/components/social/CursorOverlay.vue';

const route = useRoute();
const router = useRouter();
const store = useSocialCollabStore();

// ==================== Refs ====================

const editorWrapperRef = ref(null);
const editorContentRef = ref(null);
const sidebarVisible = ref(true);
const sidebarTab = ref('collaborators');
const cursorLine = ref(0);
const cursorColumn = ref(0);
const inviteModalVisible = ref(false);
const inviteLoading = ref(false);
const saveVersionModalVisible = ref(false);
const saveVersionLoading = ref(false);
const versionDescription = ref('');
const cursorPollTimer = ref(null);

const inviteForm = ref({
  inviteeDid: '',
  permission: 'editor',
});

// ==================== Computed ====================

const currentDoc = computed(() => store.currentDoc);

const docId = computed(() => {
  return (route.params?.docId) || '';
});

const placeholderText = computed(() => {
  const type = currentDoc.value?.contentType || 'markdown';
  switch (type) {
    case 'markdown':
      return 'Start writing in Markdown...';
    case 'richtext':
      return 'Start writing...';
    case 'table':
      return 'Enter table data...';
    case 'whiteboard':
      return 'Start drawing...';
    default:
      return 'Start typing...';
  }
});

const visibilityColor = computed(() => {
  switch (currentDoc.value?.visibility) {
    case 'private':
      return 'red';
    case 'friends':
      return 'green';
    case 'invited':
      return 'orange';
    default:
      return 'default';
  }
});

const allCollaborators = computed(() => {
  return store.remoteCursors.map((cursor) => ({
    did: cursor.did,
    name: cursor.name,
    color: cursor.color,
  }));
});

// ==================== Lifecycle ====================

onMounted(async () => {
  if (docId.value) {
    try {
      await store.openDocument(docId.value);
    } catch (err) {
      message.error('Failed to open document');
      router.back();
      return;
    }
  }

  // Start polling for cursor updates
  cursorPollTimer.value = setInterval(async () => {
    if (store.currentDoc) {
      await store.refreshCursors();
    }
  }, 2000);
});

onUnmounted(async () => {
  // Stop cursor polling
  if (cursorPollTimer.value) {
    clearInterval(cursorPollTimer.value);
    cursorPollTimer.value = null;
  }

  // Close the document
  await store.closeDocument();
});

// Watch for route changes
watch(
  () => route.params?.docId,
  async (newDocId) => {
    if (newDocId && newDocId !== store.currentDoc?.id) {
      await store.closeDocument();
      await store.openDocument(newDocId);
    }
  },
);

// ==================== Methods ====================

function handleBack() {
  router.back();
}

function toggleSidebar() {
  sidebarVisible.value = !sidebarVisible.value;
}

function handleInput() {
  handleCursorChange();
}

function handleCursorChange() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) {return;}

  const range = sel.getRangeAt(0);
  const editor = editorContentRef.value;
  if (!editor) {return;}

  // Calculate line and column from the editor content
  const text = editor.innerText || '';
  const preRange = document.createRange();
  preRange.selectNodeContents(editor);
  preRange.setEnd(range.startContainer, range.startOffset);
  const preText = preRange.toString();
  const lines = preText.split('\n');

  cursorLine.value = lines.length - 1;
  cursorColumn.value = lines[lines.length - 1]?.length || 0;

  // Report cursor position to the store
  const hasSelection = !range.collapsed;
  let selection = null;

  if (hasSelection) {
    const endPreRange = document.createRange();
    endPreRange.selectNodeContents(editor);
    endPreRange.setEnd(range.endContainer, range.endOffset);
    const endPreText = endPreRange.toString();
    const endLines = endPreText.split('\n');

    selection = {
      start: {
        line: cursorLine.value,
        column: cursorColumn.value,
      },
      end: {
        line: endLines.length - 1,
        column: endLines[endLines.length - 1]?.length || 0,
      },
    };
  }

  store.updateLocalCursor(
    { line: cursorLine.value, column: cursorColumn.value },
    selection,
  );
}

function handleEditorFocus() {
  // Could trigger awareness broadcast
}

function handleEditorBlur() {
  // Could trigger awareness cleanup
}

function handleInvite() {
  inviteForm.value = { inviteeDid: '', permission: 'editor' };
  inviteModalVisible.value = true;
}

async function handleInviteSubmit() {
  if (!inviteForm.value.inviteeDid.trim()) {
    message.warning('Please enter a DID');
    return;
  }

  if (!store.currentDoc) {
    message.error('No document open');
    return;
  }

  inviteLoading.value = true;
  try {
    await store.inviteUser({
      docId: store.currentDoc.id,
      inviteeDid: inviteForm.value.inviteeDid.trim(),
      permission: inviteForm.value.permission,
    });
    message.success('Invitation sent');
    inviteModalVisible.value = false;
  } catch (err) {
    message.error(err?.message || 'Failed to send invitation');
  } finally {
    inviteLoading.value = false;
  }
}

function handleSaveVersion() {
  versionDescription.value = '';
  saveVersionModalVisible.value = true;
}

async function handleSaveVersionSubmit() {
  if (!store.currentDoc) {
    message.error('No document open');
    return;
  }

  saveVersionLoading.value = true;
  try {
    const version = await store.createVersion({
      docId: store.currentDoc.id,
      description: versionDescription.value.trim() || undefined,
    });

    if (version) {
      message.success(`Version ${version.versionNumber} saved`);
      saveVersionModalVisible.value = false;
    } else {
      message.error('Failed to save version');
    }
  } catch (err) {
    message.error(err?.message || 'Failed to save version');
  } finally {
    saveVersionLoading.value = false;
  }
}

async function handleRollback(version) {
  if (!store.currentDoc) {return;}

  try {
    await store.rollback(store.currentDoc.id, version.versionNumber);
    message.success(`Rolled back to version ${version.versionNumber}`);
  } catch (err) {
    message.error(err?.message || 'Rollback failed');
  }
}

function formatTime(timestamp) {
  if (!timestamp) {return '';}
  const date = new Date(timestamp);
  return date.toLocaleString();
}
</script>

<style scoped>
.collab-editor-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
}

.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-bottom: 1px solid #f0f0f0;
  background: #fafafa;
  min-height: 48px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.doc-title-area {
  display: flex;
  align-items: center;
  gap: 8px;
}

.doc-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-center {
  display: flex;
  align-items: center;
  justify-content: center;
}

.collaborator-avatars {
  display: flex;
  align-items: center;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.editor-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.editor-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: all 0.2s;
}

.editor-area.with-sidebar {
  margin-right: 0;
}

.editor-wrapper {
  flex: 1;
  position: relative;
  overflow: auto;
  padding: 24px 32px;
}

.editor-content {
  min-height: 100%;
  outline: none;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 15px;
  line-height: 1.8;
  color: #333;
  word-wrap: break-word;
  white-space: pre-wrap;
}

.editor-content:empty::before {
  content: attr(placeholder);
  color: #bfbfbf;
  pointer-events: none;
}

.editor-status-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 4px 16px;
  border-top: 1px solid #f0f0f0;
  background: #fafafa;
  font-size: 12px;
  color: #8c8c8c;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.status-label {
  font-weight: 500;
  color: #bfbfbf;
}

.editor-sidebar {
  width: 300px;
  border-left: 1px solid #f0f0f0;
  overflow-y: auto;
  background: #fafafa;
  flex-shrink: 0;
}

.editor-sidebar :deep(.ant-tabs-nav) {
  padding: 0 12px;
  margin-bottom: 0;
}

.sidebar-section {
  padding: 12px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  color: #bfbfbf;
  text-align: center;
}

.empty-state p {
  margin-top: 8px;
  font-size: 13px;
}

.version-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.version-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.version-description {
  font-size: 12px;
  color: #595959;
}

.version-meta {
  font-size: 11px;
  color: #bfbfbf;
}
</style>
