# workflow-ipc

**Source**: `src/main/browser/workflow/workflow-ipc.js`

**Generated**: 2026-02-15T10:10:53.435Z

---

## const

```javascript
const
```

* Workflow IPC - IPC handlers for browser workflow system
 *
 * @module browser/workflow/workflow-ipc
 * @author ChainlessChain Team
 * @since v0.30.0

---

## function initializeWorkflowSystem(browserEngine, db)

```javascript
function initializeWorkflowSystem(browserEngine, db)
```

* Initialize workflow system
 * @param {Object} browserEngine - Browser engine instance
 * @param {Object} db - Database instance

---

## function getWorkflowEngine()

```javascript
function getWorkflowEngine()
```

* Get workflow engine instance
 * @returns {WorkflowEngine}

---

## function getWorkflowStorage()

```javascript
function getWorkflowStorage()
```

* Get workflow storage instance
 * @returns {WorkflowStorage}

---

## function registerWorkflowIPC()

```javascript
function registerWorkflowIPC()
```

* Register all Workflow IPC handlers

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Create a new workflow
   * @param {Object} workflow - Workflow data
   * @returns {Promise<Object>} Created workflow

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Get workflow by ID
   * @param {string} id - Workflow ID
   * @returns {Promise<Object|null>} Workflow

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* List workflows
   * @param {Object} options - Filter options
   * @returns {Promise<Array>} Workflow list

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Update workflow
   * @param {string} id - Workflow ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated workflow

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Delete workflow
   * @param {string} id - Workflow ID
   * @returns {Promise<boolean>} Success

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Duplicate workflow
   * @param {string} id - Source workflow ID
   * @param {string} newName - Name for the duplicate
   * @returns {Promise<Object>} New workflow

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Execute a workflow
   * @param {string} workflowId - Workflow ID
   * @param {Object} options - Execution options
   * @returns {Promise<Object>} Execution result

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Execute workflow inline (without saving)
   * @param {Object} workflow - Workflow definition
   * @param {Object} options - Execution options
   * @returns {Promise<Object>} Execution result

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Pause workflow execution
   * @param {string} executionId - Execution ID
   * @returns {Promise<boolean>} Success

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Resume workflow execution
   * @param {string} executionId - Execution ID
   * @returns {Promise<boolean>} Success

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Cancel workflow execution
   * @param {string} executionId - Execution ID
   * @returns {Promise<boolean>} Success

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Get workflow execution status
   * @param {string} executionId - Execution ID
   * @returns {Promise<Object|null>} Status

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* List active executions
   * @returns {Promise<Array>} Active executions

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Get execution by ID
   * @param {string} executionId - Execution ID
   * @returns {Promise<Object>} Execution record

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* List workflow executions
   * @param {Object} options - Filter options
   * @returns {Promise<Array>} Execution list

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Get workflow statistics
   * @param {string} workflowId - Workflow ID
   * @returns {Promise<Object>} Statistics

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Set workflow variable during execution
   * @param {string} executionId - Execution ID
   * @param {string} name - Variable name
   * @param {any} value - Variable value
   * @returns {Promise<boolean>} Success

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Get workflow variables
   * @param {string} executionId - Execution ID
   * @returns {Promise<Object>} Variables

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Export workflow to JSON
   * @param {string} id - Workflow ID
   * @returns {Promise<Object>} Exportable data

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Import workflow from JSON
   * @param {Object} data - Imported data
   * @param {Object} options - Import options
   * @returns {Promise<Object>} Imported workflow

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Build workflow from steps (helper for frontend)
   * @param {string} name - Workflow name
   * @param {Array} steps - Step definitions
   * @param {Object} options - Build options
   * @returns {Promise<Object>} Built workflow

---

## function cleanupWorkflowSystem()

```javascript
function cleanupWorkflowSystem()
```

* Cleanup workflow system

---

