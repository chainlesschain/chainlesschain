# ChainlessChain 多语言（i18n）使用指南

本文档介绍如何在 ChainlessChain 项目中使用多语言功能。

## 概述

ChainlessChain 现已支持以下5种语言：
- 🇨🇳 简体中文 (zh-CN) - 默认语言
- 🇺🇸 英文 (en-US)
- 🇹🇼 繁体中文 (zh-TW)
- 🇯🇵 日文 (ja-JP)
- 🇰🇷 韩文 (ko-KR)

## 技术栈

- **vue-i18n 9.x** - Vue 3 官方国际化插件
- **Composition API** - 使用 Vue 3 组合式 API
- **localStorage** - 用于持久化语言偏好设置

## 目录结构

```
src/renderer/
├── locales/
│   ├── index.js       # i18n 配置和初始化
│   ├── zh-CN.js       # 简体中文翻译
│   ├── en-US.js       # 英文翻译
│   ├── zh-TW.js       # 繁体中文翻译
│   ├── ja-JP.js       # 日文翻译
│   └── ko-KR.js       # 韩文翻译
└── components/
    └── LanguageSwitcher.vue  # 语言切换组件
```

## 在组件中使用 i18n

### 1. 在模板中使用

#### 基础用法

```vue
<template>
  <div>
    <!-- 使用 $t() 函数 -->
    <h1>{{ $t('app.title') }}</h1>
    <p>{{ $t('app.subtitle') }}</p>

    <!-- 在属性中使用 -->
    <a-button :title="$t('common.save')">
      {{ $t('common.save') }}
    </a-button>
  </div>
</template>
```

#### 带参数的翻译

```vue
<template>
  <div>
    <!-- 时间相关翻译 -->
    <span>{{ $t('time.minutesAgo', { n: 5 }) }}</span>
    <!-- 输出: "5分钟前" (中文) 或 "5 minutes ago" (英文) -->

    <!-- 验证消息 -->
    <span>{{ $t('validation.minLength', { min: 6 }) }}</span>
    <!-- 输出: "长度不能少于6个字符" -->
  </div>
</template>
```

### 2. 在 Script 中使用

#### Setup Script 模式

```vue
<script setup>
import { useI18n } from 'vue-i18n';

const { t, locale } = useI18n();

// 使用 t() 函数获取翻译
const title = t('app.title');
const saveText = t('common.save');

// 获取当前语言
console.log('当前语言:', locale.value);

// 带参数的翻译
const errorMsg = t('validation.minLength', { min: 6 });
</script>
```

#### Options API 模式

```vue
<script>
export default {
  methods: {
    showMessage() {
      // 使用 this.$t() 访问翻译
      const msg = this.$t('common.success');
      console.log(msg);
    }
  }
}
</script>
```

### 3. 切换语言

#### 在组件中切换

```vue
<script setup>
import { setLocale, getLocale } from '@/locales';

// 获取当前语言
const currentLang = getLocale();

// 切换到英文
const switchToEnglish = () => {
  setLocale('en-US');
};

// 切换到日文
const switchToJapanese = () => {
  setLocale('ja-JP');
};
</script>
```

#### 使用语言切换组件

```vue
<template>
  <div>
    <LanguageSwitcher />
  </div>
</template>

<script setup>
import LanguageSwitcher from '@/components/LanguageSwitcher.vue';
</script>
```

## 添加新的翻译

### 1. 在现有语言文件中添加翻译

编辑对应的语言文件（如 `locales/zh-CN.js`）：

```javascript
export default {
  // ... 现有翻译

  myModule: {
    title: '我的模块',
    description: '这是模块描述',
    action: {
      create: '创建',
      edit: '编辑',
      delete: '删除'
    }
  }
};
```

### 2. 确保所有语言文件都有对应翻译

为了保持一致性，请确保在所有语言文件中添加相同的 key：

**zh-CN.js:**
```javascript
myModule: {
  title: '我的模块'
}
```

**en-US.js:**
```javascript
myModule: {
  title: 'My Module'
}
```

**zh-TW.js:**
```javascript
myModule: {
  title: '我的模塊'
}
```

以此类推...

## 翻译文件结构

当前的翻译文件按功能模块组织：

```javascript
{
  common: {},        // 通用文本（按钮、操作等）
  app: {},          // 应用相关
  nav: {},          // 导航
  auth: {},         // 认证
  knowledge: {},    // 知识库
  project: {},      // 项目
  chat: {},         // AI对话
  file: {},         // 文件
  editor: {},       // 编辑器
  settings: {},     // 设置
  ukey: {},         // U盾
  git: {},          // Git
  p2p: {},          // P2P
  social: {},       // 社交
  trade: {},        // 交易
  template: {},     // 模板
  notification: {}, // 通知
  error: {},        // 错误
  validation: {},   // 验证
  time: {}          // 时间
}
```

## 最佳实践

### 1. 命名规范

- 使用小驼峰命名法
- 使用点号分隔层级
- 保持语义清晰

```javascript
// ✅ 推荐
$t('project.create')
$t('file.uploadSuccess')
$t('settings.language')

// ❌ 不推荐
$t('prj_create')
$t('file_upload_success')
$t('lang')
```

### 2. 避免硬编码文本

```vue
<!-- ❌ 不推荐 -->
<a-button>保存</a-button>

<!-- ✅ 推荐 -->
<a-button>{{ $t('common.save') }}</a-button>
```

### 3. 使用参数而非字符串拼接

```javascript
// ❌ 不推荐
const msg = '用户 ' + username + ' 已登录';

// ✅ 推荐
const msg = t('auth.userLoggedIn', { username });
// 在翻译文件中: userLoggedIn: '用户 {username} 已登录'
```

### 4. 复数形式处理

对于需要根据数量变化的文本，使用 vue-i18n 的复数功能：

```javascript
// 翻译文件
{
  items: '没有项目 | 1个项目 | {count}个项目'
}

// 使用
$t('items', 0)  // "没有项目"
$t('items', 1)  // "1个项目"
$t('items', 5)  // "5个项目"
```

## Ant Design Vue 组件国际化

Ant Design Vue 组件的国际化已经在 `App.vue` 中配置完成，会根据当前选择的语言自动切换：

```vue
<a-config-provider :locale="currentAntdLocale">
  <router-view />
</a-config-provider>
```

这意味着所有 Ant Design Vue 组件（如日期选择器、分页器等）的文本会自动切换语言。

## 调试

### 1. 检查当前语言

```javascript
import { getLocale } from '@/locales';
console.log('当前语言:', getLocale());
```

### 2. 检查翻译是否存在

```javascript
import { useI18n } from 'vue-i18n';

const { te } = useI18n();

if (te('myModule.title')) {
  console.log('翻译存在');
} else {
  console.log('翻译不存在');
}
```

### 3. 显示翻译 key（开发模式）

在开发环境中，如果翻译缺失，会显示翻译 key 本身，这样可以快速定位问题。

## 常见问题

### Q: 为什么切换语言后部分文本没有改变？

A: 可能原因：
1. 该文本是硬编码的，需要改为使用 `$t()` 函数
2. 翻译文件中缺少该 key
3. 组件没有正确响应语言变化（检查是否使用了响应式数据）

### Q: 如何在 JavaScript 文件中使用 i18n？

A: 在非组件的 JS 文件中，可以这样使用：

```javascript
import i18n from '@/locales';

const { t } = i18n.global;
const message = t('common.success');
```

### Q: 如何添加新语言？

A: 步骤如下：
1. 在 `locales/` 目录创建新的语言文件（如 `fr-FR.js`）
2. 在 `locales/index.js` 中导入并添加到 messages 对象
3. 在 `supportedLocales` 数组中添加新语言信息
4. 在 `App.vue` 中添加对应的 Ant Design locale

## 示例代码

### 完整的页面组件示例

```vue
<template>
  <div class="my-page">
    <h1>{{ $t('myPage.title') }}</h1>

    <a-form>
      <a-form-item :label="$t('common.name')">
        <a-input v-model:value="name" :placeholder="$t('myPage.namePlaceholder')" />
      </a-form-item>

      <a-form-item>
        <a-space>
          <a-button type="primary" @click="handleSave">
            {{ $t('common.save') }}
          </a-button>
          <a-button @click="handleCancel">
            {{ $t('common.cancel') }}
          </a-button>
        </a-space>
      </a-form-item>
    </a-form>

    <LanguageSwitcher />
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { message } from 'ant-design-vue';
import LanguageSwitcher from '@/components/LanguageSwitcher.vue';

const { t } = useI18n();
const name = ref('');

const handleSave = () => {
  message.success(t('common.success'));
};

const handleCancel = () => {
  message.info(t('common.cancel'));
};
</script>
```

## 更多资源

- [Vue I18n 官方文档](https://vue-i18n.intlify.dev/)
- [Ant Design Vue 国际化](https://antdv.com/docs/vue/i18n-cn)

---

如有问题或建议，请联系开发团队。
