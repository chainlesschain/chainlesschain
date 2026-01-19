# iOS 应用图标和启动屏幕资源指南

本文档说明如何为 ChainlessChain iOS 应用创建和配置图标资源。

## 📁 资源目录结构

已创建的资源目录：

```
ChainlessChain/Resources/Assets.xcassets/
├── Contents.json                    # Asset Catalog 配置
├── AppIcon.appiconset/             # 应用图标集
│   └── Contents.json
├── LaunchIcon.imageset/            # 启动图标集
│   └── Contents.json
├── AccentColor.colorset/           # 主题色
│   └── Contents.json
└── README.md                       # 本文档
```

## 🎨 方式一：使用在线工具生成（推荐）

### 步骤 1：设计 1024x1024 主图标

使用任何设计工具（Figma、Sketch、Photoshop 等）创建一个 1024x1024 的图标：

**设计建议**：
- 简洁明了，在小尺寸下也能识别
- 使用品牌色（建议：蓝色渐变 #005491 → #00A8E8）
- 可以包含链条元素（体现 ChainlessChain 概念）
- 不要添加圆角（iOS 系统会自动添加）
- 不要使用透明背景

### 步骤 2：使用在线工具生成所有尺寸

推荐工具：

1. **AppIconMaker** (https://appiconmaker.co/)
   - 上传 1024x1024 图标
   - 选择 iOS
   - 下载生成的所有尺寸

2. **MakeAppIcon** (https://makeappicon.com/)
   - 上传图标
   - 选择 iOS
   - 下载 ZIP 文件

3. **AppIcon.co** (https://appicon.co/)
   - 免费在线工具
   - 支持所有 iOS 尺寸

### 步骤 3：替换生成的图标

1. 解压下载的图标包
2. 将所有 PNG 文件复制到 `AppIcon.appiconset/` 目录
3. 确保文件名与 `Contents.json` 中的定义匹配

## 🖼️ 方式二：使用 Python 脚本生成占位图标

如果你只是想快速测试，可以使用提供的 Python 脚本生成占位图标。

### 安装依赖

```bash
pip3 install Pillow
```

### 运行脚本

```bash
cd /Users/mac/Documents/code2/chainlesschain/ios-app
python3 generate_app_icons.py
```

这将生成：
- 所有必需的应用图标尺寸（18 个）
- 启动屏幕图标（3 个尺寸）
- 简单的蓝色渐变 + "CC" 文字

**注意**：这些是占位图标，建议后续替换为专业设计的图标。

## 🎯 方式三：在 Xcode 中手动添加

### 步骤 1：准备图标文件

创建以下尺寸的 PNG 图标（无透明度）：

| 用途 | 尺寸 (px) | 文件名示例 |
|------|-----------|-----------|
| iPhone 通知 | 40x40, 60x60 | icon-20@2x.png, icon-20@3x.png |
| iPhone 设置 | 58x58, 87x87 | icon-29@2x.png, icon-29@3x.png |
| iPhone Spotlight | 80x80, 120x120 | icon-40@2x.png, icon-40@3x.png |
| iPhone 应用 | 120x120, 180x180 | icon-60@2x.png, icon-60@3x.png |
| iPad 通知 | 20x20, 40x40 | icon-20@1x.png, icon-20@2x.png |
| iPad 设置 | 29x29, 58x58 | icon-29@1x.png, icon-29@2x.png |
| iPad Spotlight | 40x40, 80x80 | icon-40@1x.png, icon-40@2x.png |
| iPad 应用 | 76x76, 152x152 | icon-76@1x.png, icon-76@2x.png |
| iPad Pro | 167x167 | icon-83.5@2x.png |
| App Store | 1024x1024 | icon-1024.png |

### 步骤 2：在 Xcode 中添加

1. 打开 Xcode 项目
2. 在 Navigator 中选择 `Assets.xcassets`
3. 选择 `AppIcon`
4. 将对应尺寸的图标拖入相应的槽位

## 🚀 启动屏幕图标

启动屏幕图标在应用启动时显示，需要 3 个尺寸：

| 尺寸 | 文件名 | 用途 |
|------|--------|------|
| 200x200 | LaunchIcon.png | @1x |
| 400x400 | LaunchIcon@2x.png | @2x |
| 600x600 | LaunchIcon@3x.png | @3x |

将这些文件放入 `LaunchIcon.imageset/` 目录。

## 🎨 主题色配置

已配置的主题色（AccentColor）：
- 浅色模式：`#005491` (RGB: 0, 84, 145)
- 深色模式：`#00A8E8` (RGB: 0, 168, 232)

可以在 Xcode 中修改：
1. 选择 `Assets.xcassets` → `AccentColor`
2. 在右侧面板中修改颜色值

## 📐 设计规范

### iOS 应用图标设计指南

1. **尺寸和格式**：
   - 使用 PNG 格式
   - 不要使用透明度
   - 不要添加圆角（系统自动添加）
   - 提供所有必需的尺寸

2. **视觉设计**：
   - 简洁明了
   - 在小尺寸下也能识别
   - 使用一致的品牌色
   - 避免过多细节

3. **品牌一致性**：
   - 与桌面版保持一致的视觉风格
   - 使用相同的配色方案
   - 体现 ChainlessChain 的核心概念

### ChainlessChain 设计建议

**概念元素**：
- 链条/链接（代表去中心化连接）
- 盾牌/锁（代表安全和隐私）
- 大脑/知识（代表知识管理）

**配色方案**：
- 主色：蓝色系（#005491 → #00A8E8）
- 辅助色：白色、浅灰
- 强调色：橙色（可选，用于重要操作）

## 🔧 在 Xcode 中验证

### 检查图标配置

1. 打开 Xcode 项目
2. 选择 Target → General
3. 查看 "App Icons and Launch Screen" 部分
4. 确认 "App Icons Source" 设置为 `AppIcon`

### 预览图标

1. 在 Xcode 中选择 `Assets.xcassets` → `AppIcon`
2. 右侧面板会显示所有尺寸的预览
3. 缺失的尺寸会显示警告

### 在模拟器中测试

1. 运行应用（Cmd+R）
2. 按 Home 键（Cmd+Shift+H）
3. 查看主屏幕上的应用图标
4. 测试启动屏幕显示

## 📱 测试清单

- [ ] 所有必需的图标尺寸都已提供
- [ ] 图标在主屏幕上显示正常
- [ ] 图标在设置中显示正常
- [ ] 图标在 Spotlight 搜索中显示正常
- [ ] 启动屏幕图标显示正常
- [ ] 图标在不同设备上显示一致（iPhone、iPad）
- [ ] 图标在浅色和深色模式下都清晰可见

## 🛠️ 故障排查

### 图标不显示

**原因**：
- 文件名不匹配
- 图标尺寸不正确
- 缓存问题

**解决方案**：
1. 检查 `Contents.json` 中的文件名
2. 验证图标尺寸
3. 清理构建（Product → Clean Build Folder）
4. 重置模拟器（Device → Erase All Content and Settings）

### 图标模糊

**原因**：
- 使用了错误的尺寸
- 图标质量不高

**解决方案**：
1. 确保使用正确的像素尺寸（不是点尺寸）
2. 使用高质量的源图像
3. 避免缩放，为每个尺寸单独导出

### 启动屏幕不显示图标

**原因**：
- Info.plist 配置错误
- 图标文件缺失

**解决方案**：
1. 检查 `Info.plist` 中的 `UILaunchScreen` 配置
2. 确认 `UIImageName` 设置为 `LaunchIcon`
3. 验证 `LaunchIcon.imageset` 中的文件存在

## 📚 参考资源

- [Apple Human Interface Guidelines - App Icons](https://developer.apple.com/design/human-interface-guidelines/app-icons)
- [iOS App Icon Sizes](https://developer.apple.com/design/human-interface-guidelines/app-icons#App-icon-sizes)
- [Asset Catalog Format Reference](https://developer.apple.com/library/archive/documentation/Xcode/Reference/xcode_ref-Asset_Catalog_Format/)

---

**版本信息**：
- 文档版本：v1.0
- 创建日期：2026-01-19
- 最后更新：2026-01-19
