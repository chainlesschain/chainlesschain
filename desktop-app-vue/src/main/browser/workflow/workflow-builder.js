/**
 * Workflow Builder - Builder pattern for creating browser workflows
 *
 * @module browser/workflow/workflow-builder
 * @author ChainlessChain Team
 * @since v0.30.0
 */

const { v4: uuidv4 } = require('uuid');
const { logger } = require('../../utils/logger');
const { StepType, LoopType, ConditionOperator } = require('./control-flow');

/**
 * Workflow Builder for fluent workflow creation
 */
class WorkflowBuilder {
  constructor(name) {
    this.workflow = {
      id: uuidv4(),
      name: name || 'Untitled Workflow',
      description: '',
      steps: [],
      variables: {},
      triggers: [],
      tags: [],
      isTemplate: false,
      isEnabled: true
    };

    // Step stack for nested structures
    this._stepStack = [this.workflow.steps];
  }

  /**
   * Set workflow description
   * @param {string} description - Description
   * @returns {WorkflowBuilder}
   */
  description(description) {
    this.workflow.description = description;
    return this;
  }

  /**
   * Set workflow ID (for updates)
   * @param {string} id - Workflow ID
   * @returns {WorkflowBuilder}
   */
  id(id) {
    this.workflow.id = id;
    return this;
  }

  /**
   * Add tags
   * @param {...string} tags - Tags to add
   * @returns {WorkflowBuilder}
   */
  tags(...tags) {
    this.workflow.tags.push(...tags);
    return this;
  }

  /**
   * Set as template
   * @param {boolean} isTemplate - Whether template
   * @returns {WorkflowBuilder}
   */
  template(isTemplate = true) {
    this.workflow.isTemplate = isTemplate;
    return this;
  }

  /**
   * Set enabled state
   * @param {boolean} enabled - Whether enabled
   * @returns {WorkflowBuilder}
   */
  enabled(enabled = true) {
    this.workflow.isEnabled = enabled;
    return this;
  }

  // ==================== Variables ====================

  /**
   * Define a variable with default value
   * @param {string} name - Variable name
   * @param {any} defaultValue - Default value
   * @returns {WorkflowBuilder}
   */
  variable(name, defaultValue) {
    this.workflow.variables[name] = defaultValue;
    return this;
  }

  /**
   * Define multiple variables
   * @param {Object} variables - Variable definitions
   * @returns {WorkflowBuilder}
   */
  variables(variables) {
    Object.assign(this.workflow.variables, variables);
    return this;
  }

  // ==================== Action Steps ====================

  /**
   * Add a navigation step
   * @param {string} url - Target URL
   * @param {Object} options - Navigation options
   * @returns {WorkflowBuilder}
   */
  navigate(url, options = {}) {
    this._addStep({
      type: StepType.ACTION,
      action: 'navigate',
      url,
      description: options.description || `Navigate to ${url}`,
      ...options
    });
    return this;
  }

  /**
   * Add a click step
   * @param {string} ref - Element reference
   * @param {Object} options - Click options
   * @returns {WorkflowBuilder}
   */
  click(ref, options = {}) {
    this._addStep({
      type: StepType.ACTION,
      action: 'click',
      ref,
      description: options.description || `Click ${ref}`,
      ...options
    });
    return this;
  }

  /**
   * Add a type step
   * @param {string} ref - Element reference
   * @param {string} text - Text to type
   * @param {Object} options - Type options
   * @returns {WorkflowBuilder}
   */
  type(ref, text, options = {}) {
    this._addStep({
      type: StepType.ACTION,
      action: 'type',
      ref,
      text,
      description: options.description || `Type "${text}" into ${ref}`,
      ...options
    });
    return this;
  }

  /**
   * Add a select step
   * @param {string} ref - Element reference
   * @param {string} value - Value to select
   * @param {Object} options - Select options
   * @returns {WorkflowBuilder}
   */
  select(ref, value, options = {}) {
    this._addStep({
      type: StepType.ACTION,
      action: 'select',
      ref,
      value,
      description: options.description || `Select "${value}" in ${ref}`,
      ...options
    });
    return this;
  }

  /**
   * Add a hover step
   * @param {string} ref - Element reference
   * @param {Object} options - Hover options
   * @returns {WorkflowBuilder}
   */
  hover(ref, options = {}) {
    this._addStep({
      type: StepType.ACTION,
      action: 'hover',
      ref,
      description: options.description || `Hover over ${ref}`,
      ...options
    });
    return this;
  }

  /**
   * Add a screenshot step
   * @param {Object} options - Screenshot options
   * @returns {WorkflowBuilder}
   */
  screenshot(options = {}) {
    this._addStep({
      type: StepType.ACTION,
      action: 'screenshot',
      description: options.description || 'Take screenshot',
      ...options
    });
    return this;
  }

  /**
   * Add a snapshot step
   * @param {Object} options - Snapshot options
   * @returns {WorkflowBuilder}
   */
  snapshot(options = {}) {
    this._addStep({
      type: StepType.ACTION,
      action: 'snapshot',
      description: options.description || 'Take page snapshot',
      ...options
    });
    return this;
  }

  /**
   * Add a scroll step
   * @param {Object} options - Scroll options
   * @returns {WorkflowBuilder}
   */
  scroll(options = {}) {
    this._addStep({
      type: StepType.ACTION,
      action: 'scroll',
      description: options.description || `Scroll ${options.direction || 'down'}`,
      ...options
    });
    return this;
  }

  /**
   * Add a keyboard step
   * @param {string} keys - Keys to press
   * @param {Object} options - Keyboard options
   * @returns {WorkflowBuilder}
   */
  keyboard(keys, options = {}) {
    this._addStep({
      type: StepType.ACTION,
      action: 'keyboard',
      keys,
      description: options.description || `Press ${keys}`,
      ...options
    });
    return this;
  }

  /**
   * Add an upload step
   * @param {Array<string>} files - File paths
   * @param {Object} options - Upload options
   * @returns {WorkflowBuilder}
   */
  upload(files, options = {}) {
    this._addStep({
      type: StepType.ACTION,
      action: 'upload',
      files: Array.isArray(files) ? files : [files],
      description: options.description || 'Upload files',
      ...options
    });
    return this;
  }

  /**
   * Add an extract step
   * @param {string} selector - CSS selector
   * @param {string} saveTo - Variable name to save to
   * @param {Object} options - Extract options
   * @returns {WorkflowBuilder}
   */
  extract(selector, saveTo, options = {}) {
    this._addStep({
      type: StepType.ACTION,
      action: 'extract',
      selector,
      saveTo,
      extractType: options.type || 'text',
      description: options.description || `Extract from ${selector}`,
      ...options
    });
    return this;
  }

  /**
   * Add a JavaScript evaluation step
   * @param {string} script - JavaScript code
   * @param {Object} options - Evaluate options
   * @returns {WorkflowBuilder}
   */
  evaluate(script, options = {}) {
    this._addStep({
      type: StepType.ACTION,
      action: 'evaluate',
      script,
      description: options.description || 'Run JavaScript',
      ...options
    });
    return this;
  }

  // ==================== Control Flow ====================

  /**
   * Add a wait step
   * @param {number|Object} conditionOrMs - Milliseconds or condition
   * @param {Object} options - Wait options
   * @returns {WorkflowBuilder}
   */
  wait(conditionOrMs, options = {}) {
    if (typeof conditionOrMs === 'number') {
      this._addStep({
        type: StepType.WAIT,
        condition: true, // Always true, just delay
        timeout: conditionOrMs,
        description: options.description || `Wait ${conditionOrMs}ms`,
        ...options
      });
    } else {
      this._addStep({
        type: StepType.WAIT,
        condition: conditionOrMs,
        description: options.description || 'Wait for condition',
        ...options
      });
    }
    return this;
  }

  /**
   * Start a conditional block
   * @param {Object} condition - Condition to evaluate
   * @returns {WorkflowBuilder}
   */
  if(condition) {
    const ifStep = {
      type: StepType.CONDITION,
      condition,
      then: [],
      else: []
    };
    this._addStep(ifStep);
    this._stepStack.push(ifStep.then);
    return this;
  }

  /**
   * Switch to else branch
   * @returns {WorkflowBuilder}
   */
  else() {
    this._stepStack.pop();
    const currentSteps = this._stepStack[this._stepStack.length - 1];
    const lastStep = currentSteps[currentSteps.length - 1];

    if (lastStep && lastStep.type === StepType.CONDITION) {
      this._stepStack.push(lastStep.else);
    }
    return this;
  }

  /**
   * End conditional block
   * @returns {WorkflowBuilder}
   */
  endIf() {
    this._stepStack.pop();
    return this;
  }

  /**
   * Start a forEach loop
   * @param {string} items - Variable containing items
   * @param {string} variable - Loop variable name
   * @returns {WorkflowBuilder}
   */
  forEach(items, variable = 'item') {
    const loopStep = {
      type: StepType.LOOP,
      loop: {
        type: LoopType.FOR_EACH,
        items,
        variable
      },
      steps: []
    };
    this._addStep(loopStep);
    this._stepStack.push(loopStep.steps);
    return this;
  }

  /**
   * Start a for loop
   * @param {Object} config - Loop configuration
   * @returns {WorkflowBuilder}
   */
  for(config) {
    const loopStep = {
      type: StepType.LOOP,
      loop: {
        type: LoopType.FOR,
        ...config
      },
      steps: []
    };
    this._addStep(loopStep);
    this._stepStack.push(loopStep.steps);
    return this;
  }

  /**
   * Start a while loop
   * @param {Object} condition - Loop condition
   * @returns {WorkflowBuilder}
   */
  while(condition) {
    const loopStep = {
      type: StepType.LOOP,
      loop: {
        type: LoopType.WHILE,
        condition
      },
      steps: []
    };
    this._addStep(loopStep);
    this._stepStack.push(loopStep.steps);
    return this;
  }

  /**
   * End loop block
   * @returns {WorkflowBuilder}
   */
  endLoop() {
    this._stepStack.pop();
    return this;
  }

  /**
   * Start a try-catch block
   * @returns {WorkflowBuilder}
   */
  try() {
    const tryCatchStep = {
      type: StepType.TRY_CATCH,
      try: [],
      catch: [],
      finally: []
    };
    this._addStep(tryCatchStep);
    this._stepStack.push(tryCatchStep.try);
    return this;
  }

  /**
   * Switch to catch block
   * @returns {WorkflowBuilder}
   */
  catch() {
    this._stepStack.pop();
    const currentSteps = this._stepStack[this._stepStack.length - 1];
    const lastStep = currentSteps[currentSteps.length - 1];

    if (lastStep && lastStep.type === StepType.TRY_CATCH) {
      this._stepStack.push(lastStep.catch);
    }
    return this;
  }

  /**
   * Switch to finally block
   * @returns {WorkflowBuilder}
   */
  finally() {
    this._stepStack.pop();
    const currentSteps = this._stepStack[this._stepStack.length - 1];
    const lastStep = currentSteps[currentSteps.length - 1];

    if (lastStep && lastStep.type === StepType.TRY_CATCH) {
      this._stepStack.push(lastStep.finally);
    }
    return this;
  }

  /**
   * End try-catch block
   * @returns {WorkflowBuilder}
   */
  endTry() {
    this._stepStack.pop();
    return this;
  }

  // ==================== Variable Steps ====================

  /**
   * Set a variable at runtime
   * @param {string} name - Variable name
   * @param {any} value - Value
   * @returns {WorkflowBuilder}
   */
  set(name, value) {
    this._addStep({
      type: StepType.VARIABLE,
      operation: 'set',
      name,
      value,
      description: `Set ${name}`
    });
    return this;
  }

  /**
   * Increment a variable
   * @param {string} name - Variable name
   * @param {number} amount - Amount (default 1)
   * @returns {WorkflowBuilder}
   */
  increment(name, amount = 1) {
    this._addStep({
      type: StepType.VARIABLE,
      operation: 'increment',
      name,
      value: amount,
      description: `Increment ${name}`
    });
    return this;
  }

  /**
   * Append to variable
   * @param {string} name - Variable name
   * @param {any} value - Value to append
   * @returns {WorkflowBuilder}
   */
  append(name, value) {
    this._addStep({
      type: StepType.VARIABLE,
      operation: 'append',
      name,
      value,
      description: `Append to ${name}`
    });
    return this;
  }

  // ==================== Sub-workflow ====================

  /**
   * Call a sub-workflow
   * @param {string} workflowId - Sub-workflow ID
   * @param {Object} options - Sub-workflow options
   * @returns {WorkflowBuilder}
   */
  subprocess(workflowId, options = {}) {
    this._addStep({
      type: StepType.SUBPROCESS,
      workflowId,
      variables: options.variables || {},
      outputVars: options.outputVars || {},
      description: options.description || `Run sub-workflow ${workflowId}`
    });
    return this;
  }

  // ==================== Step Modifiers ====================

  /**
   * Add a raw step object
   * @param {Object} step - Step definition
   * @returns {WorkflowBuilder}
   */
  step(step) {
    this._addStep(step);
    return this;
  }

  /**
   * Set the last step as critical
   * @param {boolean} critical - Whether critical
   * @returns {WorkflowBuilder}
   */
  critical(critical = true) {
    const currentSteps = this._stepStack[this._stepStack.length - 1];
    if (currentSteps.length > 0) {
      currentSteps[currentSteps.length - 1].critical = critical;
    }
    return this;
  }

  /**
   * Set timeout for last step
   * @param {number} ms - Timeout in milliseconds
   * @returns {WorkflowBuilder}
   */
  timeout(ms) {
    const currentSteps = this._stepStack[this._stepStack.length - 1];
    if (currentSteps.length > 0) {
      currentSteps[currentSteps.length - 1].timeout = ms;
    }
    return this;
  }

  /**
   * Set retry configuration for last step
   * @param {number} maxRetries - Max retry count
   * @returns {WorkflowBuilder}
   */
  retry(maxRetries) {
    const currentSteps = this._stepStack[this._stepStack.length - 1];
    if (currentSteps.length > 0) {
      currentSteps[currentSteps.length - 1].maxRetries = maxRetries;
    }
    return this;
  }

  // ==================== Triggers ====================

  /**
   * Add a schedule trigger
   * @param {string} cron - Cron expression
   * @returns {WorkflowBuilder}
   */
  onSchedule(cron) {
    this.workflow.triggers.push({
      type: 'schedule',
      cron
    });
    return this;
  }

  /**
   * Add a URL trigger
   * @param {string} pattern - URL pattern
   * @returns {WorkflowBuilder}
   */
  onUrl(pattern) {
    this.workflow.triggers.push({
      type: 'url',
      pattern
    });
    return this;
  }

  /**
   * Add a manual trigger
   * @returns {WorkflowBuilder}
   */
  onManual() {
    this.workflow.triggers.push({
      type: 'manual'
    });
    return this;
  }

  // ==================== Build ====================

  /**
   * Build and return the workflow
   * @returns {Object} Workflow definition
   */
  build() {
    // Ensure stack is clean
    if (this._stepStack.length > 1) {
      logger.warn('[WorkflowBuilder] Unclosed blocks detected');
    }

    return { ...this.workflow };
  }

  /**
   * Add step to current context
   * @private
   */
  _addStep(step) {
    const currentSteps = this._stepStack[this._stepStack.length - 1];
    currentSteps.push(step);
  }
}

/**
 * Create a workflow builder
 * @param {string} name - Workflow name
 * @returns {WorkflowBuilder}
 */
function createWorkflow(name) {
  return new WorkflowBuilder(name);
}

/**
 * Create a condition object
 * @param {string} left - Left operand
 * @param {string} operator - Operator
 * @param {any} right - Right operand
 * @returns {Object}
 */
function condition(left, operator, right) {
  return { left, operator, right };
}

/**
 * Create an AND condition
 * @param {...Object} conditions - Conditions
 * @returns {Object}
 */
function and(...conditions) {
  return { operator: ConditionOperator.AND, conditions };
}

/**
 * Create an OR condition
 * @param {...Object} conditions - Conditions
 * @returns {Object}
 */
function or(...conditions) {
  return { operator: ConditionOperator.OR, conditions };
}

/**
 * Create a NOT condition
 * @param {Object} cond - Condition to negate
 * @returns {Object}
 */
function not(cond) {
  return { operator: ConditionOperator.NOT, conditions: [cond] };
}

module.exports = {
  WorkflowBuilder,
  createWorkflow,
  condition,
  and,
  or,
  not
};
