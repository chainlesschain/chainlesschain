# 云LLM服务商全面对比

ChainlessChain 支持 **14个云LLM服务商**，覆盖国内外主流AI平台。

---

## 📊 完整服务商列表

| # | 服务商 | 提供商标识 | 代表模型 | 价格/1K tokens | 免费额度 | 推荐指数 |
|---|--------|-----------|---------|---------------|---------|---------|
| 1 | **火山引擎（豆包）** | `volcengine` | doubao-lite | **免费** | 无限 | ⭐⭐⭐⭐⭐ |
| 2 | **腾讯混元** | `hunyuan` | hunyuan-lite | **免费** | 无限 | ⭐⭐⭐⭐⭐ |
| 3 | **硅基流动** | `openai` | Qwen2-7B | ￥0.0007 | 部分 | ⭐⭐⭐⭐⭐ |
| 4 | **DeepSeek** | `deepseek` | deepseek-chat | ￥0.001 | 部分 | ⭐⭐⭐⭐⭐ |
| 5 | **阿里云通义千问** | `dashscope` | qwen-turbo | ￥0.008 | 100万/月 | ⭐⭐⭐⭐⭐ |
| 6 | **百度千帆** | `qianfan` | ERNIE-Bot-turbo | ￥0.012 | 有 | ⭐⭐⭐⭐ |
| 7 | **Moonshot AI** | `openai` | moonshot-v1-8k | ￥0.012 | 有 | ⭐⭐⭐⭐ |
| 8 | **零一万物** | `openai` | yi-large | ￥0.02 | 有 | ⭐⭐⭐⭐ |
| 9 | **MiniMax** | `minimax` | abab5.5-chat | ￥0.015 | 有 | ⭐⭐⭐ |
| 10 | **讯飞星火** | `spark` | spark-lite | ￥0.018 | 有 | ⭐⭐⭐ |
| 11 | **智谱AI** | `zhipu` | glm-4 | ￥0.05 | 有 | ⭐⭐⭐ |
| 12 | **OpenAI** | `openai` | gpt-3.5-turbo | ￥0.014 | 无 | ⭐⭐⭐ |
| 13 | **本地Ollama** | `ollama` | qwen2:7b | **￥0** | - | ⭐⭐⭐⭐ |
| 14 | **云GPU租用** | - | 自定义 | ￥1-3/时 | - | ⭐⭐⭐⭐ |

---

## 🏆 分类推荐

### 💰 最便宜方案（适合高频使用）

1. **火山引擎 doubao-lite** - 完全免费！
2. **腾讯混元 hunyuan-lite** - 完全免费！
3. **硅基流动 Qwen2-7B** - ￥0.0007/1K (极致性价比)
4. **DeepSeek** - ￥0.001/1K (代码能力强)

**月成本**: ￥0-10 (日均300次对话)

---

### 🎯 新手推荐（免费额度充足）

1. **阿里云通义千问** - 100万tokens/月免费
2. **火山引擎** - 完全免费
3. **腾讯混元** - 完全免费

**月成本**: ￥0 (日均100次对话在免费额度内)

---

### 🚀 性能优先（适合生产环境）

1. **阿里云 qwen-max** - 能力最强
2. **智谱AI glm-4** - 综合性能好
3. **OpenAI GPT-4-Turbo** - 国际标准

**月成本**: ￥30-100+ (取决于使用量)

---

### 🇨🇳 国产优选（数据合规）

1. **阿里云通义千问** - 阿里巴巴
2. **火山引擎** - 字节跳动
3. **百度千帆** - 百度
4. **腾讯混元** - 腾讯
5. **讯飞星火** - 科大讯飞
6. **智谱AI** - 智谱华章
7. **DeepSeek** - 深度求索

**特点**: 国内服务器、稳定快速、数据安全

---

## 📝 详细配置指南

### 1. 火山引擎（豆包）⭐⭐⭐⭐⭐

**官网**: https://console.volcengine.com/ark

**优势**:
- ✅ doubao-lite完全免费，无限制
- ✅ doubao-pro性价比极高 (￥0.0008/1K)
- ✅ 字节跳动出品，中文能力强
- ✅ 国内访问快速稳定

**配置**:
```bash
LLM_PROVIDER=volcengine
VOLCENGINE_API_KEY=your_ak:your_sk
VOLCENGINE_MODEL=doubao-lite  # 或 doubao-pro-4k
```

**获取Key**:
1. 注册火山引擎账号
2. 进入"方舟大模型平台"
3. 创建API Key (AK:SK格式)

**月成本估算**:
- 轻度: ￥0 (使用doubao-lite)
- 中度: ￥0-5 (使用doubao-pro)
- 重度: ￥5-30

---

### 2. 腾讯混元 ⭐⭐⭐⭐⭐

**官网**: https://cloud.tencent.com/product/hunyuan

**优势**:
- ✅ hunyuan-lite完全免费
- ✅ 腾讯出品，稳定可靠
- ✅ 支持长文本 (最高128K)
- ✅ 企业级服务

**配置**:
```bash
LLM_PROVIDER=hunyuan
HUNYUAN_API_KEY=your_api_key
HUNYUAN_MODEL=hunyuan-lite
```

**月成本**: ￥0-20

---

### 3. 硅基流动 ⭐⭐⭐⭐⭐

**官网**: https://siliconflow.cn/

**优势**:
- ✅ 价格最便宜 (￥0.0007/1K)
- ✅ OpenAI兼容API
- ✅ 支持多种开源模型
- ✅ 响应速度快

**配置**:
```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=your_siliconflow_key
OPENAI_BASE_URL=https://api.siliconflow.cn/v1
LLM_MODEL=Qwen/Qwen2-7B-Instruct
```

**可选模型**:
- `Qwen/Qwen2-7B-Instruct` - ￥0.0007/1K
- `deepseek-ai/DeepSeek-V2.5` - ￥0.0014/1K
- `Qwen/Qwen2.5-72B-Instruct` - ￥0.0042/1K

**月成本**: ￥2-20

---

### 4. DeepSeek ⭐⭐⭐⭐⭐

**官网**: https://platform.deepseek.com/

**优势**:
- ✅ 超便宜 (￥0.001/1K)
- ✅ 代码能力顶尖
- ✅ 国产顶级大模型
- ✅ API稳定

**配置**:
```bash
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=your_deepseek_key
DEEPSEEK_MODEL=deepseek-chat
```

**适用场景**:
- 代码生成
- 技术文档
- 编程助手

**月成本**: ￥3-15

---

### 5. 阿里云通义千问 ⭐⭐⭐⭐⭐

**官网**: https://dashscope.aliyun.com/

**优势**:
- ✅ 免费额度100万tokens/月
- ✅ 阿里巴巴出品，质量保证
- ✅ 模型选择丰富
- ✅ 企业级稳定性

**配置**:
```bash
LLM_PROVIDER=dashscope
DASHSCOPE_API_KEY=your_dashscope_key
DASHSCOPE_MODEL=qwen-turbo
```

**模型选择**:
- `qwen-turbo` - ￥0.008/1K (推荐)
- `qwen-plus` - ￥0.02/1K
- `qwen-max` - ￥0.12/1K (能力最强)

**月成本**: ￥0-50 (取决于是否超出免费额度)

---

### 6. 百度千帆（文心一言）⭐⭐⭐⭐

**官网**: https://cloud.baidu.com/product/wenxinworkshop

**优势**:
- ✅ 百度出品，国内稳定
- ✅ 中文能力强
- ✅ 有免费额度
- ✅ 企业认证用户额度更多

**配置**:
```bash
LLM_PROVIDER=qianfan
QIANFAN_API_KEY=access_key:secret_key
QIANFAN_MODEL=ERNIE-Bot-turbo
```

**获取Key**:
1. 注册百度智能云
2. 开通千帆大模型平台
3. 创建应用获取AK/SK

**月成本**: ￥10-50

---

### 7. Moonshot AI（Kimi）⭐⭐⭐⭐

**官网**: https://platform.moonshot.cn/

**优势**:
- ✅ 长文本支持好 (最高128K)
- ✅ 有免费额度
- ✅ 响应速度快
- ✅ 中文优化好

**配置**:
```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=your_moonshot_key
OPENAI_BASE_URL=https://api.moonshot.cn/v1
LLM_MODEL=moonshot-v1-8k
```

**月成本**: ￥10-30

---

### 8. 零一万物 ⭐⭐⭐⭐

**官网**: https://platform.lingyiwanwu.com/

**优势**:
- ✅ 李开复创办
- ✅ 速度快
- ✅ 有免费额度
- ✅ API稳定

**配置**:
```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=your_lingyi_key
OPENAI_BASE_URL=https://api.lingyiwanwu.com/v1
LLM_MODEL=yi-large
```

**月成本**: ￥15-40

---

### 9-12. 其他服务商

**MiniMax** (￥0.015/1K)
```bash
LLM_PROVIDER=minimax
MINIMAX_API_KEY=your_key
MINIMAX_MODEL=abab5.5-chat
```

**讯飞星火** (￥0.018/1K)
```bash
LLM_PROVIDER=spark
SPARK_API_KEY=your_key
SPARK_MODEL=spark-lite
```

**智谱AI** (￥0.05/1K)
```bash
LLM_PROVIDER=zhipu
ZHIPU_API_KEY=your_key
ZHIPU_MODEL=glm-4
```

**OpenAI** (￥0.014/1K)
```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=your_key
LLM_MODEL=gpt-3.5-turbo
```

---

## 💡 选择建议

### 个人学习/测试
**推荐**: 火山引擎 doubao-lite 或 腾讯混元 hunyuan-lite
**原因**: 完全免费，无限制
**月成本**: ￥0

---

### 小型项目/轻度使用
**推荐**: 硅基流动 或 阿里云 qwen-turbo
**原因**: 免费额度充足，超出后也便宜
**月成本**: ￥0-10

---

### 中型项目/中度使用
**推荐**: DeepSeek 或 硅基流动
**原因**: 性价比极高，质量稳定
**月成本**: ￥5-30

---

### 大型项目/重度使用
**推荐**: 租用云GPU + Ollama
**原因**: 无调用限制，总成本更低
**月成本**: ￥100-300

---

### 企业级/生产环境
**推荐**: 阿里云 qwen-max 或 百度千帆
**原因**: 企业级SLA保障，稳定性高
**月成本**: ￥100-500+

---

## 🎯 成本优化技巧

1. **混合使用**: 日常用免费模型，关键任务用高级模型
2. **启用缓存**: 相同问题不重复调用（可节省50%+）
3. **控制Token**: 限制输出长度，优化Prompt
4. **选择合适模型**: 简单任务用lite，复杂任务用pro
5. **监控用量**: 设置预算告警，避免超支

---

## 📞 技术支持

如有问题，请访问：
- GitHub Issues: https://github.com/chainlesschain/chainlesschain/issues
- 文档: ./README-云端部署指南.md
- 成本计算器: `python tools/cost-calculator.py`

---

**最后更新**: 2024年12月
**总计支持**: 14个服务商
**最低成本**: ￥0/月
