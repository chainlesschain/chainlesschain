/**
 * Installment Manager - 分期付款管理器
 *
 * 支持分期付款计划创建、审批、还款、逾期处理
 * 集成信用评分系统进行风控
 *
 * @module trade/installment-manager
 * @version 1.0.0
 */

const { logger } = require("../utils/logger.js");
const { EventEmitter } = require("events");
const { v4: uuidv4 } = require("uuid");

const InstallmentStatus = {
  PENDING: "pending",
  APPROVED: "approved",
  ACTIVE: "active",
  COMPLETED: "completed",
  OVERDUE: "overdue",
  DEFAULTED: "defaulted",
  REJECTED: "rejected",
};

class InstallmentManager extends EventEmitter {
  constructor(database, escrowManager, creditScoreManager) {
    super();

    this.database = database;
    this.escrowManager = escrowManager;
    this.creditScoreManager = creditScoreManager;
    this.initialized = false;
  }

  async initialize() {
    logger.info("[InstallmentManager] 初始化分期付款管理器...");

    try {
      await this._initializeTables();
      this.initialized = true;
      logger.info("[InstallmentManager] 分期付款管理器初始化成功");
    } catch (error) {
      logger.error("[InstallmentManager] 初始化失败:", error);
      throw error;
    }
  }

  async _initializeTables() {
    const db = this.database?.db;
    if (!db) {
      return;
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS installment_plans (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        buyer_id TEXT NOT NULL,
        seller_id TEXT NOT NULL,
        total_amount REAL NOT NULL,
        installments INTEGER NOT NULL,
        interest_rate REAL DEFAULT 0,
        paid_count INTEGER DEFAULT 0,
        paid_amount REAL DEFAULT 0,
        next_due_date INTEGER,
        status TEXT DEFAULT 'pending',
        credit_check_result TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now')),
        updated_at INTEGER DEFAULT (strftime('%s','now'))
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS installment_payments (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        installment_number INTEGER NOT NULL,
        amount REAL NOT NULL,
        due_date INTEGER NOT NULL,
        paid_date INTEGER,
        status TEXT DEFAULT 'pending',
        FOREIGN KEY (plan_id) REFERENCES installment_plans(id)
      )
    `);
  }

  async createPlan(params) {
    const {
      orderId,
      buyerId,
      sellerId,
      totalAmount,
      installments = 3,
      interestRate = 0,
    } = params;

    if (!orderId || !buyerId || !sellerId || !totalAmount) {
      throw new Error("Missing required fields");
    }
    if (installments < 2 || installments > 24) {
      throw new Error("Installments must be between 2 and 24");
    }
    if (interestRate < 0) {
      throw new Error("Interest rate cannot be negative");
    }

    const db = this.database?.db;
    if (!db) {
      throw new Error("Database not available");
    }

    const id = uuidv4();
    const now = Math.floor(Date.now() / 1000);
    const schedule = this._calculateSchedule(
      totalAmount,
      installments,
      interestRate,
    );

    db.prepare(
      `INSERT INTO installment_plans (id, order_id, buyer_id, seller_id, total_amount,
       installments, interest_rate, next_due_date, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    ).run(
      id,
      orderId,
      buyerId,
      sellerId,
      totalAmount,
      installments,
      interestRate,
      schedule[0].dueDate,
      now,
      now,
    );

    const stmt = db.prepare(
      `INSERT INTO installment_payments (id, plan_id, installment_number, amount, due_date, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
    );

    for (const payment of schedule) {
      stmt.run(uuidv4(), id, payment.number, payment.amount, payment.dueDate);
    }

    this.emit("plan-created", {
      id,
      orderId,
      buyerId,
      totalAmount,
      installments,
    });
    logger.info(`[InstallmentManager] 分期计划创建成功: ${id}`);

    return this.getPlan(id);
  }

  async approvePlan(planId) {
    const db = this.database?.db;
    if (!db) {
      throw new Error("Database not available");
    }

    const plan = this.getPlan(planId);
    if (!plan) {
      throw new Error("Plan not found");
    }
    if (plan.status !== InstallmentStatus.PENDING) {
      throw new Error("Plan is not pending");
    }

    let creditResult = { level: 3, approved: true };
    if (this.creditScoreManager) {
      try {
        const score = await this.creditScoreManager.getScore(plan.buyer_id);
        creditResult = {
          level: score?.level || 3,
          approved: (score?.level || 3) >= 2,
        };
      } catch {
        // Default approve on credit check failure
      }
    }

    const now = Math.floor(Date.now() / 1000);
    const newStatus = creditResult.approved
      ? InstallmentStatus.ACTIVE
      : InstallmentStatus.REJECTED;

    db.prepare(
      "UPDATE installment_plans SET status = ?, credit_check_result = ?, updated_at = ? WHERE id = ?",
    ).run(newStatus, JSON.stringify(creditResult), now, planId);

    this.emit("plan-approved", { planId, status: newStatus, creditResult });
    return this.getPlan(planId);
  }

  async makePayment(planId, amount) {
    const db = this.database?.db;
    if (!db) {
      throw new Error("Database not available");
    }

    const plan = this.getPlan(planId);
    if (!plan) {
      throw new Error("Plan not found");
    }
    if (
      plan.status !== InstallmentStatus.ACTIVE &&
      plan.status !== InstallmentStatus.OVERDUE
    ) {
      throw new Error("Plan is not active");
    }

    const nextPayment = db
      .prepare(
        "SELECT * FROM installment_payments WHERE plan_id = ? AND status = 'pending' ORDER BY installment_number ASC LIMIT 1",
      )
      .get(planId);

    if (!nextPayment) {
      throw new Error("No pending payments");
    }

    const now = Math.floor(Date.now() / 1000);
    const payAmount = amount || nextPayment.amount;

    db.prepare(
      "UPDATE installment_payments SET paid_date = ?, status = 'paid' WHERE id = ?",
    ).run(now, nextPayment.id);

    const newPaidCount = plan.paid_count + 1;
    const newPaidAmount = plan.paid_amount + payAmount;
    const isComplete = newPaidCount >= plan.installments;

    const nextDue = db
      .prepare(
        "SELECT due_date FROM installment_payments WHERE plan_id = ? AND status = 'pending' ORDER BY installment_number ASC LIMIT 1",
      )
      .get(planId);

    db.prepare(
      `UPDATE installment_plans SET paid_count = ?, paid_amount = ?,
       next_due_date = ?, status = ?, updated_at = ? WHERE id = ?`,
    ).run(
      newPaidCount,
      newPaidAmount,
      nextDue?.due_date || null,
      isComplete ? InstallmentStatus.COMPLETED : plan.status,
      now,
      planId,
    );

    this.emit("payment-made", {
      planId,
      amount: payAmount,
      remaining: plan.installments - newPaidCount,
    });
    return this.getPlan(planId);
  }

  getPlan(planId) {
    const db = this.database?.db;
    if (!db) {
      return null;
    }

    const plan = db
      .prepare("SELECT * FROM installment_plans WHERE id = ?")
      .get(planId);
    if (!plan) {
      return null;
    }

    const payments = db
      .prepare(
        "SELECT * FROM installment_payments WHERE plan_id = ? ORDER BY installment_number",
      )
      .all(planId);

    return {
      ...plan,
      payments,
      credit_check_result: plan.credit_check_result
        ? JSON.parse(plan.credit_check_result)
        : null,
    };
  }

  async listPlans(userId, filters = {}) {
    const db = this.database?.db;
    if (!db) {
      return { plans: [], total: 0 };
    }

    const { status, role = "buyer", limit = 20, offset = 0 } = filters;
    const userField = role === "seller" ? "seller_id" : "buyer_id";

    let query = `SELECT * FROM installment_plans WHERE ${userField} = ?`;
    let countQuery = `SELECT COUNT(*) as total FROM installment_plans WHERE ${userField} = ?`;
    const params = [userId];

    if (status) {
      query += " AND status = ?";
      countQuery += " AND status = ?";
      params.push(status);
    }

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    const plans = db.prepare(query).all(...params, limit, offset);
    const { total } = db.prepare(countQuery).get(...params);

    return { plans, total };
  }

  async checkOverdue() {
    const db = this.database?.db;
    if (!db) {
      return { checked: 0, overdue: 0 };
    }

    const now = Math.floor(Date.now() / 1000);

    const overduePayments = db
      .prepare(
        `SELECT DISTINCT p.plan_id FROM installment_payments p
         JOIN installment_plans pl ON p.plan_id = pl.id
         WHERE p.status = 'pending' AND p.due_date < ? AND pl.status = 'active'`,
      )
      .all(now);

    for (const { plan_id } of overduePayments) {
      db.prepare(
        "UPDATE installment_plans SET status = 'overdue', updated_at = ? WHERE id = ?",
      ).run(now, plan_id);
      this.emit("plan-overdue", { planId: plan_id });
    }

    return { checked: overduePayments.length, overdue: overduePayments.length };
  }

  async handleDefault(planId) {
    const db = this.database?.db;
    if (!db) {
      throw new Error("Database not available");
    }

    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      "UPDATE installment_plans SET status = 'defaulted', updated_at = ? WHERE id = ?",
    ).run(now, planId);

    const plan = this.getPlan(planId);
    if (plan && this.creditScoreManager) {
      try {
        await this.creditScoreManager.recordEvent(plan.buyer_id, "default", {
          planId,
          amount: plan.total_amount - plan.paid_amount,
        });
      } catch {
        // Credit score update failure is non-blocking
      }
    }

    this.emit("plan-defaulted", { planId });
    return this.getPlan(planId);
  }

  getSchedule(planId) {
    const plan = this.getPlan(planId);
    if (!plan) {
      return null;
    }
    return plan.payments;
  }

  _calculateSchedule(totalAmount, installments, interestRate) {
    const schedule = [];
    const now = Math.floor(Date.now() / 1000);
    const totalWithInterest = totalAmount * (1 + interestRate);
    const perPayment =
      Math.ceil((totalWithInterest / installments) * 100) / 100;

    for (let i = 1; i <= installments; i++) {
      const isLast = i === installments;
      const paid = perPayment * (i - 1);
      schedule.push({
        number: i,
        amount: isLast
          ? Math.round((totalWithInterest - paid) * 100) / 100
          : perPayment,
        dueDate: now + i * 30 * 86400,
      });
    }

    return schedule;
  }
}

module.exports = { InstallmentManager, InstallmentStatus };
