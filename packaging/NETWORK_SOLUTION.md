# 网络连接问题解决方案

## 🔴 问题诊断

打包过程失败，错误信息：
```
getaddrinfo ENOTFOUND github.com
```

这表明系统无法解析 `github.com` 的域名。

---

## 🔧 解决方案

### 方案 1: 配置 DNS (最简单)

修改 DNS 服务器为公共 DNS：

**Windows:**
1. 打开"控制面板" > "网络和Internet" > "网络连接"
2. 右键点击当前网络连接 > "属性"
3. 选择 "Internet 协议版本 4 (TCP/IPv4)" > "属性"
4. 选择"使用下面的 DNS 服务器地址"：
   - 首选 DNS: `8.8.8.8` (Google)
   - 备用 DNS: `1.1.1.1` (Cloudflare)
5. 或者使用国内 DNS:
   - 首选 DNS: `223.5.5.5` (阿里云)
   - 备用 DNS: `119.29.29.29` (腾讯)
6. 确定后刷新 DNS 缓存：
   ```cmd
   ipconfig /flushdns
   ```

**测试连接:**
```bash
ping github.com
nslookup github.com
```

---

### 方案 2: 配置代理 (如果使用 VPN/代理)

如果使用代理，需要配置 npm 和 Electron 的代理：

```bash
# 设置 npm 代理
npm config set proxy http://127.0.0.1:7890
npm config set https-proxy http://127.0.0.1:7890

# 设置 Electron 镜像 (使用淘宝镜像)
npm config set electron_mirror https://npm.taobao.org/mirrors/electron/
```

或者设置环境变量：
```bash
# Git Bash
export HTTP_PROXY=http://127.0.0.1:7890
export HTTPS_PROXY=http://127.0.0.1:7890
export ELECTRON_MIRROR=https://npm.taobao.org/mirrors/electron/

# PowerShell
$env:HTTP_PROXY="http://127.0.0.1:7890"
$env:HTTPS_PROXY="http://127.0.0.1:7890"
$env:ELECTRON_MIRROR="https://npm.taobao.org/mirrors/electron/"
```

**注意**: 将 `127.0.0.1:7890` 替换为你实际的代理地址和端口。

---

### 方案 3: 使用国内镜像源

配置所有 Node.js 相关工具使用国内镜像：

```bash
# 使用淘宝镜像
npm config set registry https://registry.npmmirror.com
npm config set electron_mirror https://npmmirror.com/mirrors/electron/
npm config set electron_builder_binaries_mirror https://npmmirror.com/mirrors/electron-builder-binaries/
npm config set sass_binary_site https://npmmirror.com/mirrors/node-sass

# 重新安装依赖
cd D:/code/chainlesschain/desktop-app-vue
rm -rf node_modules package-lock.json
npm install
```

---

### 方案 4: 修改 Hosts 文件 (临时)

如果 DNS 解析有问题，可以手动添加 GitHub 的 IP 地址：

**编辑 hosts 文件:**
```
C:\Windows\System32\drivers\etc\hosts
```

添加以下内容：
```
140.82.114.4 github.com
140.82.114.4 raw.githubusercontent.com
185.199.108.133 raw.githubusercontent.com
```

**获取最新 IP:**
```bash
nslookup github.com 8.8.8.8
```

---

### 方案 5: 离线打包 (终极方案)

如果网络问题无法解决，使用离线打包：

**1. 下载 Electron 预构建包:**

访问: https://npmmirror.com/mirrors/electron/

下载对应版本 (查看 package.json 中的 electron 版本):
- `electron-v39.2.6-win32-x64.zip`

解压到: `%LOCALAPPDATA%\electron\Cache\`

**2. 使用 electron-builder 替代:**

```bash
cd D:/code/chainlesschain/desktop-app-vue

# 安装 electron-builder
npm install --save-dev electron-builder

# 添加到 package.json
{
  "build": {
    "appId": "com.chainlesschain.app",
    "productName": "ChainlessChain",
    "win": {
      "target": "nsis",
      "icon": "assets/icon.ico"
    }
  }
}

# 打包
npx electron-builder --win --dir
```

---

## ✅ 验证步骤

配置完成后，依次验证：

### 1. DNS 解析
```bash
nslookup github.com
```
应该返回有效的 IP 地址。

### 2. 网络连接
```bash
ping github.com
curl -I https://github.com
```
应该能正常连接。

### 3. NPM 连接
```bash
npm config get registry
npm ping
```
应该返回成功。

### 4. 重新打包
```bash
cd D:/code/chainlesschain/desktop-app-vue
export SKIP_BACKEND_CHECK=true
npm run make:win
```

---

## 🚀 推荐流程

**优先级顺序:**

1. ✅ **方案 1: 配置 DNS** (最简单，解决根本问题)
2. ✅ **方案 3: 使用国内镜像** (如果在国内)
3. ✅ **方案 2: 配置代理** (如果使用 VPN)
4. ⚠️ **方案 4: 修改 Hosts** (临时方案)
5. 🔧 **方案 5: 离线打包** (最后手段)

---

## 📊 常见错误对照表

| 错误信息 | 原因 | 解决方案 |
|---------|------|----------|
| `ENOTFOUND github.com` | DNS 无法解析 | 方案 1 或 4 |
| `ETIMEDOUT` | 连接超时 | 方案 2 (代理) |
| `ECONNREFUSED` | 连接被拒绝 | 检查防火墙 |
| `certificate` 错误 | SSL 证书问题 | 配置代理或关闭 SSL 验证 |

---

## 💡 后续建议

1. **配置完成后**，重新运行：
   ```bash
   cd D:/code/chainlesschain/desktop-app-vue
   export SKIP_BACKEND_CHECK=true
   npm run make:win
   ```

2. **如果仍然失败**，查看详细日志：
   ```bash
   npm run make:win --verbose
   ```

3. **联系网络管理员**确认是否有防火墙/代理限制

---

**祝顺利解决网络问题！如果还有疑问，请查看项目 GitHub Issues。**
