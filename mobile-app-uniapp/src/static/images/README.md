# TabBar 图标说明

## 当前图标文件

### 已有完整图标
- ✅ home.png / home-active.png - 首页
- ✅ knowledge.png / knowledge-active.png - 知识
- ✅ mine.png / mine-active.png - 我的

### 临时占位图标（需要替换）
- ⚠️ project.png / project-active.png - 项目（当前使用knowledge图标作为占位）
- ⚠️ message.png / message-active.png - 消息（当前使用chat图标作为占位）

## 图标规格要求

### UniApp TabBar 图标规格
- **尺寸**: 81px × 81px（推荐）
- **格式**: PNG（推荐）或 JPG
- **背景**: 透明背景
- **颜色**:
  - 未选中状态：灰色 (#7A7E83)
  - 选中状态：品牌色 (#667eea)

### SVG图标（已提供）
已创建SVG格式的图标设计：
- project.svg / project-active.svg
- message.svg / message-active.svg

## 替换图标指南

### 方案1: 使用在线工具转换SVG到PNG
1. 访问 https://svgtopng.com/ 或 https://cloudconvert.com/
2. 上传对应的 .svg 文件
3. 设置尺寸为 81x81px
4. 下载生成的 .png 文件
5. 替换 static/images/ 目录下的对应文件

### 方案2: 使用设计工具
使用 Figma、Sketch 或 Adobe Illustrator：
1. 打开 SVG 文件
2. 调整画布大小为 81x81px
3. 导出为 PNG（2x 或 3x）
4. 保存到 static/images/ 目录

### 方案3: 使用命令行工具（推荐）
如果安装了 ImageMagick：

```bash
# 转换 project 图标
convert -background none -resize 81x81 project.svg project.png
convert -background none -resize 81x81 project-active.svg project-active.png

# 转换 message 图标
convert -background none -resize 81x81 message.svg message.png
convert -background none -resize 81x81 message-active.svg message-active.png
```

## 图标设计建议

### Project（项目）图标
- 建议使用：文件夹+加号、代码文件、项目图标
- 颜色：未选中 #7A7E83，选中 #667eea
- 风格：简洁、扁平化

### Message（消息）图标
- 建议使用：对话气泡、信封、消息图标
- 颜色：未选中 #7A7E83，选中 #667eea
- 风格：简洁、扁平化

## 图标资源推荐

免费图标库：
- [Feather Icons](https://feathericons.com/) - 简洁线性图标
- [Heroicons](https://heroicons.com/) - Tailwind官方图标
- [Iconify](https://iconify.design/) - 海量图标集合
- [Flaticon](https://www.flaticon.com/) - 扁平化图标

## 当前TabBar配置

pages.json 中的配置：
```json
{
  "tabBar": {
    "list": [
      {
        "pagePath": "pages/index/index",
        "iconPath": "static/images/home.png",
        "selectedIconPath": "static/images/home-active.png",
        "text": "首页"
      },
      {
        "pagePath": "pages/projects/list",
        "iconPath": "static/images/project.png",
        "selectedIconPath": "static/images/project-active.png",
        "text": "项目"
      },
      {
        "pagePath": "pages/messages/index",
        "iconPath": "static/images/message.png",
        "selectedIconPath": "static/images/message-active.png",
        "text": "消息"
      },
      {
        "pagePath": "pages/knowledge/list/list",
        "iconPath": "static/images/knowledge.png",
        "selectedIconPath": "static/images/knowledge-active.png",
        "text": "知识"
      },
      {
        "pagePath": "pages/mine/mine",
        "iconPath": "static/images/mine.png",
        "selectedIconPath": "static/images/mine-active.png",
        "text": "我的"
      }
    ]
  }
}
```

## 注意事项

1. **文件命名**: 图标文件名必须与 pages.json 中配置的路径完全一致
2. **大小写**: Windows不区分大小写，但Linux/Mac区分，建议使用小写
3. **路径**: 相对路径从项目根目录开始，不需要 `./` 前缀
4. **格式**: TabBar推荐使用PNG格式，SVG在某些平台可能不支持
5. **缓存**: 修改图标后需要清除编译缓存，重新编译才能看到效果

## 清除缓存方法

### HBuilderX
1. 菜单栏 → 运行 → 停止运行
2. 删除 unpackage 目录
3. 重新运行项目

### CLI
```bash
# 清除缓存
npm run clean
# 或手动删除
rm -rf unpackage
# 重新编译
npm run dev:mp-weixin
```

---

**更新日期**: 2025-12-21
**维护者**: 项目组
