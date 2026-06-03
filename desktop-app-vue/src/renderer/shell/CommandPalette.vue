<template>
  <a-modal
    :open="open"
    :footer="null"
    :closable="false"
    :mask-closable="true"
    :width="560"
    :body-style="{ padding: 0 }"
    :transition-name="''"
    :mask-transition-name="''"
    wrap-class-name="command-palette-wrap"
    @cancel="close"
  >
    <div class="command-palette">
      <a-input
        ref="inputRef"
        v-model:value="query"
        size="large"
        :bordered="false"
        placeholder="搜索命令、空间、联系人、笔记…"
        class="palette-input"
        @keydown="handleKeydown"
      >
        <template #prefix>
          <SearchOutlined />
        </template>
      </a-input>

      <div class="palette-results">
        <div v-if="groupedResults.length === 0" class="empty">无结果</div>
        <div
          v-for="group in groupedResults"
          :key="group.title"
          class="result-group"
        >
          <div class="group-title">
            {{ group.title }}
          </div>
          <div
            v-for="item in group.items"
            :key="item.id"
            :class="[
              'result-item',
              activeIndex === item._flatIndex ? 'active' : '',
            ]"
            @click="execute(item)"
            @mouseenter="activeIndex = item._flatIndex"
          >
            <span class="item-label">{{ item.label }}</span>
            <span v-if="item.hint" class="item-hint">{{ item.hint }}</span>
          </div>
        </div>
      </div>

      <div class="palette-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> 移动</span>
        <span><kbd>Enter</kbd> 执行</span>
        <span><kbd>Esc</kbd> 关闭</span>
      </div>
    </div>
  </a-modal>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { SearchOutlined } from "@ant-design/icons-vue";
import { storeToRefs } from "pinia";
import { useExtensionRegistryStore } from "../stores/extensionRegistry";

interface Props {
  open: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: "update:open", v: boolean): void;
}>();

const registry = useExtensionRegistryStore();
const { slashCommands, spaces } = storeToRefs(registry);

const query = ref("");
const activeIndex = ref(0);
const inputRef = ref<any>(null);

interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  group: string;
  execute: () => void;
  _flatIndex: number;
}

const systemActions: Omit<PaletteItem, "_flatIndex">[] = [
  {
    id: "sys:new-session",
    label: "新会话",
    group: "系统",
    execute: () => console.debug("[Palette] new session"),
  },
  {
    id: "sys:toggle-artifact",
    label: "切换 Artifact 面板",
    group: "系统",
    execute: () => console.debug("[Palette] toggle artifact"),
  },
];

const groupedResults = computed(() => {
  const q = query.value.toLowerCase().trim();

  const spaceItems: Omit<PaletteItem, "_flatIndex">[] = spaces.value.map(
    (s) => ({
      id: `space:${s.id}`,
      label: s.name,
      hint: "切换空间",
      group: "空间",
      execute: () => console.debug("[Palette] switch space", s.id),
    }),
  );

  const slashItems: Omit<PaletteItem, "_flatIndex">[] = slashCommands.value.map(
    (c) => ({
      id: `slash:${c.id}`,
      label: `/${c.trigger}`,
      hint: c.description,
      group: "命令",
      execute: () => console.debug("[Palette] run slash", c.trigger),
    }),
  );

  const all = [...systemActions, ...spaceItems, ...slashItems];
  const filtered = q
    ? all.filter(
        (x) =>
          x.label.toLowerCase().includes(q) ||
          (x.hint || "").toLowerCase().includes(q),
      )
    : all;

  const groups = new Map<string, Omit<PaletteItem, "_flatIndex">[]>();
  for (const item of filtered) {
    if (!groups.has(item.group)) {
      groups.set(item.group, []);
    }
    groups.get(item.group)!.push(item);
  }

  let flatIdx = 0;
  return Array.from(groups.entries()).map(([title, items]) => ({
    title,
    items: items.map((i) => ({ ...i, _flatIndex: flatIdx++ })),
  }));
});

const flatItems = computed<PaletteItem[]>(() =>
  groupedResults.value.flatMap((g) => g.items),
);

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    activeIndex.value = Math.min(
      activeIndex.value + 1,
      flatItems.value.length - 1,
    );
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    activeIndex.value = Math.max(activeIndex.value - 1, 0);
  } else if (e.key === "Enter") {
    const item = flatItems.value[activeIndex.value];
    if (item) {
      execute(item);
    }
  } else if (e.key === "Escape") {
    close();
  }
}

function execute(item: PaletteItem) {
  item.execute();
  close();
}

function close() {
  emit("update:open", false);
  query.value = "";
  activeIndex.value = 0;
}

watch(
  () => props.open,
  (v) => {
    if (v) {
      nextTick(() => {
        inputRef.value?.focus?.();
      });
    }
  },
);
</script>

<style>
.command-palette-wrap .ant-modal {
  top: 15vh;
}
</style>

<style scoped>
.command-palette {
  display: flex;
  flex-direction: column;
  max-height: 60vh;
}

.palette-input {
  font-size: 16px;
  padding: 16px !important;
  border-bottom: 1px solid var(--shell-border, #e8e8e8);
}

.palette-results {
  flex: 1;
  overflow-y: auto;
  max-height: 420px;
  padding: 8px 0;
}

.result-group + .result-group {
  border-top: 1px solid #f0f0f0;
  margin-top: 4px;
  padding-top: 4px;
}

.group-title {
  font-size: 11px;
  color: #999;
  padding: 6px 16px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.result-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  cursor: pointer;
  font-size: 13px;
}

.result-item.active,
.result-item:hover {
  background: #f0f5ff;
}

.item-label {
  color: #111;
}

.item-hint {
  color: #888;
  font-size: 12px;
  margin-left: 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 60%;
}

.empty {
  padding: 32px;
  text-align: center;
  color: #aaa;
}

.palette-footer {
  display: flex;
  gap: 16px;
  padding: 8px 16px;
  font-size: 11px;
  color: #999;
  border-top: 1px solid var(--shell-border, #e8e8e8);
  background: #fafafa;
}

.palette-footer kbd {
  background: #f0f0f0;
  border: 1px solid #ddd;
  border-radius: 3px;
  padding: 0 4px;
  font-family: monospace;
  font-size: 10px;
  margin-right: 4px;
}
</style>
