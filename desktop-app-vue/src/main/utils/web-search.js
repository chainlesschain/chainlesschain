/**
 * 通用联网搜索工具
 * 支持多个搜索引擎，不依赖特定LLM提供商
 */

const https = require('https');
const http = require('http');

/**
 * DuckDuckGo即时回答API搜索（无需API key）
 * @param {string} query - 搜索查询
 * @param {Object} options - 选项
 * @returns {Promise<Object>} 搜索结果
 */
async function searchDuckDuckGo(query, options = {}) {
  const { maxResults = 5, language = 'zh-cn' } = options;

  return new Promise((resolve, reject) => {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`;

    console.log('[WebSearch] 使用DuckDuckGo搜索:', query);

    https.get(url, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
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

          console.log('[WebSearch] 找到', results.length, '条结果');

          resolve({
            query,
            results,
            totalResults: results.length
          });
        } catch (error) {
          console.error('[WebSearch] 解析结果失败:', error);
          reject(error);
        }
      });
    }).on('error', (error) => {
      console.error('[WebSearch] 请求失败:', error);
      reject(error);
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

    console.log('[WebSearch] 使用Bing搜索:', query);

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

          console.log('[WebSearch] 找到', results.length, '条结果');

          resolve({
            query,
            results,
            totalResults: result.webPages?.totalEstimatedMatches || results.length
          });
        } catch (error) {
          console.error('[WebSearch] 解析结果失败:', error);
          reject(error);
        }
      });
    }).on('error', (error) => {
      console.error('[WebSearch] 请求失败:', error);
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
    console.log('[WebSearch] 增强对话，搜索:', userQuery);

    // 执行搜索
    const searchResult = await search(userQuery, options);

    // 格式化搜索结果
    const searchContext = formatSearchResults(searchResult);

    // 将搜索结果作为系统消息添加到对话中
    const enhancedMessages = [
      ...messages,
      {
        role: 'system',
        content: `以下是搜索到的相关信息，请结合这些信息回答用户的问题：\n\n${searchContext}`
      }
    ];

    console.log('[WebSearch] 使用搜索结果增强对话');

    // 调用LLM
    return await llmChat(enhancedMessages, options);
  } catch (error) {
    console.error('[WebSearch] 搜索增强失败，使用原始对话:', error.message);
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
