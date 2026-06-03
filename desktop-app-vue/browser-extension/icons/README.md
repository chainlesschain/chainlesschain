# 扩展图标

浏览器扩展需要以下尺寸的图标：

- `icon16.png` - 16x16 像素 (工具栏图标)
- `icon48.png` - 48x48 像素 (扩展管理页面)
- `icon128.png` - 128x128 像素 (Chrome Web Store)

## 临时方案

在正式设计图标之前，可以使用以下方法创建临时图标：

### 方法 1: 使用在线工具

访问 https://www.favicon-generator.org/ 上传一张图片，自动生成各种尺寸。

### 方法 2: 使用 ImageMagick

```bash
# 安装 ImageMagick
# Windows: choco install imagemagick
# macOS: brew install imagemagick

# 从源图片生成各种尺寸
convert source.png -resize 16x16 icon16.png
convert source.png -resize 48x48 icon48.png
convert source.png -resize 128x128 icon128.png
```

### 方法 3: 使用 ChainlessChain Logo

如果项目有 logo，可以从中提取并调整尺寸。

## 设计建议

- 使用简洁的图标设计
- 确保在小尺寸下清晰可辨
- 使用品牌颜色 (例如 #1890ff)
- 添加透明背景
- 考虑深色/浅色主题适配

## 占位图标

在开发阶段，可以使用纯色背景 + 文字的简单图标：

- 背景: #1890ff (ChainlessChain 品牌色)
- 文字: "CC" (白色)
- 字体: 粗体 sans-serif
