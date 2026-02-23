/**
 * Lending Manager - P2P借贷管理器
 *
 * 支持借贷池创建、贷款申请/审批、还款、清算
 * 集成信用评分和托管系统
 *
 * @module defi/lending-manager
 * @version 1.0.0
 */

const { logger } = require("../utils/logger.js");
const { EventEmitter } = require("events");
const { v4: uuidv4 } = require("uuid");

const PoolStatus = {
  ACTIVE: "active",
  PAUSED: "paused",
  CLOSED: "closed",
  DEPLETED: "depleted",
};

const LoanStatus = {
  PENDING: "pending",
  APPROVED: "approved",
  ACTIVE: "active",
  REPAID: "repaid",
  DEFAULTED: "defaulted",
  LIQUIDATED: "liquidated",
  REJECTED: "rejected",
};

class LendingManager extends EventEmitter {
  constructor(database, creditScoreManager, escrowManager) {
    super();

    this.database = database;
    this.creditScoreManager = creditScoreManager;
    this.escrowManager = escrowManager;
    this.initialized = false;
  }

  async initialize() {
    logger.info("[LendingManager] 初始化P2P借贷管理器...");

    try {
      await this._initializeTables();
      this.initialized = true;
      logger.info("[LendingManager] P2P借贷管理器初始化成功");
    } catch (error) {
      logger.error("[LendingManager] 初始化失败:", error);
      throw error;
    }
  }

  async _initializeTables() {
    const db = this.database?.db;
    if (!db) {
      return;
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS lending_pools (
        id TEXT PRIMARY KEY,
        lender_id TEXT NOT NULL,
        total_amount REAL NOT NULL,
        available_amount REAL NOT NULL,
        interest_rate REAL NOT NULL,
        term_days INTEGER NOT NULL,
        min_credit_level INTEGER DEFAULT 1,
        active_loans INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        created_at INTEGER DEFAULT (strftime('%s','now')),
        updated_at INTEGER DEFAULT (strftime('%s','now'))
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS loans (
        id TEXT PRIMARY KEY,
        pool_id TEXT NOT NULL,
        borrower_id TEXT NOT NULL,
        amount REAL NOT NULL,
        collateral_amount REAL DEFAULT 0,
        collateral_asset TEXT,
        interest_rate REAL NOT NULL,
        term_days INTEGER NOT NULL,
        repaid_amount REAL DEFAULT 0,
        due_date INTEGER,
        ltv_ratio REAL,
        status TEXT DEFAULT 'pending',
        created_at INTEGER DEFAULT (strftime('%s','now')),
        updated_at INTEGER DEFAULT (strftime('%s','now')),
        FOREIGN KEY (pool_id) REFERENCES lending_pools(id)
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS loan_payments (
        id TEXT PRIMARY KEY,
        loan_id TEXT NOT NULL,
        amount REAL NOT NULL,
        principal REAL NOT NULL,
        interest REAL NOT NULL,
        payment_date INTEGER DEFAULT (strftime('%s','now')),
        FOREIGN KEY (loan_id) REFERENCES loans(id)
      )
    `);
  }

  async createLendingPool(params) {
    const {
      lenderId,
      totalAmount,
      interestRate,
      termDays = 30,
      minCreditLevel = 1,
    } = params;

    if (!lenderId || totalAmount == null || interestRate == null) {
      throw new Error(
        "Missing required fields: lenderId, totalAmount, interestRate",
      );
    }
    if (totalAmount <= 0) {
      throw new Error("Total amount must be positive");
    }
    if (interestRate < 0 || interestRate > 1) {
      throw new Error("Interest rate must be between 0 and 1");
    }
    if (termDays <= 0) {
      throw new Error("Term must be at least 1 day");
    }

    const db = this.database?.db;
    if (!db) {
      throw new Error("Database not available");
    }

    const id = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    db.prepare(
      `INSERT INTO lending_pools (id, lender_id, total_amount, available_amount,
       interest_rate, term_days, min_credit_level, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).run(
      id,
      lenderId,
      totalAmount,
      totalAmount,
      interestRate,
      termDays,
      minCreditLevel,
      now,
      now,
    );

    this.emit("pool-created", { id, lenderId, totalAmount, interestRate });
    logger.info(`[LendingManager] 借贷池创建成功: ${id}`);

    return this.getPool(id);
  }

  async requestLoan(params) {
    const { poolId, borrowerId, amount, collateral = {} } = params;

    if (!poolId || !borrowerId || !amount) {
      throw new Error("Missing required fields: poolId, borrowerId, amount");
    }

    const db = this.database?.db;
    if (!db) {
      throw new Error("Database not available");
    }

    const pool = this.getPool(poolId);
    if (!pool) {
      throw new Error("Lending pool not found");
    }
    if (pool.status !== PoolStatus.ACTIVE) {
      throw new Error("Pool is not active");
    }
    if (amount > pool.available_amount) {
      throw new Error("Insufficient pool liquidity");
    }
    if (pool.lender_id === borrowerId) {
      throw new Error("Lender cannot borrow from own pool");
    }

    const id = uuidv4();
    const now = Math.floor(Date.now() / 1000);
    const dueDate = now + pool.term_days * 86400;
    const ltvRatio = collateral.amount ? amount / collateral.amount : null;

    db.prepare(
      `INSERT INTO loans (id, pool_id, borrower_id, amount, collateral_amount,
       collateral_asset, interest_rate, term_days, due_date, ltv_ratio, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    ).run(
      id,
      poolId,
      borrowerId,
      amount,
      collateral.amount || 0,
      collateral.asset || null,
      pool.interest_rate,
      pool.term_days,
      dueDate,
      ltvRatio,
      now,
      now,
    );

    this.emit("loan-requested", { id, poolId, borrowerId, amount });
    logger.info(`[LendingManager] 贷款申请提交: ${id}`);

    return this.getLoan(id);
  }

  async approveLoan(loanId) {
    const db = this.database?.db;
    if (!db) {
      throw new Error("Database not available");
    }

    const loan = this.getLoan(loanId);
    if (!loan) {
      throw new Error("Loan not found");
    }
    if (loan.status !== LoanStatus.PENDING) {
      throw new Error("Loan is not pending");
    }

    let creditCheck = { level: 3, approved: true };
    if (this.creditScoreManager) {
      try {
        const score = await this.creditScoreManager.getScore(loan.borrower_id);
        const pool = this.getPool(loan.pool_id);
        creditCheck = {
          level: score?.level || 3,
          approved: (score?.level || 3) >= (pool?.min_credit_level || 1),
        };
      } catch {
        // Default approve on error
      }
    }

    if (!creditCheck.approved) {
      return this.rejectLoan(loanId, "Insufficient credit level");
    }

    const now = Math.floor(Date.now() / 1000);

    db.prepare(
      "UPDATE lending_pools SET available_amount = available_amount - ?, active_loans = active_loans + 1, updated_at = ? WHERE id = ?",
    ).run(loan.amount, now, loan.pool_id);

    db.prepare(
      "UPDATE loans SET status = 'active', updated_at = ? WHERE id = ?",
    ).run(now, loanId);

    this.emit("loan-approved", {
      loanId,
      borrowerId: loan.borrower_id,
      amount: loan.amount,
    });
    return this.getLoan(loanId);
  }

  async rejectLoan(loanId, reason = "") {
    const db = this.database?.db;
    if (!db) {
      throw new Error("Database not available");
    }

    const loan = this.getLoan(loanId);
    if (!loan) {
      throw new Error("Loan not found");
    }
    if (loan.status !== LoanStatus.PENDING) {
      throw new Error("Loan is not pending");
    }

    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      "UPDATE loans SET status = 'rejected', updated_at = ? WHERE id = ?",
    ).run(now, loanId);

    this.emit("loan-rejected", { loanId, reason });
    return this.getLoan(loanId);
  }

  async repayLoan(loanId, amount) {
    const db = this.database?.db;
    if (!db) {
      throw new Error("Database not available");
    }

    const loan = this.getLoan(loanId);
    if (!loan) {
      throw new Error("Loan not found");
    }
    if (loan.status !== LoanStatus.ACTIVE) {
      throw new Error("Loan is not active");
    }
    if (!amount || amount <= 0) {
      throw new Error("Payment amount must be positive");
    }

    const totalOwed =
      loan.amount * (1 + loan.interest_rate) - loan.repaid_amount;
    const payAmount = Math.min(amount || totalOwed, totalOwed);
    const interestPortion =
      payAmount * (loan.interest_rate / (1 + loan.interest_rate));
    const principalPortion = payAmount - interestPortion;

    const paymentId = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    db.prepare(
      `INSERT INTO loan_payments (id, loan_id, amount, principal, interest, payment_date)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(paymentId, loanId, payAmount, principalPortion, interestPortion, now);

    const newRepaid = loan.repaid_amount + payAmount;
    const isFullyRepaid =
      newRepaid >= loan.amount * (1 + loan.interest_rate) - 0.01;

    db.prepare(
      "UPDATE loans SET repaid_amount = ?, status = ?, updated_at = ? WHERE id = ?",
    ).run(
      newRepaid,
      isFullyRepaid ? LoanStatus.REPAID : loan.status,
      now,
      loanId,
    );

    if (isFullyRepaid) {
      db.prepare(
        "UPDATE lending_pools SET available_amount = available_amount + ?, active_loans = MAX(0, active_loans - 1), updated_at = ? WHERE id = ?",
      ).run(loan.amount, now, loan.pool_id);
    }

    this.emit("loan-repaid", {
      loanId,
      amount: payAmount,
      fullyRepaid: isFullyRepaid,
    });
    return this.getLoan(loanId);
  }

  async liquidateLoan(loanId) {
    const db = this.database?.db;
    if (!db) {
      throw new Error("Database not available");
    }

    const loan = this.getLoan(loanId);
    if (!loan) {
      throw new Error("Loan not found");
    }
    if (loan.status !== LoanStatus.ACTIVE) {
      throw new Error("Loan is not active");
    }

    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      "UPDATE loans SET status = 'liquidated', updated_at = ? WHERE id = ?",
    ).run(now, loanId);

    db.prepare(
      "UPDATE lending_pools SET available_amount = available_amount + ?, active_loans = MAX(0, active_loans - 1), updated_at = ? WHERE id = ?",
    ).run(Math.min(loan.collateral_amount, loan.amount), now, loan.pool_id);

    this.emit("loan-liquidated", {
      loanId,
      collateral: loan.collateral_amount,
    });
    return this.getLoan(loanId);
  }

  getPool(poolId) {
    const db = this.database?.db;
    if (!db) {
      return null;
    }
    return db.prepare("SELECT * FROM lending_pools WHERE id = ?").get(poolId);
  }

  getLoan(loanId) {
    const db = this.database?.db;
    if (!db) {
      return null;
    }

    const loan = db.prepare("SELECT * FROM loans WHERE id = ?").get(loanId);
    if (!loan) {
      return null;
    }

    const payments = db
      .prepare(
        "SELECT * FROM loan_payments WHERE loan_id = ? ORDER BY payment_date",
      )
      .all(loanId);

    return { ...loan, payments };
  }

  async listPools(filters = {}) {
    const db = this.database?.db;
    if (!db) {
      return { pools: [], total: 0 };
    }

    const { status, limit = 20, offset = 0 } = filters;
    let query = "SELECT * FROM lending_pools";
    let countQuery = "SELECT COUNT(*) as total FROM lending_pools";
    const params = [];

    if (status) {
      query += " WHERE status = ?";
      countQuery += " WHERE status = ?";
      params.push(status);
    }

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    const pools = db.prepare(query).all(...params, limit, offset);
    const { total } = db.prepare(countQuery).get(...params);

    return { pools, total };
  }

  async listLoans(userId, filters = {}) {
    const db = this.database?.db;
    if (!db) {
      return { loans: [], total: 0 };
    }

    const { status, role = "borrower", limit = 20, offset = 0 } = filters;
    let query, countQuery;
    const params = [];

    if (role === "lender") {
      query =
        "SELECT l.* FROM loans l JOIN lending_pools p ON l.pool_id = p.id WHERE p.lender_id = ?";
      countQuery =
        "SELECT COUNT(*) as total FROM loans l JOIN lending_pools p ON l.pool_id = p.id WHERE p.lender_id = ?";
    } else {
      query = "SELECT * FROM loans WHERE borrower_id = ?";
      countQuery = "SELECT COUNT(*) as total FROM loans WHERE borrower_id = ?";
    }
    params.push(userId);

    if (status) {
      query += " AND status = ?";
      countQuery += " AND status = ?";
      params.push(status);
    }

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    const loans = db.prepare(query).all(...params, limit, offset);
    const { total } = db.prepare(countQuery).get(...params);

    return { loans, total };
  }

  async calculateInterest(loanId) {
    const loan = this.getLoan(loanId);
    if (!loan) {
      return null;
    }

    const totalOwed = loan.amount * (1 + loan.interest_rate);
    const remaining = totalOwed - loan.repaid_amount;

    return {
      principal: loan.amount,
      interestRate: loan.interest_rate,
      totalInterest: loan.amount * loan.interest_rate,
      totalOwed,
      repaid: loan.repaid_amount,
      remaining: Math.max(0, remaining),
    };
  }

  async checkLoanHealth() {
    const db = this.database?.db;
    if (!db) {
      return { checked: 0, unhealthy: 0 };
    }

    const now = Math.floor(Date.now() / 1000);
    const activeLoans = db
      .prepare("SELECT * FROM loans WHERE status = 'active'")
      .all();

    let unhealthy = 0;
    for (const loan of activeLoans) {
      if (loan.due_date && now > loan.due_date) {
        db.prepare(
          "UPDATE loans SET status = 'defaulted', updated_at = ? WHERE id = ?",
        ).run(now, loan.id);
        unhealthy++;
        this.emit("loan-defaulted", { loanId: loan.id });
      } else if (loan.ltv_ratio && loan.ltv_ratio > 0.9) {
        unhealthy++;
        this.emit("loan-unhealthy", {
          loanId: loan.id,
          ltvRatio: loan.ltv_ratio,
        });
      }
    }

    return { checked: activeLoans.length, unhealthy };
  }
}

module.exports = { LendingManager, PoolStatus, LoanStatus };
