<template>
  <div class="execution-result">
    <!-- 成功结果 -->
    <a-result
      status="success"
      title="任务执行完成!"
      :sub-title="getResultSummary()"
    >
      <template #icon>
        <div class="success-icon">🎉</div>
      </template>
    </a-result>

    <!-- 质量评分 -->
    <div v-if="qualityScore" class="quality-score">
      <h4>📊 质量评分</h4>
      <div class="score-card">
        <div class="score-main">
          <div class="score-value">{{ qualityScore.percentage }}</div>
          <div class="score-label">分</div>
          <div class="score-grade">{{ qualityScore.grade }}</div>
        </div>
        <div class="score-details">
          <div class="score-item">
            <span class="item-label">完成度:</span>
            <a-progress
              :percent="getScorePercent(qualityScore.completionScore, 30)"
              :show-info="false"
              stroke-color="#52c41a"
            />
            <span class="item-value">{{ qualityScore.completionScore }}/30</span>
          </div>
          <div class="score-item">
            <span class="item-label">文件输出:</span>
            <a-progress
              :percent="getScorePercent(qualityScore.fileOutputScore, 20)"
              :show-info="false"
              stroke-color="#1890ff"
            />
            <span class="item-value">{{ qualityScore.fileOutputScore }}/20</span>
          </div>
          <div class="score-item">
            <span class="item-label">执行时间:</span>
            <a-progress
              :percent="getScorePercent(qualityScore.executionTimeScore, 15)"
              :show-info="false"
              stroke-color="#722ed1"
            />
            <span class="item-value">{{ qualityScore.executionTimeScore }}/15</span>
          </div>
          <div class="score-item">
            <span class="item-label">错误率:</span>
            <a-progress
              :percent="getScorePercent(qualityScore.errorRateScore, 20)"
              :show-info="false"
              stroke-color="#fa8c16"
            />
            <span class="item-value">{{ qualityScore.errorRateScore }}/20</span>
          </div>
          <div class="score-item">
            <span class="item-label">资源使用:</span>
            <a-progress
              :percent="getScorePercent(qualityScore.resourceUsageScore, 15)"
              :show-info="false"
              stroke-color="#13c2c2"
            />
            <span class="item-value">{{ qualityScore.resourceUsageScore }}/15</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 生成的文件 -->
    <div v-if="result?.files && result.files.length > 0" class="generated-files">
      <h4>📁 生成的文件</h4>
      <div class="files-list">
        <div
          v-for="(file, index) in result.files"
          :key="index"
          class="file-item"
        >
          <div class="file-icon">📄</div>
          <div class="file-info">
            <div class="file-name">{{ file.name }}</div>
            <div class="file-size">{{ formatFileSize(file.size) }}</div>
          </div>
          <a-button type="link" size="small">
            查看
          </a-button>
        </div>
      </div>
    </div>

    <!-- 反馈表单 -->
    <div class="feedback-section">
      <h4>💬 您的反馈</h4>
      <a-form layout="vertical">
        <a-form-item label="总体评价">
          <a-rate
            v-model:value="feedback.rating"
            :tooltips="['很差', '较差', '一般', '满意', '非常满意']"
            allow-half
          />
        </a-form-item>
        <a-form-item label="遇到的问题">
          <a-checkbox-group v-model:value="feedback.issues">
            <a-checkbox value="incomplete">结果不完整</a-checkbox>
            <a-checkbox value="quality">质量不够好</a-checkbox>
            <a-checkbox value="slow">执行太慢</a-checkbox>
            <a-checkbox value="error">出现错误</a-checkbox>
            <a-checkbox value="other">其他问题</a-checkbox>
          </a-checkbox-group>
        </a-form-item>
        <a-form-item label="改进建议">
          <a-textarea
            v-model:value="feedback.comment"
            placeholder="请分享您的建议，帮助我们改进..."
            :rows="4"
          />
        </a-form-item>
        <a-form-item>
          <a-space>
            <a-button
              type="primary"
              @click="handleSubmitFeedback"
            >
              提交反馈
            </a-button>
            <a-button
              v-if="result?.projectId"
              @click="handleViewProject"
            >
              查看项目
            </a-button>
            <a-button @click="handleClose">
              关闭
            </a-button>
          </a-space>
        </a-form-item>
      </a-form>
    </div>
  </div>
</template>

<script setup>
import { reactive } from 'vue';

const props = defineProps({
  result: {
    type: Object,
    default: null
  },
  qualityScore: {
    type: Object,
    default: null
  }
});

const emit = defineEmits(['submit-feedback', 'view-project', 'close']);

const feedback = reactive({
  rating: 5,
  issues: [],
  comment: ''
});

// 获取结果摘要
const getResultSummary = () => {
  const filesCount = props.result?.files?.length || 0;
  return `成功生成 ${filesCount} 个文件`;
};

// 计算分数百分比
const getScorePercent = (score, maxScore) => {
  return Math.round((score / maxScore) * 100);
};

// 格式化文件大小
const formatFileSize = (bytes) => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
};

// 提交反馈
const handleSubmitFeedback = () => {
  emit('submit-feedback', {
    ...feedback,
    timestamp: Date.now()
  });
};

// 查看项目
const handleViewProject = () => {
  emit('view-project', props.result?.projectId);
};

// 关闭
const handleClose = () => {
  emit('close');
};
</script>

<style scoped>
.execution-result {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* 成功图标 */
.success-icon {
  font-size: 72px;
  line-height: 1;
}

/* 质量评分 */
.quality-score {
  background: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.quality-score h4 {
  margin: 0 0 16px;
  font-size: 16px;
  font-weight: 600;
}

.score-card {
  display: flex;
  gap: 24px;
}

.score-main {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 150px;
  padding: 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 8px;
  color: white;
}

.score-value {
  font-size: 48px;
  font-weight: 700;
  line-height: 1;
}

.score-label {
  font-size: 14px;
  opacity: 0.9;
  margin-top: 4px;
}

.score-grade {
  font-size: 20px;
  font-weight: 600;
  margin-top: 8px;
  padding: 4px 16px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 20px;
}

.score-details {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.score-item {
  display: grid;
  grid-template-columns: 80px 1fr 60px;
  align-items: center;
  gap: 12px;
}

.item-label {
  font-size: 13px;
  color: #666;
}

.item-value {
  font-size: 13px;
  color: #999;
  text-align: right;
}

/* 生成的文件 */
.generated-files {
  background: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.generated-files h4 {
  margin: 0 0 16px;
  font-size: 16px;
  font-weight: 600;
}

.files-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: #f9f9f9;
  border-radius: 6px;
  transition: all 0.3s;
}

.file-item:hover {
  background: #f0f0f0;
}

.file-icon {
  font-size: 24px;
}

.file-info {
  flex: 1;
}

.file-name {
  font-weight: 500;
  color: #333;
  margin-bottom: 2px;
}

.file-size {
  font-size: 12px;
  color: #999;
}

/* 反馈表单 */
.feedback-section {
  background: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.feedback-section h4 {
  margin: 0 0 16px;
  font-size: 16px;
  font-weight: 600;
}

/* 响应式 */
@media (max-width: 768px) {
  .score-card {
    flex-direction: column;
  }

  .score-item {
    grid-template-columns: 70px 1fr 50px;
  }
}
</style>
