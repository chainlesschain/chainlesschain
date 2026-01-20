# 虚拟滚动组件使用指南

## 概述

虚拟滚动组件用于优化长列表的渲染性能。通过只渲染可见区域的项目，大幅减少 DOM 节点数量，提升滚动流畅度。

## 组件列表

### 1. VirtualList.vue

适用于**单列列表**场景，如消息列表、联系人列表等。

```vue
<template>
  <virtual-list
    :items="messages"
    :item-height="60"
    :height="500"
    item-key="id"
    @reach-bottom="loadMore"
  >
    <template #default="{ item, index }">
      <message-item :message="item" />
    </template>
  </virtual-list>
</template>

<script setup>
import VirtualList from "@/components/common/VirtualList.vue";
</script>
```

**Props:**

| 属性          | 类型            | 默认值   | 说明                             |
| ------------- | --------------- | -------- | -------------------------------- |
| items         | Array           | required | 数据列表                         |
| itemHeight    | Number          | 50       | 每个项目的固定高度（px）         |
| height        | Number/String   | null     | 容器高度                         |
| buffer        | Number          | 5        | 缓冲区大小（上下各缓冲的项目数） |
| itemKey       | Function/String | 'id'     | 获取项目唯一标识                 |
| throttle      | Boolean         | true     | 是否启用滚动节流                 |
| throttleDelay | Number          | 16       | 节流延迟（ms）                   |

**Events:**

- `scroll` - 滚动时触发
- `reach-top` - 滚动到顶部时触发
- `reach-bottom` - 滚动到底部时触发

**Methods (通过 ref 访问):**

- `scrollToIndex(index, behavior)` - 滚动到指定索引
- `scrollToTop(behavior)` - 滚动到顶部
- `scrollToBottom(behavior)` - 滚动到底部

---

### 2. VirtualGrid.vue

适用于**网格/卡片列表**场景，如订单列表、技能卡片、图片墙等。

```vue
<template>
  <virtual-grid
    :items="orders"
    :item-height="220"
    :responsive="{ xs: 1, sm: 2, md: 3, lg: 4, xl: 4, xxl: 6 }"
    :gap="16"
    :loading="loading"
    :infinite-scroll="true"
    @load-more="loadMore"
  >
    <template #default="{ item, index }">
      <order-card :order="item" />
    </template>
    <template #empty>
      <a-empty description="暂无订单">
        <a-button type="primary" @click="createOrder">发布订单</a-button>
      </a-empty>
    </template>
  </virtual-grid>
</template>

<script setup>
import VirtualGrid from "@/components/common/VirtualGrid.vue";
</script>
```

**Props:**

| 属性              | 类型            | 默认值     | 说明                     |
| ----------------- | --------------- | ---------- | ------------------------ |
| items             | Array           | required   | 数据列表                 |
| itemHeight        | Number          | 250        | 每行的高度（px）         |
| columns           | Number/Object   | 3          | 固定列数或响应式配置     |
| responsive        | Object          | null       | 响应式断点配置           |
| gap               | Number          | 16         | 间距（px）               |
| buffer            | Number          | 2          | 缓冲行数                 |
| itemKey           | String/Function | 'id'       | 获取项目唯一标识         |
| loading           | Boolean         | false      | 是否正在加载             |
| emptyText         | String          | '暂无数据' | 空状态文本               |
| infiniteScroll    | Boolean         | false      | 是否启用无限滚动         |
| loadMoreThreshold | Number          | 100        | 触发加载更多的阈值（px） |

**响应式配置示例:**

```javascript
// 使用 responsive prop
responsive: { xs: 1, sm: 2, md: 3, lg: 4, xl: 4, xxl: 6 }

// 或使用 columns 对象形式
columns: { xs: 1, sm: 2, md: 3, lg: 4, xl: 4, xxl: 6 }
```

**Events:**

- `scroll` - 滚动时触发
- `reach-top` - 滚动到顶部时触发
- `reach-bottom` - 滚动到底部时触发
- `load-more` - 需要加载更多时触发（需开启 infiniteScroll）

**Methods (通过 ref 访问):**

- `scrollToIndex(index, behavior)` - 滚动到指定索引
- `scrollToTop(behavior)` - 滚动到顶部
- `scrollToBottom(behavior)` - 滚动到底部
- `getColumnsPerRow()` - 获取当前每行列数
- `refresh()` - 刷新容器尺寸

---

## 使用场景推荐

| 场景       | 推荐组件    | 配置建议                      |
| ---------- | ----------- | ----------------------------- |
| 消息列表   | VirtualList | itemHeight: 60-80, buffer: 10 |
| 联系人列表 | VirtualList | itemHeight: 50-60, buffer: 5  |
| 订单卡片   | VirtualGrid | itemHeight: 220, responsive   |
| 技能列表   | VirtualGrid | itemHeight: 250, columns: 3-4 |
| 笔记列表   | VirtualGrid | itemHeight: 180, responsive   |
| 图片墙     | VirtualGrid | itemHeight: 200, gap: 8       |

---

## 性能优化建议

1. **固定高度**: 确保每个项目高度一致，避免动态高度导致的计算开销

2. **适当的缓冲区**: 根据滚动速度调整 buffer 大小
   - 慢速滚动: buffer: 2-3
   - 快速滚动: buffer: 5-10

3. **避免复杂计算**: 项目组件内避免复杂的计算属性

4. **使用 memo/缓存**: 对于复杂的子组件，使用 `<keep-alive>` 或手动缓存

5. **图片懒加载**: 结合 `v-lazy` 或 Intersection Observer 实现图片懒加载

---

## 迁移指南

### 从 a-list 迁移到 VirtualGrid

**迁移前:**

```vue
<a-list
  :data-source="orders"
  :grid="{ gutter: 16, xs: 1, sm: 2, md: 3, lg: 4, xl: 4 }"
>
  <template #renderItem="{ item }">
    <a-list-item>
      <order-card :order="item" />
    </a-list-item>
  </template>
</a-list>
```

**迁移后:**

```vue
<virtual-grid
  :items="orders"
  :item-height="220"
  :responsive="{ xs: 1, sm: 2, md: 3, lg: 4, xl: 4 }"
  :gap="16"
>
  <template #default="{ item }">
    <order-card :order="item" />
  </template>
</virtual-grid>
```

### 从普通 v-for 迁移

**迁移前:**

```vue
<div class="message-list" @scroll="handleScroll">
  <message-item
    v-for="msg in messages"
    :key="msg.id"
    :message="msg"
  />
</div>
```

**迁移后:**

```vue
<virtual-list
  :items="messages"
  :item-height="60"
  :height="containerHeight"
  @reach-bottom="loadMore"
>
  <template #default="{ item }">
    <message-item :message="item" />
  </template>
</virtual-list>
```

---

## 注意事项

1. 虚拟滚动组件需要**固定的容器高度**，确保父容器有明确的高度

2. 项目高度必须**统一**，不支持动态高度

3. 使用 `itemKey` 确保每个项目有唯一标识，避免渲染问题

4. 无限滚动模式下，注意防止重复请求
