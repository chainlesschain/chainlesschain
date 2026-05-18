/**
 * Batch Clip Manager - 批量剪藏管理器
 */

export class BatchClipManager {
  constructor() {
    this.concurrency = 3;
    this.closeAfterClip = false;
  }

  /**
   * 批量剪藏标签页
   */
  async clipTabs(tabs, progressCallback) {
    const settings = await chrome.storage.sync.get({
      batchConcurrency: 3,
      batchCloseAfterClip: false
    });

    this.concurrency = settings.batchConcurrency;
    this.closeAfterClip = settings.batchCloseAfterClip;

    const results = [];
    let completed = 0;

    // 分批处理
    for (let i = 0; i < tabs.length; i += this.concurrency) {
      const batch = tabs.slice(i, i + this.concurrency);
      const batchPromises = batch.map(tab => this.clipTab(tab));

      const batchResults = await Promise.allSettled(batchPromises);
      results.push(...batchResults);

      completed += batch.length;
      if (progressCallback) {
        progressCallback(completed, tabs.length);
      }
    }

    return results;
  }

  /**
   * 剪藏单个标签页
   */
  async clipTab(tab) {
    try {
      // 注入内容脚本提取页面内容
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: this.extractPageContent
      });

      const pageContent = result.result;

      // 发送到background保存
      await chrome.runtime.sendMessage({
        action: 'clip',
        data: {
          type: 'page',
          content: pageContent.content,
          html: pageContent.html,
          url: tab.url,
          title: tab.title,
          images: pageContent.images,
          links: pageContent.links,
          timestamp: Date.now()
        }
      });

      // 关闭标签页（如果启用）
      if (this.closeAfterClip) {
        await chrome.tabs.remove(tab.id);
      }

      return { success: true, tab };
    } catch (error) {
      console.error('Failed to clip tab:', error);
      return { success: false, tab, error: error.message };
    }
  }

  /**
   * 提取页面内容（在页面上下文中执行）
   */
  extractPageContent() {
    const article = document.querySelector('article') ||
                    document.querySelector('main') ||
                    document.body;

    return {
      content: article.innerText,
      html: article.innerHTML,
      images: Array.from(article.querySelectorAll('img')).map(img => ({
        src: img.src,
        alt: img.alt,
        width: img.width,
        height: img.height
      })),
      links: Array.from(article.querySelectorAll('a')).map(a => ({
        href: a.href,
        text: a.textContent.trim()
      }))
    };
  }
}
