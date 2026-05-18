/**
 * ChainlessChain Web Clipper - Content Script
 * 注入到网页中，负责提取页面内容
 */

(function() {
  'use strict';

  console.log('[ContentScript] ChainlessChain Web Clipper 已注入');

  /**
   * 提取页面基础信息
   */
  function extractBasicInfo() {
    // 页面标题
    const title = document.title ||
      document.querySelector('meta[property="og:title"]')?.content ||
      document.querySelector('h1')?.textContent ||
      '';

    // 页面 URL
    const url = window.location.href;

    // 域名
    const domain = window.location.hostname;

    // 发布日期
    const date = extractDate();

    // 作者
    const author = extractAuthor();

    // 摘要
    const excerpt = extractExcerpt();

    return {
      title: title.trim(),
      url,
      domain,
      date,
      author,
      excerpt,
    };
  }

  /**
   * 提取发布日期
   */
  function extractDate() {
    // 尝试从多个来源提取日期
    const selectors = [
      'meta[property="article:published_time"]',
      'meta[name="date"]',
      'meta[name="publish-date"]',
      'time[datetime]',
      '.publish-date',
      '.post-date',
      '.entry-date',
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        const dateStr = element.getAttribute('content') ||
          element.getAttribute('datetime') ||
          element.textContent;

        if (dateStr) {
          try {
            const date = new Date(dateStr);
            if (!isNaN(date.getTime())) {
              return date.toISOString();
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
    }

    // 返回当前日期
    return new Date().toISOString();
  }

  /**
   * 提取作者
   */
  function extractAuthor() {
    const selectors = [
      'meta[name="author"]',
      'meta[property="article:author"]',
      '.author',
      '.author-name',
      '.byline',
      '[rel="author"]',
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        const author = element.getAttribute('content') || element.textContent;
        if (author && author.trim()) {
          return author.trim();
        }
      }
    }

    return '';
  }

  /**
   * 提取摘要
   */
  function extractExcerpt() {
    const selectors = [
      'meta[name="description"]',
      'meta[property="og:description"]',
      '.summary',
      '.excerpt',
      '.description',
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        const excerpt = element.getAttribute('content') || element.textContent;
        if (excerpt && excerpt.trim()) {
          return excerpt.trim();
        }
      }
    }

    // 从正文提取前200字
    const content = document.body.textContent;
    if (content) {
      return content.substring(0, 200).trim() + '...';
    }

    return '';
  }

  /**
   * 使用 Readability 提取主要内容
   */
  function extractWithReadability() {
    try {
      // 检查 Readability 是否可用
      if (typeof Readability === 'undefined') {
        console.warn('[ContentScript] Readability 未加载');
        return null;
      }

      // 克隆文档，避免修改原始页面
      const documentClone = document.cloneNode(true);

      // 使用 Readability 解析
      const reader = new Readability(documentClone, {
        charThreshold: 500,  // 最小字符数
        keepClasses: false,  // 不保留 class
      });

      const article = reader.parse();

      if (article) {
        return {
          title: article.title || '',
          content: article.content || '',
          textContent: article.textContent || '',
          excerpt: article.excerpt || '',
          byline: article.byline || '',
          length: article.length || 0,
          siteName: article.siteName || '',
        };
      }

      return null;
    } catch (error) {
      console.error('[ContentScript] Readability 提取失败:', error);
      return null;
    }
  }

  /**
   * 提取页面 HTML
   */
  function extractHTML() {
    // 获取主要内容区域
    const mainSelectors = [
      'main',
      'article',
      '.content',
      '.main-content',
      '.post-content',
      '.entry-content',
      '#content',
    ];

    for (const selector of mainSelectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent.length > 500) {
        return element.innerHTML;
      }
    }

    // 如果找不到主要内容，返回 body
    return document.body.innerHTML;
  }

  /**
   * 提取页面完整信息
   */
  async function extractPageInfo(useReadability = true) {
    console.log('[ContentScript] 提取页面信息...');

    // 提取基础信息
    const basicInfo = extractBasicInfo();

    // 尝试使用 Readability
    let content = '';
    let textContent = '';

    if (useReadability) {
      const article = extractWithReadability();
      if (article) {
        content = article.content;
        textContent = article.textContent;

        // 更新基础信息
        if (article.title && !basicInfo.title) {
          basicInfo.title = article.title;
        }
        if (article.byline && !basicInfo.author) {
          basicInfo.author = article.byline;
        }
        if (article.excerpt && !basicInfo.excerpt) {
          basicInfo.excerpt = article.excerpt;
        }
      }
    }

    // 如果 Readability 失败，使用原始 HTML
    if (!content) {
      content = extractHTML();
      textContent = document.body.textContent.trim();
    }

    return {
      ...basicInfo,
      content,
      textContent,
    };
  }

  /**
   * 消息监听器
   */
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[ContentScript] 收到消息:', request);

    if (request.action === 'getPageInfo') {
      extractPageInfo(true)
        .then(data => {
          console.log('[ContentScript] 页面信息:', data);
          sendResponse({ success: true, data });
        })
        .catch(error => {
          console.error('[ContentScript] 提取失败:', error);
          sendResponse({ success: false, error: error.message });
        });

      // 返回 true 表示异步响应
      return true;
    }

    if (request.action === 'extractHTML') {
      const html = extractHTML();
      sendResponse({ success: true, data: html });
      return true;
    }

    return false;
  });

  // 初始化完成
  console.log('[ContentScript] 初始化完成');
})();
