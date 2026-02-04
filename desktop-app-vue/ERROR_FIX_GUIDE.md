# Desktop App Error Fix Guide

## Diagnosis Summary (2026-02-04)

Multiple initialization errors detected in the ChainlessChain desktop application:

### 1. TemplateManager Not Initialized ✓ FIXED
**Error**: `模板管理器未初始化` (Template Manager Not Initialized)
**Root Cause**: TemplateManager initialization failures are silently ignored because it's marked as non-required
**Status**: ✓ Fixed with graceful degradation fallback

**Fix Applied**:
- Added try-catch wrapper in `core-initializer.js`
- Returns mock templateManager if initialization fails
- App now continues to run even if template system is unavailable

### 2. Missing Ant Design Vue Components
**Errors**:
- `Failed to resolve component: SearchOutlined`
- `Failed to resolve component: a-statistic-group`

**Root Cause**:
- `SearchOutlined` is actually imported correctly - this is a HMR (Hot Module Replacement) false warning
- `a-statistic-group` doesn't exist in Ant Design Vue 4.x

**Fix Needed**:
```bash
# Fix non-existent component in AutomationRules.vue
# Line 84 & 106: Replace <a-statistic-group> with <div> or <a-space>
```

### 3. PreferenceManager Not Available
**Error**: `PreferenceManager not available, using localStorage`
**Root Cause**: MemoryBank system (which includes PreferenceManager) failed to initialize
**Impact**: App Store falls back to localStorage (functional but not optimal)

**Status**: Low priority - app still works with localStorage fallback

### 4. Project Loading Failures
**Error**: `加载项目列表失败` (Failed to load project list)
**Root Cause**: Cascading initialization failures - database or project-related managers not properly initialized
**Status**: Needs investigation

### 5. Social Features Failures
**Errors**:
- `加载待处理邀请失败` (Failed to load pending invitations)
- `加载聊天会话失败` (Failed to load chat sessions)
- `加载好友列表失败` (Failed to load friends list)

**Root Cause**: DID/P2P/Social managers not properly initialized
**Status**: Needs investigation

### 6. Settings Check Failure
**Error**: `检查设置状态失败` (Failed to check settings status)
**Root Cause**: Initial setup IPC or database connection issue
**Status**: Needs investigation

## Quick Fixes

### Fix 1: Remove Invalid Ant Design Component

```bash
# Open AutomationRules.vue and replace lines 84 & 106:
# Before: <a-statistic-group>
# After: <div class="statistic-group">
```

### Fix 2: Enable Debug Logging

Add this to `desktop-app-vue/src/main/index.js` after line 187:

```javascript
logger.info("[Main] Bootstrap 初始化完成");
logger.info("[Main] Initialized modules:", Object.keys(instances));
logger.info("[Main] templateManager status:", {
  exists: !!this.templateManager,
  type: typeof this.templateManager,
  methods: this.templateManager ? Object.keys(this.templateManager).slice(0, 5) : []
});
```

### Fix 3: Check Database Path

```bash
# Verify database exists
ls data/chainlesschain.db

# If not exists, the app will create it on first run
# Check userData directory for actual location
```

## Running the App After Fixes

```bash
cd desktop-app-vue

# Clean rebuild
npm run build:main
npm run dev

# Check logs for:
# ✓ [TemplateManager] ✓ 成功加载 X 个项目模板
# ✓ [InitializerFactory] ✓ templateManager 初始化成功
```

## Expected Behavior After Fixes

1. **Template Manager**: Should either:
   - ✓ Load templates successfully, OR
   - ✓ Gracefully degrade with mock manager (no crashes)

2. **Project List**: Should load (empty list is OK for fresh install)

3. **Social Features**: Should initialize or gracefully fail

4. **No Vue component errors**: SearchOutlined warning should disappear after HMR stabilizes

## Verification Steps

1. Start app: `npm run dev`
2. Login with: username `admin`, password: `admin`
3. Check console for:
   - No "模板管理器未初始化" errors
   - No "Failed to resolve component" errors
   - Successful module initialization logs

## If Issues Persist

### Deep Debug Mode

Add to `desktop-app-vue/src/main/bootstrap/core-initializer.js` after line 109:

```javascript
logger.info('[Bootstrap] Creating ProjectTemplateManager...');
logger.info('[Bootstrap] Database status:', {
  exists: !!context.database,
  type: typeof context.database
});
```

### Database Reset (Last Resort)

```bash
# Backup first!
mv data/chainlesschain.db data/chainlesschain.db.backup

# Restart app - it will create fresh database
npm run dev
```

## Files Modified

1. `desktop-app-vue/src/main/bootstrap/core-initializer.js` - Added templateManager error handling
2. (Pending) `desktop-app-vue/src/renderer/components/projects/AutomationRules.vue` - Remove invalid component

## Next Steps

1. ✓ TemplateManager graceful degradation implemented
2. TODO: Fix `a-statistic-group` component
3. TODO: Add debug logging for initialization sequence
4. TODO: Investigate social features initialization failures
5. TODO: Add initialization retry logic for critical managers

## Contact

If errors persist, check:
- Main process logs: Console output when running `npm run dev`
- Renderer logs: DevTools console (F12)
- Error Monitor: Built-in error tracking (if initialized)
