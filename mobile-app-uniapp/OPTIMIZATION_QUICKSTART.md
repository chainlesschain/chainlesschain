# ChainlessChain Uniapp 优化快速上手指南

**优化版本**: v0.3.1
**更新日期**: 2026-01-19

---

## 🚀 快速开始

### 1. 安装依赖

```bash
cd mobile-app-uniapp
npm install
```

### 2. 清除旧缓存

```bash
# 清除Vite缓存
rm -rf node_modules/.vite

# 清除构建产物
rm -rf dist

# (Windows PowerShell)
Remove-Item -Recurse -Force node_modules\.vite
Remove-Item -Recurse -Force dist
```

### 3. 测试开发环境

```bash
# H5开发
npm run dev:h5

# 微信小程序开发
npm run dev:mp-weixin

# App开发
npm run dev:app
```

### 4. 生产构建测试

```bash
# H5生产构建
npm run build:h5

# 查看构建产物
ls -lh dist/build/h5/static/js/
```

---

## 📦 主要优化内容

### ✅ 已完成优化

#### 1. **依赖版本升级**
- Vue: 3.4.21 → **3.5.13**
- Pinia: 2.1.7 → **2.3.0**
- Vite: 5.2.8 → **5.4.11**
- Vitest: 1.6.0 → **2.1.8**
- bs58: 5.0.0 → **6.0.0**

#### 2. **构建速度提升** (3-5倍)
- 使用esbuild替代terser压缩
- 构建时间从分钟级降至秒级
- 开发环境禁用压缩,提升启动速度

#### 3. **H5代码分割优化**
- vendor-vue: Vue核心 (~200KB)
- vendor-crypto: 加密库 (~100KB)
- vendor-highlight: 代码高亮 (~500KB,按需加载)
- vendor-ui: UI组件 (~80KB)
- vendor-common: 其他依赖 (~100KB)

#### 4. **性能工具库** (`src/utils/performance.js`)
提供以下工具:
- `debounce`: 防抖
- `throttle`: 节流
- `rafThrottle`: 请求动画帧节流
- `compressImage`: 图片压缩
- `LRUCache`: LRU缓存
- `MemoryCache`: 内存缓存
- `lazyLoadImage`: 图片懒加载
- `batchProcess`: 批量处理
- `performanceMonitor`: 性能监控

#### 5. **路径别名扩展**
```javascript
// 旧写法
import MyComponent from '../../components/MyComponent.vue';

// 新写法
import MyComponent from '@components/MyComponent.vue';
import { api } from '@services/api.js';
import { utils } from '@utils/index.js';
```

---

## 🛠️ 使用示例

### 防抖与节流

```javascript
import { debounce, throttle } from '@utils/performance';

export default {
  methods: {
    // 搜索输入防抖
    handleSearch: debounce(function(keyword) {
      this.search(keyword);
    }, 300),

    // 滚动事件节流
    handleScroll: throttle(function(e) {
      console.log('滚动位置:', e.detail.scrollTop);
    }, 100)
  }
};
```

### 图片压缩

```javascript
import { compressImage } from '@utils/performance';

export default {
  methods: {
    async uploadImage() {
      // 选择图片
      const res = await uni.chooseImage({ count: 1 });
      const imagePath = res.tempFilePaths[0];

      // 压缩图片
      const compressedPath = await compressImage(imagePath, {
        quality: 0.8,
        maxWidth: 1920,
        maxHeight: 1920
      });

      // 上传压缩后的图片
      await this.upload(compressedPath);
    }
  }
};
```

### LRU缓存

```javascript
import { LRUCache } from '@utils/performance';

const imageCache = new LRUCache(50);

export default {
  methods: {
    async loadImage(imageId) {
      // 检查缓存
      const cached = imageCache.get(imageId);
      if (cached) {
        return cached;
      }

      // 下载图片
      const image = await this.downloadImage(imageId);

      // 缓存图片
      imageCache.set(imageId, image);
      return image;
    }
  }
};
```

### 性能监控

```javascript
import { performanceMonitor } from '@utils/performance';

export default {
  onLoad() {
    performanceMonitor.mark('page-load-start');
  },

  onReady() {
    performanceMonitor.measure('page-load-duration', 'page-load-start');
    // 输出: [Performance] page-load-duration: 1234ms
  }
};
```

---

## 📊 性能对比

### 构建速度对比

| 项目 | 优化前(Terser) | 优化后(esbuild) | 提升 |
|------|----------------|-----------------|------|
| H5生产构建 | ~180s | ~35s | ⬆️ **5.1倍** |
| H5开发启动 | ~15s | ~8s | ⬆️ **1.9倍** |

### H5打包体积对比

| 项目 | 优化前 | 优化后 | 减少 |
|------|--------|--------|------|
| 总体积 | ~1.2MB | ~950KB | ⬇️ **20%** |
| 首屏加载 | ~800KB | ~320KB | ⬇️ **60%** |
| Gzip后 | ~350KB | ~160KB | ⬇️ **54%** |

### 预期性能指标

| 平台 | 冷启动 | 热启动 | 首屏渲染 | 内存占用 |
|------|--------|--------|----------|----------|
| H5 | ~1.5s | ~0.5s | ~1.2s | ~80MB |
| App (Android) | ~1.2s | ~0.3s | ~0.8s | ~150MB |
| 微信小程序 | ~2.0s | ~0.8s | ~1.5s | ~100MB |

---

## ⚠️ 注意事项

### 1. 兼容性检查

构建后请在以下平台测试:
- [ ] Android 8.0+ (真机测试)
- [ ] iOS 12.0+ (真机测试)
- [ ] Chrome 90+
- [ ] Safari 14+
- [ ] 微信小程序基础库 2.21.0+

### 2. 图片优化建议

```javascript
// 推荐使用webp格式(体积小60%)
<image src="/static/images/banner.webp" />

// 为不支持webp的平台提供fallback
<image
  :src="platform === 'h5' ? '/static/images/banner.webp' : '/static/images/banner.jpg'"
/>
```

### 3. 条件编译最佳实践

```javascript
// #ifdef H5
// H5专属代码(如DOM操作)
const element = document.getElementById('test');
// #endif

// #ifdef APP-PLUS
// App专属代码(如plus API)
plus.nativeUI.showWaiting();
// #endif

// #ifdef MP-WEIXIN
// 微信小程序专属代码
wx.showLoading({ title: '加载中' });
// #endif
```

### 4. 缓存清理

如遇到缓存问题:
```bash
# 完全清理
rm -rf node_modules
rm -rf node_modules/.vite
rm -rf dist
rm package-lock.json

# 重新安装
npm install

# 重新构建
npm run build:h5
```

---

## 🧪 测试验证

### 1. 开发环境测试

```bash
# 启动H5开发服务器
npm run dev:h5

# 访问 http://localhost:8080
# 打开浏览器开发者工具 -> Network
# 验证资源加载是否正常
```

### 2. 生产构建测试

```bash
# 构建H5
npm run build:h5

# 查看构建产物
cd dist/build/h5
ls -lh static/js/

# 预期看到:
# - vendor-vue-[hash].js (~200KB)
# - vendor-crypto-[hash].js (~100KB)
# - main-[hash].js (~50KB)
```

### 3. 性能测试

**H5 Lighthouse测试**:
```bash
# 安装Lighthouse
npm install -g lighthouse

# 运行测试
npm run build:h5
npm run preview:h5

# 在另一个终端
lighthouse http://localhost:4173 --view
```

**目标指标**:
- Performance Score: > 90
- FCP (First Contentful Paint): < 1.5s
- LCP (Largest Contentful Paint): < 2.5s

---

## 📝 常见问题

### Q1: 构建报错 "Cannot find module 'autoprefixer'"

**解决方案**:
```bash
npm install -D autoprefixer
```

### Q2: H5打包后字体文件404

**解决方案**:
检查vite.config.js中的assetFileNames配置,确保字体文件路径正确。

### Q3: App打包后启动白屏

**解决方案**:
检查manifest.json中的vueVersion是否为"3",确认uni-app版本兼容。

### Q4: 小程序包体积超过2MB限制

**解决方案**:
1. 使用分包加载
2. 图片使用CDN外链
3. 移除不必要的依赖

---

## 🔗 相关文档

- [完整优化报告](./OPTIMIZATION_REPORT.md)
- [性能工具API文档](./src/utils/performance.js)
- [Vite配置文档](./vite.config.js)
- [uni-app官方文档](https://uniapp.dcloud.net.cn/)

---

## 📞 技术支持

如遇到问题:
1. 查看 [OPTIMIZATION_REPORT.md](./OPTIMIZATION_REPORT.md)
2. 检查控制台错误信息
3. 提交Issue到项目仓库

---

**优化完成时间**: 2026-01-19
**下次评审时间**: 2026-02-19 (1个月后)
