<template>
  <div class="plugin-management">
    <div class="settings-header">
      <h1>
        <AppstoreOutlined />
        插件管理
      </h1>
      <p>安装、管理和配置应用插件以扩展功能</p>
    </div>

    <a-spin :spinning="loading">
      <!-- 操作栏 -->
      <div class="plugin-actions">
        <a-space>
          <a-button type="primary" @click="showInstallModal = true">
            <PlusOutlined />
            安装插件
          </a-button>
          <a-button @click="handleOpenPluginsDir">
            <FolderOpenOutlined />
            打开插件目录
          </a-button>
          <a-button @click="loadPlugins">
            <ReloadOutlined />
            刷新列表
          </a-button>
        </a-space>

        <!-- 搜索和筛选 -->
        <a-space>
          <a-input-search
            v-model:value="searchKeyword"
            placeholder="搜索插件名称、ID或作者"
            style="width: 250px"
            @search="loadPlugins"
          />
          <a-select
            v-model:value="filterStatus"
            placeholder="状态筛选"
            style="width: 120px"
            @change="loadPlugins"
          >
            <a-select-option value="all"> 全部 </a-select-option>
            <a-select-option value="enabled"> 已启用 </a-select-option>
            <a-select-option value="disabled"> 已禁用 </a-select-option>
          </a-select>
          <a-select
            v-model:value="filterCategory"
            placeholder="分类筛选"
            style="width: 120px"
            @change="loadPlugins"
          >
            <a-select-option value="all"> 全部分类 </a-select-option>
            <a-select-option value="official"> 官方插件 </a-select-option>
            <a-select-option value="community"> 社区插件 </a-select-option>
            <a-select-option value="custom"> 自定义 </a-select-option>
          </a-select>
        </a-space>
      </div>

      <!-- 插件列表 -->
      <div class="plugin-list">
        <a-empty v-if="plugins.length === 0" description="暂无插件" />
        <a-list v-else :data-source="plugins" :grid="{ gutter: 16, column: 2 }">
          <template #renderItem="{ item }">
            <a-list-item>
              <a-card
                :class="['plugin-card', { 'plugin-disabled': !item.enabled }]"
                hoverable
              >
                <template #title>
                  <div class="plugin-card-title">
                    <a-space>
                      <a-badge :status="item.enabled ? 'success' : 'default'" />
                      <span>{{ item.name }}</span>
                      <a-tag v-if="item.category === 'official'" color="blue">
                        官方
                      </a-tag>
                      <a-tag
                        v-else-if="item.category === 'community'"
                        color="green"
                      >
                        社区
                      </a-tag>
                      <a-tag v-else color="default"> 自定义 </a-tag>
                    </a-space>
                  </div>
                </template>

                <template #extra>
                  <a-switch
                    v-model:checked="item.enabled"
                    :loading="item.switching"
                    @change="handleTogglePlugin(item)"
                  />
                </template>

                <div class="plugin-info">
                  <p class="plugin-description">
                    {{ item.description || "暂无描述" }}
                  </p>
                  <div class="plugin-meta">
                    <a-space direction="vertical" :size="4">
                      <div><strong>ID:</strong> {{ item.plugin_id }}</div>
                      <div><strong>版本:</strong> {{ item.version }}</div>
                      <div v-if="item.author">
                        <strong>作者:</strong> {{ item.author }}
                      </div>
                      <div>
                        <strong>安装时间:</strong>
                        {{ formatDate(item.installed_at) }}
                      </div>
                    </a-space>
                  </div>

                  <!-- 扩展点标签 -->
                  <div
                    v-if="
                      item.extensionPoints && item.extensionPoints.length > 0
                    "
                    class="plugin-extensions"
                  >
                    <a-divider style="margin: 12px 0 8px" />
                    <div
                      style="font-size: 12px; color: #999; margin-bottom: 4px"
                    >
                      扩展点：
                    </div>
                    <a-space :size="[4, 4]" wrap>
                      <a-tag
                        v-for="ext in item.extensionPoints"
                        :key="ext"
                        size="small"
                      >
                        {{ ext }}
                      </a-tag>
                    </a-space>
                  </div>
                </div>

                <template #actions>
                  <a-button size="small" @click="showPluginDetail(item)">
                    <InfoCircleOutlined />
                    详情
                  </a-button>
                  <a-button size="small" @click="showPluginPermissions(item)">
                    <SafetyOutlined />
                    权限
                  </a-button>
                  <a-popconfirm
                    title="确定要卸载此插件吗？"
                    ok-text="确定"
                    cancel-text="取消"
                    @confirm="handleUninstallPlugin(item)"
                  >
                    <a-button size="small" danger>
                      <DeleteOutlined />
                      卸载
                    </a-button>
                  </a-popconfirm>
                </template>
              </a-card>
            </a-list-item>
          </template>
        </a-list>
      </div>
    </a-spin>

    <!-- 安装插件对话框 -->
    <a-modal
      v-model:open="showInstallModal"
      title="安装插件"
      :confirm-loading="installing"
      @ok="handleInstallPlugin"
    >
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
        <a-form-item label="安装方式">
          <a-radio-group v-model:value="installMethod">
            <a-radio value="local"> 本地目录 </a-radio>
            <a-radio value="npm"> NPM包 </a-radio>
            <a-radio value="zip"> ZIP文件 </a-radio>
          </a-radio-group>
        </a-form-item>

        <a-form-item v-if="installMethod === 'local'" label="插件目录">
          <a-input
            v-model:value="installSource"
            placeholder="选择插件目录路径"
            readonly
          />
          <template #extra>
            <a-button size="small" @click="handleSelectPluginFolder">
              <FolderOpenOutlined />
              选择目录
            </a-button>
          </template>
        </a-form-item>

        <a-form-item v-else-if="installMethod === 'npm'" label="NPM包名">
          <a-input
            v-model:value="installSource"
            placeholder="例如: @chainlesschain/plugin-example"
          />
        </a-form-item>

        <a-form-item v-else-if="installMethod === 'zip'" label="ZIP文件">
          <a-input
            v-model:value="installSource"
            placeholder="选择ZIP文件路径"
            readonly
          />
          <template #extra>
            <a-button size="small" @click="handleSelectPluginZip">
              <FileZipOutlined />
              选择文件
            </a-button>
          </template>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 插件详情对话框 -->
    <a-modal
      v-model:open="showDetailModal"
      :title="`插件详情 - ${currentPlugin?.name}`"
      :footer="null"
      width="800px"
    >
      <a-descriptions v-if="currentPlugin" bordered :column="1">
        <a-descriptions-item label="插件ID">
          {{ currentPlugin.plugin_id }}
        </a-descriptions-item>
        <a-descriptions-item label="名称">
          {{ currentPlugin.name }}
        </a-descriptions-item>
        <a-descriptions-item label="版本">
          {{ currentPlugin.version }}
        </a-descriptions-item>
        <a-descriptions-item label="作者">
          {{ currentPlugin.author || "未知" }}
        </a-descriptions-item>
        <a-descriptions-item label="描述">
          {{ currentPlugin.description || "暂无描述" }}
        </a-descriptions-item>
        <a-descriptions-item label="主页">
          <a
            v-if="currentPlugin.homepage"
            :href="currentPlugin.homepage"
            target="_blank"
          >
            {{ currentPlugin.homepage }}
          </a>
          <span v-else>-</span>
        </a-descriptions-item>
        <a-descriptions-item label="许可证">
          {{ currentPlugin.license || "-" }}
        </a-descriptions-item>
        <a-descriptions-item label="分类">
          {{ currentPlugin.category }}
        </a-descriptions-item>
        <a-descriptions-item label="状态">
          <a-badge :status="currentPlugin.enabled ? 'success' : 'default'" />
          {{ currentPlugin.enabled ? "已启用" : "已禁用" }}
        </a-descriptions-item>
        <a-descriptions-item label="安装路径">
          {{ currentPlugin.installed_path }}
        </a-descriptions-item>
        <a-descriptions-item label="安装时间">
          {{ formatDate(currentPlugin.installed_at) }}
        </a-descriptions-item>
        <a-descriptions-item label="更新时间">
          {{ formatDate(currentPlugin.updated_at) }}
        </a-descriptions-item>
      </a-descriptions>
    </a-modal>

    <!-- 权限管理对话框 -->
    <a-modal
      v-model:open="showPermissionsModal"
      :title="`权限管理 - ${currentPlugin?.name}`"
      :confirm-loading="savingPermissions"
      @ok="handleSavePermissions"
    >
      <a-list
        v-if="pluginPermissions.length > 0"
        :data-source="pluginPermissions"
        size="small"
      >
        <template #renderItem="{ item }">
          <a-list-item>
            <a-list-item-meta>
              <template #title>
                {{ getPermissionName(item.permission) }}
              </template>
              <template #description>
                {{ getPermissionDescription(item.permission) }}
              </template>
            </a-list-item-meta>
            <template #actions>
              <a-switch
                v-model:checked="item.granted"
                checked-children="允许"
                un-checked-children="拒绝"
              />
            </template>
          </a-list-item>
        </template>
      </a-list>
      <a-empty v-else description="该插件未请求任何权限" />
    </a-modal>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, onMounted } from "vue";
import { message } from "ant-design-vue";
import {
  AppstoreOutlined,
  PlusOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  InfoCircleOutlined,
  SafetyOutlined,
  DeleteOutlined,
  FileZipOutlined,
} from "@ant-design/icons-vue";

const loading = ref(false);
const plugins = ref([]);
const searchKeyword = ref("");
const filterStatus = ref("all");
const filterCategory = ref("all");

// 安装插件
const showInstallModal = ref(false);
const installing = ref(false);
const installMethod = ref("local");
const installSource = ref("");

// 插件详情
const showDetailModal = ref(false);
const currentPlugin = ref(null);

// 权限管理
const showPermissionsModal = ref(false);
const pluginPermissions = ref([]);
const savingPermissions = ref(false);

// 加载插件列表
const loadPlugins = async () => {
  loading.value = true;
  try {
    // 检查 API 是否可用
    if (!window.electronAPI || !window.electronAPI.plugin) {
      logger.error("[PluginManagement] electronAPI.plugin 不可用");
      logger.info("[PluginManagement] electronAPI:", window.electronAPI);
      message.error("插件 API 不可用，请重启应用");
      return;
    }

    const filters = {};

    if (filterStatus.value !== "all") {
      filters.enabled = filterStatus.value === "enabled";
    }

    if (filterCategory.value !== "all") {
      filters.category = filterCategory.value;
    }

    if (searchKeyword.value) {
      filters.search = searchKeyword.value;
    }

    const result = await window.electronAPI.plugin.getPlugins(filters);

    // Handle response object structure
    if (result && !result.success) {
      throw new Error(result.error || "获取插件列表失败");
    }

    // Ensure result is an array before mapping
    const pluginList = Array.isArray(result)
      ? result
      : result?.plugins || result?.data || [];

    plugins.value = pluginList.map((p) => ({
      ...p,
      switching: false,
      extensionPoints: p.extension_points ? JSON.parse(p.extension_points) : [],
    }));
  } catch (error) {
    // IPC 未就绪时静默处理
    if (error.message?.includes("No handler registered")) {
      plugins.value = [];
      return;
    }
    logger.error("[PluginManagement] 加载插件列表失败:", error);
    message.error("加载插件列表失败: " + error.message);
  } finally {
    loading.value = false;
  }
};

// 启用/禁用插件
const handleTogglePlugin = async (plugin) => {
  plugin.switching = true;
  try {
    if (plugin.enabled) {
      await window.electronAPI.plugin.enable(plugin.plugin_id);
      message.success(`插件 ${plugin.name} 已启用`);
    } else {
      await window.electronAPI.plugin.disable(plugin.plugin_id);
      message.success(`插件 ${plugin.name} 已禁用`);
    }
  } catch (error) {
    logger.error("切换插件状态失败:", error);
    message.error("操作失败: " + error.message);
    // 恢复开关状态
    plugin.enabled = !plugin.enabled;
  } finally {
    plugin.switching = false;
  }
};

// 安装插件
const handleInstallPlugin = async () => {
  if (!installSource.value) {
    message.warning("请选择要安装的插件");
    return;
  }

  installing.value = true;
  try {
    const options = {};

    if (installMethod.value === "npm") {
      options.fromNpm = true;
    } else if (installMethod.value === "zip") {
      options.fromZip = true;
    }

    await window.electronAPI.plugin.install(installSource.value, options);
    message.success("插件安装成功");
    showInstallModal.value = false;
    installSource.value = "";
    await loadPlugins();
  } catch (error) {
    logger.error("安装插件失败:", error);
    message.error("安装失败: " + error.message);
  } finally {
    installing.value = false;
  }
};

// 卸载插件
const handleUninstallPlugin = async (plugin) => {
  loading.value = true;
  try {
    await window.electronAPI.plugin.uninstall(plugin.plugin_id);
    message.success(`插件 ${plugin.name} 已卸载`);
    await loadPlugins();
  } catch (error) {
    logger.error("卸载插件失败:", error);
    message.error("卸载失败: " + error.message);
  } finally {
    loading.value = false;
  }
};

// 显示插件详情
const showPluginDetail = (plugin) => {
  currentPlugin.value = plugin;
  showDetailModal.value = true;
};

// 显示权限管理
const showPluginPermissions = async (plugin) => {
  currentPlugin.value = plugin;
  try {
    const result = await window.electronAPI.plugin.getPermissions(
      plugin.plugin_id,
    );

    // Handle response object structure
    if (result && !result.success) {
      throw new Error(result.error || "获取权限失败");
    }

    pluginPermissions.value = result?.permissions || [];
    showPermissionsModal.value = true;
  } catch (error) {
    logger.error("获取插件权限失败:", error);
    message.error("获取权限失败: " + error.message);
  }
};

// 保存权限设置
const handleSavePermissions = async () => {
  savingPermissions.value = true;
  try {
    for (const perm of pluginPermissions.value) {
      await window.electronAPI.plugin.updatePermission(
        currentPlugin.value.plugin_id,
        perm.permission,
        perm.granted,
      );
    }
    message.success("权限设置已保存");
    showPermissionsModal.value = false;
  } catch (error) {
    logger.error("保存权限失败:", error);
    message.error("保存失败: " + error.message);
  } finally {
    savingPermissions.value = false;
  }
};

// 打开插件目录
const handleOpenPluginsDir = async () => {
  try {
    // 检查 API 是否可用
    if (!window.electronAPI || !window.electronAPI.plugin) {
      message.error("插件 API 不可用，请重启应用");
      return;
    }
    await window.electronAPI.plugin.openPluginsDir();
  } catch (error) {
    logger.error("打开插件目录失败:", error);
    message.error("操作失败: " + error.message);
  }
};

// 选择插件目录
const handleSelectPluginFolder = async () => {
  try {
    const result = await window.electronAPI.dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      installSource.value = result.filePaths[0];
    }
  } catch (error) {
    logger.error("选择目录失败:", error);
    message.error("选择目录失败");
  }
};

// 选择ZIP文件
const handleSelectPluginZip = async () => {
  try {
    const result = await window.electronAPI.dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "ZIP Files", extensions: ["zip"] }],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      installSource.value = result.filePaths[0];
    }
  } catch (error) {
    logger.error("选择文件失败:", error);
    message.error("选择文件失败");
  }
};

// 权限名称映射
const getPermissionName = (permission) => {
  const names = {
    "database:read": "数据库读取",
    "database:write": "数据库写入",
    "database:admin": "数据库管理",
    "llm:query": "LLM查询",
    "llm:stream": "LLM流式响应",
    "llm:embed": "文本嵌入",
    "ui:component": "UI组件",
    "ui:page": "UI页面",
    "ui:menu": "菜单项",
    "file:read": "文件读取",
    "file:write": "文件写入",
    "network:request": "网络请求",
    "system:notification": "系统通知",
  };
  return names[permission] || permission;
};

// 权限描述
const getPermissionDescription = (permission) => {
  const descriptions = {
    "database:read": "允许插件读取数据库数据",
    "database:write": "允许插件修改数据库数据",
    "database:admin": "允许插件管理数据库结构",
    "llm:query": "允许插件调用LLM服务",
    "llm:stream": "允许插件使用LLM流式响应",
    "llm:embed": "允许插件进行文本向量化",
    "ui:component": "允许插件注册UI组件",
    "ui:page": "允许插件添加页面",
    "ui:menu": "允许插件添加菜单项",
    "file:read": "允许插件读取文件",
    "file:write": "允许插件写入文件",
    "network:request": "允许插件发起网络请求",
    "system:notification": "允许插件显示系统通知",
  };
  return descriptions[permission] || "未知权限";
};

// 格式化日期
const formatDate = (dateString) => {
  if (!dateString) {
    return "-";
  }
  const date = new Date(dateString);
  return date.toLocaleString("zh-CN");
};

// 初始化
onMounted(() => {
  loadPlugins();
});
</script>

<style scoped>
.plugin-management {
  padding: 24px;
}

.settings-header {
  margin-bottom: 24px;
}

.settings-header h1 {
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.settings-header p {
  color: #666;
  margin: 0;
}

.plugin-actions {
  margin-bottom: 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background: #fafafa;
  border-radius: 8px;
}

.plugin-list {
  margin-top: 16px;
}

.plugin-card {
  height: 100%;
  transition: all 0.3s;
}

.plugin-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.plugin-disabled {
  opacity: 0.6;
}

.plugin-card-title {
  font-size: 16px;
  font-weight: 600;
}

.plugin-info {
  min-height: 180px;
}

.plugin-description {
  color: #666;
  margin-bottom: 12px;
  min-height: 40px;
}

.plugin-meta {
  font-size: 13px;
  color: #999;
  padding: 12px;
  background: #fafafa;
  border-radius: 4px;
}

.plugin-extensions {
  margin-top: 8px;
}
</style>
