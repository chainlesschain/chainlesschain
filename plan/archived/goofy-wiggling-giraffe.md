# Browser Extension Enhancement Implementation Plan

## Executive Summary

Enhance the existing ChainlessChain browser extension with:

- **Cross-browser support**: Chrome/Edge (existing), Firefox, Safari
- **AI features**: Smart tag generation, intelligent summaries
- **Screenshot & annotation**: Capture and mark up web pages
- **Batch clipping**: Save multiple tabs at once

**Deployment Mode**: Local development (no store publishing)

---

## Confirmed Requirements

Based on user answers:

1. ✅ **Approach**: Improve existing extension (not rebuild)
2. ✅ **Browsers**: Chrome/Edge (keep), Firefox (add), Safari (add)
3. ✅ **New Features**: AI tags, screenshots, summaries, batch clipping
4. ✅ **Deployment**: Local development mode

---

## Current Architecture Analysis

### Existing Extension (Chrome/Edge)

**Location**: `desktop-app-vue/browser-extension/`

**Structure**:

```
browser-extension/
├── manifest.json          (Manifest V3, Chrome/Edge)
├── popup/
│   ├── popup.html        (Extension UI)
│   └── popup.js          (283 lines - form handling, connection check)
├── background/
│   └── background.js     (209 lines - Native Messaging)
├── content/
│   └── content-script.js (Page extraction)
├── lib/
│   └── readability.js    (Mozilla Readability)
└── icons/
```

**Communication Flow**:

```
Extension Popup → Background Worker → Native Messaging Host →
HTTP API (port 23456) → Desktop App (SQLite + RAG)
```

**Current Capabilities**:

- Smart content extraction (Readability.js)
- Basic tag suggestion (domain + keywords)
- Connection health check
- Type selection (web_clip, article, note, document)
- Auto RAG indexing

---

## Implementation Strategy

### Phase 1: Foundation - Cross-Browser Support

**Goal**: Make extension work on Firefox and Safari while maintaining Chrome/Edge support.

#### 1.1 Create Modular Architecture

**New File Structure**:

```
browser-extension/
├── src/                          (Shared source code)
│   ├── common/                   (Browser-agnostic code)
│   │   ├── readability.js       (Move from lib/)
│   │   ├── api-client.js        (NEW - HTTP API wrapper)
│   │   ├── storage.js           (NEW - Browser storage wrapper)
│   │   └── utils.js             (NEW - Shared utilities)
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.js
│   │   └── popup.css
│   ├── background/
│   │   ├── background.js
│   │   └── messaging.js         (NEW - Messaging adapter)
│   ├── content/
│   │   └── content-script.js
│   └── adapters/                 (NEW - Browser-specific code)
│       ├── chrome-adapter.js
│       ├── firefox-adapter.js
│       └── safari-adapter.js
├── build/                        (Build output)
│   ├── chrome/
│   ├── firefox/
│   └── safari/
├── manifests/                    (NEW - Browser-specific manifests)
│   ├── manifest-chrome.json     (V3 for Chrome/Edge)
│   ├── manifest-firefox.json    (V2 for Firefox)
│   └── manifest-safari.json     (Safari format)
└── webpack.config.js             (NEW - Build system)
```

#### 1.2 Browser Adapter Pattern

**File**: `src/adapters/chrome-adapter.js`

```javascript
// Wrapper for Chrome-specific APIs
export const BrowserAdapter = {
  runtime: {
    sendMessage: chrome.runtime.sendMessage,
    onMessage: chrome.runtime.onMessage,
  },
  tabs: {
    query: chrome.tabs.query,
    sendMessage: chrome.tabs.sendMessage,
    captureVisibleTab: chrome.tabs.captureVisibleTab,
  },
  storage: {
    get: chrome.storage.local.get,
    set: chrome.storage.local.set,
  },
  // Native messaging
  connectNative: chrome.runtime.connectNative,
};
```

**File**: `src/adapters/firefox-adapter.js`

```javascript
// Firefox uses browser.* API (similar to Chrome)
export const BrowserAdapter = {
  runtime: {
    sendMessage: browser.runtime.sendMessage,
    onMessage: browser.runtime.onMessage,
  },
  // ... similar structure
};
```

**File**: `src/adapters/safari-adapter.js`

```javascript
// Safari uses different approach (XPC instead of Native Messaging)
export const BrowserAdapter = {
  runtime: {
    sendMessage: safari.extension.dispatchMessage,
    onMessage: safari.application.addEventListener,
  },
  // ... Safari-specific implementations
};
```

#### 1.3 Manifest Configuration

**Chrome/Edge** (`manifests/manifest-chrome.json`):

```json
{
  "manifest_version": 3,
  "name": "ChainlessChain Web Clipper",
  "version": "2.0.0",
  "permissions": ["activeTab", "storage", "nativeMessaging", "tabs"],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "background/background.js"
  },
  ...
}
```

**Firefox** (`manifests/manifest-firefox.json`):

```json
{
  "manifest_version": 2,
  "name": "ChainlessChain Web Clipper",
  "version": "2.0.0",
  "permissions": ["activeTab", "storage", "nativeMessaging", "tabs", "<all_urls>"],
  "background": {
    "scripts": ["background/background.js"]
  },
  "browser_specific_settings": {
    "gecko": {
      "id": "clipper@chainlesschain.com"
    }
  },
  ...
}
```

**Safari** - Requires Xcode project wrapper.

#### 1.4 Build System

**Install Dependencies**:

```bash
cd desktop-app-vue/browser-extension
npm init -y
npm install --save-dev webpack webpack-cli copy-webpack-plugin
```

**File**: `webpack.config.js`

```javascript
const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");

module.exports = (env) => {
  const browser = env.browser || "chrome";

  return {
    entry: {
      "popup/popup": "./src/popup/popup.js",
      "background/background": "./src/background/background.js",
      "content/content-script": "./src/content/content-script.js",
    },
    output: {
      path: path.resolve(__dirname, `build/${browser}`),
      filename: "[name].js",
    },
    plugins: [
      new CopyPlugin({
        patterns: [
          { from: `manifests/manifest-${browser}.json`, to: "manifest.json" },
          { from: "src/popup/*.html", to: "popup/[name][ext]" },
          { from: "src/popup/*.css", to: "popup/[name][ext]" },
          { from: "icons", to: "icons" },
        ],
      }),
    ],
  };
};
```

**Build Scripts** (add to `package.json`):

```json
{
  "scripts": {
    "build:chrome": "webpack --env browser=chrome",
    "build:firefox": "webpack --env browser=firefox",
    "build:safari": "webpack --env browser=safari",
    "build:all": "npm run build:chrome && npm run build:firefox && npm run build:safari",
    "watch:chrome": "webpack --env browser=chrome --watch"
  }
}
```

#### 1.5 Firefox Native Messaging

**File**: `scripts/install-native-messaging-firefox.js`

```javascript
// Similar to Chrome but different registry path
// Firefox: ~/.mozilla/native-messaging-hosts/ (Linux/macOS)
// Firefox: %APPDATA%\Mozilla\NativeMessagingHosts\ (Windows)
```

#### 1.6 Safari XPC Service

Safari doesn't support Native Messaging. Instead:

**Option A**: Direct HTTP API (Simpler)

- Safari extension calls HTTP API directly
- No native host needed
- Security: localhost only

**Option B**: XPC Service (More complex)

- Requires macOS app extension
- Better integration
- Needs Xcode

**Recommendation**: Use Option A for Phase 1.

---

### Phase 2: AI Features

**Goal**: Add AI-powered tag generation and intelligent summaries.

#### 2.1 Backend API Endpoints

**File**: `desktop-app-vue/src/main/native-messaging/http-server.js`

Add new endpoints:

```javascript
// POST /api/generate-tags
app.post("/api/generate-tags", async (req, res) => {
  const { title, content, url, excerpt } = req.body;

  try {
    // Call LLM service
    const tags = await llmManager.generateTags({
      title,
      content: excerpt || content.substring(0, 500),
      url,
    });

    res.json({ success: true, data: { tags } });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// POST /api/generate-summary
app.post("/api/generate-summary", async (req, res) => {
  const { title, content } = req.body;

  try {
    const summary = await llmManager.generateSummary({
      title,
      content: content.substring(0, 3000), // Limit to 3k chars
    });

    res.json({ success: true, data: { summary } });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});
```

#### 2.2 LLM Integration

**File**: `desktop-app-vue/src/main/llm/llm-manager.js` (existing)

Add new methods:

```javascript
class LLMManager {
  // ... existing code

  async generateTags({ title, content, url }) {
    const prompt = `分析以下网页内容，生成3-5个最相关的标签（中文或英文）。
只返回标签列表，用逗号分隔。

标题: ${title}
URL: ${url}
内容: ${content}

标签:`;

    const response = await this.chat({
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 50,
    });

    // Parse tags from response
    const tags = response.content
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0 && t.length < 20);

    return tags.slice(0, 5);
  }

  async generateSummary({ title, content }) {
    const prompt = `请为以下文章生成一段简洁的摘要（100-200字）。

标题: ${title}
内容: ${content}

摘要:`;

    const response = await this.chat({
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
      max_tokens: 300,
    });

    return response.content.trim();
  }
}
```

#### 2.3 Extension UI Updates

**File**: `src/popup/popup.html`

Add AI feature buttons:

```html
<div class="ai-features">
  <button id="generateTagsBtn" class="btn-secondary">🤖 AI生成标签</button>
  <button id="generateSummaryBtn" class="btn-secondary">📝 AI生成摘要</button>
</div>

<div id="summarySection" style="display:none">
  <label>智能摘要</label>
  <textarea id="summaryText" rows="3" readonly></textarea>
</div>
```

**File**: `src/popup/popup.js`

Add AI feature handlers:

```javascript
// AI Tag Generation
elements.generateTagsBtn.addEventListener("click", async () => {
  const btn = elements.generateTagsBtn;
  btn.disabled = true;
  btn.textContent = "生成中...";

  try {
    const response = await chrome.runtime.sendMessage({
      action: "generateTags",
      data: {
        title: currentPage.title,
        content: currentPage.content,
        url: currentPage.url,
        excerpt: currentPage.excerpt,
      },
    });

    if (response && response.success) {
      elements.tagsInput.value = response.data.tags.join(", ");
    }
  } catch (error) {
    console.error("AI标签生成失败:", error);
  } finally {
    btn.disabled = false;
    btn.textContent = "🤖 AI生成标签";
  }
});

// AI Summary Generation
elements.generateSummaryBtn.addEventListener("click", async () => {
  // Similar implementation
  // Shows summary in summarySection
});
```

**File**: `src/background/background.js`

Add API call handlers:

```javascript
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // ... existing handlers

  if (request.action === "generateTags") {
    fetch("http://localhost:23456/api/generate-tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request.data),
    })
      .then((r) => r.json())
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === "generateSummary") {
    // Similar implementation
  }
});
```

#### 2.4 Fallback Strategy

If LLM unavailable:

1. Show warning message
2. Fall back to existing keyword-based tags
3. Allow manual editing

---

### Phase 3: Screenshot & Annotation

**Goal**: Capture page screenshots and add annotations.

#### 3.1 Screenshot Capture

**File**: `src/popup/popup.js`

Add screenshot button:

```javascript
elements.captureScreenshotBtn.addEventListener("click", async () => {
  try {
    // Capture visible tab
    const dataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: "png",
      quality: 90,
    });

    // Open annotation editor
    openAnnotationEditor(dataUrl);
  } catch (error) {
    console.error("截图失败:", error);
  }
});
```

#### 3.2 Annotation Editor

**Library**: Fabric.js (canvas-based drawing)

**Install**:

```bash
npm install fabric
```

**File**: `src/annotation/annotation-editor.html` (NEW)

```html
<!DOCTYPE html>
<html>
  <head>
    <title>标注编辑器</title>
    <style>
      #canvas-container {
        position: relative;
      }
      .toolbar {
        /* ... */
      }
    </style>
  </head>
  <body>
    <div class="toolbar">
      <button id="highlightBtn">高亮</button>
      <button id="textBtn">文本</button>
      <button id="arrowBtn">箭头</button>
      <button id="undoBtn">撤销</button>
      <button id="saveBtn">保存</button>
    </div>
    <div id="canvas-container">
      <canvas id="annotation-canvas"></canvas>
    </div>
    <script src="annotation-editor.js"></script>
  </body>
</html>
```

**File**: `src/annotation/annotation-editor.js` (NEW)

```javascript
import { fabric } from "fabric";

class AnnotationEditor {
  constructor(imageDataUrl) {
    this.canvas = new fabric.Canvas("annotation-canvas");
    this.loadImage(imageDataUrl);
    this.setupTools();
  }

  loadImage(dataUrl) {
    fabric.Image.fromURL(dataUrl, (img) => {
      this.canvas.setBackgroundImage(
        img,
        this.canvas.renderAll.bind(this.canvas),
      );
      this.canvas.setDimensions({
        width: img.width,
        height: img.height,
      });
    });
  }

  setupTools() {
    // Highlight tool
    document.getElementById("highlightBtn").onclick = () => {
      this.activateTool("highlight");
    };

    // Text tool
    document.getElementById("textBtn").onclick = () => {
      this.activateTool("text");
    };

    // Save
    document.getElementById("saveBtn").onclick = () => {
      this.save();
    };
  }

  save() {
    // Export canvas as image
    const finalImage = this.canvas.toDataURL({
      format: "png",
      quality: 0.9,
    });

    // Export annotation metadata
    const annotations = this.canvas.toJSON();

    // Send to background script
    chrome.runtime.sendMessage({
      action: "saveScreenshot",
      data: {
        image: finalImage,
        annotations: JSON.stringify(annotations),
      },
    });
  }
}
```

#### 3.3 Backend Storage

**Database Schema Update**:

```javascript
// Add to desktop-app-vue/src/main/database.js

db.run(`
  CREATE TABLE IF NOT EXISTS screenshots (
    id TEXT PRIMARY KEY,
    knowledge_item_id TEXT NOT NULL,
    image_path TEXT NOT NULL,
    annotations TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (knowledge_item_id) REFERENCES knowledge_items(id) ON DELETE CASCADE
  )
`);
```

**API Endpoint**:

```javascript
// POST /api/upload-screenshot
app.post("/api/upload-screenshot", async (req, res) => {
  const { knowledgeItemId, imageData, annotations } = req.body;

  try {
    // Decode base64 image
    const buffer = Buffer.from(imageData.split(",")[1], "base64");

    // Save to file
    const filename = `screenshot-${Date.now()}.png`;
    const filepath = path.join(userDataPath, "screenshots", filename);
    await fs.promises.writeFile(filepath, buffer);

    // Save to database
    await database.addScreenshot({
      knowledgeItemId,
      imagePath: filepath,
      annotations,
    });

    res.json({ success: true, data: { path: filepath } });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});
```

---

### Phase 4: Batch Clipping

**Goal**: Save multiple tabs at once.

#### 4.1 Batch UI

**File**: `src/batch/batch-clipper.html` (NEW)

```html
<!DOCTYPE html>
<html>
  <head>
    <title>批量剪藏</title>
    <style>
      .tab-list {
        /* ... */
      }
      .tab-item {
        /* checkbox + favicon + title */
      }
    </style>
  </head>
  <body>
    <h2>选择要剪藏的标签页</h2>
    <div class="controls">
      <button id="selectAllBtn">全选</button>
      <button id="deselectAllBtn">取消全选</button>
    </div>
    <div id="tabList" class="tab-list"></div>
    <div class="footer">
      <button id="batchClipBtn" class="btn-primary">
        剪藏选中的标签页 (<span id="selectedCount">0</span>)
      </button>
    </div>
    <div id="progress" style="display:none">
      <div class="progress-bar"></div>
      <div class="progress-text">
        已保存 <span id="savedCount">0</span> / <span id="totalCount">0</span>
      </div>
    </div>
    <script src="batch-clipper.js"></script>
  </body>
</html>
```

#### 4.2 Batch Logic

**File**: `src/batch/batch-clipper.js` (NEW)

```javascript
async function loadTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });

  const tabList = document.getElementById("tabList");
  tabList.innerHTML = "";

  tabs.forEach((tab) => {
    const item = createTabItem(tab);
    tabList.appendChild(item);
  });
}

async function batchClip() {
  const selectedTabs = getSelectedTabs();
  const total = selectedTabs.length;

  showProgress(total);

  for (let i = 0; i < selectedTabs.length; i++) {
    const tab = selectedTabs[i];

    try {
      // Extract content from tab
      const pageInfo = await chrome.tabs.sendMessage(tab.id, {
        action: "getPageInfo",
      });

      // Clip page
      await chrome.runtime.sendMessage({
        action: "clipPage",
        data: {
          title: pageInfo.title,
          content: pageInfo.content,
          url: tab.url,
          type: "web_clip",
          autoIndex: true,
        },
      });

      updateProgress(i + 1, total);
    } catch (error) {
      console.error(`剪藏失败: ${tab.title}`, error);
      // Continue with next tab
    }
  }

  showComplete();
}
```

#### 4.3 Backend Optimization

For batch requests, add rate limiting:

```javascript
// Limit concurrent requests
const pLimit = require("p-limit");
const limit = pLimit(3); // Max 3 concurrent clips

// Process in batches of 3
```

---

## Critical Files to Modify/Create

### To Modify

1. `desktop-app-vue/browser-extension/manifest.json` → Move to `manifests/manifest-chrome.json`
2. `desktop-app-vue/browser-extension/popup/popup.js` → Refactor for adapter pattern
3. `desktop-app-vue/browser-extension/background/background.js` → Add new API handlers
4. `desktop-app-vue/src/main/native-messaging/http-server.js` → Add AI endpoints
5. `desktop-app-vue/src/main/llm/llm-manager.js` → Add generateTags/generateSummary
6. `desktop-app-vue/src/main/database.js` → Add screenshots table

### To Create

1. `desktop-app-vue/browser-extension/webpack.config.js` → Build system
2. `desktop-app-vue/browser-extension/src/adapters/*` → Browser adapters
3. `desktop-app-vue/browser-extension/src/common/api-client.js` → API wrapper
4. `desktop-app-vue/browser-extension/src/annotation/*` → Annotation editor
5. `desktop-app-vue/browser-extension/src/batch/*` → Batch clipper
6. `desktop-app-vue/browser-extension/manifests/*` → Browser-specific manifests
7. `desktop-app-vue/scripts/install-native-messaging-firefox.js` → Firefox installer

---

## Dependencies to Install

### Extension

```bash
npm install --save-dev webpack webpack-cli copy-webpack-plugin
npm install fabric
```

### Desktop App

```bash
npm install p-limit  # For batch rate limiting
```

---

## Testing Plan

### Manual Testing Checklist

**Phase 1 - Cross-Browser**:

- [ ] Chrome: Extension loads, connects, clips page
- [ ] Firefox: Extension loads, connects, clips page
- [ ] Safari: Extension loads, HTTP API works

**Phase 2 - AI Features**:

- [ ] Tag generation works with LLM online
- [ ] Tag generation falls back when LLM offline
- [ ] Summary generation works
- [ ] Summary displays correctly

**Phase 3 - Screenshot**:

- [ ] Capture screenshot
- [ ] Annotation tools work (highlight, text, arrow)
- [ ] Save annotated screenshot
- [ ] Screenshot links to knowledge item

**Phase 4 - Batch**:

- [ ] Tab list displays all tabs
- [ ] Select/deselect tabs
- [ ] Batch clip 10+ tabs
- [ ] Progress indicator updates
- [ ] Error handling (some tabs fail)

---

## Rollback & Risk Mitigation

### Backup Strategy

1. Create git branch: `feature/browser-extension-v2`
2. Keep existing extension working during development
3. Test each phase independently

### Fallback Plan

- If Firefox/Safari complex → Ship Chrome/Edge first
- If annotation complex → Ship without it (Phase 3 optional)
- If AI timeout → Use existing keyword tags

---

## Success Criteria

- [ ] Extension works on Chrome, Edge, Firefox (Safari nice-to-have)
- [ ] AI tag generation works when LLM available
- [ ] AI summary generation works
- [ ] Screenshot capture works
- [ ] Batch clipping works for 20+ tabs
- [ ] No regression in existing features
- [ ] Documentation updated

---

## Next Steps After Approval

1. Create feature branch
2. Set up build system (webpack)
3. Implement Phase 1 (cross-browser foundation)
4. Test on all browsers
5. Implement Phase 2 (AI features)
6. Test AI endpoints
7. Implement Phase 3 (screenshot)
8. Implement Phase 4 (batch)
9. Final integration testing
10. Update documentation
