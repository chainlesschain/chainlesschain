# Ollama Android 调用指南

**问题**: Android 应用无法调用 PC 端的 Ollama 服务
**原因**: 默认配置使用 `localhost`，Android 设备无法访问

---

## 🔍 问题诊断

### Ollama 默认配置

```kotlin
// OllamaConfig.kt:28
url: String = "http://localhost:11434"  // ❌ 错误！Android 无法访问
```

**为什么不行**:

- `localhost` 或 `127.0.0.1` 在 Android 上指向手机自己
- PC 的 Ollama 服务运行在另一台设备上
- 需要使用局域网 IP 地址

---

## ✅ 解决方案

### 步骤 1: 获取 PC 的 IP 地址

**Windows PowerShell**:

```powershell
ipconfig | findstr IPv4
```

**输出示例**:

```
IPv4 地址 . . . . . . . . . . : 192.168.1.100
```

记录这个 IP 地址（例如: `192.168.1.100`）

---

### 步骤 2: 确保 PC 的 Ollama 正在运行

```powershell
# 测试 Ollama 是否运行
curl http://localhost:11434/api/tags

# 应该返回模型列表，例如:
# {"models":[{"name":"qwen2.5:latest","modified_at":"..."}]}
```

如果报错，请先启动 Ollama:

```powershell
ollama serve
```

---

### 步骤 3: 测试 Android 设备能否访问 PC

**从 Android 设备测试连接**:

```bash
# 替换 192.168.1.100 为您的 PC IP
adb shell curl http://192.168.1.100:11434/api/tags
```

**可能的错误**:

1. **Connection refused** (连接被拒绝)
   - 原因: Ollama 默认只监听 localhost
   - 解决: 设置 Ollama 监听所有接口

2. **No route to host** (无法路由)
   - 原因: 防火墙阻止
   - 解决: 开放 11434 端口

---

### 步骤 4: 配置 Ollama 允许远程访问

**方法 1: 临时设置环境变量**

```powershell
# Windows PowerShell
$env:OLLAMA_HOST = "0.0.0.0:11434"
ollama serve
```

**方法 2: 永久设置 (Windows)**

1. 打开"系统属性" → "环境变量"
2. 添加用户变量:
   - 变量名: `OLLAMA_HOST`
   - 变量值: `0.0.0.0:11434`
3. 重启 Ollama 服务

**方法 3: 修改 Ollama 服务配置** (推荐)

```powershell
# 编辑 Ollama 服务配置
# 位置: C:\Program Files\Ollama\ollama.exe
# 或通过服务管理器设置环境变量
```

---

### 步骤 5: 配置防火墙

**Windows 防火墙**:

```powershell
# 允许 Ollama 端口入站
New-NetFirewallRule -DisplayName "Ollama" -Direction Inbound -LocalPort 11434 -Protocol TCP -Action Allow
```

**或通过 GUI**:

1. 控制面板 → Windows Defender 防火墙
2. 高级设置 → 入站规则 → 新建规则
3. 端口 → TCP → 特定本地端口 → 11434
4. 允许连接

---

### 步骤 6: 在 Android 应用中配置正确的 URL

**在应用中设置**:

1. 打开应用
2. 点击"LLM设置"
3. 选择 "Ollama"
4. 修改 Base URL:
   ```
   ❌ http://localhost:11434
   ✅ http://192.168.1.100:11434  (替换为您的 PC IP)
   ```
5. 模型名称: `qwen2.5:latest` (或其他已安装的模型)
6. 点击"保存"
7. 点击"测试连接"

**预期结果**:

- ✅ 成功: 显示绿色卡片 "连接成功"
- ❌ 失败: 显示红色卡片及错误原因

---

## 🧪 完整测试步骤

### 1. 在 PC 上测试 Ollama

```powershell
# 检查 Ollama 状态
curl http://localhost:11434/api/tags

# 测试生成
curl http://localhost:11434/api/generate -d '{
  "model": "qwen2.5:latest",
  "prompt": "你好",
  "stream": false
}'
```

### 2. 在 PC 上测试远程访问

```powershell
# 替换为您的 PC IP
curl http://192.168.1.100:11434/api/tags
```

### 3. 从 Android 设备测试

```bash
# 通过 ADB
adb shell curl http://192.168.1.100:11434/api/tags

# 或在 Android 终端 App 中
curl http://192.168.1.100:11434/api/tags
```

### 4. 在应用中测试

1. 配置正确的 URL
2. 测试连接
3. 创建新对话
4. 选择 Ollama 模型
5. 发送消息: "你好"
6. 等待响应

---

## 🚨 常见问题

### 问题 1: "Connection refused"

**原因**: Ollama 只监听 localhost

**解决**:

```powershell
$env:OLLAMA_HOST = "0.0.0.0:11434"
ollama serve
```

---

### 问题 2: "No route to host"

**原因**: 防火墙阻止

**解决**:

```powershell
# 检查防火墙规则
Get-NetFirewallRule | Where-Object {$_.DisplayName -like "*Ollama*"}

# 添加规则
New-NetFirewallRule -DisplayName "Ollama" -Direction Inbound -LocalPort 11434 -Protocol TCP -Action Allow
```

---

### 问题 3: "Connection timeout"

**原因**:

- PC 和手机不在同一局域网
- VPN 干扰
- 路由器隔离设置

**解决**:

1. 确保 PC 和手机连接到同一个 WiFi
2. 关闭 VPN
3. 检查路由器的 AP 隔离设置

---

### 问题 4: 模型未安装

**错误**: "model not found"

**解决**:

```powershell
# 列出已安装的模型
ollama list

# 安装模型
ollama pull qwen2.5:latest
ollama pull llama3:latest
ollama pull gemma2:latest
```

---

## 📱 移动应用最佳配置

### 推荐的 Ollama 模型（考虑网络延迟）

**快速响应**（适合移动端）:

- `qwen2.5:latest` (7B) - 平衡性能和速度
- `llama3:8b` - Meta 开源，响应快
- `gemma2:9b` - Google 开源，效率高

**避免使用**:

- `qwen2.5:72b` - 太大，响应慢
- `llama3:70b` - 网络延迟高

### 优化建议

1. **使用量化模型**:

   ```bash
   ollama pull qwen2.5:7b-q4_0  # 4-bit 量化
   ```

2. **预加载模型**（减少首次响应时间）:

   ```bash
   ollama run qwen2.5:latest ""
   ```

3. **调整超时设置**:
   - 应用默认超时: 30秒
   - 移动网络建议: 60秒

---

## 🔧 高级配置

### 使用 Cloudflare Tunnel (免费)

如果 PC 和手机不在同一网络:

1. **安装 Cloudflare Tunnel**:

   ```powershell
   # 下载 cloudflared
   # https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/
   ```

2. **创建隧道**:

   ```powershell
   cloudflared tunnel --url http://localhost:11434
   ```

3. **获得公网 URL**:

   ```
   https://xxxx.trycloudflare.com
   ```

4. **在应用中使用**:
   ```
   URL: https://xxxx.trycloudflare.com
   ```

**注意**: Cloudflare 免费隧道 URL 会定期更改。

---

### 使用 Tailscale (推荐用于远程访问)

1. **在 PC 和手机上安装 Tailscale**
2. **登录同一账号**
3. **PC 获得固定 IP**: `100.x.x.x`
4. **在应用中使用**:
   ```
   URL: http://100.x.x.x:11434
   ```

**优势**:

- 永久固定 IP
- 加密通信
- 跨网络访问

---

## ✅ 验证清单

测试完成后，请确认：

- [ ] PC Ollama 正在运行

  ```powershell
  curl http://localhost:11434/api/tags
  ```

- [ ] PC 防火墙允许 11434 端口

  ```powershell
  Get-NetFirewallRule | Where-Object {$_.DisplayName -like "*Ollama*"}
  ```

- [ ] Ollama 监听 0.0.0.0

  ```powershell
  $env:OLLAMA_HOST
  # 应显示: 0.0.0.0:11434
  ```

- [ ] Android 设备可以访问 PC

  ```bash
  adb shell ping -c 4 192.168.1.100
  ```

- [ ] Android 设备可以访问 Ollama

  ```bash
  adb shell curl http://192.168.1.100:11434/api/tags
  ```

- [ ] 应用中配置正确的 URL
  - ✅ `http://192.168.1.100:11434`
  - ❌ `http://localhost:11434`

- [ ] 测试连接成功
  - 在 LLM 设置中点击"测试连接"
  - 显示绿色成功消息

- [ ] 实际对话测试
  - 创建新对话
  - 选择 Ollama 模型
  - 发送消息并收到响应

---

## 📊 性能优化建议

### 局域网延迟测试

```bash
# 测试 PC 响应时间
adb shell ping -c 10 192.168.1.100

# 预期结果:
# rtt min/avg/max = 1/5/10 ms  (良好)
# rtt min/avg/max = 10/30/50 ms  (可接受)
# rtt min/avg/max = 100/200/300 ms  (较差)
```

### 推荐配置

**WiFi 5 (802.11ac) 或更高**:

- 延迟 < 10ms
- 适合所有模型

**WiFi 4 (802.11n)**:

- 延迟 10-30ms
- 推荐 7B 以下模型

**移动数据 + VPN**:

- 延迟 > 100ms
- 不推荐

---

## 🎯 快速命令参考

```bash
# 获取 PC IP
ipconfig | findstr IPv4

# 启动 Ollama (监听所有接口)
$env:OLLAMA_HOST = "0.0.0.0:11434"
ollama serve

# 测试连接
curl http://localhost:11434/api/tags

# 开放防火墙
New-NetFirewallRule -DisplayName "Ollama" -Direction Inbound -LocalPort 11434 -Protocol TCP -Action Allow

# 从 Android 测试
adb shell curl http://<PC_IP>:11434/api/tags

# 查看 Ollama 日志
ollama logs
```

---

**文档版本**: 2026-01-27
**适用版本**: ChainlessChain Android v0.26.2
**Ollama 版本**: 0.1.x+

**需要帮助？** 请提供以下信息：

1. PC IP 地址
2. `curl http://localhost:11434/api/tags` 输出
3. `adb shell curl http://<PC_IP>:11434/api/tags` 输出
4. 应用中显示的错误消息
