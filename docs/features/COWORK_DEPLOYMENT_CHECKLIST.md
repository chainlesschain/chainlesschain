# Cowork Deployment Checklist

**Version**: 1.0
**Last Updated**: 2026-01-27
**Status**: Production Deployment Guide

---

## Pre-Deployment Checklist

### ✅ Code Quality Verification

```bash
# 1. Run all tests
cd desktop-app-vue
npm test

# Expected: All 200+ tests passing
# ✓ Unit tests: 150+ passing
# ✓ Integration tests: 40+ passing
# ✓ Security tests: 50+ passing

# 2. Run performance benchmarks
npm run benchmark:cowork

# Expected: All operations meet baseline targets
# ✓ Team creation: < 50ms
# ✓ Agent creation: < 30ms
# ✓ Permission check: < 5ms

# 3. Check code coverage
npm run test:coverage

# Expected: > 90% coverage for Cowork modules
```

### ✅ Database Preparation

```bash
# 1. Backup existing database
cp data/chainlesschain.db data/chainlesschain.db.backup

# 2. Verify database encryption
# Check that SQLCipher is enabled and AES-256 encryption is active

# 3. Run database migrations (if needed)
# The database.js will auto-create tables on first run

# 4. Verify all indexes exist
# Run this SQL query to check:
SELECT name, sql FROM sqlite_master
WHERE type='index' AND name LIKE 'idx_cowork%'
ORDER BY name;

# Expected: 35 indexes (27 single-column + 8 composite)
```

### ✅ Configuration Check

```javascript
// 1. Verify .chainlesschain/config.json exists
{
  "cowork": {
    "enabled": true,
    "maxTeamsPerUser": 100,
    "maxAgentsPerTeam": 50,
    "maxTasksPerTeam": 1000,
    "checkpointInterval": 30000,
    "taskTimeout": 3600000,
    "integrations": {
      "rag": { "enabled": true },
      "llm": { "enabled": true, "model": "qwen2:7b" },
      "errorMonitor": { "enabled": true },
      "session": { "enabled": true }
    }
  }
}

// 2. Verify environment variables
// OLLAMA_HOST (if using LLM integration)
// QDRANT_HOST (if using RAG integration)

// 3. Check file sandbox configuration
// Verify sandbox root directory exists and has proper permissions
```

### ✅ Security Verification

```bash
# 1. Run security tests
npm run test:security

# Expected: All 50+ security tests passing
# ✓ Path traversal prevention
# ✓ SQL injection prevention
# ✓ XSS prevention
# ✓ Sensitive file protection

# 2. Verify sensitive file patterns
# Check file-sandbox.js for 18+ patterns

# 3. Test permission system
# Verify that permission checks work correctly

# 4. Check audit logging
# Ensure all file operations are logged
```

### ✅ Integration Verification

```bash
# 1. Test RAG integration (if enabled)
# Verify RAG service is running and accessible

# 2. Test LLM integration (if enabled)
curl http://localhost:11434/api/tags
# Should list available Ollama models

# 3. Test ErrorMonitor integration
# Verify ErrorMonitor service is running

# 4. Test SessionManager integration
# Verify SessionManager is initialized
```

---

## Deployment Steps

### Step 1: Stop Services

```bash
# If application is running, stop it gracefully
# On Windows: Close the Electron app
# On macOS/Linux: pkill -f "chainlesschain-desktop"

# Stop any background services
docker-compose down
```

### Step 2: Deploy Backend Code

```bash
# 1. Copy Cowork modules to production
cd desktop-app-vue/src/main/ai-engine/cowork/

# Verify all files exist:
ls -la
# Expected files:
# - teammate-tool.js
# - file-sandbox.js
# - long-running-task-manager.js
# - cowork-orchestrator.js
# - cowork-ipc.js
# - skills/ (directory)
# - integrations/ (directory)

# 2. Verify database.js includes Cowork tables
grep -n "cowork_teams" ../database.js
# Should find table definition

# 3. Check IPC registration in main process
grep -n "registerCoworkIPC" ../index.js
# Should find IPC registration call
```

### Step 3: Deploy Frontend Code

```bash
# 1. Copy frontend components
cd desktop-app-vue/src/renderer/

# Verify Cowork store exists
ls stores/cowork.js

# Verify Cowork pages exist
ls pages/CoworkDashboard.vue
ls pages/TaskMonitor.vue
ls pages/SkillManager.vue
ls pages/CoworkAnalytics.vue

# Verify Cowork components exist
ls components/cowork/

# 2. Verify routes are registered
grep -n "cowork" router/index.js

# 3. Verify menu items added
grep -n "cowork-dashboard" components/MainLayout.vue
```

### Step 4: Build Application

```bash
cd desktop-app-vue

# 1. Install dependencies (if not already installed)
npm install

# Add ECharts if not already installed
npm install echarts

# 2. Build main process
npm run build:main

# 3. Build renderer process (for production)
npm run build

# 4. Verify build output
ls dist/
# Should contain bundled files
```

### Step 5: Database Initialization

```bash
# 1. Start application in development mode first
npm run dev

# This will:
# - Create Cowork tables automatically
# - Create all indexes
# - Initialize default data

# 2. Verify tables created
# Open database and run:
SELECT name FROM sqlite_master
WHERE type='table' AND name LIKE 'cowork%';

# Expected: 9 tables
# - cowork_teams
# - cowork_agents
# - cowork_tasks
# - cowork_messages
# - cowork_audit_log
# - cowork_metrics
# - cowork_checkpoints
# - cowork_sandbox_permissions
# - cowork_decisions

# 3. Verify indexes created
SELECT COUNT(*) FROM sqlite_master
WHERE type='index' AND name LIKE 'idx_cowork%';

# Expected: 35 indexes
```

### Step 6: Smoke Testing

```bash
# 1. Start application
npm run dev

# 2. Navigate to Cowork Dashboard
# URL: http://localhost:5173/#/cowork

# 3. Create test team
# Click "创建团队" button
# Name: "Test Team"
# Config: Default

# Expected: Team created successfully

# 4. Add test agent
# Click on team card
# Click "添加代理"
# Name: "Test Agent"
# Capabilities: ["testing"]

# Expected: Agent added successfully

# 5. Assign test task
# Click "分配任务"
# Description: "Test task"
# Type: "office"

# Expected: Task assigned successfully

# 6. Verify analytics
# Navigate to: http://localhost:5173/#/cowork/analytics
# Expected: Charts display with data

# 7. Check audit logs
# Navigate to file permission dialog
# Expected: Audit logs visible
```

### Step 7: Performance Verification

```bash
# 1. Run performance benchmarks
npm run benchmark:cowork

# 2. Verify all operations meet targets:
# ✓ Team Creation: < 50ms
# ✓ Agent Creation: < 30ms
# ✓ Task Assignment: < 40ms
# ✓ Permission Check: < 5ms
# ✓ Audit Log Write: < 10ms

# 3. Load test (optional)
# Create 100 teams, 1000 agents, 10000 tasks
# Monitor memory usage
# Expected: < 200MB total memory increase

# 4. Check for memory leaks
# Use Chrome DevTools Memory Profiler
# Take heap snapshot before/after team operations
# Expected: Memory reclaimed after team deletion
```

### Step 8: Security Verification

```bash
# 1. Run security tests
npm run test:security

# All tests should pass

# 2. Manual security checks:

# Test path traversal prevention:
# Try to access: ../../etc/passwd
# Expected: Access denied

# Test sensitive file protection:
# Try to access: /app/.env
# Expected: Access denied (sensitive_file)

# Test SQL injection:
# Try team name: '; DROP TABLE cowork_teams; --
# Expected: Sanitized, no SQL execution

# Test XSS:
# Try team name: <script>alert('xss')</script>
# Expected: Sanitized, no script execution

# 3. Verify audit logging
# All operations should be logged in cowork_audit_log table
```

### Step 9: Integration Testing

```bash
# 1. Test RAG Integration (if enabled)
# Assign a task and check if RAG is queried
# Check logs for: "Querying RAG for team..."

# 2. Test LLM Integration (if enabled)
# Assign a complex task
# Check logs for: "Analyzing task..."
# Verify task complexity is calculated

# 3. Test ErrorMonitor Integration (if enabled)
# Trigger an error (e.g., invalid file path)
# Check ErrorMonitor for reported error

# 4. Test SessionManager Integration (if enabled)
# Create a team
# Check if session is started
# Verify events are recorded
```

---

## Post-Deployment Verification

### ✅ Monitoring Setup

```bash
# 1. Configure performance monitoring
# Set up alerts for:
# - Average task completion time > 2x baseline
# - Error rate > 5%
# - Memory usage > 80%
# - Database query time > 100ms

# 2. Configure security monitoring
# Set up alerts for:
# - Path traversal attempts
# - Permission denial rate > 10%
# - Failed authentication attempts
# - Sensitive file access attempts

# 3. Configure availability monitoring
# Set up health checks:
# - Application responding
# - Database accessible
# - Integration services available
```

### ✅ Backup Configuration

```bash
# 1. Set up automated database backups
# Frequency: Daily
# Retention: 30 days
# Location: External storage

# 2. Set up audit log archival
# Archive logs older than 90 days
# Compress and store to cold storage

# 3. Verify backup restoration
# Test restoring from backup
# Verify data integrity
```

### ✅ User Documentation

```bash
# Ensure users have access to:
# 1. Quick Start Guide: docs/features/COWORK_QUICK_START.md
# 2. User Manual: (create if needed)
# 3. API Documentation: (in Quick Start Guide)
# 4. Troubleshooting Guide: (in completion reports)
```

---

## Rollback Plan

### If Deployment Fails

```bash
# 1. Stop application
# Close Electron app or kill process

# 2. Restore database backup
cp data/chainlesschain.db.backup data/chainlesschain.db

# 3. Revert code changes
git checkout main
# or restore from previous commit

# 4. Restart application
npm run dev

# 5. Verify system is operational
# Check that existing features still work
```

### If Issues Discovered Post-Deployment

```bash
# 1. Document the issue
# - What happened
# - When it happened
# - Impact level
# - Steps to reproduce

# 2. Check error logs
# Look in:
# - Application logs
# - Database logs
# - ErrorMonitor logs
# - Audit logs

# 3. Determine severity
# Critical: Rollback immediately
# High: Fix within 24 hours
# Medium: Fix within 1 week
# Low: Schedule for next release

# 4. Apply hotfix or rollback
# If critical: Rollback using steps above
# If not critical: Deploy hotfix

# 5. Post-mortem
# Document what happened
# Update deployment checklist
# Improve monitoring/alerts
```

---

## Performance Baselines

Record these metrics after deployment for future comparison:

| Metric | Baseline | Acceptable Range | Alert Threshold |
|--------|----------|------------------|-----------------|
| Team Creation | 45ms | < 60ms | > 75ms |
| Agent Creation | 28ms | < 40ms | > 50ms |
| Task Assignment | 38ms | < 50ms | > 60ms |
| Permission Check | 3ms | < 8ms | > 10ms |
| Audit Log Write | 8ms | < 15ms | > 20ms |
| Memory Usage (100 teams) | 95MB | < 150MB | > 200MB |
| Database Size | - | - | > 1GB |
| Error Rate | < 1% | < 3% | > 5% |

---

## Success Criteria

Deployment is considered successful when:

- ✅ All tests passing (200+ tests)
- ✅ All performance metrics within acceptable range
- ✅ No critical security vulnerabilities
- ✅ All integrations working (if enabled)
- ✅ Smoke tests completed successfully
- ✅ No errors in application logs
- ✅ Database properly initialized
- ✅ Monitoring and alerts configured
- ✅ Backup system operational
- ✅ Users can access and use Cowork features

---

## Deployment Sign-Off

**Deployment Date**: _______________

**Deployed By**: _______________

**Checklist Completed**: ☐ Yes ☐ No

**Performance Verified**: ☐ Yes ☐ No

**Security Verified**: ☐ Yes ☐ No

**Integrations Verified**: ☐ Yes ☐ No

**Rollback Plan Tested**: ☐ Yes ☐ No

**Approved For Production**: ☐ Yes ☐ No

**Signature**: _______________

---

## Support Contacts

**Development Team**: [Your Contact]
**Security Team**: [Security Contact]
**Database Admin**: [DBA Contact]
**On-Call**: [On-Call Contact]

**Emergency Rollback Authority**: [Manager Contact]

---

*This checklist should be completed before every production deployment of the Cowork system.*
