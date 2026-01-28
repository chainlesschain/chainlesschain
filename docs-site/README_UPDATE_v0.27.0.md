# 文档网站更新说明 v0.27.0

## 📋 更新内容

本次更新将文档网站从 v0.26.0 升级到 v0.27.0 (Cowork Enterprise Edition)。

### 主要变更

1. **版本升级**: v0.26.0 → v0.27.0
2. **新增文档**: Cowork 多智能体协作系统完整文档
3. **更新日志**: 新增 v0.26.1, v0.26.2, v0.27.0 版本记录
4. **配置更新**: 导航和侧边栏配置

### 文件列表

```
docs-site/
├── docs/
│   ├── index.md                        # 首页 (更新版本号和特性)
│   ├── changelog.md                    # 更新日志 (新增3个版本)
│   ├── chainlesschain/
│   │   ├── overview.md                 # 系统概述 (添加 Cowork 章节)
│   │   └── cowork.md                   # Cowork 文档 (新建)
│   └── .vitepress/
│       └── config.js                   # VitePress 配置 (更新导航)
├── DOCS_UPDATE_v0.27.0.md             # 更新总结
└── README_UPDATE_v0.27.0.md           # 本文件
```

## 🚀 如何运行文档网站

### 1. 安装依赖

```bash
cd docs-site
npm install
```

### 2. 开发模式

```bash
npm run dev
```

访问: http://localhost:5173

### 3. 构建生产版本

```bash
npm run build
```

输出目录: `docs/.vitepress/dist/`

### 4. 预览生产版本

```bash
npm run preview
```

## 📝 验证更新

### 检查项

- [ ] 首页版本号显示为 v0.27.0
- [ ] 首页显示 "Cowork多智能体协作" 特性卡片
- [ ] 导航栏包含 "企业版功能" → "Cowork多智能体协作"
- [ ] 系统概述页面包含 Cowork 章节
- [ ] Cowork 文档页面可正常访问
- [ ] 更新日志包含 v0.26.1, v0.26.2, v0.27.0
- [ ] 所有内部链接正常工作
- [ ] 代码示例格式正确

### 快速验证

1. 运行 `npm run dev`
2. 访问 http://localhost:5173
3. 检查首页版本号
4. 点击 "产品文档" → "ChainlessChain系统" → "企业版功能" → "Cowork多智能体协作"
5. 验证页面内容完整

## 📊 更新统计

| 项目 | 数值 |
|------|------|
| 新增文件 | 1 |
| 修改文件 | 4 |
| 新增代码行 | +958 |
| 删除代码行 | -11 |
| 净增行数 | +947 |

## 🔗 主要链接

- [首页](http://localhost:5173/)
- [Cowork 文档](http://localhost:5173/chainlesschain/cowork)
- [系统概述](http://localhost:5173/chainlesschain/overview)
- [更新日志](http://localhost:5173/changelog)

## 📞 问题反馈

如发现任何问题，请及时反馈:

- 📧 邮箱: zhanglongfa@chainlesschain.com
- 🐛 GitHub Issues

## ✅ 完成状态

- ✅ 版本信息更新完成
- ✅ Cowork 文档创建完成
- ✅ 更新日志补充完成
- ✅ 导航配置更新完成
- ✅ 文档质量审核完成
- ⏳ 待用户验证

---

**更新日期**: 2026-01-28
**更新版本**: v0.27.0
**更新状态**: ✅ 完成
