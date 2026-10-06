"use strict";

const {
  goalError,
  validateGoalRecord,
  createGoalRecord,
  reviseGoalRecord,
  completeGoalRecord,
} = require("./goal-contract.js");
const {
  digestBusinessObjectContent,
} = require("./business-object-contract.js");

function checkedInput(value) {
  try {
    digestBusinessObjectContent(value);
  } catch {
    throw goalError("GOAL_INVALID_REQUEST");
  }
  return value;
}

/** Adapters must compare and transform under their storage transaction/lock.
 * A repository is not an authorization service. Personal project adapters must
 * resolve current host identity and project ownership inside every operation. */
class GoalRepository {
  constructor({
    adapter,
    now = () => new Date().toISOString(),
    verifyCompletion = null,
  }) {
    if (
      !adapter ||
      typeof adapter.storeId !== "string" ||
      ["create", "get", "compareAndSwap", "list"].some(
        (key) => typeof adapter[key] !== "function",
      )
    )
      throw goalError("GOAL_INVALID_ADAPTER");
    if (
      typeof now !== "function" ||
      (verifyCompletion !== null && typeof verifyCompletion !== "function")
    )
      throw goalError("GOAL_INVALID_HOST");
    this.adapter = adapter;
    this.now = now;
    this.verifyCompletion = verifyCompletion;
  }
  _validate(value) {
    const record = validateGoalRecord(value);
    if (record.storeId !== this.adapter.storeId)
      throw goalError("GOAL_STORE_MISMATCH");
    return record;
  }
  create(input) {
    checkedInput(input);
    return this._validate(
      this.adapter.create(
        createGoalRecord({
          ...input,
          storeId: this.adapter.storeId,
          createdAt: this.now(),
        }),
      ),
    );
  }
  get(id) {
    const record = this.adapter.get(id);
    return record === null ? null : this._validate(record);
  }
  list(options = {}) {
    return this.adapter.list(options).map((record) => this._validate(record));
  }
  revise(input) {
    const { id, expectedRevision, patch } = checkedInput(input);
    return this._validate(
      this.adapter.compareAndSwap(id, expectedRevision, (record) =>
        reviseGoalRecord(this._validate(record), patch, this.now()),
      ),
    );
  }
  complete(input) {
    const { id, expectedRevision } = checkedInput(input);
    // Proof is obtained from an injected trusted host checker, not request data.
    if (this.verifyCompletion === null)
      throw goalError("GOAL_VERIFIER_UNAVAILABLE");
    return this._validate(
      this.adapter.compareAndSwap(id, expectedRevision, (record) => {
        const current = this._validate(record);
        const proof = this.verifyCompletion(current);
        if (proof && typeof proof.then === "function")
          throw goalError("GOAL_ASYNC_VERIFIER_UNSUPPORTED");
        return completeGoalRecord(current, proof, this.now());
      }),
    );
  }
}

module.exports = { GoalRepository };
