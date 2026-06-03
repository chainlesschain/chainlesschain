<template>
  <div>
    <!-- 引擎选择 -->
    <a-card title="识别引擎" style="margin-bottom: 16px">
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
        <a-form-item label="默认引擎">
          <a-select
            v-model:value="config.speech.defaultEngine"
            style="width: 300px"
          >
            <a-select-option value="webspeech">
              Web Speech API（浏览器内置）
            </a-select-option>
            <a-select-option value="whisper-api">
              Whisper API（OpenAI云端）
            </a-select-option>
            <a-select-option value="whisper-local">
              Whisper Local（本地服务）
            </a-select-option>
          </a-select>
          <template #extra>
            <div style="margin-top: 8px">
              <div v-if="config.speech.defaultEngine === 'webspeech'">
                ✓ 免费，无需配置，但准确度较低
              </div>
              <div v-else-if="config.speech.defaultEngine === 'whisper-api'">
                ⚠ 需要OpenAI API密钥，按使用量计费，准确度高
              </div>
              <div v-else-if="config.speech.defaultEngine === 'whisper-local'">
                ✓ 免费，需要本地部署Whisper服务，准确度高
              </div>
            </div>
          </template>
        </a-form-item>
      </a-form>
    </a-card>

    <!-- Web Speech API 配置 -->
    <a-card
      v-if="config.speech.defaultEngine === 'webspeech'"
      title="Web Speech API 配置"
      style="margin-bottom: 16px"
    >
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
        <a-form-item label="语言">
          <a-select
            v-model:value="config.speech.webSpeech.lang"
            style="width: 200px"
          >
            <a-select-option value="zh-CN"> 中文（简体） </a-select-option>
            <a-select-option value="zh-TW"> 中文（繁体） </a-select-option>
            <a-select-option value="en-US"> 英语（美国） </a-select-option>
            <a-select-option value="en-GB"> 英语（英国） </a-select-option>
            <a-select-option value="ja-JP"> 日语 </a-select-option>
            <a-select-option value="ko-KR"> 韩语 </a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="连续识别">
          <a-switch
            v-model:checked="config.speech.webSpeech.continuous"
            checked-children="启用"
            un-checked-children="禁用"
          />
          <template #extra> 启用后可以持续识别，不会在停顿时自动停止 </template>
        </a-form-item>

        <a-form-item label="实时结果">
          <a-switch
            v-model:checked="config.speech.webSpeech.interimResults"
            checked-children="启用"
            un-checked-children="禁用"
          />
          <template #extra> 显示识别过程中的临时结果 </template>
        </a-form-item>
      </a-form>
    </a-card>

    <!-- Whisper API 配置 -->
    <a-card
      v-if="config.speech.defaultEngine === 'whisper-api'"
      title="Whisper API 配置"
      style="margin-bottom: 16px"
    >
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
        <a-form-item label="API 密钥">
          <a-input-password
            v-model:value="config.speech.whisperAPI.apiKey"
            placeholder="sk-..."
            style="width: 400px"
          />
          <template #extra>
            OpenAI API密钥，从环境变量OPENAI_API_KEY读取
          </template>
        </a-form-item>

        <a-form-item label="API 地址">
          <a-input
            v-model:value="config.speech.whisperAPI.baseURL"
            placeholder="https://api.openai.com/v1"
            style="width: 400px"
          />
          <template #extra> 可以使用代理或第三方兼容服务 </template>
        </a-form-item>

        <a-form-item label="模型">
          <a-select
            v-model:value="config.speech.whisperAPI.model"
            style="width: 200px"
          >
            <a-select-option value="whisper-1"> whisper-1 </a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="语言">
          <a-select
            v-model:value="config.speech.whisperAPI.language"
            style="width: 200px"
          >
            <a-select-option value="zh"> 中文 </a-select-option>
            <a-select-option value="en"> 英语 </a-select-option>
            <a-select-option value="ja"> 日语 </a-select-option>
            <a-select-option value="ko"> 韩语 </a-select-option>
            <a-select-option value=""> 自动检测 </a-select-option>
          </a-select>
          <template #extra> 指定语言可以提高准确度，留空则自动检测 </template>
        </a-form-item>

        <a-form-item label="超时时间">
          <a-input-number
            v-model:value="config.speech.whisperAPI.timeout"
            :min="10000"
            :max="300000"
            :step="10000"
            :formatter="(value) => `${value / 1000} 秒`"
            :parser="(value) => parseInt(value) * 1000"
            style="width: 200px"
          />
        </a-form-item>
      </a-form>
    </a-card>

    <!-- Whisper Local 配置 -->
    <a-card
      v-if="config.speech.defaultEngine === 'whisper-local'"
      title="Whisper Local 配置"
      style="margin-bottom: 16px"
    >
      <a-alert
        message="本地Whisper服务"
        description="需要先启动本地Whisper服务: docker-compose up -d whisper-service"
        type="info"
        show-icon
        style="margin-bottom: 16px"
      />

      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
        <a-form-item label="服务器地址">
          <a-input
            v-model:value="config.speech.whisperLocal.serverUrl"
            placeholder="http://localhost:8002"
            style="width: 400px"
          />
          <template #extra> 本地Whisper服务的地址 </template>
        </a-form-item>

        <a-form-item label="模型大小">
          <a-select
            v-model:value="config.speech.whisperLocal.modelSize"
            style="width: 200px"
          >
            <a-select-option value="tiny">
              Tiny（最快，准确度低）
            </a-select-option>
            <a-select-option value="base"> Base（推荐） </a-select-option>
            <a-select-option value="small">
              Small（较慢，准确度高）
            </a-select-option>
            <a-select-option value="medium">
              Medium（慢，准确度很高）
            </a-select-option>
            <a-select-option value="large">
              Large（最慢，准确度最高）
            </a-select-option>
          </a-select>
          <template #extra> 模型越大，准确度越高，但速度越慢 </template>
        </a-form-item>

        <a-form-item label="计算设备">
          <a-select
            v-model:value="config.speech.whisperLocal.device"
            style="width: 200px"
          >
            <a-select-option value="auto"> 自动选择 </a-select-option>
            <a-select-option value="cpu"> CPU </a-select-option>
            <a-select-option value="cuda"> CUDA（NVIDIA GPU） </a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="超时时间">
          <a-input-number
            v-model:value="config.speech.whisperLocal.timeout"
            :min="30000"
            :max="600000"
            :step="30000"
            :formatter="(value) => `${value / 1000} 秒`"
            :parser="(value) => parseInt(value) * 1000"
            style="width: 200px"
          />
        </a-form-item>

        <a-form-item label="服务状态">
          <a-space>
            <a-button
              :loading="testingWhisperLocal"
              @click="handleTestWhisperLocal"
            >
              <ExperimentOutlined />
              测试连接
            </a-button>
            <a-tag v-if="whisperLocalStatus === 'online'" color="green">
              ✓ 在线
            </a-tag>
            <a-tag v-else-if="whisperLocalStatus === 'offline'" color="red">
              ✗ 离线
            </a-tag>
            <a-tag v-else color="default"> 未测试 </a-tag>
          </a-space>
        </a-form-item>
      </a-form>
    </a-card>

    <!-- 音频处理配置 -->
    <a-card title="音频处理" style="margin-bottom: 16px">
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
        <a-form-item label="最大文件大小">
          <a-input-number
            v-model:value="config.speech.audio.maxFileSize"
            :min="1048576"
            :max="104857600"
            :step="1048576"
            :formatter="(value) => `${(value / 1048576).toFixed(0)} MB`"
            :parser="(value) => parseInt(value) * 1048576"
            style="width: 200px"
          />
          <template #extra> Whisper API限制为25MB </template>
        </a-form-item>

        <a-form-item label="最大时长">
          <a-input-number
            v-model:value="config.speech.audio.maxDuration"
            :min="60"
            :max="7200"
            :step="60"
            :formatter="(value) => `${(value / 60).toFixed(0)} 分钟`"
            :parser="(value) => parseInt(value) * 60"
            style="width: 200px"
          />
        </a-form-item>

        <a-form-item label="分段时长">
          <a-input-number
            v-model:value="config.speech.audio.segmentDuration"
            :min="60"
            :max="600"
            :step="60"
            :formatter="(value) => `${(value / 60).toFixed(0)} 分钟`"
            :parser="(value) => parseInt(value) * 60"
            style="width: 200px"
          />
          <template #extra> 超过此时长的音频将自动分段处理 </template>
        </a-form-item>
      </a-form>
    </a-card>

    <!-- 知识库集成 -->
    <a-card title="知识库集成" style="margin-bottom: 16px">
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
        <a-form-item label="自动保存">
          <a-switch
            v-model:checked="
              config.speech.knowledgeIntegration.autoSaveToKnowledge
            "
            checked-children="启用"
            un-checked-children="禁用"
          />
          <template #extra> 识别结果自动保存到知识库 </template>
        </a-form-item>

        <a-form-item label="自动索引">
          <a-switch
            v-model:checked="config.speech.knowledgeIntegration.autoAddToIndex"
            checked-children="启用"
            un-checked-children="禁用"
          />
          <template #extra> 自动添加到RAG向量索引，支持语义搜索 </template>
        </a-form-item>

        <a-form-item label="默认类型">
          <a-select
            v-model:value="config.speech.knowledgeIntegration.defaultType"
            style="width: 200px"
          >
            <a-select-option value="note"> 笔记 </a-select-option>
            <a-select-option value="meeting"> 会议记录 </a-select-option>
            <a-select-option value="memo"> 备忘录 </a-select-option>
            <a-select-option value="transcript"> 转录文本 </a-select-option>
          </a-select>
        </a-form-item>
      </a-form>
    </a-card>

    <!-- 存储配置 -->
    <a-card title="存储配置" style="margin-bottom: 16px">
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
        <a-form-item label="保存路径">
          <a-input
            v-model:value="config.speech.storage.savePath"
            placeholder="音频文件保存路径"
            style="width: 400px"
          />
          <template #extra>
            <a-button size="small" @click="handleSelectSavePath">
              <FolderOpenOutlined />
              选择目录
            </a-button>
          </template>
        </a-form-item>

        <a-form-item label="保留原始文件">
          <a-switch
            v-model:checked="config.speech.storage.keepOriginal"
            checked-children="是"
            un-checked-children="否"
          />
        </a-form-item>

        <a-form-item label="自动清理">
          <a-switch
            v-model:checked="config.speech.storage.autoCleanup"
            checked-children="启用"
            un-checked-children="禁用"
          />
          <template #extra> 自动清理临时文件 </template>
        </a-form-item>

        <a-form-item v-if="config.speech.storage.autoCleanup" label="清理周期">
          <a-input-number
            v-model:value="config.speech.storage.cleanupAfterDays"
            :min="1"
            :max="365"
            addon-after="天"
            style="width: 200px"
          />
        </a-form-item>
      </a-form>
    </a-card>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";
import { ref } from "vue";
import { message } from "ant-design-vue";
import { ExperimentOutlined, FolderOpenOutlined } from "@ant-design/icons-vue";

const config = defineModel("config", { type: Object, required: true });

const testingWhisperLocal = ref(false);
const whisperLocalStatus = ref(null);

const handleTestWhisperLocal = async () => {
  testingWhisperLocal.value = true;
  whisperLocalStatus.value = null;

  try {
    const serverUrl = config.value.speech.whisperLocal.serverUrl;
    if (!serverUrl) {
      throw new Error("请先输入Whisper服务器地址");
    }

    const response = await fetch(`${serverUrl}/health`, {
      method: "GET",
      timeout: 5000,
    });

    if (response.ok) {
      whisperLocalStatus.value = "online";
      message.success("Whisper服务连接成功！");
    } else {
      whisperLocalStatus.value = "offline";
      message.error("Whisper服务响应异常");
    }
  } catch (error) {
    logger.error("测试Whisper连接失败:", error);
    whisperLocalStatus.value = "offline";
    message.error("Whisper服务连接失败：" + error.message);
  } finally {
    testingWhisperLocal.value = false;
  }
};

const handleSelectSavePath = async () => {
  try {
    const current = config.value.speech.storage.savePath;
    const selectedPath = await window.electronAPI.dialog.selectFolder({
      title: "选择文件夹",
      defaultPath: current || undefined,
      buttonLabel: "选择",
    });

    if (selectedPath) {
      config.value.speech.storage.savePath = selectedPath;
      message.success("文件夹已选择：" + selectedPath);
    }
  } catch (error) {
    logger.error("选择文件夹失败:", error);
    message.error("选择文件夹失败：" + error.message);
  }
};
</script>
