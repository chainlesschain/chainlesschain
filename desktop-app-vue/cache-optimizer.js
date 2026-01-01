/**
 * 缓存优化器
 * 分析和优化系统缓存性能
 *
 * 功能:
 * 1. 分析缓存命中率
 * 2. 识别缓存热点和冷点
 * 3. 优化缓存策略
 * 4. 缓存预热
 * 5. 智能缓存键生成
 *
 * 使用方法:
 *   node cache-optimizer.js [命令]
 *
 * 命令:
 *   analyze      分析当前缓存性能
 *   optimize     优化缓存配置
 *   preheat      缓存预热
 *   monitor      实时监控缓存
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// 颜色输出
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m'
};

function logSuccess(msg) {
  console.log(`${colors.green}✓${colors.reset} ${msg}`);
}

function logError(msg) {
  console.log(`${colors.red}✗${colors.reset} ${msg}`);
}

function logWarning(msg) {
  console.log(`${colors.yellow}⚠${colors.reset} ${msg}`);
}

function logInfo(msg) {
  console.log(`${colors.blue}ℹ${colors.reset} ${msg}`);
}

function logHeader(title) {
  console.log(`\n${colors.cyan}${'='.repeat(70)}${colors.reset}`);
  console.log(`${colors.cyan}${title}${colors.reset}`);
  console.log(`${colors.cyan}${'='.repeat(70)}${colors.reset}\n`);
}

/**
 * 缓存管理器
 */
class CacheManager {
  constructor() {
    this.cache = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      totalSize: 0,
      keyAccessCount: new Map(),
      keyLastAccess: new Map(),
      keyCreationTime: new Map(),
      keySizeBytes: new Map()
    };

    this.config = {
      maxSize: 1000,              // 最大缓存条目数
      maxMemoryMB: 100,           // 最大内存使用 (MB)
      ttl: 3600000,               // 默认TTL (1小时)
      evictionPolicy: 'lru',      // 淘汰策略: lru, lfu, fifo
      compressionEnabled: true,   // 启用压缩
      prefetchEnabled: true       // 启用预取
    };
  }

  /**
   * 生成智能缓存键
   */
  generateKey(type, data) {
    // 规范化数据以提高缓存命中率
    const normalized = this.normalizeData(type, data);

    // 生成确定性哈希
    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify(normalized))
      .digest('hex')
      .substring(0, 16);

    return `${type}:${hash}`;
  }

  /**
   * 规范化数据
   */
  normalizeData(type, data) {
    switch (type) {
      case 'intent':
        // 意图缓存：去除空格、统一大小写
        return {
          text: data.text?.toLowerCase().trim().replace(/\s+/g, ' '),
          context: this.normalizeContext(data.context)
        };

      case 'tool':
        // 工具调用缓存：排序参数
        return {
          name: data.name,
          params: this.sortObject(data.params)
        };

      case 'llm':
        // LLM响应缓存：规范化提示词
        return {
          prompt: data.prompt?.trim(),
          model: data.model,
          temperature: Math.round(data.temperature * 10) / 10
        };

      default:
        return data;
    }
  }

  /**
   * 规范化上下文
   */
  normalizeContext(context) {
    if (!context) return null;

    // 只保留相关字段
    return {
      userId: context.userId,
      sessionId: context.sessionId,
      // 忽略时间戳等易变字段
    };
  }

  /**
   * 排序对象键（深度排序）
   */
  sortObject(obj) {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sortObject(item));
    }

    const sorted = {};
    Object.keys(obj).sort().forEach(key => {
      sorted[key] = this.sortObject(obj[key]);
    });

    return sorted;
  }

  /**
   * 获取缓存
   */
  get(key) {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // 检查TTL
    if (Date.now() > entry.expireAt) {
      this.cache.delete(key);
      this.stats.misses++;
      this.stats.evictions++;
      return null;
    }

    // 更新访问统计
    this.stats.hits++;
    this.stats.keyAccessCount.set(key, (this.stats.keyAccessCount.get(key) || 0) + 1);
    this.stats.keyLastAccess.set(key, Date.now());

    return entry.value;
  }

  /**
   * 设置缓存
   */
  set(key, value, ttl = this.config.ttl) {
    // 检查是否需要淘汰
    if (this.cache.size >= this.config.maxSize) {
      this.evict();
    }

    const entry = {
      value,
      expireAt: Date.now() + ttl,
      createdAt: Date.now(),
      size: this.estimateSize(value)
    };

    this.cache.set(key, entry);
    this.stats.sets++;
    this.stats.keyCreationTime.set(key, Date.now());
    this.stats.keySizeBytes.set(key, entry.size);
    this.stats.totalSize += entry.size;

    return true;
  }

  /**
   * 估算数据大小
   */
  estimateSize(value) {
    const str = JSON.stringify(value);
    return Buffer.byteLength(str, 'utf8');
  }

  /**
   * 缓存淘汰
   */
  evict() {
    let keyToEvict;

    switch (this.config.evictionPolicy) {
      case 'lru':
        // 最近最少使用
        keyToEvict = this.findLRUKey();
        break;

      case 'lfu':
        // 最不常使用
        keyToEvict = this.findLFUKey();
        break;

      case 'fifo':
        // 先进先出
        keyToEvict = this.cache.keys().next().value;
        break;

      default:
        keyToEvict = this.cache.keys().next().value;
    }

    if (keyToEvict) {
      const entry = this.cache.get(keyToEvict);
      this.cache.delete(keyToEvict);
      this.stats.evictions++;
      this.stats.totalSize -= (entry?.size || 0);
    }
  }

  /**
   * 查找LRU键
   */
  findLRUKey() {
    let oldestKey = null;
    let oldestTime = Infinity;

    for (const [key, _] of this.cache) {
      const lastAccess = this.stats.keyLastAccess.get(key) || 0;
      if (lastAccess < oldestTime) {
        oldestTime = lastAccess;
        oldestKey = key;
      }
    }

    return oldestKey;
  }

  /**
   * 查找LFU键
   */
  findLFUKey() {
    let leastKey = null;
    let leastCount = Infinity;

    for (const [key, _] of this.cache) {
      const count = this.stats.keyAccessCount.get(key) || 0;
      if (count < leastCount) {
        leastCount = count;
        leastKey = key;
      }
    }

    return leastKey;
  }

  /**
   * 清空缓存
   */
  clear() {
    this.cache.clear();
    this.stats.totalSize = 0;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0
      ? (this.stats.hits / totalRequests * 100).toFixed(2)
      : 0;

    return {
      ...this.stats,
      totalRequests,
      hitRate,
      missRate: (100 - parseFloat(hitRate)).toFixed(2),
      cacheSize: this.cache.size,
      totalSizeMB: (this.stats.totalSize / 1024 / 1024).toFixed(2),
      avgEntrySize: this.cache.size > 0
        ? (this.stats.totalSize / this.cache.size / 1024).toFixed(2)
        : 0
    };
  }

  /**
   * 获取热点数据
   */
  getHotKeys(limit = 10) {
    const accessCounts = Array.from(this.stats.keyAccessCount.entries());
    accessCounts.sort((a, b) => b[1] - a[1]);

    return accessCounts.slice(0, limit).map(([key, count]) => ({
      key,
      accessCount: count,
      lastAccess: this.stats.keyLastAccess.get(key),
      size: this.stats.keySizeBytes.get(key)
    }));
  }

  /**
   * 获取冷数据
   */
  getColdKeys(limit = 10) {
    const accessCounts = Array.from(this.stats.keyAccessCount.entries());
    accessCounts.sort((a, b) => a[1] - b[1]);

    return accessCounts.slice(0, limit).map(([key, count]) => ({
      key,
      accessCount: count,
      lastAccess: this.stats.keyLastAccess.get(key),
      size: this.stats.keySizeBytes.get(key)
    }));
  }
}

/**
 * 分析缓存性能
 */
async function analyzeCachePerformance(db) {
  logHeader('📊 缓存性能分析');

  // 模拟缓存使用
  const cache = new CacheManager();

  // 1. 意图识别缓存
  console.log('1. 意图识别缓存分析\n');

  const intents = db.prepare(`
    SELECT user_input, intents, intent_count
    FROM multi_intent_history
    LIMIT 100
  `).all();

  let intentHits = 0;
  let intentMisses = 0;

  // 模拟缓存使用
  intents.forEach((intent, index) => {
    const key = cache.generateKey('intent', {
      text: intent.user_input,
      context: { userId: 'test' }
    });

    // 模拟重复查询（30%概率）
    if (index > 0 && Math.random() < 0.3) {
      const prevIntent = intents[Math.floor(Math.random() * index)];
      const prevKey = cache.generateKey('intent', {
        text: prevIntent.user_input,
        context: { userId: 'test' }
      });

      const cached = cache.get(prevKey);
      if (cached) {
        intentHits++;
      } else {
        intentMisses++;
      }
    } else {
      cache.set(key, intent);
    }
  });

  logInfo('意图缓存样本数', intents.length);
  logInfo('模拟命中次数', intentHits);
  logInfo('模拟未命中次数', intentMisses);
  if (intentHits + intentMisses > 0) {
    logInfo('预期命中率', `${(intentHits / (intentHits + intentMisses) * 100).toFixed(1)}%`);
  }

  // 2. LLM响应缓存
  console.log('\n2. LLM响应缓存分析\n');

  const distillations = db.prepare(`
    SELECT task_id, complexity_level, complexity_score, actual_model
    FROM knowledge_distillation_history
    LIMIT 100
  `).all();

  logInfo('LLM任务样本数', distillations.length);

  // 分析复杂度分布
  const complexityDist = {};
  distillations.forEach(d => {
    complexityDist[d.complexity_level] = (complexityDist[d.complexity_level] || 0) + 1;
  });

  console.log('\n复杂度分布:');
  Object.entries(complexityDist).forEach(([level, count]) => {
    const percentage = (count / distillations.length * 100).toFixed(1);
    console.log(`  ${level}: ${count} (${percentage}%)`);
  });

  // 3. 整体缓存统计
  console.log('\n3. 整体缓存统计\n');

  const stats = cache.getStats();

  logInfo('总请求数', stats.totalRequests);
  logInfo('缓存命中', `${stats.hits} (${stats.hitRate}%)`);
  logInfo('缓存未命中', `${stats.misses} (${stats.missRate}%)`);
  logInfo('缓存条目数', stats.cacheSize);
  logInfo('总内存占用', `${stats.totalSizeMB} MB`);
  logInfo('平均条目大小', `${stats.avgEntrySize} KB`);
  logInfo('淘汰次数', stats.evictions);

  // 4. 热点分析
  console.log('\n4. 缓存热点 Top 5\n');

  const hotKeys = cache.getHotKeys(5);
  hotKeys.forEach((item, index) => {
    console.log(`  ${index + 1}. ${item.key.substring(0, 40)}...`);
    console.log(`     访问次数: ${item.accessCount}, 大小: ${(item.size / 1024).toFixed(2)} KB`);
  });

  // 5. 优化建议
  console.log('\n5. 优化建议\n');

  if (parseFloat(stats.hitRate) < 50) {
    logWarning('缓存命中率偏低 (<50%)');
    console.log('   建议:');
    console.log('   - 增加缓存大小');
    console.log('   - 优化缓存键生成算法');
    console.log('   - 实施缓存预热策略');
  } else if (parseFloat(stats.hitRate) < 70) {
    logWarning('缓存命中率一般 (50-70%)');
    console.log('   建议:');
    console.log('   - 分析冷数据，考虑调整TTL');
    console.log('   - 实施智能预取');
  } else {
    logSuccess('缓存命中率良好 (>=70%)');
  }

  if (parseFloat(stats.totalSizeMB) > 80) {
    logWarning('内存占用较高');
    console.log('   建议:');
    console.log('   - 启用压缩');
    console.log('   - 调整淘汰策略');
    console.log('   - 减小TTL');
  }

  if (stats.evictions > stats.sets * 0.3) {
    logWarning('淘汰率较高 (>30%)');
    console.log('   建议:');
    console.log('   - 增加缓存容量');
    console.log('   - 优化淘汰策略（考虑LFU）');
  }

  return { cache, stats };
}

/**
 * 优化缓存配置
 */
function optimizeCacheConfig(stats) {
  logHeader('⚙️ 缓存配置优化');

  const recommendations = {
    maxSize: 1000,
    maxMemoryMB: 100,
    ttl: 3600000,
    evictionPolicy: 'lru',
    compressionEnabled: true,
    prefetchEnabled: true
  };

  // 基于命中率调整
  const hitRate = parseFloat(stats.hitRate);

  if (hitRate < 50) {
    recommendations.maxSize = 2000;
    recommendations.maxMemoryMB = 200;
    recommendations.ttl = 7200000; // 2小时
    recommendations.evictionPolicy = 'lfu'; // 改用LFU
    logInfo('命中率低，增加缓存大小和TTL');
  } else if (hitRate >= 80) {
    recommendations.maxSize = 500;
    recommendations.maxMemoryMB = 50;
    recommendations.evictionPolicy = 'lru';
    logInfo('命中率高，可适当减小缓存大小');
  }

  // 基于淘汰率调整
  const evictionRate = stats.evictions / stats.sets;

  if (evictionRate > 0.3) {
    recommendations.maxSize = Math.ceil(recommendations.maxSize * 1.5);
    logInfo('淘汰率高，增加缓存容量');
  }

  // 基于内存使用调整
  const memoryUsage = parseFloat(stats.totalSizeMB);

  if (memoryUsage > 80) {
    recommendations.compressionEnabled = true;
    recommendations.ttl = Math.floor(recommendations.ttl * 0.8);
    logInfo('内存占用高，启用压缩并缩短TTL');
  }

  console.log('\n推荐配置:\n');
  Object.entries(recommendations).forEach(([key, value]) => {
    console.log(`  ${key}: ${colors.green}${value}${colors.reset}`);
  });

  // 保存配置
  const configPath = path.join(__dirname, 'cache-config.json');
  fs.writeFileSync(configPath, JSON.stringify(recommendations, null, 2), 'utf8');
  logSuccess(`配置已保存: ${configPath}`);

  return recommendations;
}

/**
 * 缓存预热
 */
async function preheatCache(db) {
  logHeader('🔥 缓存预热');

  const cache = new CacheManager();

  // 1. 预热高频意图
  console.log('1. 预热高频意图\n');

  const topIntents = db.prepare(`
    SELECT user_input, intents, intent_count, COUNT(*) as frequency
    FROM multi_intent_history
    GROUP BY user_input
    ORDER BY frequency DESC
    LIMIT 50
  `).all();

  topIntents.forEach(intent => {
    const key = cache.generateKey('intent', {
      text: intent.user_input,
      context: { userId: 'system' }
    });

    cache.set(key, {
      intents: intent.intents,
      count: intent.intent_count
    });
  });

  logSuccess(`预热 ${topIntents.length} 个高频意图`);

  // 2. 预热常用工具调用
  console.log('\n2. 预热常用工具\n');

  const topFeatures = db.prepare(`
    SELECT feature_name, COUNT(*) as usage_count
    FROM feature_usage_tracking
    GROUP BY feature_name
    ORDER BY usage_count DESC
    LIMIT 30
  `).all();

  topFeatures.forEach(feature => {
    const key = cache.generateKey('tool', {
      name: feature.feature_name,
      params: {}
    });

    cache.set(key, {
      name: feature.feature_name,
      usageCount: feature.usage_count
    });
  });

  logSuccess(`预热 ${topFeatures.length} 个常用工具`);

  // 3. 统计
  console.log('\n预热结果:\n');

  const stats = cache.getStats();
  logInfo('预热条目数', stats.cacheSize);
  logInfo('内存占用', `${stats.totalSizeMB} MB`);

  return cache;
}

/**
 * 主函数
 */
async function main() {
  const command = process.argv[2] || 'analyze';

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║     缓存优化器                                           ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  try {
    // 连接数据库
    const DatabaseManager = require('./src/main/database');
    const dbPath = path.join(__dirname, 'data/chainlesschain.db');
    const dbManager = new DatabaseManager(dbPath, { encryptionEnabled: false });
    await dbManager.initialize();
    const db = dbManager.db;

    switch (command) {
      case 'analyze': {
        const { cache, stats } = await analyzeCachePerformance(db);
        break;
      }

      case 'optimize': {
        const { cache, stats } = await analyzeCachePerformance(db);
        optimizeCacheConfig(stats);
        break;
      }

      case 'preheat': {
        await preheatCache(db);
        break;
      }

      case 'all': {
        const { cache, stats } = await analyzeCachePerformance(db);
        optimizeCacheConfig(stats);
        await preheatCache(db);
        break;
      }

      default:
        logError(`未知命令: ${command}`);
        console.log('\n可用命令:');
        console.log('  analyze      分析缓存性能');
        console.log('  optimize     优化缓存配置');
        console.log('  preheat      缓存预热');
        console.log('  all          执行所有优化');
        process.exit(1);
    }

    dbManager.close();
    console.log('');
    process.exit(0);

  } catch (error) {
    logError(`执行失败: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
