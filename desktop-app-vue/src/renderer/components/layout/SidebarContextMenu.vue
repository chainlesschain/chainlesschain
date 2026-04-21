<template>
  <a-dropdown
    v-model:open="visible"
    :trigger="['contextmenu']"
    :get-popup-container="() => document?.body ?? document?.documentElement"
  >
    <div
      :style="{
        position: 'fixed',
        left: position.x + 'px',
        top: position.y + 'px',
        width: '1px',
        height: '1px',
      }"
    />
    <template #overlay>
      <a-menu @click="visible = false">
        <a-menu-item @click="toggleFavorite">
          <StarFilled
            v-if="currentItem && store.isFavoriteMenu(currentItem.key)"
          />
          <StarOutlined v-else />
          {{
            currentItem && store.isFavoriteMenu(currentItem.key)
              ? "取消收藏"
              : "添加收藏"
          }}
        </a-menu-item>
        <a-menu-item @click="pinToTop">
          <PushpinOutlined />
          {{
            currentItem && store.isPinnedMenu(currentItem.key)
              ? "取消置顶"
              : "置顶"
          }}
        </a-menu-item>
      </a-menu>
    </template>
  </a-dropdown>
</template>

<script setup>
import { ref } from "vue";
import { message } from "ant-design-vue";
import {
  StarFilled,
  StarOutlined,
  PushpinOutlined,
} from "@ant-design/icons-vue";
import { useAppStore } from "../../stores/app";

const store = useAppStore();

const visible = ref(false);
const position = ref({ x: 0, y: 0 });
const currentItem = ref(null);

function show(event, item) {
  event.preventDefault();
  event.stopPropagation();

  currentItem.value = item;
  position.value = { x: event.clientX, y: event.clientY };
  visible.value = true;
}

function toggleFavorite() {
  if (!currentItem.value) {
    return;
  }

  store.toggleFavoriteMenu(currentItem.value);
  visible.value = false;

  message.success(
    store.isFavoriteMenu(currentItem.value.key) ? "已添加到收藏" : "已取消收藏",
  );
}

function pinToTop() {
  if (!currentItem.value) {
    return;
  }

  if (store.isPinnedMenu(currentItem.value.key)) {
    store.unpinMenu(currentItem.value.key);
    message.success("已取消置顶");
  } else {
    store.pinMenu(currentItem.value.key);
    message.success("已置顶");
  }

  visible.value = false;
}

defineExpose({ show });
</script>
