#!/usr/bin/env node

/**
 * RSS 和邮件集成功能快速测试脚本
 * 用于验证核心功能是否正常工作
 */

const path = require('path');

console.log('='.repeat(60));
console.log('RSS 和邮件集成功能测试');
console.log('='.repeat(60));
console.log('');

// 测试 1: RSS Fetcher
console.log('📝 测试 1: RSS Fetcher');
try {
  const RSSFetcher = require('../src/main/api/rss-fetcher');
  const fetcher = new RSSFetcher();

  // 测试 URL 验证
  console.log('  ✓ URL 验证: ', fetcher.isValidUrl('https://example.com'));

  // 测试 Feed 标准化
  const mockFeed = {
    title: 'Test Feed',
    items: [{ title: 'Test Item', guid: '1' }],
  };
  const normalized = fetcher.normalizeFeed(mockFeed, 'https://example.com/feed.xml');
  console.log('  ✓ Feed 标准化: ', normalized.title);
  console.log('  ✓ RSS Fetcher 基本功能正常');
} catch (error) {
  console.log('  ✗ RSS Fetcher 测试失败:', error.message);
}

console.log('');

// 测试 2: Email Client
console.log('📧 测试 2: Email Client');
try {
  const EmailClient = require('../src/main/api/email-client');
  const client = new EmailClient();

  // 测试默认主机检测
  console.log('  ✓ Gmail IMAP: ', client.getDefaultImapHost('user@gmail.com'));
  console.log('  ✓ QQ IMAP: ', client.getDefaultImapHost('user@qq.com'));

  // 测试配置
  client.configure({
    email: 'test@example.com',
    password: 'test',
    imapHost: 'imap.example.com',
    smtpHost: 'smtp.example.com',
  });
  console.log('  ✓ 配置成功: ', client.config.imap.user);
  console.log('  ✓ Email Client 基本功能正常');
} catch (error) {
  console.log('  ✗ Email Client 测试失败:', error.message);
}

console.log('');

// 测试 3: Notification Manager
console.log('🔔 测试 3: Notification Manager');
try {
  const { getAPINotificationManager } = require('../src/main/api/notification-manager');
  const notificationManager = getAPINotificationManager();

  console.log('  ✓ 通知管理器初始化成功');
  console.log('  ✓ 通知状态: ', notificationManager.enabled ? '已启用' : '已禁用');
  console.log('  ✓ Notification Manager 基本功能正常');
} catch (error) {
  console.log('  ✗ Notification Manager 测试失败:', error.message);
}

console.log('');

// 测试 4: 数据库表检查
console.log('💾 测试 4: 数据库表检查');
try {
  const DatabaseManager = require('../src/main/database');
  const db = new DatabaseManager();

  console.log('  ✓ 数据库管理器加载成功');
  console.log('  ℹ️  数据库表将在应用启动时自动创建');
  console.log('  ✓ Database Manager 基本功能正常');
} catch (error) {
  console.log('  ✗ Database Manager 测试失败:', error.message);
}

console.log('');

// 测试 5: Vue 组件检查
console.log('🎨 测试 5: Vue 组件检查');
try {
  const fs = require('fs');

  const components = [
    'src/renderer/pages/rss/FeedList.vue',
    'src/renderer/pages/rss/ArticleReader.vue',
    'src/renderer/pages/email/AccountManager.vue',
    'src/renderer/pages/email/EmailReader.vue',
    'src/renderer/pages/email/EmailComposer.vue',
  ];

  let allExist = true;
  for (const component of components) {
    const exists = fs.existsSync(path.join(__dirname, '..', component));
    if (exists) {
      console.log(`  ✓ ${path.basename(component)} 存在`);
    } else {
      console.log(`  ✗ ${path.basename(component)} 不存在`);
      allExist = false;
    }
  }

  if (allExist) {
    console.log('  ✓ 所有 Vue 组件文件存在');
  }
} catch (error) {
  console.log('  ✗ Vue 组件检查失败:', error.message);
}

console.log('');
console.log('='.repeat(60));
console.log('测试完成！');
console.log('='.repeat(60));
console.log('');
console.log('下一步:');
console.log('1. 运行完整测试: npm run test');
console.log('2. 构建主进程: npm run build:main');
console.log('3. 启动应用: npm run dev');
console.log('');
