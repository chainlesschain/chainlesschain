<template>
  <a-modal
    :open="open"
    :width="860"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '78vh', overflowY: 'auto' }"
    title="我的知识"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <FileTextOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <div class="kl-toolbar">
      <a-input-search
        v-model:value="searchQuery"
        placeholder="搜索知识…"
        allow-clear
        style="max-width: 320px"
      />
      <a-space>
        <a-select v-model:value="sortBy" size="small" style="width: 110px">
          <a-select-option value="time">按时间</a-select-option>
          <a-select-option value="title">按标题</a-select-option>
        </a-select>
        <a-button size="small" :loading="loading" @click="refresh">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
        <a-button type="primary" size="small" @click="openCreate">
          <template #icon><PlusOutlined /></template>
          新建知识
        </a-button>
      </a-space>
    </div>

    <div class="kl-count">共 {{ filteredItems.length }} 条知识</div>

    <a-spin :spinning="loading">
      <a-empty
        v-if="!loading && filteredItems.length === 0"
        description="暂无知识条目"
      >
        <a-button type="primary" @click="openCreate">新建知识</a-button>
      </a-empty>
      <a-list
        v-else
        :data-source="filteredItems"
        :pagination="{ pageSize: 8, hideOnSinglePage: true }"
        item-layout="horizontal"
      >
        <template #renderItem="{ item }">
          <a-list-item class="kl-item">
            <a-list-item-meta :description="describe(item)">
              <template #title>
                <a class="kl-title" @click="viewDetail(item.id)">
                  {{ item.title || "(未命名)" }}
                </a>
              </template>
              <template #avatar>
                <a-avatar :style="{ backgroundColor: colorFor(item.id) }">
                  {{ (item.title || "?").charAt(0) }}
                </a-avatar>
              </template>
            </a-list-item-meta>
            <template #actions>
              <a-button type="link" size="small" @click="editItem(item.id)">
                编辑
              </a-button>
              <a-popconfirm
                title="确定删除该知识条目?"
                ok-text="删除"
                cancel-text="取消"
                @confirm="removeItem(item)"
              >
                <a-button type="link" size="small" danger>删除</a-button>
              </a-popconfirm>
            </template>
          </a-list-item>
        </template>
      </a-list>
    </a-spin>

    <p class="panel-desc">
      知识条目浏览 / 搜索 / 新建 / 删除在本面板；详情与编辑（含
      RAG、富文本）仍在 V5 知识页（菜单「我的知识」/ Alt+2），后续 phase 迁入。
    </p>

    <!-- create modal -->
    <a-modal
      v-model:open="createOpen"
      title="新建知识条目"
      :confirm-loading="creating"
      :ok-button-props="{ disabled: !createForm.title.trim() }"
      @ok="submitCreate"
    >
      <a-form layout="vertical" :disabled="creating">
        <a-form-item label="标题" required>
          <a-input
            v-model:value="createForm.title"
            placeholder="例如：Vue 3 组合式 API 速记"
            :maxlength="120"
            allow-clear
          />
        </a-form-item>
        <a-form-item label="内容">
          <a-textarea
            v-model:value="createForm.content"
            placeholder="正文（支持 Markdown，可稍后再补）"
            :rows="6"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from "vue";
import { useRouter } from "vue-router";
import { message } from "ant-design-vue";
import {
  FileTextOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons-vue";
import { useAppStore } from "../stores/app";

interface KItem {
  id: string;
  title: string;
  content?: string;
  updatedAt?: string | number;
}

const props = defineProps<{ open: boolean; prefillText?: string }>();
const emit = defineEmits<{ (e: "update:open", value: boolean): void }>();

const router = useRouter();
const store = useAppStore();

const searchQuery = ref("");
const sortBy = ref<"time" | "title">("time");
const loading = ref(false);

const createOpen = ref(false);
const creating = ref(false);
const createForm = reactive({ title: "", content: "" });

const colors = ["#667eea", "#f093fb", "#4facfe", "#43e97b", "#fa8c16"];
function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < String(id).length; i++) {
    h = (h + String(id).charCodeAt(i)) % colors.length;
  }
  return colors[h];
}

function describe(item: KItem): string {
  const c = (item.content || "").replace(/\s+/g, " ").trim();
  return c.length > 80 ? c.slice(0, 80) + "…" : c || "（暂无内容）";
}

const filteredItems = computed<KItem[]>(() => {
  let items = [...((store.knowledgeItems as KItem[]) || [])];
  const q = searchQuery.value.trim().toLowerCase();
  if (q) {
    items = items.filter(
      (it) =>
        (it.title || "").toLowerCase().includes(q) ||
        (it.content || "").toLowerCase().includes(q),
    );
  }
  if (sortBy.value === "time") {
    items.sort(
      (a, b) =>
        new Date(b.updatedAt ?? 0).getTime() -
        new Date(a.updatedAt ?? 0).getTime(),
    );
  } else {
    items.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  }
  return items;
});

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    await store.loadKnowledgeItemsFromDb();
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !loading.value) {
      refresh();
    }
  },
  { immediate: true },
);

function openCreate(): void {
  createForm.title = "";
  createForm.content = "";
  createOpen.value = true;
}

async function submitCreate(): Promise<void> {
  const title = createForm.title.trim();
  if (!title) {
    message.warning("请填写标题");
    return;
  }
  creating.value = true;
  try {
    const created = await store.createKnowledgeItemInDb({
      title,
      content: createForm.content,
    });
    if (created) {
      message.success("已创建");
      createOpen.value = false;
      await store.loadKnowledgeItemsFromDb();
    } else {
      message.error("创建失败：IPC 不可用或数据库未初始化");
    }
  } catch (e: unknown) {
    message.error("创建失败：" + (e instanceof Error ? e.message : String(e)));
  } finally {
    creating.value = false;
  }
}

async function removeItem(item: KItem): Promise<void> {
  const ok = await store.deleteKnowledgeItemFromDb(item.id);
  if (ok) {
    message.success("删除成功");
  } else {
    message.error("删除失败：IPC 不可用或数据库未响应");
  }
}

function navigate(path: string): void {
  emit("update:open", false);
  router.push(path);
}
function viewDetail(id: string): void {
  navigate(`/knowledge/${id}`);
}
function editItem(id: string): void {
  navigate(`/knowledge/${id}/edit`);
}
</script>

<style scoped>
.prefill-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  margin-bottom: 12px;
  background: rgba(24, 144, 255, 0.08);
  border-radius: 6px;
  font-size: 13px;
}
.kl-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.kl-count {
  color: rgba(0, 0, 0, 0.45);
  font-size: 13px;
  margin-bottom: 8px;
}
.kl-title {
  font-weight: 500;
}
.panel-desc {
  margin-top: 16px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
</style>
