/**
 * 通用联网搜索工具
 * 支持多个搜索引擎，不依赖特定LLM提供商
 */

const { logger, createLogger } = require('./logger.js');
const https = require('https');
const http = require('http');

/**
 * 使用简单的搜索建议作为备选方案
 * @param {string} query - 搜索查询
 * @param {Object} options - 选项
 * @returns {Promise<Object>} 模拟搜索结果
 */
async function searchFallback(query, options = {}) {
  const { maxResults = 5 } = options;

  logger.info('[WebSearch] 使用备选搜索方案:', query);

  // 返回基于查询的建议结果（引导用户自己搜索）
  const results = [
    {
      title: `关于 "${query}" 的搜索建议`,
      snippet: `由于联网搜索暂时不可用，建议您：
1. 访问搜索引擎（如百度、Google、必应）搜索 "${query}"
2. 查阅官方文档或技术社区
3. 如果是技术问题，可以访问 Stack Overflow、GitHub、CSDN 等平台`,
      url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      source: '搜索建议'
    },
    {
      title: '百度搜索',
      snippet: `在百度搜索 "${query}"`,
      url: `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`,
      source: '百度'
    },
    {
      title: '必应搜索',
      snippet: `在必应搜索 "${query}"`,
      url: `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
      source: '必应'
    }
  ];

  return {
    query,
    results: results.slice(0, maxResults),
    totalResults: results.length,
    isFallback: true
  };
}

/**
 * DuckDuckGo即时回答API搜索（无需API key）
 * 注意：DuckDuckGo的API有时不稳定，作为备选方案
 * @param {string} query - 搜索查询
 * @param {Object} options - 选项
 * @returns {Promise<Object>} 搜索结果
 */
async function searchDuckDuckGo(query, options = {}) {
  const { maxResults = 5, language = 'zh-cn' } = options;

  return new Promise((resolve, reject) => {
    const encodedQuery = encodeURIComponent(query);
    // 使用DuckDuckGo即时回答API（仅支持即时回答，不支持常规搜索）
    const url = `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`;

    logger.info('[WebSearch] 尝试使用DuckDuckGo API:', query);

    const request = https.get(url, { timeout: 5000 }, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          // 检查是否是HTML响应（API失败）
          if (data.trim().startsWith('<')) {
            logger.warn('[WebSearch] DuckDuckGo API返回HTML，使用备选方案');
            return resolve(searchFallback(query, options));
          }

          const result = JSON.parse(data);

          // 提取搜索结果
          const results = [];

          // 即时回答
          if (result.AbstractText) {
            results.push({
              title: result.Heading || '即时回答',
              snippet: result.AbstractText,
              url: result.AbstractURL || '',
              source: result.AbstractSource || 'DuckDuckGo'
            });
          }

          // 相关主题
          if (result.RelatedTopics && result.RelatedTopics.length > 0) {
            result.RelatedTopics.slice(0, maxResults).forEach(topic => {
              if (topic.Text && topic.FirstURL) {
                results.push({
                  title: topic.Text.split(' - ')[0] || topic.Text,
                  snippet: topic.Text,
                  url: topic.FirstURL,
                  source: 'DuckDuckGo'
                });
              }
            });
          }

          // 如果没有结果，使用备选方案
          if (results.length === 0) {
            logger.warn('[WebSearch] DuckDuckGo API无结果，使用备选方案');
            return resolve(searchFallback(query, options));
          }

          logger.info('[WebSearch] DuckDuckGo找到', results.length, '条结果');

          resolve({
            query,
            results,
            totalResults: results.length
          });
        } catch (error) {
          logger.error('[WebSearch] DuckDuckGo解析失败:', error.message);
          // 解析失败时使用备选方案
          resolve(searchFallback(query, options));
        }
      });
    });

    request.on('error', (error) => {
      logger.error('[WebSearch] DuckDuckGo请求失败:', error.message);
      // 请求失败时使用备选方案
      resolve(searchFallback(query, options));
    });

    request.on('timeout', () => {
      logger.error('[WebSearch] DuckDuckGo请求超时');
      request.destroy();
      resolve(searchFallback(query, options));
    });
  });
}

/**
 * 使用Bing搜索API（如果配置了API key）
 * @param {string} query - 搜索查询
 * @param {Object} options - 选项
 * @returns {Promise<Object>} 搜索结果
 */
async function searchBing(query, options = {}) {
  const { maxResults = 5, apiKey } = options;

  if (!apiKey) {
    throw new Error('Bing搜索需要API key');
  }

  return new Promise((resolve, reject) => {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodedQuery}&count=${maxResults}`;

    logger.info('[WebSearch] 使用Bing搜索:', query);

    const options = {
      headers: {
        'Ocp-Apim-Subscription-Key': apiKey
      }
    };

    https.get(url, options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const result = JSON.parse(data);

          const results = (result.webPages?.value || []).map(item => ({
            title: item.name,
            snippet: item.snippet,
            url: item.url,
            source: 'Bing'
          }));

          logger.info('[WebSearch] 找到', results.length, '条结果');

          resolve({
            query,
            results,
            totalResults: result.webPages?.totalEstimatedMatches || results.length
          });
        } catch (error) {
          logger.error('[WebSearch] 解析结果失败:', error);
          reject(error);
        }
      });
    }).on('error', (error) => {
      logger.error('[WebSearch] 请求失败:', error);
      reject(error);
    });
  });
}

/**
 * 通用搜索接口（自动选择可用的搜索引擎）
 * @param {string} query - 搜索查询
 * @param {Object} options - 选项
 * @returns {Promise<Object>} 搜索结果
 */
async function search(query, options = {}) {
  const { engine = 'auto', bingApiKey } = options;

  // 如果指定了Bing且有API key
  if (engine === 'bing' && bingApiKey) {
    return await searchBing(query, { ...options, apiKey: bingApiKey });
  }

  // 默认使用DuckDuckGo（无需API key）
  return await searchDuckDuckGo(query, options);
}

/**
 * 格式化搜索结果为文本
 * @param {Object} searchResult - 搜索结果
 * @returns {string} 格式化的文本
 */
function formatSearchResults(searchResult) {
  if (!searchResult || !searchResult.results || searchResult.results.length === 0) {
    return '未找到相关搜索结果。';
  }

  let text = `搜索查询: ${searchResult.query}\n\n`;
  text += `找到 ${searchResult.results.length} 条结果:\n\n`;

  searchResult.results.forEach((result, index) => {
    text += `${index + 1}. ${result.title}\n`;
    text += `   ${result.snippet}\n`;
    text += `   来源: ${result.url}\n\n`;
  });

  return text;
}

/**
 * 使用搜索结果增强LLM对话
 * @param {string} userQuery - 用户查询
 * @param {Array} messages - 对话历史
 * @param {Function} llmChat - LLM对话函数
 * @param {Object} options - 选项
 * @returns {Promise<Object>} LLM响应
 */
async function enhanceChatWithSearch(userQuery, messages, llmChat, options = {}) {
  try {
    logger.info('[WebSearch] 增强对话，搜索:', userQuery);

    // 执行搜索
    const searchResult = await search(userQuery, options);

    // 检查是否使用了备选方案
    if (searchResult.isFallback) {
      logger.info('[WebSearch] 使用备选搜索建议');
      // 格式化搜索建议
      const searchContext = formatSearchResults(searchResult);

      // 将搜索建议作为系统消息添加到对话中
      const enhancedMessages = [
        ...messages,
        {
          role: 'system',
          content: `注意：由于联网搜索功能暂时不可用，以下是搜索建议链接供参考：\n\n${searchContext}\n\n请基于您已有的知识回答用户问题，并适当提醒用户可以通过上述链接获取最新信息。`
        }
      ];

      logger.info('[WebSearch] 使用搜索建议增强对话');
      return await llmChat(enhancedMessages, options);
    }

    // 正常搜索结果
    const searchContext = formatSearchResults(searchResult);

    // 将搜索结果作为系统消息添加到对话中
    const enhancedMessages = [
      ...messages,
      {
        role: 'system',
        content: `以下是搜索到的相关信息，请结合这些信息回答用户的问题：\n\n${searchContext}`
      }
    ];

    logger.info('[WebSearch] 使用搜索结果增强对话');

    // 调用LLM
    return await llmChat(enhancedMessages, options);
  } catch (error) {
    logger.error('[WebSearch] 搜索增强失败，使用原始对话:', error.message);
    // 如果搜索失败，直接使用原始对话
    return await llmChat(messages, options);
  }
}

module.exports = {
  search,
  searchDuckDuckGo,
  searchBing,
  formatSearchResults,
  enhanceChatWithSearch
};
