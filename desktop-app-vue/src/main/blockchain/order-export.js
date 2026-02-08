/**
 * 订单导出模块
 * 支持导出订单为 PDF 和图片格式
 */
const { logger } = require("../utils/logger.js");
const puppeteer = require("puppeteer");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");
const { app } = require("electron");

/**
 * 生成订单 HTML 模板
 * @param {Object} order - 订单数据
 * @returns {string} HTML 字符串
 */
function generateOrderHTML(order) {
  const statusMap = {
    open: "开放中",
    matched: "已匹配",
    completed: "已完成",
    cancelled: "已取消",
    expired: "已过期",
  };

  const typeMap = {
    sell: "出售",
    buy: "求购",
  };

  const formatDate = (timestamp) => {
    if (!timestamp) {
      return "-";
    }
    return new Date(timestamp).toLocaleString("zh-CN");
  };

  const formatPrice = (price, currency = "CNY") => {
    if (price === undefined || price === null) {
      return "-";
    }
    return `${price.toFixed(2)} ${currency}`;
  };

  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>订单详情 - ${order.id || ""}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #f5f7fa;
      padding: 40px;
      color: #333;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      text-align: center;
    }
    .header h1 {
      font-size: 24px;
      margin-bottom: 8px;
    }
    .header .order-id {
      font-size: 14px;
      opacity: 0.9;
    }
    .status-badge {
      display: inline-block;
      padding: 6px 16px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 500;
      margin-top: 12px;
      background: rgba(255, 255, 255, 0.2);
    }
    .content {
      padding: 30px;
    }
    .section {
      margin-bottom: 24px;
    }
    .section-title {
      font-size: 16px;
      font-weight: 600;
      color: #667eea;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 2px solid #f0f0f0;
    }
    .info-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
    }
    .info-item {
      padding: 12px;
      background: #f8f9fc;
      border-radius: 8px;
    }
    .info-label {
      font-size: 12px;
      color: #888;
      margin-bottom: 4px;
    }
    .info-value {
      font-size: 16px;
      font-weight: 500;
      color: #333;
    }
    .description {
      padding: 16px;
      background: #f8f9fc;
      border-radius: 8px;
      line-height: 1.6;
    }
    .footer {
      text-align: center;
      padding: 20px;
      background: #f8f9fc;
      font-size: 12px;
      color: #888;
    }
    .price-highlight {
      font-size: 24px;
      color: #667eea;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>ChainlessChain 交易订单</h1>
      <div class="order-id">订单号: ${order.id || "-"}</div>
      <div class="status-badge">${statusMap[order.status] || order.status || "-"}</div>
    </div>

    <div class="content">
      <div class="section">
        <div class="section-title">基本信息</div>
        <div class="info-grid">
          <div class="info-item">
            <div class="info-label">订单类型</div>
            <div class="info-value">${typeMap[order.type] || order.type || "-"}</div>
          </div>
          <div class="info-item">
            <div class="info-label">资产类型</div>
            <div class="info-value">${order.assetType || "-"}</div>
          </div>
          <div class="info-item">
            <div class="info-label">数量</div>
            <div class="info-value">${order.quantity || "-"}</div>
          </div>
          <div class="info-item">
            <div class="info-label">单价</div>
            <div class="info-value price-highlight">${formatPrice(order.price, order.currency)}</div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">时间信息</div>
        <div class="info-grid">
          <div class="info-item">
            <div class="info-label">创建时间</div>
            <div class="info-value">${formatDate(order.createdAt)}</div>
          </div>
          <div class="info-item">
            <div class="info-label">更新时间</div>
            <div class="info-value">${formatDate(order.updatedAt)}</div>
          </div>
          <div class="info-item">
            <div class="info-label">过期时间</div>
            <div class="info-value">${formatDate(order.expiresAt)}</div>
          </div>
          <div class="info-item">
            <div class="info-label">完成时间</div>
            <div class="info-value">${formatDate(order.completedAt)}</div>
          </div>
        </div>
      </div>

      ${
        order.description
          ? `
      <div class="section">
        <div class="section-title">订单描述</div>
        <div class="description">${order.description}</div>
      </div>
      `
          : ""
      }

      <div class="section">
        <div class="section-title">交易方信息</div>
        <div class="info-grid">
          <div class="info-item">
            <div class="info-label">创建者 DID</div>
            <div class="info-value" style="font-size: 12px; word-break: break-all;">${order.creatorDid || "-"}</div>
          </div>
          ${
            order.buyerDid
              ? `
          <div class="info-item">
            <div class="info-label">买家 DID</div>
            <div class="info-value" style="font-size: 12px; word-break: break-all;">${order.buyerDid}</div>
          </div>
          `
              : ""
          }
        </div>
      </div>
    </div>

    <div class="footer">
      <p>由 ChainlessChain 生成 | ${new Date().toLocaleString("zh-CN")}</p>
      <p>此文档仅供参考，以链上数据为准</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

/**
 * 获取临时目录
 * @returns {string} 临时目录路径
 */
function getTempDir() {
  const tempDir = path.join(app.getPath("temp"), "chainlesschain-exports");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  return tempDir;
}

/**
 * 导出订单为 PDF
 * @param {Object} order - 订单数据
 * @param {Object} options - 导出选项
 * @returns {Promise<{success: boolean, filePath?: string, error?: string}>}
 */
async function exportOrderToPDF(order, options = {}) {
  let browser = null;

  try {
    logger.info("[OrderExport] 开始导出 PDF...");

    const html = generateOrderHTML(order);
    const tempDir = getTempDir();
    const htmlPath = path.join(tempDir, `order-${order.id}.html`);
    const pdfPath =
      options.outputPath || path.join(tempDir, `order-${order.id}.pdf`);

    // 写入临时 HTML 文件
    fs.writeFileSync(htmlPath, html, "utf8");

    // 启动 puppeteer
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle0" });

    // 生成 PDF
    await page.pdf({
      path: pdfPath,
      format: "A4",
      printBackground: true,
      margin: {
        top: "20px",
        right: "20px",
        bottom: "20px",
        left: "20px",
      },
    });

    // 清理临时 HTML 文件
    fs.unlinkSync(htmlPath);

    logger.info("[OrderExport] PDF 导出成功:", pdfPath);

    return {
      success: true,
      filePath: pdfPath,
    };
  } catch (error) {
    logger.error("[OrderExport] PDF 导出失败:", error);
    return {
      success: false,
      error: error.message,
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * 导出订单为图片
 * @param {Object} order - 订单数据
 * @param {Object} options - 导出选项
 * @returns {Promise<{success: boolean, filePath?: string, error?: string}>}
 */
async function exportOrderToImage(order, options = {}) {
  let browser = null;

  try {
    logger.info("[OrderExport] 开始导出图片...");

    const html = generateOrderHTML(order);
    const tempDir = getTempDir();
    const htmlPath = path.join(tempDir, `order-${order.id}.html`);
    const format = options.format || "png";
    const imagePath =
      options.outputPath || path.join(tempDir, `order-${order.id}.${format}`);

    // 写入临时 HTML 文件
    fs.writeFileSync(htmlPath, html, "utf8");

    // 启动 puppeteer
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();

    // 设置视口大小
    await page.setViewport({
      width: options.width || 800,
      height: options.height || 1200,
      deviceScaleFactor: options.scale || 2, // 高清截图
    });

    await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle0" });

    // 获取内容实际高度
    const bodyHandle = await page.$(".container");
    const boundingBox = await bodyHandle.boundingBox();

    // 截图
    const screenshotBuffer = await page.screenshot({
      type: format === "jpg" ? "jpeg" : "png",
      clip: {
        x: boundingBox.x,
        y: boundingBox.y,
        width: boundingBox.width,
        height: boundingBox.height,
      },
      omitBackground: false,
    });

    // 使用 sharp 优化图片
    let sharpInstance = sharp(screenshotBuffer);

    if (format === "jpg" || format === "jpeg") {
      sharpInstance = sharpInstance.jpeg({ quality: options.quality || 90 });
    } else if (format === "webp") {
      sharpInstance = sharpInstance.webp({ quality: options.quality || 90 });
    } else {
      sharpInstance = sharpInstance.png({ compressionLevel: 9 });
    }

    await sharpInstance.toFile(imagePath);

    // 清理临时 HTML 文件
    fs.unlinkSync(htmlPath);

    logger.info("[OrderExport] 图片导出成功:", imagePath);

    return {
      success: true,
      filePath: imagePath,
    };
  } catch (error) {
    logger.error("[OrderExport] 图片导出失败:", error);
    return {
      success: false,
      error: error.message,
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * 分享链接管理器
 */
class ShareLinkManager {
  constructor(db) {
    this.db = db;
    this._ensureTable();
  }

  /**
   * 确保分享链接表存在
   */
  _ensureTable() {
    if (!this.db) {
      return;
    }

    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS order_share_links (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_id TEXT NOT NULL,
          token TEXT UNIQUE NOT NULL,
          permission TEXT DEFAULT 'view',
          expires_at INTEGER,
          created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
          access_count INTEGER DEFAULT 0,
          last_accessed_at INTEGER,
          is_revoked INTEGER DEFAULT 0
        )
      `);

      // 创建索引
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_share_links_order_id ON order_share_links(order_id);
        CREATE INDEX IF NOT EXISTS idx_share_links_token ON order_share_links(token);
      `);

      logger.info("[ShareLinkManager] 表初始化完成");
    } catch (error) {
      logger.error("[ShareLinkManager] 表初始化失败:", error);
    }
  }

  /**
   * 保存分享链接
   * @param {Object} linkData - 链接数据
   * @returns {Promise<{success: boolean, id?: number, error?: string}>}
   */
  async saveLink(linkData) {
    if (!this.db) {
      return { success: false, error: "数据库未初始化" };
    }

    try {
      const stmt = this.db.prepare(`
        INSERT INTO order_share_links (order_id, token, permission, expires_at)
        VALUES (?, ?, ?, ?)
      `);

      const result = stmt.run(
        linkData.orderId,
        linkData.token,
        linkData.permission || "view",
        linkData.expiresAt,
      );

      return {
        success: true,
        id: result.lastInsertRowid,
      };
    } catch (error) {
      logger.error("[ShareLinkManager] 保存链接失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 验证分享链接
   * @param {string} token - 链接令牌
   * @returns {Promise<{valid: boolean, link?: Object, error?: string}>}
   */
  async validateLink(token) {
    if (!this.db) {
      return { valid: false, error: "数据库未初始化" };
    }

    try {
      const link = this.db
        .prepare(
          `
        SELECT * FROM order_share_links WHERE token = ? AND is_revoked = 0
      `,
        )
        .get(token);

      if (!link) {
        return { valid: false, error: "链接不存在或已撤销" };
      }

      // 检查是否过期
      if (link.expires_at && link.expires_at < Date.now()) {
        return { valid: false, error: "链接已过期" };
      }

      // 更新访问统计
      this.db
        .prepare(
          `
        UPDATE order_share_links
        SET access_count = access_count + 1, last_accessed_at = ?
        WHERE token = ?
      `,
        )
        .run(Date.now(), token);

      return {
        valid: true,
        link: {
          orderId: link.order_id,
          permission: link.permission,
          expiresAt: link.expires_at,
          accessCount: link.access_count + 1,
        },
      };
    } catch (error) {
      logger.error("[ShareLinkManager] 验证链接失败:", error);
      return {
        valid: false,
        error: error.message,
      };
    }
  }

  /**
   * 撤销分享链接
   * @param {string} orderId - 订单 ID
   * @param {string} token - 可选，指定令牌；不传则撤销该订单所有链接
   * @returns {Promise<{success: boolean, count?: number, error?: string}>}
   */
  async revokeLink(orderId, token = null) {
    if (!this.db) {
      return { success: false, error: "数据库未初始化" };
    }

    try {
      let result;
      if (token) {
        result = this.db
          .prepare(
            `
          UPDATE order_share_links SET is_revoked = 1 WHERE order_id = ? AND token = ?
        `,
          )
          .run(orderId, token);
      } else {
        result = this.db
          .prepare(
            `
          UPDATE order_share_links SET is_revoked = 1 WHERE order_id = ?
        `,
          )
          .run(orderId);
      }

      return {
        success: true,
        count: result.changes,
      };
    } catch (error) {
      logger.error("[ShareLinkManager] 撤销链接失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 获取订单的所有分享链接
   * @param {string} orderId - 订单 ID
   * @returns {Promise<Array>}
   */
  async getLinksForOrder(orderId) {
    if (!this.db) {
      return [];
    }

    try {
      return this.db
        .prepare(
          `
        SELECT * FROM order_share_links
        WHERE order_id = ? AND is_revoked = 0
        ORDER BY created_at DESC
      `,
        )
        .all(orderId);
    } catch (error) {
      logger.error("[ShareLinkManager] 获取链接失败:", error);
      return [];
    }
  }
}

module.exports = {
  exportOrderToPDF,
  exportOrderToImage,
  ShareLinkManager,
  generateOrderHTML,
};
