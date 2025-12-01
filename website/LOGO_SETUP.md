# Logo 设置说明

## 获取Logo

您需要从原网站获取logo图片：

### 方法1：直接下载
访问原网站的logo地址：
```
https://www.chainlesschain.com/logo.png
```

右键保存图片到 `website/` 目录，重命名为 `logo.png`

### 方法2：从原网站复制
1. 访问 https://www.chainlesschain.com/
2. 右键点击页面上的logo
3. 选择"图片另存为"
4. 保存到 `website/` 目录，命名为 `logo.png`

## Logo规格建议

- **格式**: PNG（支持透明背景）
- **尺寸**: 建议高度 80-120px，宽度自适应
- **背景**: 透明背景最佳
- **文件大小**: 建议小于 100KB

## 放置位置

```
website/
├── logo.png          ← 放在这里
├── index.html
├── css/
└── js/
```

## 备用方案

如果暂时没有logo图片，网站会自动显示文字logo"无链之链"🔗

## 测试

放置logo后，在浏览器中打开 `index.html` 查看效果。

如果logo不显示，请检查：
1. 文件名是否为 `logo.png`（区分大小写）
2. 文件是否在正确的目录
3. 浏览器控制台是否有错误信息

## 自定义Logo样式

如需调整logo大小，在 `css/style.css` 中修改：

```css
.logo-image {
    height: 40px;  /* 修改这个值 */
    width: auto;
    object-fit: contain;
}
```
