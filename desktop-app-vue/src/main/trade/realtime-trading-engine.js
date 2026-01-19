/**
 * 实时交易引擎
 *
 * 提供实时交易功能，包括：
 * - 实时订单匹配
 * - 实时价格更新
 * - 订单簿管理
 * - 交易执行
 * - WebSocket通信
 */

const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');

/**
 * 订单类型
 */
const OrderType = {
  MARKET: 'market',       // 市价单
  LIMIT: 'limit',         // 限价单
  STOP_LOSS: 'stop_loss', // 止损单
  STOP_LIMIT: 'stop_limit' // 止损限价单
};

/**
 * 订单方向
 */
const OrderSide = {
  BUY: 'buy',
  SELL: 'sell'
};

/**
 * 订单状态
 */
const OrderStatus = {
  PENDING: 'pending',       // 待处理
  OPEN: 'open',             // 已开启
  PARTIAL: 'partial',       // 部分成交
  FILLED: 'filled',         // 完全成交
  CANCELLED: 'cancelled',   // 已取消
  REJECTED: 'rejected'      // 已拒绝
};

/**
 * 实时交易引擎类
 */
class RealtimeTradingEngine extends EventEmitter {
  constructor(database, marketplaceManager, assetManager, escrowManager) {
    super();

    this.database = database;
    this.marketplaceManager = marketplaceManager;
    this.assetManager = assetManager;
    this.escrowManager = escrowManager;

    this.orderBooks = new Map(); // 订单簿 {assetId: OrderBook}
    this.activeOrders = new Map(); // 活跃订单 {orderId: Order}
    this.priceFeeds = new Map(); // 价格源 {assetId: PriceFeed}

    this.matchingInterval = null;
    this.priceUpdateInterval = null;

    this.initialized = false;
  }

  /**
   * 初始化交易引擎
   */
  async initialize() {
    console.log('[RealtimeTradingEngine] 初始化实时交易引擎...');

    try {
      // 加载活跃订单
      await this.loadActiveOrders();

      // 初始化订单簿
      await this.initializeOrderBooks();

      // 启动订单匹配引擎（每秒执行一次）
      this.startMatching(1000);

      // 启动价格更新（每5秒更新一次）
      this.startPriceUpdates(5000);

      this.initialized = true;
      console.log('[RealtimeTradingEngine] 实时交易引擎初始化成功');
    } catch (error) {
      console.error('[RealtimeTradingEngine] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 加载活跃订单
   */
  async loadActiveOrders() {
    const sql = `
      SELECT * FROM marketplace_orders
      WHERE status IN ('open', 'partial')
      ORDER BY created_at ASC
    `;

    const orders = await this.database.all(sql);

    for (const order of orders) {
      this.activeOrders.set(order.id, order);
    }

    console.log(`[RealtimeTradingEngine] 加载了 ${orders.length} 个活跃订单`);
  }

  /**
   * 初始化订单簿
   */
  async initializeOrderBooks() {
    // 获取所有有活跃订单的资产
    const sql = `
      SELECT DISTINCT asset_id FROM marketplace_orders
      WHERE status IN ('open', 'partial')
    `;

    const results = await this.database.all(sql);

    for (const row of results) {
      const orderBook = new OrderBook(row.asset_id);

      // 加载该资产的所有活跃订单
      const orders = Array.from(this.activeOrders.values())
        .filter(o => o.asset_id === row.asset_id);

      for (const order of orders) {
        orderBook.addOrder(order);
      }

      this.orderBooks.set(row.asset_id, orderBook);
    }

    console.log(`[RealtimeTradingEngine] 初始化了 ${this.orderBooks.size} 个订单簿`);
  }

  /**
   * 提交订单
   * @param {Object} orderData - 订单数据
   * @returns {Promise<Object>} 订单结果
   */
  async submitOrder(orderData) {
    try {
      // 验证订单
      this.validateOrder(orderData);

      // 创建订单
      const order = {
        id: uuidv4(),
        ...orderData,
        status: OrderStatus.PENDING,
        filled_quantity: 0,
        remaining_quantity: orderData.quantity,
        created_at: Date.now(),
        updated_at: Date.now()
      };

      // 检查资产余额
      await this.checkBalance(order);

      // 保存订单到数据库
      await this.saveOrder(order);

      // 添加到活跃订单
      this.activeOrders.set(order.id, order);

      // 添加到订单簿
      let orderBook = this.orderBooks.get(order.asset_id);
      if (!orderBook) {
        orderBook = new OrderBook(order.asset_id);
        this.orderBooks.set(order.asset_id, orderBook);
      }
      orderBook.addOrder(order);

      // 更新订单状态为开启
      order.status = OrderStatus.OPEN;
      await this.updateOrder(order);

      // 触发订单事件
      this.emit('order:submitted', order);

      // 如果是市价单，立即尝试匹配
      if (order.order_type === OrderType.MARKET) {
        await this.matchOrder(order);
      }

      return {
        success: true,
        order
      };
    } catch (error) {
      console.error('[RealtimeTradingEngine] 提交订单失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 验证订单
   */
  validateOrder(orderData) {
    if (!orderData.asset_id) {
      throw new Error('缺少资产ID');
    }

    if (!orderData.order_type || !Object.values(OrderType).includes(orderData.order_type)) {
      throw new Error('无效的订单类型');
    }

    if (!orderData.side || !Object.values(OrderSide).includes(orderData.side)) {
      throw new Error('无效的订单方向');
    }

    if (!orderData.quantity || orderData.quantity <= 0) {
      throw new Error('无效的订单数量');
    }

    if (orderData.order_type === OrderType.LIMIT && (!orderData.price || orderData.price <= 0)) {
      throw new Error('限价单必须指定价格');
    }
  }

  /**
   * 检查余额
   */
  async checkBalance(order) {
    if (order.side === OrderSide.SELL) {
      // 卖单：检查资产余额
      const asset = await this.assetManager.getAsset(order.asset_id);
      if (!asset || asset.quantity < order.quantity) {
        throw new Error('资产余额不足');
      }
    } else {
      // 买单：检查资金余额（这里简化处理）
      // 实际应该检查用户的资金账户
      const requiredAmount = order.price * order.quantity;
      // TODO: 实现资金余额检查
    }
  }

  /**
   * 保存订单
   */
  async saveOrder(order) {
    const sql = `
      INSERT INTO marketplace_orders (
        id, asset_id, user_did, order_type, side, quantity,
        price, filled_quantity, remaining_quantity, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await this.database.run(sql, [
      order.id,
      order.asset_id,
      order.user_did,
      order.order_type,
      order.side,
      order.quantity,
      order.price || null,
      order.filled_quantity,
      order.remaining_quantity,
      order.status,
      order.created_at,
      order.updated_at
    ]);
  }

  /**
   * 更新订单
   */
  async updateOrder(order) {
    const sql = `
      UPDATE marketplace_orders
      SET filled_quantity = ?,
          remaining_quantity = ?,
          status = ?,
          updated_at = ?
      WHERE id = ?
    `;

    await this.database.run(sql, [
      order.filled_quantity,
      order.remaining_quantity,
      order.status,
      Date.now(),
      order.id
    ]);

    // 触发订单更新事件
    this.emit('order:updated', order);
  }

  /**
   * 取消订单
   * @param {string} orderId - 订单ID
   * @returns {Promise<boolean>}
   */
  async cancelOrder(orderId) {
    try {
      const order = this.activeOrders.get(orderId);
      if (!order) {
        throw new Error('订单不存在');
      }

      if (order.status !== OrderStatus.OPEN && order.status !== OrderStatus.PARTIAL) {
        throw new Error('订单状态不允许取消');
      }

      // 更新订单状态
      order.status = OrderStatus.CANCELLED;
      order.updated_at = Date.now();

      await this.updateOrder(order);

      // 从活跃订单中移除
      this.activeOrders.delete(orderId);

      // 从订单簿中移除
      const orderBook = this.orderBooks.get(order.asset_id);
      if (orderBook) {
        orderBook.removeOrder(order);
      }

      // 触发取消事件
      this.emit('order:cancelled', order);

      return true;
    } catch (error) {
      console.error('[RealtimeTradingEngine] 取消订单失败:', error);
      return false;
    }
  }

  /**
   * 启动订单匹配
   */
  startMatching(interval) {
    this.matchingInterval = setInterval(async () => {
      await this.matchAllOrders();
    }, interval);
  }

  /**
   * 匹配所有订单
   */
  async matchAllOrders() {
    for (const [assetId, orderBook] of this.orderBooks) {
      await this.matchOrderBook(orderBook);
    }
  }

  /**
   * 匹配订单簿
   */
  async matchOrderBook(orderBook) {
    const matches = orderBook.findMatches();

    for (const match of matches) {
      await this.executeMatch(match);
    }
  }

  /**
   * 匹配单个订单
   */
  async matchOrder(order) {
    const orderBook = this.orderBooks.get(order.asset_id);
    if (!orderBook) {return;}

    const matches = orderBook.findMatchesForOrder(order);

    for (const match of matches) {
      await this.executeMatch(match);
    }
  }

  /**
   * 执行匹配
   */
  async executeMatch(match) {
    try {
      const { buyOrder, sellOrder, quantity, price } = match;

      console.log(`[RealtimeTradingEngine] 执行匹配: ${quantity} @ ${price}`);

      // 更新买单
      buyOrder.filled_quantity += quantity;
      buyOrder.remaining_quantity -= quantity;
      if (buyOrder.remaining_quantity === 0) {
        buyOrder.status = OrderStatus.FILLED;
        this.activeOrders.delete(buyOrder.id);
      } else {
        buyOrder.status = OrderStatus.PARTIAL;
      }
      await this.updateOrder(buyOrder);

      // 更新卖单
      sellOrder.filled_quantity += quantity;
      sellOrder.remaining_quantity -= quantity;
      if (sellOrder.remaining_quantity === 0) {
        sellOrder.status = OrderStatus.FILLED;
        this.activeOrders.delete(sellOrder.id);
      } else {
        sellOrder.status = OrderStatus.PARTIAL;
      }
      await this.updateOrder(sellOrder);

      // 创建交易记录
      await this.createTrade({
        buyOrderId: buyOrder.id,
        sellOrderId: sellOrder.id,
        assetId: buyOrder.asset_id,
        quantity,
        price,
        buyerDid: buyOrder.user_did,
        sellerDid: sellOrder.user_did
      });

      // 触发匹配事件
      this.emit('trade:executed', {
        buyOrder,
        sellOrder,
        quantity,
        price
      });

      // 更新价格
      await this.updatePrice(buyOrder.asset_id, price);

    } catch (error) {
      console.error('[RealtimeTradingEngine] 执行匹配失败:', error);
    }
  }

  /**
   * 创建交易记录
   */
  async createTrade(tradeData) {
    const sql = `
      INSERT INTO trades (
        id, buy_order_id, sell_order_id, asset_id,
        quantity, price, buyer_did, seller_did,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const tradeId = uuidv4();

    await this.database.run(sql, [
      tradeId,
      tradeData.buyOrderId,
      tradeData.sellOrderId,
      tradeData.assetId,
      tradeData.quantity,
      tradeData.price,
      tradeData.buyerDid,
      tradeData.sellerDid,
      Date.now()
    ]);

    return tradeId;
  }

  /**
   * 启动价格更新
   */
  startPriceUpdates(interval) {
    this.priceUpdateInterval = setInterval(async () => {
      await this.updateAllPrices();
    }, interval);
  }

  /**
   * 更新所有价格
   */
  async updateAllPrices() {
    for (const [assetId, orderBook] of this.orderBooks) {
      const price = orderBook.getCurrentPrice();
      if (price) {
        await this.updatePrice(assetId, price);
      }
    }
  }

  /**
   * 更新价格
   */
  async updatePrice(assetId, price) {
    let priceFeed = this.priceFeeds.get(assetId);

    if (!priceFeed) {
      priceFeed = {
        assetId,
        prices: [],
        currentPrice: price,
        lastUpdate: Date.now()
      };
      this.priceFeeds.set(assetId, priceFeed);
    }

    priceFeed.prices.push({
      price,
      timestamp: Date.now()
    });

    // 只保留最近100个价格
    if (priceFeed.prices.length > 100) {
      priceFeed.prices = priceFeed.prices.slice(-100);
    }

    priceFeed.currentPrice = price;
    priceFeed.lastUpdate = Date.now();

    // 触发价格更新事件
    this.emit('price:updated', {
      assetId,
      price,
      timestamp: Date.now()
    });
  }

  /**
   * 获取订单簿
   */
  getOrderBook(assetId) {
    return this.orderBooks.get(assetId);
  }

  /**
   * 获取价格源
   */
  getPriceFeed(assetId) {
    return this.priceFeeds.get(assetId);
  }

  /**
   * 获取活跃订单
   */
  getActiveOrders(assetId = null) {
    if (assetId) {
      return Array.from(this.activeOrders.values())
        .filter(o => o.asset_id === assetId);
    }
    return Array.from(this.activeOrders.values());
  }

  /**
   * 销毁交易引擎
   */
  async destroy() {
    if (this.matchingInterval) {
      clearInterval(this.matchingInterval);
    }

    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
    }

    this.orderBooks.clear();
    this.activeOrders.clear();
    this.priceFeeds.clear();
    this.removeAllListeners();

    this.initialized = false;
  }
}

/**
 * 订单簿类
 */
class OrderBook {
  constructor(assetId) {
    this.assetId = assetId;
    this.buyOrders = []; // 买单（按价格降序）
    this.sellOrders = []; // 卖单（按价格升序）
  }

  /**
   * 添加订单
   */
  addOrder(order) {
    if (order.side === OrderSide.BUY) {
      this.buyOrders.push(order);
      this.buyOrders.sort((a, b) => b.price - a.price); // 降序
    } else {
      this.sellOrders.push(order);
      this.sellOrders.sort((a, b) => a.price - b.price); // 升序
    }
  }

  /**
   * 移除订单
   */
  removeOrder(order) {
    if (order.side === OrderSide.BUY) {
      this.buyOrders = this.buyOrders.filter(o => o.id !== order.id);
    } else {
      this.sellOrders = this.sellOrders.filter(o => o.id !== order.id);
    }
  }

  /**
   * 查找匹配
   */
  findMatches() {
    const matches = [];

    while (this.buyOrders.length > 0 && this.sellOrders.length > 0) {
      const buyOrder = this.buyOrders[0];
      const sellOrder = this.sellOrders[0];

      // 检查价格是否匹配
      if (buyOrder.price < sellOrder.price) {
        break;
      }

      // 计算成交数量
      const quantity = Math.min(buyOrder.remaining_quantity, sellOrder.remaining_quantity);

      // 成交价格（取卖单价格）
      const price = sellOrder.price;

      matches.push({
        buyOrder,
        sellOrder,
        quantity,
        price
      });

      // 更新剩余数量
      buyOrder.remaining_quantity -= quantity;
      sellOrder.remaining_quantity -= quantity;

      // 移除已完成的订单
      if (buyOrder.remaining_quantity === 0) {
        this.buyOrders.shift();
      }
      if (sellOrder.remaining_quantity === 0) {
        this.sellOrders.shift();
      }
    }

    return matches;
  }

  /**
   * 为特定订单查找匹配
   */
  findMatchesForOrder(order) {
    const matches = [];

    if (order.side === OrderSide.BUY) {
      // 买单匹配卖单
      for (const sellOrder of this.sellOrders) {
        if (order.remaining_quantity === 0) {break;}

        if (order.order_type === OrderType.MARKET || order.price >= sellOrder.price) {
          const quantity = Math.min(order.remaining_quantity, sellOrder.remaining_quantity);
          matches.push({
            buyOrder: order,
            sellOrder,
            quantity,
            price: sellOrder.price
          });

          order.remaining_quantity -= quantity;
          sellOrder.remaining_quantity -= quantity;
        }
      }
    } else {
      // 卖单匹配买单
      for (const buyOrder of this.buyOrders) {
        if (order.remaining_quantity === 0) {break;}

        if (order.order_type === OrderType.MARKET || order.price <= buyOrder.price) {
          const quantity = Math.min(order.remaining_quantity, buyOrder.remaining_quantity);
          matches.push({
            buyOrder,
            sellOrder: order,
            quantity,
            price: buyOrder.price
          });

          order.remaining_quantity -= quantity;
          buyOrder.remaining_quantity -= quantity;
        }
      }
    }

    return matches;
  }

  /**
   * 获取当前价格（最新成交价）
   */
  getCurrentPrice() {
    if (this.buyOrders.length > 0 && this.sellOrders.length > 0) {
      // 取买卖价格的中间值
      return (this.buyOrders[0].price + this.sellOrders[0].price) / 2;
    } else if (this.buyOrders.length > 0) {
      return this.buyOrders[0].price;
    } else if (this.sellOrders.length > 0) {
      return this.sellOrders[0].price;
    }
    return null;
  }

  /**
   * 获取订单簿快照
   */
  getSnapshot(depth = 10) {
    return {
      assetId: this.assetId,
      bids: this.buyOrders.slice(0, depth).map(o => ({
        price: o.price,
        quantity: o.remaining_quantity
      })),
      asks: this.sellOrders.slice(0, depth).map(o => ({
        price: o.price,
        quantity: o.remaining_quantity
      })),
      timestamp: Date.now()
    };
  }
}

module.exports = {
  RealtimeTradingEngine,
  OrderBook,
  OrderType,
  OrderSide,
  OrderStatus
};
