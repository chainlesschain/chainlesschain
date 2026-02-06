/**
 * Workflow Variables - Variable management for browser workflows
 *
 * @module browser/workflow/workflow-variables
 * @author ChainlessChain Team
 * @since v0.30.0
 */

const { logger } = require('../../utils/logger');

/**
 * Variable scope types
 */
const VariableScope = {
  GLOBAL: 'global',     // Available across all steps
  STEP: 'step',         // Available only in current step
  LOOP: 'loop',         // Loop iteration variables
  EXTRACTED: 'extracted' // Extracted from page
};

/**
 * Built-in variable prefixes
 */
const BuiltInPrefixes = {
  STEP: '$step',        // Step result access
  LOOP: '$loop',        // Loop variables
  PAGE: '$page',        // Page information
  ENV: '$env',          // Environment variables
  DATE: '$date',        // Date/time functions
  RANDOM: '$random'     // Random generators
};

/**
 * Variable Manager for workflow execution
 */
class VariableManager {
  constructor(initialVariables = {}) {
    this.scopes = new Map();
    this.scopes.set(VariableScope.GLOBAL, new Map(Object.entries(initialVariables)));
    this.scopes.set(VariableScope.STEP, new Map());
    this.scopes.set(VariableScope.LOOP, new Map());
    this.scopes.set(VariableScope.EXTRACTED, new Map());

    // Step results storage for $step.N.result access
    this.stepResults = [];
  }

  /**
   * Set a variable
   * @param {string} name - Variable name
   * @param {any} value - Variable value
   * @param {string} scope - Variable scope
   */
  set(name, value, scope = VariableScope.GLOBAL) {
    const scopeMap = this.scopes.get(scope);
    if (!scopeMap) {
      throw new Error(`Invalid scope: ${scope}`);
    }
    scopeMap.set(name, value);
    logger.debug('[VariableManager] Variable set', { name, scope, type: typeof value });
  }

  /**
   * Get a variable value
   * @param {string} name - Variable name (supports dot notation)
   * @returns {any} Variable value
   */
  get(name) {
    // Check for built-in variables first
    if (name.startsWith('$')) {
      return this._getBuiltIn(name);
    }

    // Search through scopes (most specific first)
    const scopeOrder = [
      VariableScope.LOOP,
      VariableScope.STEP,
      VariableScope.EXTRACTED,
      VariableScope.GLOBAL
    ];

    for (const scope of scopeOrder) {
      const scopeMap = this.scopes.get(scope);
      if (scopeMap.has(name)) {
        return scopeMap.get(name);
      }
    }

    // Handle dot notation for nested objects
    const parts = name.split('.');
    if (parts.length > 1) {
      let value = this.get(parts[0]);
      for (let i = 1; i < parts.length && value !== undefined; i++) {
        value = value?.[parts[i]];
      }
      return value;
    }

    return undefined;
  }

  /**
   * Check if variable exists
   * @param {string} name - Variable name
   * @returns {boolean}
   */
  has(name) {
    return this.get(name) !== undefined;
  }

  /**
   * Delete a variable
   * @param {string} name - Variable name
   * @param {string} scope - Variable scope
   */
  delete(name, scope = VariableScope.GLOBAL) {
    const scopeMap = this.scopes.get(scope);
    if (scopeMap) {
      scopeMap.delete(name);
    }
  }

  /**
   * Clear scope variables
   * @param {string} scope - Scope to clear
   */
  clearScope(scope) {
    const scopeMap = this.scopes.get(scope);
    if (scopeMap) {
      scopeMap.clear();
    }
  }

  /**
   * Store step result for later access
   * @param {number} stepIndex - Step index
   * @param {Object} result - Step result
   */
  setStepResult(stepIndex, result) {
    this.stepResults[stepIndex] = result;
  }

  /**
   * Get all variables as flat object
   * @returns {Object}
   */
  getAll() {
    const result = {};

    // Merge all scopes (global first, then more specific)
    const scopeOrder = [
      VariableScope.GLOBAL,
      VariableScope.EXTRACTED,
      VariableScope.STEP,
      VariableScope.LOOP
    ];

    for (const scope of scopeOrder) {
      const scopeMap = this.scopes.get(scope);
      for (const [key, value] of scopeMap) {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Create a snapshot of current state
   * @returns {Object}
   */
  snapshot() {
    const result = {};
    for (const [scope, map] of this.scopes) {
      result[scope] = Object.fromEntries(map);
    }
    return result;
  }

  /**
   * Restore from snapshot
   * @param {Object} snapshot - Previously saved snapshot
   */
  restore(snapshot) {
    for (const [scope, vars] of Object.entries(snapshot)) {
      const scopeMap = this.scopes.get(scope);
      if (scopeMap) {
        scopeMap.clear();
        for (const [key, value] of Object.entries(vars)) {
          scopeMap.set(key, value);
        }
      }
    }
  }

  /**
   * Interpolate variables in a string
   * Supports: ${varName}, ${obj.prop}, ${$step.0.result}
   * @param {string} template - String with variable placeholders
   * @returns {string} Interpolated string
   */
  interpolate(template) {
    if (typeof template !== 'string') {
      return template;
    }

    return template.replace(/\$\{([^}]+)\}/g, (match, expr) => {
      const value = this._evaluateExpression(expr.trim());
      if (value === undefined) {
        logger.warn('[VariableManager] Undefined variable in interpolation', { expr });
        return match; // Keep original if undefined
      }
      return String(value);
    });
  }

  /**
   * Interpolate variables in an object (deep)
   * @param {any} obj - Object to interpolate
   * @returns {any} Interpolated object
   */
  interpolateDeep(obj) {
    if (typeof obj === 'string') {
      return this.interpolate(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.interpolateDeep(item));
    }

    if (obj && typeof obj === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.interpolateDeep(value);
      }
      return result;
    }

    return obj;
  }

  /**
   * Extract value from page/element using expression
   * @param {Object} page - Playwright page
   * @param {string} expression - Extraction expression
   * @param {Object} options - Extraction options
   * @returns {Promise<any>} Extracted value
   */
  async extractFromPage(page, expression, options = {}) {
    const { type = 'text', selector, attribute } = options;

    try {
      let value;

      switch (type) {
        case 'text':
          value = await page.locator(selector).textContent();
          break;

        case 'value':
          value = await page.locator(selector).inputValue();
          break;

        case 'attribute':
          value = await page.locator(selector).getAttribute(attribute);
          break;

        case 'innerHtml':
          value = await page.locator(selector).innerHTML();
          break;

        case 'count':
          value = await page.locator(selector).count();
          break;

        case 'evaluate':
          value = await page.evaluate(expression);
          break;

        case 'url':
          value = page.url();
          break;

        case 'title':
          value = await page.title();
          break;

        default:
          throw new Error(`Unknown extraction type: ${type}`);
      }

      // Store in extracted scope
      if (options.saveTo) {
        this.set(options.saveTo, value, VariableScope.EXTRACTED);
      }

      return value;
    } catch (error) {
      logger.error('[VariableManager] Extraction failed', {
        expression,
        options,
        error: error.message
      });
      throw error;
    }
  }

  // ==================== Private Methods ====================

  /**
   * Get built-in variable value
   * @param {string} name - Variable name starting with $
   * @returns {any}
   */
  _getBuiltIn(name) {
    // $step.N.field - Access step result
    if (name.startsWith(BuiltInPrefixes.STEP)) {
      const match = name.match(/^\$step\.(\d+)\.(.+)$/);
      if (match) {
        const stepIndex = parseInt(match[1], 10);
        const field = match[2];
        const stepResult = this.stepResults[stepIndex];
        return stepResult?.[field];
      }
      return undefined;
    }

    // $loop.index, $loop.value, $loop.first, $loop.last
    if (name.startsWith(BuiltInPrefixes.LOOP)) {
      const field = name.slice(6); // Remove '$loop.'
      const loopVars = this.scopes.get(VariableScope.LOOP);
      return loopVars.get(field);
    }

    // $page.url, $page.title
    if (name.startsWith(BuiltInPrefixes.PAGE)) {
      const field = name.slice(6); // Remove '$page.'
      return this.scopes.get(VariableScope.STEP).get(`page_${field}`);
    }

    // $env.NAME - Environment variable
    if (name.startsWith(BuiltInPrefixes.ENV)) {
      const envName = name.slice(5); // Remove '$env.'
      return process.env[envName];
    }

    // $date.now, $date.iso, $date.timestamp
    if (name.startsWith(BuiltInPrefixes.DATE)) {
      const fn = name.slice(6); // Remove '$date.'
      return this._getDateValue(fn);
    }

    // $random.int, $random.uuid, $random.string
    if (name.startsWith(BuiltInPrefixes.RANDOM)) {
      const fn = name.slice(8); // Remove '$random.'
      return this._getRandomValue(fn);
    }

    return undefined;
  }

  /**
   * Get date/time value
   * @param {string} fn - Function name
   * @returns {any}
   */
  _getDateValue(fn) {
    const now = new Date();

    switch (fn) {
      case 'now':
        return now.toISOString();
      case 'timestamp':
        return Date.now();
      case 'iso':
        return now.toISOString();
      case 'date':
        return now.toISOString().split('T')[0];
      case 'time':
        return now.toTimeString().split(' ')[0];
      case 'year':
        return now.getFullYear();
      case 'month':
        return now.getMonth() + 1;
      case 'day':
        return now.getDate();
      default:
        return undefined;
    }
  }

  /**
   * Get random value
   * @param {string} fn - Function name (may include parameters)
   * @returns {any}
   */
  _getRandomValue(fn) {
    // Parse function and parameters: int(1,100), string(10)
    const match = fn.match(/^(\w+)(?:\(([^)]*)\))?$/);
    if (!match) return undefined;

    const [, funcName, params] = match;
    const args = params ? params.split(',').map(s => s.trim()) : [];

    switch (funcName) {
      case 'int': {
        const min = parseInt(args[0], 10) || 0;
        const max = parseInt(args[1], 10) || 100;
        return Math.floor(Math.random() * (max - min + 1)) + min;
      }

      case 'float': {
        const min = parseFloat(args[0]) || 0;
        const max = parseFloat(args[1]) || 1;
        return Math.random() * (max - min) + min;
      }

      case 'uuid':
        return require('uuid').v4();

      case 'string': {
        const length = parseInt(args[0], 10) || 8;
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
          result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
      }

      case 'choice': {
        if (args.length === 0) return undefined;
        return args[Math.floor(Math.random() * args.length)];
      }

      case 'boolean':
        return Math.random() > 0.5;

      default:
        return undefined;
    }
  }

  /**
   * Evaluate a simple expression
   * Supports: variable access, property access, basic operations
   * @param {string} expr - Expression to evaluate
   * @returns {any}
   */
  _evaluateExpression(expr) {
    // Simple variable reference
    if (!expr.includes(' ') && !expr.includes('(')) {
      return this.get(expr);
    }

    // Function call: length(arr), upper(str), etc.
    const fnMatch = expr.match(/^(\w+)\((.+)\)$/);
    if (fnMatch) {
      const [, fn, arg] = fnMatch;
      const value = this._evaluateExpression(arg);
      return this._applyFunction(fn, value);
    }

    // Binary operation: a + b, a == b, etc.
    const opMatch = expr.match(/^(.+?)\s*([\+\-\*\/\%\=\!\<\>]+)\s*(.+)$/);
    if (opMatch) {
      const [, left, op, right] = opMatch;
      const leftVal = this._evaluateExpression(left.trim());
      const rightVal = this._evaluateExpression(right.trim());
      return this._applyOperator(op, leftVal, rightVal);
    }

    // Try as literal
    return this._parseLiteral(expr);
  }

  /**
   * Apply a function to a value
   * @param {string} fn - Function name
   * @param {any} value - Input value
   * @returns {any}
   */
  _applyFunction(fn, value) {
    switch (fn.toLowerCase()) {
      case 'length':
        return value?.length || 0;
      case 'upper':
        return String(value).toUpperCase();
      case 'lower':
        return String(value).toLowerCase();
      case 'trim':
        return String(value).trim();
      case 'int':
        return parseInt(value, 10);
      case 'float':
        return parseFloat(value);
      case 'string':
        return String(value);
      case 'json':
        return JSON.stringify(value);
      case 'parse':
        return JSON.parse(value);
      case 'not':
        return !value;
      case 'abs':
        return Math.abs(value);
      case 'round':
        return Math.round(value);
      case 'floor':
        return Math.floor(value);
      case 'ceil':
        return Math.ceil(value);
      default:
        logger.warn('[VariableManager] Unknown function', { fn });
        return value;
    }
  }

  /**
   * Apply a binary operator
   * @param {string} op - Operator
   * @param {any} left - Left operand
   * @param {any} right - Right operand
   * @returns {any}
   */
  _applyOperator(op, left, right) {
    switch (op) {
      case '+':
        return left + right;
      case '-':
        return left - right;
      case '*':
        return left * right;
      case '/':
        return left / right;
      case '%':
        return left % right;
      case '==':
      case '===':
        return left === right;
      case '!=':
      case '!==':
        return left !== right;
      case '<':
        return left < right;
      case '>':
        return left > right;
      case '<=':
        return left <= right;
      case '>=':
        return left >= right;
      default:
        logger.warn('[VariableManager] Unknown operator', { op });
        return undefined;
    }
  }

  /**
   * Parse a literal value
   * @param {string} expr - Expression
   * @returns {any}
   */
  _parseLiteral(expr) {
    // String literal
    if ((expr.startsWith('"') && expr.endsWith('"')) ||
        (expr.startsWith("'") && expr.endsWith("'"))) {
      return expr.slice(1, -1);
    }

    // Number
    const num = Number(expr);
    if (!isNaN(num)) {
      return num;
    }

    // Boolean
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'null') return null;
    if (expr === 'undefined') return undefined;

    // Assume it's a variable reference
    return this.get(expr);
  }
}

/**
 * Create variable context for loop iteration
 * @param {number} index - Current index
 * @param {any} value - Current value
 * @param {number} total - Total items
 * @returns {Object} Loop context
 */
function createLoopContext(index, value, total) {
  return {
    index,
    value,
    first: index === 0,
    last: index === total - 1,
    even: index % 2 === 0,
    odd: index % 2 === 1,
    count: total
  };
}

module.exports = {
  VariableManager,
  VariableScope,
  BuiltInPrefixes,
  createLoopContext
};
