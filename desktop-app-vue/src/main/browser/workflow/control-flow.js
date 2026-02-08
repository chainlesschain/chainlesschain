/**
 * Control Flow - Conditional and loop logic for browser workflows
 *
 * @module browser/workflow/control-flow
 * @author ChainlessChain Team
 * @since v0.30.0
 */

const { logger } = require("../../utils/logger");
const { createLoopContext, VariableScope } = require("./workflow-variables");

/**
 * Step types enum
 */
const StepType = {
  ACTION: "action", // Browser action
  CONDITION: "condition", // if/else
  LOOP: "loop", // for/while/forEach
  VARIABLE: "variable", // Variable set/modify
  WAIT: "wait", // Wait for condition
  SUBPROCESS: "subprocess", // Sub-workflow call
  GROUP: "group", // Group of steps
  TRY_CATCH: "tryCatch", // Error handling
};

/**
 * Condition operators
 */
const ConditionOperator = {
  // Comparison
  EQUALS: "==",
  NOT_EQUALS: "!=",
  GREATER: ">",
  LESS: "<",
  GREATER_EQUALS: ">=",
  LESS_EQUALS: "<=",

  // String
  CONTAINS: "contains",
  STARTS_WITH: "startsWith",
  ENDS_WITH: "endsWith",
  MATCHES: "matches",

  // Type
  IS_NULL: "isNull",
  IS_NOT_NULL: "isNotNull",
  IS_EMPTY: "isEmpty",
  IS_NOT_EMPTY: "isNotEmpty",

  // Logical
  AND: "and",
  OR: "or",
  NOT: "not",
};

/**
 * Loop types
 */
const LoopType = {
  FOR: "for", // for (i = 0; i < n; i++)
  WHILE: "while", // while (condition)
  FOR_EACH: "forEach", // for item in array
  DO_WHILE: "doWhile", // do { } while (condition)
};

/**
 * Control Flow Manager
 */
class ControlFlowManager {
  constructor(variableManager) {
    this.variables = variableManager;
    this.maxLoopIterations = 1000; // Safety limit
  }

  /**
   * Evaluate a condition expression
   * @param {Object|string} condition - Condition to evaluate
   * @returns {boolean}
   */
  evaluateCondition(condition) {
    // Simple boolean or variable reference
    if (typeof condition === "boolean") {
      return condition;
    }

    if (typeof condition === "string") {
      const value = this.variables.get(condition);
      return Boolean(value);
    }

    // Complex condition object
    if (typeof condition === "object") {
      return this._evaluateConditionObject(condition);
    }

    return false;
  }

  /**
   * Evaluate condition object
   * @param {Object} condition - Condition object
   * @returns {boolean}
   */
  _evaluateConditionObject(condition) {
    const { operator, left, right, conditions } = condition;

    // Logical operators (and/or/not)
    if (operator === ConditionOperator.AND) {
      return conditions.every((c) => this.evaluateCondition(c));
    }

    if (operator === ConditionOperator.OR) {
      return conditions.some((c) => this.evaluateCondition(c));
    }

    if (operator === ConditionOperator.NOT) {
      return !this.evaluateCondition(conditions[0] || left);
    }

    // Get actual values for comparison
    const leftValue = this._resolveValue(left);
    const rightValue =
      right !== undefined ? this._resolveValue(right) : undefined;

    switch (operator) {
      // Comparison
      case ConditionOperator.EQUALS:
      case "===":
        return leftValue === rightValue;

      case ConditionOperator.NOT_EQUALS:
      case "!==":
        return leftValue !== rightValue;

      case ConditionOperator.GREATER:
        return leftValue > rightValue;

      case ConditionOperator.LESS:
        return leftValue < rightValue;

      case ConditionOperator.GREATER_EQUALS:
        return leftValue >= rightValue;

      case ConditionOperator.LESS_EQUALS:
        return leftValue <= rightValue;

      // String operations
      case ConditionOperator.CONTAINS:
        return String(leftValue).includes(String(rightValue));

      case ConditionOperator.STARTS_WITH:
        return String(leftValue).startsWith(String(rightValue));

      case ConditionOperator.ENDS_WITH:
        return String(leftValue).endsWith(String(rightValue));

      case ConditionOperator.MATCHES:
        try {
          const regex = new RegExp(rightValue);
          return regex.test(String(leftValue));
        } catch {
          return false;
        }

      // Type checks
      case ConditionOperator.IS_NULL:
        return leftValue === null || leftValue === undefined;

      case ConditionOperator.IS_NOT_NULL:
        return leftValue !== null && leftValue !== undefined;

      case ConditionOperator.IS_EMPTY:
        return this._isEmpty(leftValue);

      case ConditionOperator.IS_NOT_EMPTY:
        return !this._isEmpty(leftValue);

      default:
        logger.warn("[ControlFlow] Unknown operator", { operator });
        return false;
    }
  }

  /**
   * Resolve a value (variable reference or literal)
   * @param {any} value - Value to resolve
   * @returns {any}
   */
  _resolveValue(value) {
    if (typeof value === "string") {
      // Check if it's a variable reference (starts with $ or no quotes)
      if (value.startsWith("$") || this.variables.has(value)) {
        return this.variables.get(value);
      }
      // Interpolate if contains placeholders
      if (value.includes("${")) {
        return this.variables.interpolate(value);
      }
    }
    return value;
  }

  /**
   * Check if value is empty
   * @param {any} value - Value to check
   * @returns {boolean}
   */
  _isEmpty(value) {
    if (value === null || value === undefined) {
      return true;
    }
    if (typeof value === "string") {
      return value.length === 0;
    }
    if (Array.isArray(value)) {
      return value.length === 0;
    }
    if (typeof value === "object") {
      return Object.keys(value).length === 0;
    }
    return false;
  }

  /**
   * Create a loop iterator
   * @param {Object} loopConfig - Loop configuration
   * @returns {AsyncGenerator}
   */
  async *createLoopIterator(loopConfig) {
    const {
      type,
      variable,
      start,
      end,
      step,
      items,
      condition,
      maxIterations,
    } = loopConfig;
    const max = maxIterations || this.maxLoopIterations;
    let iterations = 0;

    switch (type) {
      case LoopType.FOR: {
        const startVal = this._resolveValue(start) || 0;
        const endVal = this._resolveValue(end);
        const stepVal = this._resolveValue(step) || 1;

        for (let i = startVal; i < endVal && iterations < max; i += stepVal) {
          this.variables.set(variable || "i", i, VariableScope.LOOP);
          const ctx = createLoopContext(
            iterations,
            i,
            Math.ceil((endVal - startVal) / stepVal),
          );
          this._setLoopContext(ctx);
          yield { index: iterations, value: i, context: ctx };
          iterations++;
        }
        break;
      }

      case LoopType.FOR_EACH: {
        const itemsValue = this._resolveValue(items);
        if (!itemsValue || !Array.isArray(itemsValue)) {
          logger.warn("[ControlFlow] forEach items is not an array", { items });
          return;
        }

        for (let i = 0; i < itemsValue.length && iterations < max; i++) {
          this.variables.set(
            variable || "item",
            itemsValue[i],
            VariableScope.LOOP,
          );
          const ctx = createLoopContext(i, itemsValue[i], itemsValue.length);
          this._setLoopContext(ctx);
          yield { index: i, value: itemsValue[i], context: ctx };
          iterations++;
        }
        break;
      }

      case LoopType.WHILE: {
        while (this.evaluateCondition(condition) && iterations < max) {
          const ctx = createLoopContext(iterations, null, -1);
          this._setLoopContext(ctx);
          yield { index: iterations, value: null, context: ctx };
          iterations++;
        }
        break;
      }

      case LoopType.DO_WHILE: {
        do {
          const ctx = createLoopContext(iterations, null, -1);
          this._setLoopContext(ctx);
          yield { index: iterations, value: null, context: ctx };
          iterations++;
        } while (this.evaluateCondition(condition) && iterations < max);
        break;
      }

      default:
        throw new Error(`Unknown loop type: ${type}`);
    }

    // Clear loop scope after completion
    this.variables.clearScope(VariableScope.LOOP);
  }

  /**
   * Set loop context variables
   * @param {Object} context - Loop context
   */
  _setLoopContext(context) {
    const loopScope = VariableScope.LOOP;
    for (const [key, value] of Object.entries(context)) {
      this.variables.set(key, value, loopScope);
    }
  }

  /**
   * Execute a conditional step
   * @param {Object} step - Conditional step
   * @param {Function} executeSteps - Function to execute steps
   * @returns {Promise<Object>} Result
   */
  async executeCondition(step, executeSteps) {
    const { condition, then: thenSteps, else: elseSteps } = step;

    const result = this.evaluateCondition(condition);
    logger.debug("[ControlFlow] Condition evaluated", { condition, result });

    if (result && thenSteps) {
      return {
        branch: "then",
        result: await executeSteps(thenSteps),
      };
    } else if (!result && elseSteps) {
      return {
        branch: "else",
        result: await executeSteps(elseSteps),
      };
    }

    return { branch: "none", result: null };
  }

  /**
   * Execute a loop step
   * @param {Object} step - Loop step
   * @param {Function} executeSteps - Function to execute steps
   * @param {Object} options - Execution options
   * @returns {Promise<Object>} Result
   */
  async executeLoop(step, executeSteps, options = {}) {
    const { loop: loopConfig, steps, breakOn, continueOn } = step;
    const results = [];
    let breakRequested = false;

    for await (const iteration of this.createLoopIterator(loopConfig)) {
      // Check for break condition
      if (breakOn && this.evaluateCondition(breakOn)) {
        logger.debug("[ControlFlow] Break condition met", {
          iteration: iteration.index,
        });
        breakRequested = true;
        break;
      }

      // Check for continue condition
      if (continueOn && this.evaluateCondition(continueOn)) {
        logger.debug("[ControlFlow] Continue condition met", {
          iteration: iteration.index,
        });
        continue;
      }

      try {
        const result = await executeSteps(steps);
        results.push({
          index: iteration.index,
          value: iteration.value,
          result,
        });
      } catch (error) {
        if (options.stopOnError) {
          throw error;
        }
        results.push({
          index: iteration.index,
          value: iteration.value,
          error: error.message,
        });
      }
    }

    return {
      iterations: results.length,
      results,
      breakRequested,
    };
  }

  /**
   * Execute a try-catch step
   * @param {Object} step - Try-catch step
   * @param {Function} executeSteps - Function to execute steps
   * @returns {Promise<Object>} Result
   */
  async executeTryCatch(step, executeSteps) {
    const { try: trySteps, catch: catchSteps, finally: finallySteps } = step;
    let result = null;
    let error = null;

    try {
      result = await executeSteps(trySteps);
    } catch (err) {
      error = err;

      if (catchSteps) {
        // Set error info in variables
        this.variables.set(
          "$error",
          {
            message: err.message,
            name: err.name,
            stack: err.stack,
          },
          VariableScope.STEP,
        );

        result = await executeSteps(catchSteps);
      }
    } finally {
      if (finallySteps) {
        await executeSteps(finallySteps);
      }
    }

    return {
      success: !error,
      result,
      error: error?.message,
    };
  }

  /**
   * Execute a variable step
   * @param {Object} step - Variable step
   * @returns {Object} Result
   */
  executeVariable(step) {
    const { name, value, operation, scope = "global" } = step;

    let finalValue;
    const currentValue = this.variables.get(name);
    const newValue = this._resolveValue(value);

    switch (operation) {
      case "set":
        finalValue = newValue;
        break;

      case "increment":
        finalValue = (currentValue || 0) + (newValue || 1);
        break;

      case "decrement":
        finalValue = (currentValue || 0) - (newValue || 1);
        break;

      case "append":
        if (Array.isArray(currentValue)) {
          finalValue = [...currentValue, newValue];
        } else if (typeof currentValue === "string") {
          finalValue = currentValue + newValue;
        } else {
          finalValue = newValue;
        }
        break;

      case "prepend":
        if (Array.isArray(currentValue)) {
          finalValue = [newValue, ...currentValue];
        } else if (typeof currentValue === "string") {
          finalValue = newValue + currentValue;
        } else {
          finalValue = newValue;
        }
        break;

      case "delete":
        this.variables.delete(name, scope);
        return { deleted: true, name };

      default:
        finalValue = newValue;
    }

    this.variables.set(name, finalValue, scope);

    return {
      name,
      value: finalValue,
      operation: operation || "set",
    };
  }
}

/**
 * Parse a condition string into a condition object
 * @param {string} conditionStr - Condition string like "count > 5 and status == 'active'"
 * @returns {Object} Condition object
 */
function parseConditionString(conditionStr) {
  // Handle logical operators first
  const andParts = conditionStr.split(/\s+and\s+/i);
  if (andParts.length > 1) {
    return {
      operator: ConditionOperator.AND,
      conditions: andParts.map(parseConditionString),
    };
  }

  const orParts = conditionStr.split(/\s+or\s+/i);
  if (orParts.length > 1) {
    return {
      operator: ConditionOperator.OR,
      conditions: orParts.map(parseConditionString),
    };
  }

  // Handle NOT
  if (conditionStr.trim().startsWith("not ")) {
    return {
      operator: ConditionOperator.NOT,
      conditions: [parseConditionString(conditionStr.slice(4).trim())],
    };
  }

  // Parse comparison operators
  const operators = [
    { regex: /\s*===\s*/, op: "===" },
    { regex: /\s*!==\s*/, op: "!==" },
    { regex: /\s*==\s*/, op: "==" },
    { regex: /\s*!=\s*/, op: "!=" },
    { regex: /\s*>=\s*/, op: ">=" },
    { regex: /\s*<=\s*/, op: "<=" },
    { regex: /\s*>\s*/, op: ">" },
    { regex: /\s*<\s*/, op: "<" },
    { regex: /\s+contains\s+/i, op: "contains" },
    { regex: /\s+startsWith\s+/i, op: "startsWith" },
    { regex: /\s+endsWith\s+/i, op: "endsWith" },
    { regex: /\s+matches\s+/i, op: "matches" },
  ];

  for (const { regex, op } of operators) {
    const parts = conditionStr.split(regex);
    if (parts.length === 2) {
      return {
        operator: op,
        left: parseValue(parts[0].trim()),
        right: parseValue(parts[1].trim()),
      };
    }
  }

  // Unary operators
  if (conditionStr.includes(" is null") || conditionStr.includes(" isNull")) {
    return {
      operator: ConditionOperator.IS_NULL,
      left: parseValue(conditionStr.replace(/\s+(is\s+)?null$/i, "").trim()),
    };
  }

  if (conditionStr.includes(" is empty") || conditionStr.includes(" isEmpty")) {
    return {
      operator: ConditionOperator.IS_EMPTY,
      left: parseValue(conditionStr.replace(/\s+(is\s+)?empty$/i, "").trim()),
    };
  }

  // Default: treat as variable boolean check
  return parseValue(conditionStr.trim());
}

/**
 * Parse a value string (number, string literal, or variable reference)
 * @param {string} valueStr - Value string
 * @returns {any}
 */
function parseValue(valueStr) {
  // String literal
  if (
    (valueStr.startsWith('"') && valueStr.endsWith('"')) ||
    (valueStr.startsWith("'") && valueStr.endsWith("'"))
  ) {
    return valueStr.slice(1, -1);
  }

  // Number
  const num = Number(valueStr);
  if (!isNaN(num)) {
    return num;
  }

  // Boolean
  if (valueStr === "true") {
    return true;
  }
  if (valueStr === "false") {
    return false;
  }
  if (valueStr === "null") {
    return null;
  }

  // Variable reference
  return valueStr;
}

module.exports = {
  ControlFlowManager,
  StepType,
  ConditionOperator,
  LoopType,
  parseConditionString,
  parseValue,
};
