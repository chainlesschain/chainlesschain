<template>
  <a-modal
    v-model:open="openModel"
    title="管理快捷访问"
    :width="600"
    :footer="null"
  >
    <div class="favorite-manager">
      <a-tabs v-model:active-key="favoriteTab">
        <a-tab-pane key="favorites" tab="收藏">
          <a-list
            :data-source="store.favoriteMenus"
            :locale="{ emptyText: '暂无收藏' }"
          >
            <template #renderItem="{ item }">
              <a-list-item>
                <template #actions>
                  <a-button
                    type="text"
                    danger
                    @click="store.removeFavoriteMenu(item.key)"
                  >
                    <DeleteOutlined />
                  </a-button>
                </template>
                <a-list-item-meta>
                  <template #avatar>
                    <component
                      :is="iconResolver(item.icon)"
                      :style="{ fontSize: '20px' }"
                    />
                  </template>
                  <template #title>
                    {{ item.title }}
                  </template>
                  <template #description>
                    {{ item.path }}
                  </template>
                </a-list-item-meta>
              </a-list-item>
            </template>
          </a-list>
        </a-tab-pane>

        <a-tab-pane key="recents" tab="最近访问">
          <div class="recents-header">
            <span>最近访问的 {{ store.recentMenus.length }} 个菜单</span>
            <a-button
              type="link"
              size="small"
              @click="store.clearRecentMenus()"
            >
              清空
            </a-button>
          </div>
          <a-list
            :data-source="store.recentMenus"
            :locale="{ emptyText: '暂无访问记录' }"
          >
            <template #renderItem="{ item }">
              <a-list-item>
                <template #actions>
                  <a-button
                    type="text"
                    @click="emit('quick-access-click', item)"
                  >
                    <ArrowRightOutlined />
                  </a-button>
                </template>
                <a-list-item-meta>
                  <template #avatar>
                    <component
                      :is="iconResolver(item.icon)"
                      :style="{ fontSize: '20px' }"
                    />
                  </template>
                  <template #title>
                    {{ item.title }}
                  </template>
                  <template #description>
                    {{ formatTime(item.visitedAt) }}
                  </template>
                </a-list-item-meta>
              </a-list-item>
            </template>
          </a-list>
        </a-tab-pane>
      </a-tabs>
    </div>
  </a-modal>
</template>

<script setup>
import { ref } from "vue";
import { DeleteOutlined, ArrowRightOutlined } from "@ant-design/icons-vue";
import { useAppStore } from "../../stores/app";

const openModel = defineModel("open", { type: Boolean, default: false });

defineProps({
  iconResolver: { type: Function, required: true },
});

const emit = defineEmits(["quick-access-click"]);

const store = useAppStore();
const favoriteTab = ref("favorites");

function formatTime(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60000) {
    return "刚刚";
  }
  if (diff < 3600000) {
    return `${Math.floor(diff / 60000)} 分钟前`;
  }
  if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)} 小时前`;
  }
  if (diff < 604800000) {
    return `${Math.floor(diff / 86400000)} 天前`;
  }

  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
</script>

<style scoped>
.favorite-manager {
  padding: 8px 0;
}

.recents-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  margin-bottom: 8px;
  color: #666;
  font-size: 13px;
}
</style>
