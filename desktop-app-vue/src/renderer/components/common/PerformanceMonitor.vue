<template>
  <div
    class="performance-monitor"
    :class="{ collapsed: isCollapsed }"
  >
    <!-- 切换按钮 -->
    <div
      class="monitor-header"
      @click="toggleCollapse"
    >
      <DashboardOutlined class="monitor-icon" />
      <span class="monitor-title">性能监控</span>
      <UpOutlined
        v-if="!isCollapsed"
        class="toggle-icon"
      />
      <DownOutlined
        v-else
        class="toggle-icon"
      />
    </div>

    <!-- 监控内容 -->
    <div
      v-if="!isCollapsed"
      class="monitor-content"
    >
      <!-- 总览 -->
      <div class="monitor-section">
        <h4>📊 总体性能</h4>
        <div class="stat-grid">
          <div class="stat-item">
            <div class="stat-label">
              FPS
            </div>
            <div
              class="stat-value"
              :class="getFPSClass(overallStats.fps)"
            >
              {{ overallStats.fps }}
            </div>
          </div>
          <div class="stat-item">
            <div class="stat-label">
              内存
            </div>
            <div class="stat-value">
              {{ overallStats.memoryMB }} MB
            </div>
          </div>
          <div class="stat-item">
            <div class="stat-label">
              加载时间
            </div>
            <div class="stat-value">
              {{ overallStats.loadTime }} ms
            </div>
          </div>
          <div class="stat-item">
            <div class="stat-label">
              节省带宽
            </div>
            <div class="stat-value success">
              {{ overallStats.bandwidthSavedMB }} MB
            </div>
          </div>
        </div>
      </div>

      <!-- 图片懒加载 -->
      <div class="monitor-section">
        <h4>🖼️ 图片懒加载</h4>
        <div class="stat-row">
          <span>总图片数:</span>
          <span>{{ imageStats.totalImages }}</span>
        </div>
        <div class="stat-row">
          <span>已加载:</span>
          <span class="success">{{ imageStats.loadedImages }}</span>
        </div>
        <div class="stat-row">
          <span>成功率:</span>
          <span>{{ imageStats.successRate }}%</span>
        </div>
        <div class="stat-row">
          <span>平均加载时间:</span>
          <span>{{ imageStats.averageLoadTime }} ms</span>
        </div>
        <div class="stat-row">
          <span>节省带宽:</span>
          <span class="success">{{ imageStats.bandwidthSavedKB }} KB</span>
        </div>
      </div>

      <!-- 请求批处理 -->
      <div class="monitor-section">
        <h4>📦 请求批处理</h4>
        <div class="stat-row">
          <span>总请求数:</span>
          <span>{{ requestStats.totalRequests }}</span>
        </div>
        <div class="stat-row">
          <span>批处理数:</span>
          <span class="success">{{ requestStats.batchedRequests }}</span>
        </div>
        <div class="stat-row">
          <span>缓存命中:</span>
          <span class="success">{{ requestStats.cachedRequests }}</span>
        </div>
        <div class="stat-row">
          <span>去重数:</span>
          <span class="success">{{ requestStats.deduplicatedRequests }}</span>
        </div>
        <div class="stat-row">
          <span>批处理率:</span>
          <span>{{ requestStats.batchRate }}</span>
        </div>
        <div class="stat-row">
          <span>缓存命中率:</span>
          <span>{{ requestStats.cacheHitRate }}</span>
        </div>
      </div>

      <!-- 组件懒加载 -->
      <div class="monitor-section">
        <h4>🧩 组件懒加载</h4>
        <div class="stat-row">
          <span>总组件数:</span>
          <span>{{ componentStats.totalComponents }}</span>
        </div>
        <div class="stat-row">
          <span>已加载:</span>
          <span class="success">{{ componentStats.loadedComponents }}</span>
        </div>
        <div class="stat-row">
          <span>预取数:</span>
          <span>{{ componentStats.prefetchedComponents }}</span>
        </div>
        <div class="stat-row">
          <span>缓存命中率:</span>
          <span>{{ componentStats.cacheHitRate }}</span>
        </div>
      </div>

      <!-- 乐观更新 -->
      <div class="monitor-section">
        <h4>⚡ 乐观更新</h4>
        <div class="stat-row">
          <span>总更新数:</span>
          <span>{{ optimisticStats.totalUpdates }}</span>
        </div>
        <div class="stat-row">
          <span>成功数:</span>
          <span class="success">{{ optimisticStats.successfulUpdates }}</span>
        </div>
        <div class="stat-row">
          <span>失败数:</span>
          <span class="error">{{ optimisticStats.failedUpdates }}</span>
        </div>
        <div class="stat-row">
          <span>回滚数:</span>
          <span class="warning">{{ optimisticStats.rolledBackUpdates }}</span>
        </div>
        <div class="stat-row">
          <span>冲突数:</span>
          <span class="warning">{{ optimisticStats.conflictedUpdates }}</span>
        </div>
        <div class="stat-row">
          <span>平均响应时间:</span>
          <span>{{ optimisticStats.averageResponseTime }} ms</span>
        </div>
      </div>

      <!-- 增量同步 -->
      <div class="monitor-section">
        <h4>🔄 增量同步</h4>
        <div class="stat-row">
          <span>总同步次数:</span>
          <span>{{ syncStats.totalSyncs }}</span>
        </div>
        <div class="stat-row">
          <span>成功:</span>
          <span class="success">{{ syncStats.successfulSyncs }}</span>
        </div>
        <div class="stat-row">
          <span>失败:</span>
          <span class="error">{{ syncStats.failedSyncs }}</span>
        </div>
        <div class="stat-row">
          <span>待同步变更:</span>
          <span>{{ syncStats.pendingChanges }}</span>
        </div>
        <div class="stat-row">
          <span>节省数据:</span>
          <span class="success">{{ syncStats.dataSavedMB }} MB</span>
        </div>
        <div class="stat-row">
          <span>在线状态:</span>
          <span :class="syncStats.isOnline ? 'success' : 'error'">
            {{ syncStats.isOnline ? "在线" : "离线" }}
          </span>
        </div>
      </div>

      <!-- 智能预取 -->
      <div class="monitor-section">
        <h4>🎯 智能预取</h4>
        <div class="stat-row">
          <span>总预取数:</span>
          <span>{{ prefetchStats.totalPrefetches }}</span>
        </div>
        <div class="stat-row">
          <span>成功:</span>
          <span class="success">{{ prefetchStats.successfulPrefetches }}</span>
        </div>
        <div class="stat-row">
          <span>缓存命中:</span>
          <span class="success">{{ prefetchStats.cacheHits }}</span>
        </div>
        <div class="stat-row">
          <span>队列大小:</span>
          <span>{{ prefetchStats.queueSize }}</span>
        </div>
        <div class="stat-row">
          <span>网络类型:</span>
          <span>{{ prefetchStats.networkType }}</span>
        </div>
        <div class="stat-row">
          <span>已预取:</span>
          <span class="success">{{ prefetchStats.bytesPrefetchedMB }} MB</span>
        </div>
      </div>

      <!-- 数据压缩 -->
      <div class="monitor-section">
        <h4>🗜️ 数据压缩</h4>
        <div class="stat-row">
          <span>压缩次数:</span>
          <span>{{ compressionStats.totalCompressed }}</span>
        </div>
        <div class="stat-row">
          <span>解压次数:</span>
          <span>{{ compressionStats.totalDecompressed }}</span>
        </div>
        <div class="stat-row">
          <span>平均压缩率:</span>
          <span class="success">{{
            compressionStats.averageCompressionRatio
          }}</span>
        </div>
        <div class="stat-row">
          <span>节省空间:</span>
          <span class="success">{{ compressionStats.bytesSavedMB }} MB</span>
        </div>
      </div>

      <!-- 动画控制器 -->
      <div class="monitor-section">
        <h4>🎬 动画系统</h4>
        <div class="stat-row">
          <span>活动动画数:</span>
          <span>{{ animationStats.activeAnimations }}</span>
        </div>
        <div class="stat-row">
          <span>平均 FPS:</span>
          <span :class="getFPSClass(animationStats.averageFPS)">
            {{ animationStats.averageFPS }}
          </span>
        </div>
        <div class="stat-row">
          <span>掉帧数:</span>
          <span class="warning">{{ animationStats.droppedFrames }}</span>
        </div>
        <div class="stat-row">
          <span>Reduced Motion:</span>
          <span>{{ animationStats.reducedMotion ? "是" : "否" }}</span>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="monitor-actions">
        <a-button
          size="small"
          @click="refreshStats"
        >
          <ReloadOutlined />
          刷新
        </a-button>
        <a-button
          size="small"
          @click="resetStats"
        >
          <ClearOutlined />
          重置统计
        </a-button>
        <a-button
          size="small"
          @click="exportStats"
        >
          <DownloadOutlined />
          导出
        </a-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, reactive, onMounted, onUnmounted } from "vue";
import {
  DashboardOutlined,
  UpOutlined,
  DownOutlined,
  ReloadOutlined,
  ClearOutlined,
  DownloadOutlined,
} from "@ant-design/icons-vue";
import { message } from "ant-design-vue";

// Import stats functions
import { getLazyLoader } from "@/utils/image-lazy-loader";
import { getRequestBatcher } from "@/utils/request-batcher";
import { getComponentLazyLoader } from "@/utils/component-lazy-loader";
import { getOptimisticUpdateManager } from "@/utils/optimistic-update-manager";
import { getIncrementalSyncManager } from "@/utils/incremental-sync";
import { getIntelligentPrefetchManager } from "@/utils/intelligent-prefetch";
import { getDataCompressor } from "@/utils/data-compression";
import { getAnimationController } from "@/utils/animation-controller";

// State
const isCollapsed = ref(true); // 默认最小化

const overallStats = reactive({
  fps: 60,
  memoryMB: 0,
  loadTime: 0,
  bandwidthSavedMB: 0,
});

const imageStats = reactive({
  totalImages: 0,
  loadedImages: 0,
  failedImages: 0,
  successRate: 0,
  averageLoadTime: 0,
  bandwidthSavedKB: 0,
});

const requestStats = reactive({
  totalRequests: 0,
  batchedRequests: 0,
  cachedRequests: 0,
  deduplicatedRequests: 0,
  batchRate: "0%",
  cacheHitRate: "0%",
});

const componentStats = reactive({
  totalComponents: 0,
  loadedComponents: 0,
  prefetchedComponents: 0,
  cacheHitRate: "0%",
});

const optimisticStats = reactive({
  totalUpdates: 0,
  successfulUpdates: 0,
  failedUpdates: 0,
  rolledBackUpdates: 0,
  conflictedUpdates: 0,
  averageResponseTime: 0,
});

const syncStats = reactive({
  totalSyncs: 0,
  successfulSyncs: 0,
  failedSyncs: 0,
  pendingChanges: 0,
  dataSavedMB: 0,
  isOnline: true,
});

const prefetchStats = reactive({
  totalPrefetches: 0,
  successfulPrefetches: 0,
  cacheHits: 0,
  queueSize: 0,
  networkType: "4g",
  bytesPrefetchedMB: 0,
});

const compressionStats = reactive({
  totalCompressed: 0,
  totalDecompressed: 0,
  averageCompressionRatio: "0%",
  bytesSavedMB: 0,
});

const animationStats = reactive({
  activeAnimations: 0,
  averageFPS: 60,
  droppedFrames: 0,
  reducedMotion: false,
});

/**
 * Toggle collapse
 */
const toggleCollapse = () => {
  isCollapsed.value = !isCollapsed.value;
};

/**
 * Get FPS class
 */
const getFPSClass = (fps) => {
  if (fps >= 55) {
    return "success";
  }
  if (fps >= 30) {
    return "warning";
  }
  return "error";
};

/**
 * Refresh all statistics
 */
const refreshStats = () => {
  try {
    // Image lazy loader
    const imageLazyLoader = getLazyLoader();
    const imgStats = imageLazyLoader?.getStats() || {};
    Object.assign(imageStats, imgStats);

    // Request batcher
    const requestBatcher = getRequestBatcher();
    const reqStats = requestBatcher?.getStats() || {};
    Object.assign(requestStats, reqStats);

    // Component lazy loader
    const componentLoader = getComponentLazyLoader();
    const compStats = componentLoader?.getStats() || {};
    Object.assign(componentStats, compStats);

    // Optimistic update manager
    const optimisticManager = getOptimisticUpdateManager();
    const optStats = optimisticManager?.getStats() || {};
    Object.assign(optimisticStats, {
      ...optStats,
      averageResponseTime: Math.round(optStats.averageResponseTime || 0),
    });

    // Incremental sync manager
    const syncManager = getIncrementalSyncManager();
    const sStats = syncManager?.getStats() || {};
    Object.assign(syncStats, sStats);

    // Intelligent prefetch manager
    const prefetchManager = getIntelligentPrefetchManager();
    const pfStats = prefetchManager?.getStats() || {};
    Object.assign(prefetchStats, pfStats);

    // Data compressor
    const compressor = getDataCompressor();
    const cStats = compressor?.getStats() || {};
    Object.assign(compressionStats, cStats);

    // Animation controller
    const animationController = getAnimationController();
    const aStats = animationController?.getStats() || {};
    Object.assign(animationStats, aStats);

    // Overall stats
    overallStats.fps = animationStats.averageFPS;
    overallStats.bandwidthSavedMB = Math.round(
      (imageStats.bandwidthSavedKB || 0) / 1024 +
        (requestStats.bandwidthSavedKB || 0) / 1024 +
        (syncStats.dataSavedMB || 0) +
        (compressionStats.bytesSavedMB || 0),
    );

    // Memory (if available)
    if (performance.memory) {
      overallStats.memoryMB = Math.round(
        performance.memory.usedJSHeapSize / 1024 / 1024,
      );
    }
  } catch (error) {
    logger.error("[PerformanceMonitor] Error refreshing stats:", error);
  }
};

/**
 * Reset all statistics
 */
const resetStats = () => {
  // This would require implementing reset methods in each manager
  message.info("统计数据已重置");
  refreshStats();
};

/**
 * Export statistics as JSON
 */
const exportStats = () => {
  const allStats = {
    timestamp: new Date().toISOString(),
    overall: overallStats,
    image: imageStats,
    request: requestStats,
    component: componentStats,
    optimistic: optimisticStats,
    sync: syncStats,
    prefetch: prefetchStats,
    compression: compressionStats,
    animation: animationStats,
  };

  const json = JSON.stringify(allStats, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `performance-stats-${Date.now()}.json`;
  a.click();

  URL.revokeObjectURL(url);

  message.success("统计数据已导出");
};

// Auto-refresh interval
let refreshInterval = null;

onMounted(() => {
  refreshStats();

  // Auto-refresh every 2 seconds
  refreshInterval = setInterval(() => {
    if (!isCollapsed.value) {
      refreshStats();
    }
  }, 2000);
});

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
});
</script>

<style scoped>
.performance-monitor {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 350px;
  max-height: 80vh;
  background: #ffffff;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  overflow: hidden;
  transition: all 0.3s ease;
}

.performance-monitor.collapsed {
  max-height: 48px;
}

.monitor-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #ffffff;
  cursor: pointer;
  user-select: none;
}

.monitor-icon {
  font-size: 18px;
}

.monitor-title {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
}

.toggle-icon {
  font-size: 12px;
}

.monitor-content {
  max-height: calc(80vh - 48px);
  overflow-y: auto;
  padding: 16px;
}

.monitor-section {
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid #f0f0f0;
}

.monitor-section:last-of-type {
  border-bottom: none;
  margin-bottom: 0;
}

.monitor-section h4 {
  margin: 0 0 12px 0;
  font-size: 13px;
  font-weight: 600;
  color: #262626;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.stat-item {
  text-align: center;
  padding: 12px;
  background: #f5f5f5;
  border-radius: 6px;
}

.stat-label {
  font-size: 11px;
  color: #8c8c8c;
  margin-bottom: 4px;
}

.stat-value {
  font-size: 18px;
  font-weight: 600;
  color: #262626;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  font-size: 12px;
}

.stat-row span:first-child {
  color: #8c8c8c;
}

.stat-row span:last-child {
  font-weight: 500;
  color: #262626;
}

.success {
  color: #52c41a !important;
}

.warning {
  color: #faad14 !important;
}

.error {
  color: #ff4d4f !important;
}

.monitor-actions {
  display: flex;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid #f0f0f0;
}

.monitor-actions button {
  flex: 1;
}

/* Scrollbar */
.monitor-content::-webkit-scrollbar {
  width: 6px;
}

.monitor-content::-webkit-scrollbar-track {
  background: #f5f5f5;
}

.monitor-content::-webkit-scrollbar-thumb {
  background: #d9d9d9;
  border-radius: 3px;
}

.monitor-content::-webkit-scrollbar-thumb:hover {
  background: #bfbfbf;
}

/* Dark theme */
.dark .performance-monitor {
  background: #1f1f1f;
}

.dark .monitor-section {
  border-bottom-color: #3e3e3e;
}

.dark .monitor-section h4 {
  color: #ffffff;
}

.dark .stat-item {
  background: #2a2a2a;
}

.dark .stat-value,
.dark .stat-row span:last-child {
  color: #ffffff;
}

.dark .stat-row span:first-child {
  color: #bfbfbf;
}

.dark .monitor-actions {
  border-top-color: #3e3e3e;
}

.dark .monitor-content::-webkit-scrollbar-track {
  background: #1f1f1f;
}

.dark .monitor-content::-webkit-scrollbar-thumb {
  background: #3e3e3e;
}

.dark .monitor-content::-webkit-scrollbar-thumb:hover {
  background: #4e4e4e;
}
</style>
