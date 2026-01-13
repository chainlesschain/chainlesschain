/**
 * Clipper Service - 网页剪藏服务
 *
 * 处理各种类型的网页内容剪藏
 */

export class ClipperService {
  constructor(nativeMessaging) {
    this.nativeMessaging = nativeMessaging;
  }

  /**
   * 保存剪藏内容
   */
  async saveClip(clipData) {
    try {
      // 获取用户配置
      const config = await chrome.storage.sync.get({
        autoSave: true,
        defaultTags: ['web-clip'],
        captureImages: true,
        captureLinks: true
      });

      // 处理剪藏数据
      const processedData = await this.processClipData(clipData, config);

      // 发送到原生应用
      const result = await this.nativeMessaging.saveClip(processedData);

      // 保存到本地历史
      await this.saveToHistory(processedData);

      return result;
    } catch (error) {
      console.error('Failed to save clip:', error);
      throw error;
    }
  }

  /**
   * 处理剪藏数据
   */
  async processClipData(clipData, config) {
    const processed = {
      ...clipData,
      tags: config.defaultTags || [],
      metadata: {
        userAgent: navigator.userAgent,
        language: navigator.language,
        timestamp: Date.now()
      }
    };

    // 处理不同类型的剪藏
    switch (clipData.type) {
      case 'selection':
        processed.content = this.cleanText(clipData.content);
        break;

      case 'page':
        processed.content = this.cleanText(clipData.content);
        processed.html = this.cleanHtml(clipData.html);

        // 处理图片
        if (config.captureImages && clipData.images) {
          processed.images = await this.processImages(clipData.images);
        }

        // 处理链接
        if (config.captureLinks && clipData.links) {
          processed.links = this.processLinks(clipData.links);
        }
        break;

      case 'screenshot':
        // 截图已经是dataUrl格式，直接使用
        break;

      case 'image':
        // 下载图片并转换为dataUrl
        if (clipData.url) {
          try {
            processed.dataUrl = await this.downloadImage(clipData.url);
          } catch (error) {
            console.error('Failed to download image:', error);
          }
        }
        break;
    }

    return processed;
  }

  /**
   * 清理文本
   */
  cleanText(text) {
    if (!text) return '';

    return text
      .replace(/\s+/g, ' ') // 合并多个空格
      .replace(/\n{3,}/g, '\n\n') // 合并多个换行
      .trim();
  }

  /**
   * 清理HTML
   */
  cleanHtml(html) {
    if (!html) return '';

    // 移除脚本和样式
    let cleaned = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

    // 移除注释
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');

    // 移除内联样式
    cleaned = cleaned.replace(/\s*style="[^"]*"/gi, '');

    return cleaned;
  }

  /**
   * 处理图片
   */
  async processImages(images) {
    const processed = [];

    for (const img of images.slice(0, 10)) { // 限制最多10张图片
      try {
        // 只保存有效的图片URL
        if (img.src && img.src.startsWith('http')) {
          processed.push({
            src: img.src,
            alt: img.alt || '',
            width: img.width,
            height: img.height
          });
        }
      } catch (error) {
        console.error('Failed to process image:', error);
      }
    }

    return processed;
  }

  /**
   * 处理链接
   */
  processLinks(links) {
    return links
      .filter(link => link.href && link.href.startsWith('http'))
      .slice(0, 50) // 限制最多50个链接
      .map(link => ({
        href: link.href,
        text: link.text || link.href
      }));
  }

  /**
   * 下载图片并转换为dataUrl
   */
  async downloadImage(url) {
    try {
      const response = await fetch(url);
      const blob = await response.blob();

      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.error('Failed to download image:', error);
      throw error;
    }
  }

  /**
   * 保存到本地历史
   */
  async saveToHistory(clipData) {
    try {
      // 获取现有历史
      const { history = [] } = await chrome.storage.local.get('history');

      // 添加新记录
      history.unshift({
        id: Date.now().toString(),
        type: clipData.type,
        title: clipData.title,
        url: clipData.url,
        timestamp: clipData.timestamp
      });

      // 限制历史记录数量
      const maxHistory = 100;
      if (history.length > maxHistory) {
        history.splice(maxHistory);
      }

      // 保存
      await chrome.storage.local.set({ history });
    } catch (error) {
      console.error('Failed to save to history:', error);
    }
  }

  /**
   * 获取剪藏历史
   */
  async getHistory(limit = 20) {
    const { history = [] } = await chrome.storage.local.get('history');
    return history.slice(0, limit);
  }

  /**
   * 清空历史
   */
  async clearHistory() {
    await chrome.storage.local.set({ history: [] });
  }

  /**
   * 提取页面元数据
   */
  extractMetadata(doc = document) {
    const metadata = {
      title: doc.title,
      description: '',
      author: '',
      publishDate: '',
      keywords: [],
      ogImage: '',
      favicon: ''
    };

    // 提取description
    const descMeta = doc.querySelector('meta[name="description"]') ||
                     doc.querySelector('meta[property="og:description"]');
    if (descMeta) {
      metadata.description = descMeta.content;
    }

    // 提取author
    const authorMeta = doc.querySelector('meta[name="author"]');
    if (authorMeta) {
      metadata.author = authorMeta.content;
    }

    // 提取发布日期
    const dateMeta = doc.querySelector('meta[property="article:published_time"]') ||
                     doc.querySelector('meta[name="date"]');
    if (dateMeta) {
      metadata.publishDate = dateMeta.content;
    }

    // 提取keywords
    const keywordsMeta = doc.querySelector('meta[name="keywords"]');
    if (keywordsMeta) {
      metadata.keywords = keywordsMeta.content.split(',').map(k => k.trim());
    }

    // 提取Open Graph图片
    const ogImageMeta = doc.querySelector('meta[property="og:image"]');
    if (ogImageMeta) {
      metadata.ogImage = ogImageMeta.content;
    }

    // 提取favicon
    const faviconLink = doc.querySelector('link[rel="icon"]') ||
                        doc.querySelector('link[rel="shortcut icon"]');
    if (faviconLink) {
      metadata.favicon = faviconLink.href;
    }

    return metadata;
  }

  /**
   * 智能提取文章内容
   */
  extractArticleContent(doc = document) {
    // 尝试多种选择器
    const selectors = [
      'article',
      '[role="main"]',
      'main',
      '.article-content',
      '.post-content',
      '.entry-content',
      '#content',
      '.content'
    ];

    for (const selector of selectors) {
      const element = doc.querySelector(selector);
      if (element && element.textContent.length > 200) {
        return {
          content: element.innerText,
          html: element.innerHTML
        };
      }
    }

    // 如果没有找到，使用body
    return {
      content: doc.body.innerText,
      html: doc.body.innerHTML
    };
  }
}
