# 第三方库

## Readability.js

Readability.js 是 Mozilla 开发的库，用于从网页中智能提取正文内容。

### 下载

由于许可证原因，Readability.js 需要手动下载。

#### 方法 1: CDN (推荐)

```bash
cd browser-extension/lib
curl -o readability.js https://cdn.jsdelivr.net/npm/@mozilla/readability@0.5.0/Readability.js
```

或者使用 PowerShell (Windows):

```powershell
cd browser-extension/lib
Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/@mozilla/readability@0.5.0/Readability.js" -OutFile "readability.js"
```

#### 方法 2: npm 安装后复制

```bash
npm install @mozilla/readability
cp node_modules/@mozilla/readability/Readability.js browser-extension/lib/
```

#### 方法 3: GitHub 手动下载

访问：https://github.com/mozilla/readability/blob/main/Readability.js

点击 "Raw" 按钮，保存为 `readability.js`。

### 验证

下载完成后，应该有文件：
```
browser-extension/lib/readability.js
```

文件大小约 70KB。

### 许可证

Readability.js 使用 Apache License 2.0。

### 相关链接

- GitHub: https://github.com/mozilla/readability
- npm: https://www.npmjs.com/package/@mozilla/readability
- 文档: https://github.com/mozilla/readability#usage
