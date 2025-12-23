<template>
  <div class="git-settings">
    <a-card title="Git 同步设置" :loading="loading">
      <a-form
        :model="form"
        :label-col="{ span: 6 }"
        :wrapper-col="{ span: 18 }"
        @finish="handleSave"
      >
        <!-- 启用Git同步 -->
        <a-form-item label="启用Git同步">
          <a-switch v-model:checked="form.enabled" />
          <div class="form-hint">
            启用后，知识库数据将自动导出为Markdown文件并同步到Git仓库
          </div>
        </a-form-item>

        <template v-if="form.enabled">
          <!-- 仓库路径 -->
          <a-form-item label="仓库路径">
            <a-input
              v-model:value="form.repoPath"
              placeholder="留空使用默认路径"
            />
            <div class="form-hint">
              Git仓库本地路径，留空将使用应用数据目录
            </div>
          </a-form-item>

          <!-- 远程仓库URL -->
          <a-form-item label="远程仓库">
            <a-input
              v-model:value="form.remoteUrl"
              placeholder="https://github.com/username/repo.git"
            />
            <div class="form-hint">
              远程Git仓库URL（可选）
            </div>
          </a-form-item>

          <!-- 作者信息 -->
          <a-form-item label="作者名称">
            <a-input
              v-model:value="form.authorName"
              placeholder="Your Name"
            />
          </a-form-item>

          <a-form-item label="作者邮箱">
            <a-input
              v-model:value="form.authorEmail"
              placeholder="you@example.com"
            />
          </a-form-item>

          <!-- 认证信息 -->
          <a-form-item label="Git认证">
            <a-radio-group v-model:value="authType">
              <a-radio value="none">无需认证</a-radio>
              <a-radio value="password">用户名/密码</a-radio>
              <a-radio value="token">Personal Access Token</a-radio>
            </a-radio-group>
          </a-form-item>

          <template v-if="authType === 'password'">
            <a-form-item label="用户名">
              <a-input v-model:value="authUsername" />
            </a-form-item>
            <a-form-item label="密码">
              <a-input-password v-model:value="authPassword" />
            </a-form-item>
          </template>

          <template v-if="authType === 'token'">
            <a-form-item label="Access Token">
              <a-input-password
                v-model:value="authToken"
                placeholder="ghp_xxxxxxxxxxxx"
              />
              <div class="form-hint">
                GitHub Personal Access Token 或其他Git服务的令牌
              </div>
            </a-form-item>
          </template>

          <!-- 自动同步 -->
          <a-form-item label="自动同步">
            <a-switch v-model:checked="form.autoSync" />
          </a-form-item>

          <a-form-item
            v-if="form.autoSync"
            label="同步间隔"
          >
            <a-input-number
              v-model:value="syncIntervalMinutes"
              :min="1"
              :max="60"
              style="width: 120px"
            />
            <span style="margin-left: 8px">分钟</span>
            <div class="form-hint">
              自动同步的时间间隔（1-60分钟）
            </div>
          </a-form-item>

          <!-- 导出路径 -->
          <a-form-item label="导出路径">
            <a-input
              v-model:value="form.exportPath"
              placeholder="knowledge"
            />
            <div class="form-hint">
              Markdown文件在仓库中的存储路径（相对路径）
            </div>
          </a-form-item>

          <!-- 启用日志输出 -->
          <a-form-item label="启用日志输出">
            <a-switch v-model:checked="form.enableLogging" />
            <div class="form-hint">
              开启后，Git操作和后端API调用的日志将输出到控制台，用于调试问题
            </div>
          </a-form-item>
        </template>

        <!-- 操作按钮 -->
        <a-form-item :wrapper-col="{ offset: 6, span: 18 }">
          <a-space>
            <a-button type="primary" html-type="submit" :loading="saving">
              保存设置
            </a-button>
            <a-button @click="handleReset">
              重置
            </a-button>
          </a-space>
        </a-form-item>
      </a-form>

      <!-- 测试连接与Git操作 -->
      <a-divider />
      <div class="test-section">
        <h4>Git操作</h4>
        <a-space>
          <a-button
            @click="handleTestConnection"
            :loading="testing"
            :disabled="!form.remoteUrl"
          >
            <template #icon><api-outlined /></template>
            测试远程连接
          </a-button>
          <a-button
            @click="handleExportMarkdown"
            :loading="exporting"
          >
            <template #icon><export-outlined /></template>
            导出Markdown
          </a-button>
          <a-button
            type="primary"
            @click="handlePull"
            :loading="pulling"
            :disabled="!form.remoteUrl"
          >
            <template #icon><download-outlined /></template>
            拉取更新 (Pull)
          </a-button>
        </a-space>
        <div v-if="testResult" class="test-result" :class="testResult.success ? 'success' : 'error'">
          {{ testResult.message }}
        </div>
      </div>
    </a-card>

    <!-- Git冲突解决器 -->
    <GitConflictResolver
      v-model:visible="showConflictResolver"
      :conflicts="conflicts"
      @resolved="handleConflictResolved"
      @aborted="handleConflictAborted"
    />
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue';
import { message } from 'ant-design-vue';
import { ApiOutlined, ExportOutlined, DownloadOutlined } from '@ant-design/icons-vue';
import GitConflictResolver from './GitConflictResolver.vue';

const loading = ref(false);
const saving = ref(false);
const testing = ref(false);
const exporting = ref(false);
const pulling = ref(false);
const testResult = ref(null);

// 冲突解决相关
const showConflictResolver = ref(false);
const conflicts = ref([]);

const form = reactive({
  enabled: false,
  repoPath: '',
  remoteUrl: '',
  authorName: 'ChainlessChain User',
  authorEmail: 'user@chainlesschain.com',
  autoSync: false,
  autoSyncInterval: 300000, // 5分钟
  exportPath: 'knowledge',
  enableLogging: false, // 默认关闭日志输出
});

const authType = ref('none');
const authUsername = ref('');
const authPassword = ref('');
const authToken = ref('');

const syncIntervalMinutes = computed({
  get: () => form.autoSyncInterval / 60000,
  set: (val) => {
    form.autoSyncInterval = val * 60000;
  },
});

// 加载配置
async function loadConfig() {
  loading.value = true;
  try {
    const config = await window.electronAPI.git.getConfig();

    form.enabled = config.enabled || false;
    form.repoPath = config.repoPath || '';
    form.remoteUrl = config.remoteUrl || '';
    form.authorName = config.authorName || 'ChainlessChain User';
    form.authorEmail = config.authorEmail || 'user@chainlesschain.com';
    form.autoSync = config.autoSync || false;
    form.autoSyncInterval = config.autoSyncInterval || 300000;
    form.exportPath = config.exportPath || 'knowledge';
    form.enableLogging = config.enableLogging || false;

    // 解析认证信息
    if (config.auth) {
      if (config.auth.password) {
        authType.value = 'password';
        authUsername.value = config.auth.username || '';
        authPassword.value = config.auth.password || '';
      } else if (config.auth.token) {
        authType.value = 'token';
        authToken.value = config.auth.token || '';
      }
    }
  } catch (error) {
    message.error('加载配置失败: ' + error.message);
  } finally {
    loading.value = false;
  }
}

// 保存配置
async function handleSave() {
  saving.value = true;
  try {
    // 构建认证对象
    let auth = null;
    if (authType.value === 'password' && authUsername.value && authPassword.value) {
      auth = {
        username: authUsername.value,
        password: authPassword.value,
      };
    } else if (authType.value === 'token' && authToken.value) {
      auth = {
        token: authToken.value,
      };
    }

    const config = {
      ...form,
      auth,
    };

    // 转换为普通对象以避免结构化克隆错误
    const plainConfig = JSON.parse(JSON.stringify(config));
    await window.electronAPI.git.setConfig(plainConfig);

    message.success('配置保存成功！需要重启应用以应用新配置');
  } catch (error) {
    message.error('保存配置失败: ' + error.message);
  } finally {
    saving.value = false;
  }
}

// 重置配置
function handleReset() {
  loadConfig();
}

// 测试连接
async function handleTestConnection() {
  if (!form.remoteUrl) {
    message.warning('请先配置远程仓库URL');
    return;
  }

  testing.value = true;
  testResult.value = null;

  try {
    // 尝试获取状态
    const status = await window.electronAPI.git.status();

    if (status.enabled) {
      testResult.value = {
        success: true,
        message: '连接成功！当前分支: ' + status.branch,
      };
    } else {
      testResult.value = {
        success: false,
        message: 'Git同步未启用',
      };
    }
  } catch (error) {
    testResult.value = {
      success: false,
      message: '连接失败: ' + error.message,
    };
  } finally {
    testing.value = false;
  }
}

// 导出Markdown
async function handleExportMarkdown() {
  exporting.value = true;
  try {
    const files = await window.electronAPI.git.exportMarkdown();
    message.success(`成功导出 ${files.length} 个Markdown文件`);
  } catch (error) {
    message.error('导出失败: ' + error.message);
  } finally {
    exporting.value = false;
  }
}

// 拉取更新
async function handlePull() {
  if (!form.remoteUrl) {
    message.warning('请先配置远程仓库URL');
    return;
  }

  pulling.value = true;
  try {
    const result = await window.electronAPI.git.pull();

    if (result.hasConflicts) {
      // 检测到冲突，显示冲突解决器
      conflicts.value = result.conflicts || [];
      showConflictResolver.value = true;
      message.warning('检测到合并冲突，请手动解决');
    } else if (result.success) {
      message.success('拉取成功！');
      testResult.value = {
        success: true,
        message: '拉取成功，仓库已更新',
      };
    }
  } catch (error) {
    message.error('拉取失败: ' + error.message);
    testResult.value = {
      success: false,
      message: '拉取失败: ' + error.message,
    };
  } finally {
    pulling.value = false;
  }
}

// 冲突解决完成
function handleConflictResolved() {
  message.success('所有冲突已解决，合并完成');
  testResult.value = {
    success: true,
    message: '冲突已解决，合并成功',
  };
  conflicts.value = [];
}

// 中止合并
function handleConflictAborted() {
  message.info('合并已中止');
  testResult.value = {
    success: false,
    message: '合并已中止',
  };
  conflicts.value = [];
}

onMounted(() => {
  loadConfig();
});
</script>

<style scoped>
.git-settings {
  height: 100%;
}

.git-settings :deep(.ant-card) {
  max-width: 800px;
}

.form-hint {
  font-size: 12px;
  color: #999;
  margin-top: 4px;
}

.test-section {
  margin-top: 16px;
}

.test-section h4 {
  margin-bottom: 12px;
}

.test-result {
  margin-top: 12px;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 14px;
}

.test-result.success {
  background: #f6ffed;
  border: 1px solid #b7eb8f;
  color: #52c41a;
}

.test-result.error {
  background: #fff2f0;
  border: 1px solid #ffccc7;
  color: #ff4d4f;
}
</style>
