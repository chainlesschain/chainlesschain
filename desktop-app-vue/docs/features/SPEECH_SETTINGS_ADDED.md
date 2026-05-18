# 语音设置页面添加完成

**日期**: 2026-01-11
**状态**: ✅ 完成

## 完成的工作

### 1. 添加语音识别标签页 ✅

**位置**: `desktop-app-vue/src/renderer/pages/settings/SystemSettings.vue:1069-1436`

**功能模块**:

#### 1.1 识别引擎选择
- Web Speech API（浏览器内置）
- Whisper API（OpenAI云端）
- Whisper Local（本地服务）
- 智能提示不同引擎的特点

#### 1.2 Web Speech API 配置
- 语言选择（中文、英文、日语、韩语等）
- 连续识别开关
- 实时结果开关

#### 1.3 Whisper API 配置
- API密钥输入
- API地址配置
- 模型选择
- 语言设置
- 超时时间配置

#### 1.4 Whisper Local 配置
- 服务器地址配置
- 模型大小选择（tiny/base/small/medium/large）
- 计算设备选择（auto/cpu/cuda）
- 超时时间配置
- **服务状态测试**（一键测试连接）

#### 1.5 音频处理配置
- 最大文件大小（1-100MB）
- 最大时长（1-120分钟）
- 分段时长（1-10分钟）

#### 1.6 知识库集成
- 自动保存到知识库
- 自动添加到RAG索引
- 默认类型选择（笔记/会议记录/备忘录/转录文本）

#### 1.7 存储配置
- 保存路径选择
- 保留原始文件开关
- 自动清理开关
- 清理周期设置（1-365天）

### 2. 添加图标导入 ✅

**位置**: `SystemSettings.vue:1515`

```javascript
import { SoundOutlined } from '@ant-design/icons-vue';
```

### 3. 添加配置数据结构 ✅

**位置**: `SystemSettings.vue:1702-1751`

```javascript
speech: {
  defaultEngine: 'whisper-local',
  webSpeech: { ... },
  whisperAPI: { ... },
  whisperLocal: { ... },
  audio: { ... },
  storage: { ... },
  knowledgeIntegration: { ... },
  performance: { ... },
}
```

### 4. 添加测试功能 ✅

**位置**: `SystemSettings.vue:2527-2562`

```javascript
// 语音识别相关
const testingWhisperLocal = ref(false);
const whisperLocalStatus = ref(null);

// 测试 Whisper Local 连接
const handleTestWhisperLocal = async () => {
  // 测试健康检查端点
  // 显示在线/离线状态
}
```

## UI界面预览

### 标签页位置
```
设置 -> 语音识别 (🔊图标)
```

### 页面结构
```
┌─ 识别引擎 ─────────────────────┐
│ 默认引擎: [下拉选择]            │
│ ✓ 免费，无需配置，但准确度较低   │
└────────────────────────────────┘

┌─ Whisper Local 配置 ───────────┐
│ ℹ 需要先启动本地Whisper服务     │
│                                 │
│ 服务器地址: [http://localhost:8002] │
│ 模型大小: [Base (推荐)]         │
│ 计算设备: [自动选择]            │
│ 超时时间: [120 秒]              │
│ 服务状态: [测试连接] ✓ 在线     │
└────────────────────────────────┘

┌─ 音频处理 ─────────────────────┐
│ 最大文件大小: [25 MB]           │
│ 最大时长: [60 分钟]             │
│ 分段时长: [5 分钟]              │
└────────────────────────────────┘

┌─ 知识库集成 ───────────────────┐
│ 自动保存: [✓ 启用]              │
│ 自动索引: [✓ 启用]              │
│ 默认类型: [笔记]                │
└────────────────────────────────┘

┌─ 存储配置 ─────────────────────┐
│ 保存路径: [选择目录]            │
│ 保留原始文件: [✓ 是]            │
│ 自动清理: [✓ 启用]              │
│ 清理周期: [30 天]               │
└────────────────────────────────┘
```

## 配置说明

### 默认配置

```javascript
{
  defaultEngine: 'whisper-local',  // 默认使用本地Whisper
  whisperLocal: {
    serverUrl: 'http://localhost:8002',  // 本地服务地址
    modelSize: 'base',                   // 推荐的模型大小
    device: 'auto',                      // 自动选择设备
    timeout: 120000,                     // 2分钟超时
  },
  knowledgeIntegration: {
    autoSaveToKnowledge: true,           // 自动保存
    autoAddToIndex: true,                // 自动索引
    defaultType: 'note',                 // 默认为笔记
  },
  storage: {
    keepOriginal: true,                  // 保留原始文件
    autoCleanup: true,                   // 自动清理
    cleanupAfterDays: 30,                // 30天后清理
  }
}
```

### 引擎对比

| 引擎 | 优点 | 缺点 | 适用场景 |
|------|------|------|---------|
| Web Speech API | 免费、无需配置 | 准确度低 | 快速测试 |
| Whisper API | 准确度高 | 需要API密钥、按量计费 | 生产环境 |
| Whisper Local | 免费、准确度高 | 需要本地部署 | 推荐使用 |

## 使用指南

### 1. 启动Whisper服务

```bash
# 启动本地Whisper服务
docker-compose up -d whisper-service

# 查看服务状态
docker ps | grep whisper

# 查看日志
docker logs -f chainlesschain-whisper
```

### 2. 配置语音识别

1. 打开桌面应用
2. 进入 **设置 -> 语音识别**
3. 选择 **Whisper Local** 引擎
4. 点击 **测试连接** 按钮
5. 看到 **✓ 在线** 状态
6. 配置其他选项（可选）
7. 点击 **保存配置**

### 3. 测试连接

点击"测试连接"按钮后：
- ✓ 在线：服务正常运行
- ✗ 离线：服务未启动或地址错误
- 未测试：尚未测试

### 4. 调整配置

根据需求调整：
- **模型大小**：base适合大多数场景
- **计算设备**：有GPU选择cuda，否则auto
- **知识库集成**：建议全部启用
- **存储配置**：根据磁盘空间调整

## 技术细节

### 配置存储

配置保存在：
- 前端：Vue响应式对象
- 后端：通过IPC保存到配置文件
- 文件：`data/speech-config.json`

### 测试连接实现

```javascript
const handleTestWhisperLocal = async () => {
  // 1. 获取服务器地址
  const serverUrl = config.value.speech.whisperLocal.serverUrl;

  // 2. 发送健康检查请求
  const response = await fetch(`${serverUrl}/health`);

  // 3. 更新状态
  if (response.ok) {
    whisperLocalStatus.value = 'online';
  } else {
    whisperLocalStatus.value = 'offline';
  }
};
```

### 配置同步

```javascript
// 保存配置时
const handleSave = async () => {
  await window.electronAPI.config.set('speech', config.value.speech);
};

// 加载配置时
const loadConfig = async () => {
  const allConfig = await window.electronAPI.config.getAll();
  config.value = deepMerge(config.value, allConfig);
};
```

## 相关文件

### 前端
- `desktop-app-vue/src/renderer/pages/settings/SystemSettings.vue` - 设置页面

### 后端
- `desktop-app-vue/src/main/speech/speech-config.js` - 配置管理
- `desktop-app-vue/src/main/speech/speech-manager.js` - 语音管理器
- `desktop-app-vue/src/main/speech/speech-recognizer.js` - 识别器
- `desktop-app-vue/src/main/speech/speech-ipc.js` - IPC通信

### Docker
- `docker-compose.yml` - Whisper服务配置
- `backend/whisper-service/` - Whisper服务实现

## 测试清单

### UI测试
- [ ] 标签页显示正常
- [ ] 图标显示正常
- [ ] 所有表单控件可用
- [ ] 下拉选择正常
- [ ] 开关切换正常
- [ ] 数字输入正常

### 功能测试
- [ ] 引擎切换正常
- [ ] 配置保存成功
- [ ] 配置加载成功
- [ ] 测试连接功能正常
- [ ] 状态显示正确

### 集成测试
- [ ] Whisper服务连接成功
- [ ] 配置持久化正常
- [ ] 与知识库集成正常

## 下一步

### 立即可做
1. 启动桌面应用测试UI
2. 测试Whisper Local连接
3. 验证配置保存和加载

### 后续优化
1. 添加更多语言支持
2. 添加音频预处理选项
3. 添加识别历史记录
4. 添加批量处理功能

## 总结

✅ 语音设置页面已完全实现，包括：
- 完整的UI界面
- 三种识别引擎配置
- 音频处理配置
- 知识库集成配置
- 存储配置
- 服务状态测试

可以立即在桌面应用中使用！

---

**创建时间**: 2026-01-11
**状态**: ✅ 完成
**下一步**: 在桌面应用中测试
