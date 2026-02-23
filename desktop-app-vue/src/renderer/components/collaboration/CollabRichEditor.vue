<template>
  <div class="collab-rich-editor">
    <!-- Toolbar -->
    <div class="editor-toolbar" v-if="editor">
      <a-space wrap>
        <!-- Text formatting -->
        <a-button
          size="small"
          :type="editor.isActive('bold') ? 'primary' : 'default'"
          @click="editor.chain().focus().toggleBold().run()"
        >
          <BoldOutlined />
        </a-button>
        <a-button
          size="small"
          :type="editor.isActive('italic') ? 'primary' : 'default'"
          @click="editor.chain().focus().toggleItalic().run()"
        >
          <ItalicOutlined />
        </a-button>
        <a-button
          size="small"
          :type="editor.isActive('strike') ? 'primary' : 'default'"
          @click="editor.chain().focus().toggleStrike().run()"
        >
          <StrikethroughOutlined />
        </a-button>
        <a-button
          size="small"
          :type="editor.isActive('highlight') ? 'primary' : 'default'"
          @click="editor.chain().focus().toggleHighlight().run()"
        >
          <HighlightOutlined />
        </a-button>

        <a-divider type="vertical" />

        <!-- Headings -->
        <a-button
          size="small"
          :type="editor.isActive('heading', { level: 1 }) ? 'primary' : 'default'"
          @click="editor.chain().focus().toggleHeading({ level: 1 }).run()"
        >
          H1
        </a-button>
        <a-button
          size="small"
          :type="editor.isActive('heading', { level: 2 }) ? 'primary' : 'default'"
          @click="editor.chain().focus().toggleHeading({ level: 2 }).run()"
        >
          H2
        </a-button>
        <a-button
          size="small"
          :type="editor.isActive('heading', { level: 3 }) ? 'primary' : 'default'"
          @click="editor.chain().focus().toggleHeading({ level: 3 }).run()"
        >
          H3
        </a-button>

        <a-divider type="vertical" />

        <!-- Lists -->
        <a-button
          size="small"
          :type="editor.isActive('bulletList') ? 'primary' : 'default'"
          @click="editor.chain().focus().toggleBulletList().run()"
        >
          <UnorderedListOutlined />
        </a-button>
        <a-button
          size="small"
          :type="editor.isActive('orderedList') ? 'primary' : 'default'"
          @click="editor.chain().focus().toggleOrderedList().run()"
        >
          <OrderedListOutlined />
        </a-button>
        <a-button
          size="small"
          :type="editor.isActive('taskList') ? 'primary' : 'default'"
          @click="editor.chain().focus().toggleTaskList().run()"
        >
          <CheckSquareOutlined />
        </a-button>

        <a-divider type="vertical" />

        <!-- Block elements -->
        <a-button
          size="small"
          :type="editor.isActive('codeBlock') ? 'primary' : 'default'"
          @click="editor.chain().focus().toggleCodeBlock().run()"
        >
          <CodeOutlined />
        </a-button>
        <a-button
          size="small"
          :type="editor.isActive('blockquote') ? 'primary' : 'default'"
          @click="editor.chain().focus().toggleBlockquote().run()"
        >
          <MenuOutlined />
        </a-button>
        <a-button
          size="small"
          @click="editor.chain().focus().setHorizontalRule().run()"
        >
          <LineOutlined />
        </a-button>

        <a-divider type="vertical" />

        <!-- Undo/Redo -->
        <a-button size="small" @click="undo" :disabled="!canUndo">
          <UndoOutlined />
          Undo
        </a-button>
        <a-button size="small" @click="redo" :disabled="!canRedo">
          <RedoOutlined />
          Redo
        </a-button>
      </a-space>
    </div>

    <!-- Presence bar showing active collaborators -->
    <div class="presence-bar" v-if="activeUsers.length > 0">
      <a-avatar-group :max-count="5" size="small">
        <a-tooltip
          v-for="user in activeUsers"
          :key="user.did"
          :title="user.name"
        >
          <a-avatar :style="{ backgroundColor: user.color }">
            {{ user.name?.charAt(0)?.toUpperCase() || '?' }}
          </a-avatar>
        </a-tooltip>
      </a-avatar-group>
      <span class="presence-count">
        {{ activeUsers.length }} collaborator{{ activeUsers.length !== 1 ? 's' : '' }}
      </span>
    </div>

    <!-- Editor content -->
    <editor-content :editor="editor" class="editor-content" />

    <!-- Status bar -->
    <div class="editor-status">
      <a-tag :color="connected ? 'green' : 'red'">
        {{ connected ? 'Connected' : 'Disconnected' }}
      </a-tag>
      <span v-if="synced" class="sync-status">Synced</span>
      <span v-else class="sync-status syncing">Syncing...</span>
      <span class="word-count" v-if="editor">
        {{ wordCount }} words
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue';
import { Editor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import * as Y from 'yjs';
import { YjsIPCProvider } from '@/utils/yjs-ipc-provider';
import {
  BoldOutlined,
  ItalicOutlined,
  StrikethroughOutlined,
  HighlightOutlined,
  UnorderedListOutlined,
  OrderedListOutlined,
  CheckSquareOutlined,
  CodeOutlined,
  MenuOutlined,
  LineOutlined,
  UndoOutlined,
  RedoOutlined,
} from '@ant-design/icons-vue';

// ==================== Types ====================

interface ActiveUser {
  did: string;
  name: string;
  color: string;
  cursor?: any;
}

// ==================== Props & Emits ====================

const props = defineProps<{
  /** Document ID for collaborative editing */
  documentId: string;
  /** Display name for the current user */
  userName?: string;
  /** Color for the current user's cursor */
  userColor?: string;
  /** Placeholder text shown when editor is empty */
  placeholder?: string;
  /** Whether the editor is read-only */
  readOnly?: boolean;
}>();

const emit = defineEmits<{
  (e: 'connected'): void;
  (e: 'disconnected'): void;
  (e: 'synced'): void;
  (e: 'error', err: Error): void;
  (e: 'update', content: string): void;
}>();

// ==================== Reactive State ====================

const editor = ref<Editor | null>(null);
const ydoc = ref<Y.Doc | null>(null);
const provider = ref<YjsIPCProvider | null>(null);
const undoManager = ref<Y.UndoManager | null>(null);
const connected = ref<boolean>(false);
const synced = ref<boolean>(false);
const activeUsers = ref<ActiveUser[]>([]);
const canUndo = ref<boolean>(false);
const canRedo = ref<boolean>(false);

// ==================== Computed ====================

/** Random color for this user (consistent per session) */
const resolvedUserColor = computed<string>(() => {
  return (
    props.userColor ||
    `#${Math.floor(Math.random() * 16777215)
      .toString(16)
      .padStart(6, '0')}`
  );
});

/** Display name for the current user */
const resolvedUserName = computed<string>(() => {
  return props.userName || 'Anonymous';
});

/** Placeholder text */
const resolvedPlaceholder = computed<string>(() => {
  return props.placeholder || 'Start typing...';
});

/** Word count based on editor text content */
const wordCount = computed<number>(() => {
  if (!editor.value) return 0;
  const text = editor.value.getText();
  if (!text || text.trim().length === 0) return 0;
  return text.trim().split(/\s+/).length;
});

// ==================== Lifecycle ====================

onMounted(async () => {
  await initializeEditor();
});

onBeforeUnmount(() => {
  cleanupEditor();
});

// ==================== Editor Initialization ====================

/**
 * Initialize the Yjs document, IPC provider, and TipTap editor
 */
async function initializeEditor(): Promise<void> {
  // 1. Create Y.Doc
  ydoc.value = new Y.Doc();

  // 2. Create IPC provider
  provider.value = new YjsIPCProvider(props.documentId, ydoc.value);

  // Set up provider event listeners
  provider.value.on('synced', () => {
    synced.value = true;
    emit('synced');
  });

  provider.value.on('status', ([{ status }]: [{ status: string }]) => {
    connected.value = status === 'connected';
    if (connected.value) {
      emit('connected');
    } else {
      emit('disconnected');
    }
  });

  provider.value.on('awareness-update', ([data]: [any]) => {
    if (data?.states) {
      activeUsers.value = data.states
        .filter((s: any) => s.state?.user)
        .map((s: any) => ({
          did: s.state.user.did || s.clientId?.toString() || 'unknown',
          name: s.state.user.name || 'Anonymous',
          color: s.state.user.color || '#888888',
          cursor: s.state.cursor,
        }));
    }
  });

  // 3. Create TipTap editor with Collaboration extensions
  editor.value = new Editor({
    editable: !props.readOnly,
    extensions: [
      StarterKit.configure({
        // Disable default history - Yjs UndoManager handles undo/redo
        history: false,
      }),
      Collaboration.configure({
        document: ydoc.value,
      }),
      CollaborationCursor.configure({
        provider: provider.value as any,
        user: {
          name: resolvedUserName.value,
          color: resolvedUserColor.value,
        },
      }),
      Placeholder.configure({
        placeholder: resolvedPlaceholder.value,
      }),
      Highlight,
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
    ],
    onUpdate: ({ editor: editorInstance }) => {
      emit('update', editorInstance.getHTML());
    },
  });

  // 4. Set up Yjs UndoManager for undo/redo support
  const xmlFragment = ydoc.value.getXmlFragment('default');
  undoManager.value = new Y.UndoManager(xmlFragment);

  undoManager.value.on('stack-item-added', () => {
    updateUndoRedoState();
  });
  undoManager.value.on('stack-item-popped', () => {
    updateUndoRedoState();
  });

  // 5. Connect provider to main process
  try {
    await provider.value.connect();
  } catch (error) {
    emit('error', error as Error);
  }
}

/**
 * Clean up all editor resources
 */
function cleanupEditor(): void {
  provider.value?.destroy();
  editor.value?.destroy();
  undoManager.value?.destroy();
  ydoc.value?.destroy();

  provider.value = null;
  editor.value = null;
  undoManager.value = null;
  ydoc.value = null;
}

// ==================== Undo/Redo ====================

/**
 * Update the undo/redo button state
 */
function updateUndoRedoState(): void {
  if (undoManager.value) {
    canUndo.value = undoManager.value.canUndo();
    canRedo.value = undoManager.value.canRedo();
  }
}

/**
 * Undo the last change (via Yjs UndoManager)
 */
function undo(): void {
  if (undoManager.value?.canUndo()) {
    undoManager.value.undo();
    updateUndoRedoState();
  }
}

/**
 * Redo the last undone change (via Yjs UndoManager)
 */
function redo(): void {
  if (undoManager.value?.canRedo()) {
    undoManager.value.redo();
    updateUndoRedoState();
  }
}

// ==================== Document Switching ====================

/**
 * Watch for documentId changes and reinitialize the editor
 */
watch(
  () => props.documentId,
  async (newId: string, oldId: string) => {
    if (newId === oldId) return;

    // Clean up old editor
    cleanupEditor();

    // Reinitialize with new document
    await initializeEditor();
  }
);

/**
 * Watch for readOnly prop changes
 */
watch(
  () => props.readOnly,
  (readOnly: boolean | undefined) => {
    if (editor.value) {
      editor.value.setEditable(!readOnly);
    }
  }
);

// ==================== Public API ====================

/**
 * Expose methods for parent component usage
 */
defineExpose({
  /** Get the current TipTap editor instance */
  getEditor: () => editor.value,
  /** Get the Y.Doc instance */
  getYDoc: () => ydoc.value,
  /** Get the IPC provider instance */
  getProvider: () => provider.value,
  /** Get current connection status */
  isConnected: () => connected.value,
  /** Get current sync status */
  isSynced: () => synced.value,
  /** Get the HTML content of the editor */
  getHTML: () => editor.value?.getHTML() || '',
  /** Get the plain text content of the editor */
  getText: () => editor.value?.getText() || '',
  /** Get the JSON content of the editor */
  getJSON: () => editor.value?.getJSON() || null,
  /** Focus the editor */
  focus: () => editor.value?.commands.focus(),
});
</script>

<style scoped>
.collab-rich-editor {
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ---- Toolbar ---- */
.editor-toolbar {
  padding: 8px 12px;
  border-bottom: 1px solid #f0f0f0;
  background: #fafafa;
  flex-shrink: 0;
}

/* ---- Presence bar ---- */
.presence-bar {
  padding: 4px 12px;
  border-bottom: 1px solid #f0f0f0;
  display: flex;
  align-items: center;
  gap: 8px;
  background: #f6ffed;
  flex-shrink: 0;
}

.presence-count {
  font-size: 12px;
  color: #8c8c8c;
}

/* ---- Editor content ---- */
.editor-content {
  min-height: 400px;
  padding: 16px;
  flex: 1;
  overflow-y: auto;
}

.editor-content :deep(.ProseMirror) {
  outline: none;
  min-height: 360px;
}

.editor-content :deep(.ProseMirror p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  float: left;
  color: #adb5bd;
  pointer-events: none;
  height: 0;
}

/* Headings */
.editor-content :deep(.ProseMirror h1) {
  font-size: 2em;
  font-weight: 700;
  margin: 0.67em 0;
}

.editor-content :deep(.ProseMirror h2) {
  font-size: 1.5em;
  font-weight: 600;
  margin: 0.83em 0;
}

.editor-content :deep(.ProseMirror h3) {
  font-size: 1.17em;
  font-weight: 600;
  margin: 1em 0;
}

/* Code blocks */
.editor-content :deep(.ProseMirror pre) {
  background: #1e1e1e;
  color: #d4d4d4;
  font-family: 'Fira Code', 'Consolas', monospace;
  padding: 12px 16px;
  border-radius: 4px;
  overflow-x: auto;
}

.editor-content :deep(.ProseMirror code) {
  background: rgba(0, 0, 0, 0.06);
  border-radius: 3px;
  font-family: 'Fira Code', 'Consolas', monospace;
  padding: 0.2em 0.4em;
  font-size: 0.9em;
}

.editor-content :deep(.ProseMirror pre code) {
  background: none;
  padding: 0;
}

/* Blockquote */
.editor-content :deep(.ProseMirror blockquote) {
  border-left: 3px solid #d9d9d9;
  padding-left: 12px;
  margin-left: 0;
  color: #595959;
}

/* Task list */
.editor-content :deep(.ProseMirror ul[data-type='taskList']) {
  list-style: none;
  padding-left: 0;
}

.editor-content :deep(.ProseMirror ul[data-type='taskList'] li) {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.editor-content :deep(.ProseMirror ul[data-type='taskList'] li label) {
  flex-shrink: 0;
  margin-top: 3px;
}

/* Highlight */
.editor-content :deep(.ProseMirror mark) {
  background-color: #ffe58f;
  padding: 0 2px;
  border-radius: 2px;
}

/* Horizontal rule */
.editor-content :deep(.ProseMirror hr) {
  border: none;
  border-top: 1px solid #d9d9d9;
  margin: 1em 0;
}

/* ---- Collaboration cursor styles ---- */
.editor-content :deep(.collaboration-cursor__caret) {
  border-left: 1px solid #0d0d0d;
  border-right: 1px solid #0d0d0d;
  margin-left: -1px;
  margin-right: -1px;
  pointer-events: none;
  position: relative;
  word-break: normal;
}

.editor-content :deep(.collaboration-cursor__label) {
  border-radius: 3px 3px 3px 0;
  color: #fff;
  font-size: 12px;
  font-style: normal;
  font-weight: 600;
  left: -1px;
  line-height: normal;
  padding: 0.1rem 0.3rem;
  position: absolute;
  top: -1.4em;
  user-select: none;
  white-space: nowrap;
}

/* ---- Status bar ---- */
.editor-status {
  padding: 4px 12px;
  border-top: 1px solid #f0f0f0;
  font-size: 12px;
  color: #8c8c8c;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  background: #fafafa;
}

.sync-status {
  color: #52c41a;
}

.sync-status.syncing {
  color: #faad14;
}

.word-count {
  margin-left: auto;
}
</style>
