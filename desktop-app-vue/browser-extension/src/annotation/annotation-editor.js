/**
 * ChainlessChain Screenshot Annotation Editor
 * Uses Fabric.js for canvas manipulation
 */

import { getBrowserAdapter } from '../common/utils.js';

// Global state
let canvas = null;
let browserAdapter = null;
let currentTool = 'select';
let currentColor = '#ff0000';
let isDrawing = false;
let screenshotData = null;
let originalKnowledgeItemId = null;

// DOM elements
const elements = {};

/**
 * Initialize the annotation editor
 */
async function initialize() {
  console.log('[AnnotationEditor] Initializing...');

  // Get browser adapter
  browserAdapter = await getBrowserAdapter();

  // Initialize DOM elements
  initializeElements();

  // Get screenshot data from URL parameters
  const params = new URLSearchParams(window.location.search);
  screenshotData = params.get('screenshot');
  originalKnowledgeItemId = params.get('itemId');

  if (!screenshotData) {
    alert('未找到截图数据');
    window.close();
    return;
  }

  // Initialize Fabric canvas
  initializeCanvas();

  // Load screenshot image
  await loadScreenshot(screenshotData);

  // Bind events
  bindEvents();

  console.log('[AnnotationEditor] Initialized successfully');
}

/**
 * Initialize DOM element references
 */
function initializeElements() {
  elements.canvas = document.getElementById('annotationCanvas');
  elements.canvasContainer = document.getElementById('canvasContainer');
  elements.loading = document.getElementById('loading');

  // Toolbar buttons
  elements.selectBtn = document.getElementById('selectBtn');
  elements.penBtn = document.getElementById('penBtn');
  elements.highlightBtn = document.getElementById('highlightBtn');
  elements.textBtn = document.getElementById('textBtn');
  elements.arrowBtn = document.getElementById('arrowBtn');
  elements.rectBtn = document.getElementById('rectBtn');
  elements.undoBtn = document.getElementById('undoBtn');
  elements.clearBtn = document.getElementById('clearBtn');
  elements.colorPicker = document.getElementById('colorPicker');
  elements.saveBtn = document.getElementById('saveBtn');
  elements.cancelBtn = document.getElementById('cancelBtn');
}

/**
 * Initialize Fabric.js canvas
 */
function initializeCanvas() {
  canvas = new fabric.Canvas('annotationCanvas', {
    isDrawingMode: false,
    selection: true,
  });

  // Set canvas size (will be adjusted when image loads)
  canvas.setWidth(800);
  canvas.setHeight(600);
}

/**
 * Load screenshot image onto canvas
 */
async function loadScreenshot(dataUrl) {
  return new Promise((resolve, reject) => {
    fabric.Image.fromURL(dataUrl, (img) => {
      // Adjust canvas size to match image
      const maxWidth = window.innerWidth - 100;
      const maxHeight = window.innerHeight - 200;

      let width = img.width;
      let height = img.height;

      // Scale down if too large
      if (width > maxWidth || height > maxHeight) {
        const scale = Math.min(maxWidth / width, maxHeight / height);
        width = width * scale;
        height = height * scale;
      }

      canvas.setWidth(width);
      canvas.setHeight(height);

      // Set as background
      canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas), {
        scaleX: width / img.width,
        scaleY: height / img.height,
      });

      resolve();
    }, { crossOrigin: 'anonymous' });
  });
}

/**
 * Bind event listeners
 */
function bindEvents() {
  // Tool buttons
  const toolButtons = [
    elements.selectBtn,
    elements.penBtn,
    elements.highlightBtn,
    elements.textBtn,
    elements.arrowBtn,
    elements.rectBtn,
  ];

  toolButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tool = btn.dataset.tool;
      setTool(tool);

      // Update active state
      toolButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Color picker
  elements.colorPicker.addEventListener('change', (e) => {
    currentColor = e.target.value;
    if (canvas.isDrawingMode) {
      canvas.freeDrawingBrush.color = currentColor;
    }
  });

  // Undo
  elements.undoBtn.addEventListener('click', undo);

  // Clear
  elements.clearBtn.addEventListener('click', () => {
    if (confirm('确定要清除所有标注吗？')) {
      clearAnnotations();
    }
  });

  // Save
  elements.saveBtn.addEventListener('click', saveAnnotation);

  // Cancel
  elements.cancelBtn.addEventListener('click', () => {
    window.close();
  });

  // Canvas mouse events for drawing
  canvas.on('mouse:down', handleMouseDown);
  canvas.on('mouse:move', handleMouseMove);
  canvas.on('mouse:up', handleMouseUp);
}

/**
 * Set current tool
 */
function setTool(tool) {
  currentTool = tool;
  console.log('[AnnotationEditor] Tool set to:', tool);

  // Reset canvas mode
  canvas.isDrawingMode = false;
  canvas.selection = true;

  switch (tool) {
    case 'select':
      canvas.selection = true;
      break;

    case 'pen':
      canvas.isDrawingMode = true;
      canvas.freeDrawingBrush.color = currentColor;
      canvas.freeDrawingBrush.width = 3;
      break;

    case 'highlight':
      canvas.isDrawingMode = true;
      canvas.freeDrawingBrush.color = currentColor;
      canvas.freeDrawingBrush.width = 20;
      canvas.freeDrawingBrush.opacity = 0.3;
      break;

    case 'text':
    case 'arrow':
    case 'rect':
      canvas.selection = false;
      break;
  }
}

/**
 * Handle mouse down event
 */
function handleMouseDown(event) {
  if (canvas.isDrawingMode) return;

  const pointer = canvas.getPointer(event.e);
  isDrawing = true;

  if (currentTool === 'text') {
    addText(pointer);
    isDrawing = false;
  } else if (currentTool === 'rect') {
    startDrawingRect(pointer);
  } else if (currentTool === 'arrow') {
    startDrawingArrow(pointer);
  }
}

/**
 * Handle mouse move event
 */
function handleMouseMove(event) {
  if (!isDrawing || canvas.isDrawingMode) return;

  const pointer = canvas.getPointer(event.e);

  // Update shape being drawn
  // (Implementation depends on specific shape logic)
}

/**
 * Handle mouse up event
 */
function handleMouseUp(event) {
  isDrawing = false;
}

/**
 * Add text annotation
 */
function addText(pointer) {
  const text = new fabric.IText('输入文本', {
    left: pointer.x,
    top: pointer.y,
    fill: currentColor,
    fontSize: 20,
    fontFamily: 'Arial',
  });

  canvas.add(text);
  canvas.setActiveObject(text);
  text.enterEditing();
  canvas.renderAll();
}

/**
 * Start drawing rectangle
 */
function startDrawingRect(pointer) {
  const rect = new fabric.Rect({
    left: pointer.x,
    top: pointer.y,
    width: 100,
    height: 60,
    fill: 'transparent',
    stroke: currentColor,
    strokeWidth: 3,
  });

  canvas.add(rect);
  canvas.renderAll();
}

/**
 * Start drawing arrow
 */
function startDrawingArrow(pointer) {
  const line = new fabric.Line([pointer.x, pointer.y, pointer.x + 100, pointer.y + 100], {
    stroke: currentColor,
    strokeWidth: 3,
  });

  // Add arrowhead (triangle)
  const arrowHead = new fabric.Triangle({
    left: pointer.x + 100,
    top: pointer.y + 100,
    width: 15,
    height: 15,
    fill: currentColor,
    angle: 135,
  });

  const group = new fabric.Group([line, arrowHead]);
  canvas.add(group);
  canvas.renderAll();
}

/**
 * Undo last action
 */
function undo() {
  const objects = canvas.getObjects();
  if (objects.length > 0) {
    canvas.remove(objects[objects.length - 1]);
    canvas.renderAll();
  }
}

/**
 * Clear all annotations
 */
function clearAnnotations() {
  const objects = canvas.getObjects();
  objects.forEach(obj => canvas.remove(obj));
  canvas.renderAll();
}

/**
 * Save annotation
 */
async function saveAnnotation() {
  console.log('[AnnotationEditor] Saving annotation...');

  // Show loading
  elements.loading.style.display = 'flex';

  try {
    // Export canvas as image
    const finalImage = canvas.toDataURL({
      format: 'png',
      quality: 0.9,
    });

    // Export annotation metadata
    const annotations = JSON.stringify(canvas.toJSON());

    // Send to background script
    const response = await browserAdapter.runtime.sendMessage({
      action: 'saveScreenshot',
      data: {
        image: finalImage,
        annotations: annotations,
        knowledgeItemId: originalKnowledgeItemId,
      },
    });

    if (response && response.success) {
      console.log('[AnnotationEditor] Saved successfully');
      alert('截图已保存！');
      window.close();
    } else {
      throw new Error(response?.error || '保存失败');
    }
  } catch (error) {
    console.error('[AnnotationEditor] Save failed:', error);
    alert('保存失败: ' + error.message);
  } finally {
    elements.loading.style.display = 'none';
  }
}

// Initialize on load
window.addEventListener('DOMContentLoaded', initialize);
