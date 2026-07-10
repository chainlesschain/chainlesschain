<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">交付物</h2>
        <p class="page-sub">
          agent 用 publish_artifact 发布的交付物（报告 / patch / 截图 /
          日志），在这里预览与管理（cc artifacts 同源）。
        </p>
      </div>
      <a-space>
        <a-select
          v-model:value="store.kindFilter"
          style="min-width: 120px"
          placeholder="全部类型"
          allow-clear
          :options="kindOptions"
          @change="store.fetchArtifacts()"
        />
        <a-popconfirm title="删除所有过期交付物？" @confirm="onClean">
          <a-button>清理过期</a-button>
        </a-popconfirm>
        <a-button
          ghost
          :loading="store.loading"
          @click="store.fetchArtifacts()"
        >
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
      </a-space>
    </div>

    <a-table
      :data-source="store.artifacts"
      :columns="columns"
      row-key="id"
      size="small"
      :pagination="{ pageSize: 10, hideOnSinglePage: true }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'title'">
          <a @click="store.openPreview(record)">{{ record.title }}</a>
        </template>
        <template v-else-if="column.key === 'kind'">
          <a-tag :color="store.kindColor(record.kind)">{{ record.kind }}</a-tag>
        </template>
        <template v-else-if="column.key === 'size'">
          {{ store.formatSize(record.size) }}
        </template>
        <template v-else-if="column.key === 'createdAt'">
          {{ (record.createdAt || "").replace("T", " ").slice(0, 19) }}
        </template>
        <template v-else-if="column.key === 'actions'">
          <a-space>
            <a-button size="small" @click="store.openPreview(record)"
              >预览</a-button
            >
            <a-button size="small" @click="onDownload(record)">下载</a-button>
            <a-popconfirm title="删除该交付物？" @confirm="onRemove(record.id)">
              <a-button size="small" danger>删除</a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
    </a-table>

    <a-card
      v-if="store.preview"
      size="small"
      class="preview-card"
      :loading="store.previewLoading"
    >
      <template #title>
        <a-space>
          <span>{{ store.preview.entry?.title }}</span>
          <a-tag :color="store.kindColor(store.preview.entry?.kind)">{{
            store.preview.entry?.kind
          }}</a-tag>
          <a-tag color="default">{{ store.preview.entry?.mime }}</a-tag>
          <a-tag v-if="store.preview.truncated" color="warning"
            >已截断预览</a-tag
          >
        </a-space>
      </template>
      <template #extra>
        <a-space>
          <a-button size="small" @click="onDownload(store.preview.entry)"
            >下载</a-button
          >
          <a-button size="small" @click="store.closePreview()">关闭</a-button>
        </a-space>
      </template>

      <img
        v-if="store.previewImageSrc"
        :src="store.previewImageSrc"
        class="preview-image"
        alt="artifact preview"
      />
      <div v-else-if="store.previewIsMarkdown" class="preview-markdown">
        <MarkdownRenderer :content="store.preview.content || ''" />
      </div>
      <pre
        v-else-if="store.preview.previewable"
        class="preview-text"
        >{{ store.preview.content || "（空文件）" }}</pre
      >
      <a-empty
        v-else
        :description="
          store.preview.reason ||
          '该类型不支持在线预览，可在本机用 cc artifacts open <id> 打开'
        "
      />
      <div class="preview-meta">
        <span>{{ store.preview.entry?.id }}</span>
        <span v-if="store.preview.entry?.sessionId">
          · session {{ store.preview.entry.sessionId }}</span
        >
        <span> · sha256 {{ (store.preview.entry?.sha256 || "").slice(0, 12) }}…</span>
      </div>
    </a-card>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted } from "vue";
import { ReloadOutlined } from "@ant-design/icons-vue";
import { message } from "ant-design-vue";
import MarkdownRenderer from "../components/MarkdownRenderer.vue";
import { useArtifactsStore } from "../stores/artifacts";

const store = useArtifactsStore();

const columns = [
  { title: "标题", key: "title", dataIndex: "title", ellipsis: true },
  { title: "类型", key: "kind", dataIndex: "kind", width: 110 },
  { title: "MIME", dataIndex: "mime", width: 160, ellipsis: true },
  { title: "大小", key: "size", dataIndex: "size", width: 90 },
  { title: "发布时间", key: "createdAt", dataIndex: "createdAt", width: 170 },
  { title: "会话", dataIndex: "sessionId", width: 160, ellipsis: true },
  { title: "操作", key: "actions", width: 150 },
];

const kindOptions = computed(() =>
  store.kinds.map((k) => ({ label: k, value: k })),
);

async function onRemove(id) {
  const ok = await store.removeArtifact(id);
  if (ok) message.success("已删除");
  else message.error("删除失败");
}

async function onClean() {
  const n = await store.cleanExpired();
  message.info(n > 0 ? `清理了 ${n} 个过期交付物` : "没有过期交付物");
}

async function onDownload(entry) {
  const ok = await store.downloadArtifact(entry);
  if (!ok) message.error("下载失败");
}

onMounted(() => {
  store.fetchArtifacts();
});
onBeforeUnmount(() => {
  store.closePreview();
});
</script>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
}
.preview-card {
  margin-top: 16px;
}
.preview-text {
  max-height: 480px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  margin: 0;
}
.preview-markdown {
  max-height: 480px;
  overflow: auto;
}
.preview-image {
  max-width: 100%;
  max-height: 480px;
  display: block;
}
.preview-meta {
  margin-top: 8px;
  color: rgba(128, 128, 128, 0.8);
  font-size: 12px;
}
</style>
