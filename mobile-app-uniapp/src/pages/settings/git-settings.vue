<template>
  <view class="git-settings-page">
    <!-- 顶部导航栏 -->
    <view class="navbar">
      <view class="navbar-left" @click="goBack">
        <text class="icon-back">←</text>
      </view>
      <view class="navbar-title">Git设置</view>
      <view class="navbar-right" @click="saveSettings">
        <text class="save-text">保存</text>
      </view>
    </view>

    <!-- 设置表单 -->
    <view class="settings-form">
      <!-- 用户信息 -->
      <view class="form-section">
        <view class="section-title">用户信息</view>
        <view class="form-item">
          <text class="item-label">用户名</text>
          <input
            class="item-input"
            v-model="config.authorName"
            placeholder="请输入用户名"
          />
        </view>
        <view class="form-item">
          <text class="item-label">邮箱</text>
          <input
            class="item-input"
            v-model="config.authorEmail"
            placeholder="请输入邮箱"
            type="email"
          />
        </view>
      </view>

      <!-- 远程仓库 -->
      <view class="form-section">
        <view class="section-title">远程仓库</view>
        <view class="form-item">
          <text class="item-label">仓库地址</text>
          <input
            class="item-input"
            v-model="config.remoteUrl"
            placeholder="https://github.com/user/repo.git"
          />
        </view>
        <view class="form-item">
          <text class="item-label">用户名</text>
          <input
            class="item-input"
            v-model="config.auth.username"
            placeholder="Git用户名"
          />
        </view>
        <view class="form-item">
          <text class="item-label">密码/Token</text>
          <input
            class="item-input"
            v-model="config.auth.password"
            placeholder="密码或Personal Access Token"
            password
          />
        </view>
        <view class="form-tip">
          <text class="tip-text">💡 建议使用Personal Access Token代替密码</text>
        </view>
      </view>

      <!-- 自动同步 -->
      <view class="form-section">
        <view class="section-title">自动同步</view>
        <view class="form-item">
          <text class="item-label">启用自动同步</text>
          <switch
            :checked="config.autoSync"
            @change="handleAutoSyncChange"
            color="#667eea"
          />
        </view>
        <view class="form-item" v-if="config.autoSync">
          <text class="item-label">同步间隔</text>
          <picker
            mode="selector"
            :range="syncIntervals"
            :range-key="'label'"
            :value="selectedIntervalIndex"
            @change="handleIntervalChange"
          >
            <view class="picker-value">
              {{ syncIntervals[selectedIntervalIndex].label }}
            </view>
          </picker>
        </view>
      </view>

      <!-- 高级选项 -->
      <view class="form-section">
        <view class="section-title">高级选项</view>
        <view class="form-item">
          <text class="item-label">默认分支</text>
          <input
            class="item-input"
            v-model="config.defaultBranch"
            placeholder="main"
          />
        </view>
        <view class="form-item">
          <text class="item-label">忽略文件</text>
          <textarea
            class="item-textarea"
            v-model="config.gitignore"
            placeholder="每行一个文件或模式，例如：&#10;*.log&#10;node_modules/&#10;.DS_Store"
            :maxlength="-1"
          />
        </view>
      </view>

      <!-- 操作按钮 -->
      <view class="action-buttons">
        <button class="btn btn-test" @click="testConnection">
          测试连接
        </button>
        <button class="btn btn-clone" @click="cloneRepository">
          克隆仓库
        </button>
        <button class="btn btn-danger" @click="resetSettings">
          重置设置
        </button>
      </view>
    </view>
  </view>
</template>

<script>
import { gitService } from '@/services/git/git-service';

export default {
  name: 'GitSettingsPage',
  data() {
    return {
      config: {
        authorName: '',
        authorEmail: '',
        remoteUrl: '',
        auth: {
          username: '',
          password: ''
        },
        autoSync: false,
        syncInterval: 5 * 60 * 1000, // 5分钟
        defaultBranch: 'main',
        gitignore: ''
      },
      syncIntervals: [
        { label: '1分钟', value: 1 * 60 * 1000 },
        { label: '5分钟', value: 5 * 60 * 1000 },
        { label: '10分钟', value: 10 * 60 * 1000 },
        { label: '30分钟', value: 30 * 60 * 1000 },
        { label: '1小时', value: 60 * 60 * 1000 }
      ],
      selectedIntervalIndex: 1
    };
  },
  onLoad() {
    this.loadSettings();
  },
  methods: {
    async loadSettings() {
      try {
        // 从数据库加载配置
        const savedConfig = await gitService.loadConfig();
        if (savedConfig) {
          this.config = { ...this.config, ...savedConfig };

          // 设置同步间隔选择器的索引
          const index = this.syncIntervals.findIndex(
            item => item.value === this.config.syncInterval
          );
          if (index !== -1) {
            this.selectedIntervalIndex = index;
          }
        }
      } catch (error) {
        console.error('加载设置失败:', error);
      }
    },
    async saveSettings() {
      try {
        // 验证必填字段
        if (!this.config.authorName || !this.config.authorEmail) {
          uni.showToast({
            title: '请填写用户名和邮箱',
            icon: 'none'
          });
          return;
        }

        // 如果启用了自动同步，验证远程仓库配置
        if (this.config.autoSync && !this.config.remoteUrl) {
          uni.showToast({
            title: '启用自动同步需要配置远程仓库',
            icon: 'none'
          });
          return;
        }

        // 保存配置
        await gitService.saveConfig(this.config);

        uni.showToast({
          title: '保存成功',
          icon: 'success'
        });

        // 延迟返回
        setTimeout(() => {
          uni.navigateBack();
        }, 1500);
      } catch (error) {
        console.error('保存设置失败:', error);
        uni.showToast({
          title: '保存失败',
          icon: 'none'
        });
      }
    },
    handleAutoSyncChange(e) {
      this.config.autoSync = e.detail.value;
    },
    handleIntervalChange(e) {
      this.selectedIntervalIndex = e.detail.value;
      this.config.syncInterval = this.syncIntervals[e.detail.value].value;
    },
    async testConnection() {
      if (!this.config.remoteUrl) {
        uni.showToast({
          title: '请先配置远程仓库地址',
          icon: 'none'
        });
        return;
      }

      uni.showLoading({
        title: '测试连接中...'
      });

      try {
        // 尝试fetch远程仓库
        await gitService.fetch();

        uni.hideLoading();
        uni.showToast({
          title: '连接成功',
          icon: 'success'
        });
      } catch (error) {
        uni.hideLoading();
        uni.showModal({
          title: '连接失败',
          content: error.message || '无法连接到远程仓库，请检查配置',
          showCancel: false
        });
      }
    },
    async cloneRepository() {
      if (!this.config.remoteUrl) {
        uni.showToast({
          title: '请先配置远程仓库地址',
          icon: 'none'
        });
        return;
      }

      uni.showModal({
        title: '克隆仓库',
        content: '克隆仓库将覆盖本地所有数据，是否继续？',
        success: async (res) => {
          if (res.confirm) {
            uni.showLoading({
              title: '克隆中...'
            });

            try {
              await gitService.clone(this.config.remoteUrl, this.config.auth);

              uni.hideLoading();
              uni.showToast({
                title: '克隆成功',
                icon: 'success'
              });
            } catch (error) {
              uni.hideLoading();
              uni.showModal({
                title: '克隆失败',
                content: error.message || '克隆仓库失败',
                showCancel: false
              });
            }
          }
        }
      });
    },
    resetSettings() {
      uni.showModal({
        title: '重置设置',
        content: '确定要重置所有Git设置吗？',
        success: (res) => {
          if (res.confirm) {
            this.config = {
              authorName: '',
              authorEmail: '',
              remoteUrl: '',
              auth: {
                username: '',
                password: ''
              },
              autoSync: false,
              syncInterval: 5 * 60 * 1000,
              defaultBranch: 'main',
              gitignore: ''
            };
            this.selectedIntervalIndex = 1;

            uni.showToast({
              title: '已重置',
              icon: 'success'
            });
          }
        }
      });
    },
    goBack() {
      uni.navigateBack();
    }
  }
};
</script>

<style scoped>
.git-settings-page {
  min-height: 100vh;
  background: #f5f5f5;
}

/* 导航栏 */
.navbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 88rpx;
  padding: 0 30rpx;
  background: #fff;
  border-bottom: 1rpx solid #eee;
}

.navbar-left,
.navbar-right {
  width: 80rpx;
  height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-back {
  font-size: 40rpx;
  color: #333;
}

.save-text {
  font-size: 28rpx;
  color: #667eea;
  font-weight: 500;
}

.navbar-title {
  font-size: 32rpx;
  font-weight: 600;
  color: #333;
}

/* 设置表单 */
.settings-form {
  padding: 20rpx 0;
}

.form-section {
  margin-bottom: 20rpx;
  padding: 30rpx;
  background: #fff;
}

.section-title {
  font-size: 28rpx;
  font-weight: 600;
  color: #333;
  margin-bottom: 30rpx;
}

.form-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx 0;
  border-bottom: 1rpx solid #f5f5f5;
}

.form-item:last-child {
  border-bottom: none;
}

.item-label {
  font-size: 28rpx;
  color: #333;
  width: 200rpx;
  flex-shrink: 0;
}

.item-input {
  flex: 1;
  font-size: 28rpx;
  color: #333;
  text-align: right;
}

.item-textarea {
  width: 100%;
  min-height: 200rpx;
  padding: 20rpx;
  background: #f5f5f5;
  border-radius: 12rpx;
  font-size: 26rpx;
  color: #333;
  margin-top: 20rpx;
}

.picker-value {
  font-size: 28rpx;
  color: #333;
  text-align: right;
}

.form-tip {
  margin-top: 20rpx;
  padding: 20rpx;
  background: #f0f4ff;
  border-radius: 12rpx;
}

.tip-text {
  font-size: 24rpx;
  color: #667eea;
  line-height: 1.6;
}

/* 操作按钮 */
.action-buttons {
  padding: 30rpx;
}

.btn {
  width: 100%;
  height: 88rpx;
  border-radius: 12rpx;
  font-size: 28rpx;
  font-weight: 500;
  border: none;
  margin-bottom: 20rpx;
}

.btn:last-child {
  margin-bottom: 0;
}

.btn-test {
  background: #e3f2fd;
  color: #2196f3;
}

.btn-clone {
  background: #e8f5e9;
  color: #4caf50;
}

.btn-danger {
  background: #ffebee;
  color: #f44336;
}
</style>
