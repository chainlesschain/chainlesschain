# Cowork Security Guide

**Version**: 1.0
**Last Updated**: 2026-01-27
**Status**: ✅ Production Ready
**Security Level**: Enterprise-Grade

## Table of Contents

- [Overview](#overview)
- [Security Architecture](#security-architecture)
- [Threat Model](#threat-model)
- [Security Controls](#security-controls)
- [File Sandbox Security](#file-sandbox-security)
- [IPC Security](#ipc-security)
- [Database Security](#database-security)
- [Input Validation](#input-validation)
- [Audit Logging](#audit-logging)
- [Security Testing](#security-testing)
- [Incident Response](#incident-response)
- [Security Checklist](#security-checklist)

## Overview

The Cowork multi-agent collaboration system implements defense-in-depth security with multiple layers of protection against common attack vectors.

### Security Goals

1. **Confidentiality**: Protect sensitive data from unauthorized access
2. **Integrity**: Prevent unauthorized modification of data and code
3. **Availability**: Ensure system remains operational under attack
4. **Accountability**: Track all operations with comprehensive audit logs
5. **Least Privilege**: Grant minimum permissions necessary

### Security Principles

- **Zero Trust**: Verify every access request
- **Defense in Depth**: Multiple layers of security controls
- **Fail Secure**: Default to deny when in doubt
- **Separation of Concerns**: Isolate critical components
- **Secure by Default**: Security enabled without configuration

## Security Architecture

### Defense Layers

```
┌─────────────────────────────────────────┐
│   Layer 5: Audit & Monitoring           │
│   - Comprehensive logging                │
│   - Anomaly detection                    │
└─────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────┐
│   Layer 4: Access Control                │
│   - Permission system                    │
│   - Team isolation                       │
│   - Path-based restrictions              │
└─────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────┐
│   Layer 3: Input Validation              │
│   - Type checking                        │
│   - Sanitization                         │
│   - Rate limiting                        │
└─────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────┐
│   Layer 2: IPC Security                  │
│   - Channel validation                   │
│   - Data encryption                      │
│   - Anti-CSRF tokens                     │
└─────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────┐
│   Layer 1: Database Encryption           │
│   - SQLCipher AES-256                    │
│   - Prepared statements                  │
│   - Transaction integrity                │
└─────────────────────────────────────────┘
```

## Threat Model

### Threats Addressed

| Threat | Likelihood | Impact | Mitigation |
|--------|-----------|--------|------------|
| Path Traversal | High | Critical | Path normalization, sandbox |
| SQL Injection | High | Critical | Prepared statements |
| XSS | Medium | High | Input sanitization |
| Command Injection | Medium | Critical | Input validation, no shell execution |
| Permission Escalation | Medium | High | Permission checks, team isolation |
| DoS | Medium | Medium | Rate limiting, resource limits |
| Data Leakage | Low | High | Field filtering, error sanitization |
| Sensitive File Access | High | Critical | Sensitive path detection |

### Attack Scenarios

#### Scenario 1: Malicious Team Attempts Path Traversal
**Attack**: Team tries to access `/etc/passwd` via `../../../etc/passwd`

**Defenses**:
1. Path normalization detects traversal
2. Sandbox root enforcement
3. Sensitive path detection
4. Permission check
5. Audit log records attempt

**Result**: ✅ Access denied, attack logged

#### Scenario 2: XSS via Team Name
**Attack**: Create team with name `<script>alert('xss')</script>`

**Defenses**:
1. Input sanitization removes scripts
2. HTML entity encoding
3. Content Security Policy
4. React/Vue auto-escaping

**Result**: ✅ Script neutralized, team created safely

#### Scenario 3: SQL Injection in Audit Log Query
**Attack**: Query audit logs with `'; DROP TABLE cowork_teams; --`

**Defenses**:
1. Prepared statements prevent injection
2. Input validation rejects malformed input
3. Transaction rollback on error
4. Database backups for recovery

**Result**: ✅ Query returns empty result, tables intact

## Security Controls

### File Sandbox Security

#### Sensitive Path Detection

**18+ Patterns Blocked**:
```javascript
const SENSITIVE_PATTERNS = [
  /\.env$/,                    // Environment files
  /\.env\./,                   // .env.production, etc.
  /credentials?\.json$/i,      // Credentials
  /secrets?\.json$/i,          // Secrets
  /\.ssh\//,                   // SSH directory
  /id_rsa/,                    // SSH private keys
  /id_ed25519/,                // Ed25519 keys
  /\.pem$/,                    // PEM certificates
  /\.key$/,                    // Private keys
  /\.p12$/,                    // PKCS#12 containers
  /\.pfx$/,                    // PFX certificates
  /config\.json$/,             // Config files (context-dependent)
  /\.npmrc$/,                  // NPM credentials
  /\.pypirc$/,                 // PyPI credentials
  /\.aws\/credentials/,        // AWS credentials
  /\.docker\/config\.json/,    // Docker credentials
  /\.kube\/config/,            // Kubernetes config
  /\.git\/config/,             // Git config (may contain tokens)
];
```

#### Path Traversal Prevention

```javascript
// ✅ Safe path handling
function checkPathSafety(filePath) {
  // 1. Normalize path
  const normalized = path.normalize(filePath);

  // 2. Resolve to absolute path
  const resolved = path.resolve(normalized);

  // 3. Check if within sandbox
  const sandboxRoot = path.resolve(SANDBOX_ROOT);
  if (!resolved.startsWith(sandboxRoot)) {
    return { safe: false, reason: "path_outside_sandbox" };
  }

  // 4. Check for symlink attacks
  if (fs.lstatSync(resolved).isSymbolicLink()) {
    const target = fs.readlinkSync(resolved);
    if (!path.resolve(target).startsWith(sandboxRoot)) {
      return { safe: false, reason: "symlink_outside_sandbox" };
    }
  }

  return { safe: true };
}
```

#### Permission System

**Granular Permissions**:
- `READ`: Read files, list directories
- `WRITE`: Create, modify, delete files
- `EXECUTE`: Execute scripts and binaries

**Permission Checks**:
```javascript
// All file operations require explicit permission
async function validateAccess(teamId, filePath, permission) {
  // 1. Check path safety
  const safetyCheck = checkPathSafety(filePath);
  if (!safetyCheck.safe) {
    return { allowed: false, reason: safetyCheck.reason };
  }

  // 2. Check if sensitive
  if (isSensitivePath(filePath)) {
    return { allowed: false, reason: "sensitive_file" };
  }

  // 3. Check permission
  if (!hasPermission(teamId, filePath, permission)) {
    return { allowed: false, reason: "insufficient_permission" };
  }

  return { allowed: true };
}
```

### IPC Security

#### Input Validation

**Type Validation**:
```javascript
const schemas = {
  "cowork:create-team": {
    teamName: { type: "string", minLength: 1, maxLength: 255, required: true },
    config: { type: "object", required: false },
  },
  "cowork:add-agent": {
    teamId: { type: "string", pattern: /^team-/, required: true },
    config: { type: "object", required: true },
  },
};

function validateInput(channel, data) {
  const schema = schemas[channel];
  if (!schema) {
    throw new Error("Unknown IPC channel");
  }

  for (const [field, rules] of Object.entries(schema)) {
    if (rules.required && !(field in data)) {
      throw new Error(`Missing required field: ${field}`);
    }

    if (field in data) {
      validateField(data[field], rules);
    }
  }
}
```

#### Sanitization

**XSS Prevention**:
```javascript
const sanitizeHtml = require("sanitize-html");

function sanitizeInput(input) {
  if (typeof input === "string") {
    // Remove all HTML tags
    return sanitizeHtml(input, {
      allowedTags: [],
      allowedAttributes: {},
    });
  }

  if (typeof input === "object") {
    const sanitized = {};
    for (const [key, value] of Object.entries(input)) {
      sanitized[key] = sanitizeInput(value);
    }
    return sanitized;
  }

  return input;
}
```

#### Rate Limiting

**Per-Channel Limits**:
```javascript
const rateLimits = {
  "cowork:create-team": { maxRequests: 10, windowMs: 60000 },  // 10/min
  "cowork:assign-task": { maxRequests: 100, windowMs: 60000 }, // 100/min
  "cowork:get-audit-log": { maxRequests: 50, windowMs: 60000 }, // 50/min
};

// Implement sliding window rate limiter
class RateLimiter {
  constructor() {
    this.windows = new Map();
  }

  checkLimit(channel, sender) {
    const limit = rateLimits[channel];
    if (!limit) return true;

    const key = `${channel}:${sender}`;
    const now = Date.now();
    const window = this.windows.get(key) || [];

    // Remove old requests outside window
    const validRequests = window.filter(
      (timestamp) => now - timestamp < limit.windowMs
    );

    if (validRequests.length >= limit.maxRequests) {
      return false;  // Rate limit exceeded
    }

    validRequests.push(now);
    this.windows.set(key, validRequests);
    return true;
  }
}
```

### Database Security

#### Encryption

**SQLCipher AES-256**:
```javascript
// Database is encrypted at rest
const db = new Database(dbPath, encryptionKey);

// Key derivation from passphrase
function deriveKey(passphrase) {
  return crypto.pbkdf2Sync(
    passphrase,
    "chainlesschain-cowork-salt",
    100000,  // 100k iterations
    32,      // 256 bits
    "sha256"
  );
}
```

#### SQL Injection Prevention

**Prepared Statements Only**:
```javascript
// ✅ Safe: Prepared statement
const team = db.prepare("SELECT * FROM cowork_teams WHERE id = ?").get(teamId);

// ❌ Unsafe: String concatenation (NEVER USE)
// const team = db.prepare(`SELECT * FROM cowork_teams WHERE id = '${teamId}'`).get();
```

**Parameterized Queries**:
```javascript
// ✅ Safe: All user inputs as parameters
db.prepare(`
  INSERT INTO cowork_tasks (team_id, description, type, input)
  VALUES (?, ?, ?, ?)
`).run(teamId, description, type, JSON.stringify(input));
```

#### Transaction Integrity

**ACID Compliance**:
```javascript
// Wrap related operations in transactions
db.transaction(() => {
  // 1. Create team
  const teamResult = db.prepare("INSERT INTO cowork_teams ...").run(...);

  // 2. Initialize metrics
  db.prepare("INSERT INTO cowork_metrics ...").run(...);

  // 3. Record audit log
  db.prepare("INSERT INTO cowork_audit_log ...").run(...);

  // All-or-nothing: if any step fails, entire transaction rolls back
})();
```

### Input Validation

#### Validation Rules

| Field | Rules | Example |
|-------|-------|---------|
| Team Name | String, 1-255 chars, no HTML | "Sales Team" ✅ |
| Agent Name | String, 1-100 chars, alphanumeric | "Agent-001" ✅ |
| File Path | String, normalized, within sandbox | "/sandbox/file.txt" ✅ |
| Permission | Enum: READ/WRITE/EXECUTE | "READ" ✅ |
| Task Type | String, 1-50 chars, alphanumeric | "office" ✅ |
| Priority | Integer, 1-5 | 3 ✅ |
| Limit | Integer, 1-1000 | 50 ✅ |

#### Validation Implementation

```javascript
const Joi = require("joi");

const schemas = {
  teamName: Joi.string().min(1).max(255).required(),
  agentName: Joi.string().min(1).max(100).alphanum().required(),
  filePath: Joi.string().min(1).max(4096).required(),
  permission: Joi.string().valid("READ", "WRITE", "EXECUTE").required(),
  taskType: Joi.string().min(1).max(50).alphanum().required(),
  priority: Joi.number().integer().min(1).max(5).required(),
  limit: Joi.number().integer().min(1).max(1000).required(),
};

function validate(field, value) {
  const schema = schemas[field];
  const { error, value: validated } = schema.validate(value);

  if (error) {
    throw new Error(`Validation failed for ${field}: ${error.message}`);
  }

  return validated;
}
```

## Audit Logging

### What to Log

**All security-relevant events**:
- ✅ File access attempts (success & failure)
- ✅ Permission grants/revocations
- ✅ Team/agent creation/deletion
- ✅ Task assignments/completions
- ✅ Authentication attempts
- ✅ Configuration changes
- ✅ Errors and exceptions

### Log Format

```json
{
  "id": "log-1706342400000-abc123",
  "timestamp": 1706342400000,
  "teamId": "team-001",
  "agentId": "agent-001",
  "operation": "WRITE",
  "path": "/sandbox/report.xlsx",
  "success": true,
  "metadata": {
    "fileSize": 15360,
    "duration": 125,
    "ip": "127.0.0.1"
  }
}
```

### Log Retention

- **Hot Storage**: Last 30 days (fast queries)
- **Warm Storage**: 31-90 days (compressed)
- **Cold Storage**: 91+ days (archived, compliance)

### Log Security

**Integrity Protection**:
```javascript
// Append-only logs with cryptographic hashing
function createAuditLog(entry) {
  // 1. Add previous log hash for chain integrity
  entry.previousHash = getLastLogHash();

  // 2. Calculate current hash
  entry.hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(entry))
    .digest("hex");

  // 3. Insert with write-once constraint
  db.prepare(`
    INSERT INTO cowork_audit_log (...)
    VALUES (...)
  `).run(...);

  // 4. Verify hash chain
  verifyHashChain();
}
```

## Security Testing

### Test Coverage

**Security Test Suite**:
- ✅ Path traversal attacks (15+ test cases)
- ✅ SQL injection (10+ test cases)
- ✅ XSS attacks (8+ test cases)
- ✅ Command injection (6+ test cases)
- ✅ Permission escalation (5+ test cases)
- ✅ Race conditions (4+ test cases)
- ✅ DoS attacks (3+ test cases)

**Total**: 50+ security-specific test cases

### Running Security Tests

```bash
# Run all security tests
npm run test:security

# Run specific test suites
npm test src/main/cowork/__tests__/security/sandbox-security.test.js
npm test src/main/cowork/__tests__/security/ipc-security.test.js
```

### Penetration Testing

**Recommended Schedule**:
- Weekly: Automated security scans
- Monthly: Internal penetration tests
- Quarterly: External security audit
- Annually: Full penetration test by 3rd party

## Incident Response

### Incident Types

| Type | Severity | Response Time | Action |
|------|----------|---------------|--------|
| Path Traversal | Critical | Immediate | Block team, audit logs |
| SQL Injection | Critical | Immediate | Block source, patch |
| Permission Escalation | High | <1 hour | Revoke permissions, investigate |
| XSS Attempt | High | <1 hour | Sanitize data, patch |
| DoS Attack | Medium | <4 hours | Rate limit, block IP |
| Failed Login | Low | <24 hours | Monitor, alert if repeated |

### Response Procedure

1. **Detection**: Alert triggered or log anomaly detected
2. **Containment**: Block malicious actor, disable affected features
3. **Investigation**: Analyze logs, determine scope of breach
4. **Eradication**: Patch vulnerability, remove malicious data
5. **Recovery**: Restore service, verify integrity
6. **Post-Incident**: Document findings, update defenses

### Contact Information

- **Security Team**: security@chainlesschain.com
- **On-Call**: +86-xxx-xxxx-xxxx
- **Emergency Escalation**: CTO, CEO

## Security Checklist

### Development Checklist

Before merging code:

- [ ] All inputs validated and sanitized
- [ ] Prepared statements used for all database queries
- [ ] File paths normalized and checked against sandbox
- [ ] Permissions verified before operations
- [ ] Errors sanitized (no sensitive data in messages)
- [ ] Audit logs added for security-relevant events
- [ ] Security tests added for new features
- [ ] Rate limiting configured for new IPC channels
- [ ] XSS protection verified in UI
- [ ] Code reviewed by security-aware developer

### Deployment Checklist

Before production deployment:

- [ ] All security tests passing
- [ ] Database encryption enabled
- [ ] Sensitive files blocked (verify patterns)
- [ ] Audit log retention configured
- [ ] Rate limiting enabled
- [ ] Error messages sanitized
- [ ] Security headers configured
- [ ] Backups enabled and tested
- [ ] Incident response plan updated
- [ ] Security monitoring enabled

### Operational Checklist

Monthly tasks:

- [ ] Review audit logs for anomalies
- [ ] Update sensitive file patterns
- [ ] Rotate encryption keys (if applicable)
- [ ] Test backup restoration
- [ ] Review and update rate limits
- [ ] Patch dependencies
- [ ] Review access permissions
- [ ] Conduct security training

## Best Practices

### DO ✅

1. **Validate All Inputs** - Never trust user input
2. **Use Prepared Statements** - Prevent SQL injection
3. **Normalize Paths** - Prevent path traversal
4. **Check Permissions** - Verify before every operation
5. **Sanitize Outputs** - Prevent XSS
6. **Log Everything** - Comprehensive audit trail
7. **Fail Securely** - Default to deny
8. **Keep Dependencies Updated** - Patch vulnerabilities
9. **Use HTTPS/TLS** - Encrypt data in transit
10. **Regular Security Testing** - Find vulnerabilities early

### DON'T ❌

1. **Don't Trust User Input** - Always validate and sanitize
2. **Don't Concatenate SQL** - Use prepared statements
3. **Don't Expose Errors** - Sanitize error messages
4. **Don't Store Plaintext Secrets** - Encrypt sensitive data
5. **Don't Skip Authentication** - Verify identity
6. **Don't Ignore Security Warnings** - Fix immediately
7. **Don't Use Weak Encryption** - Use AES-256, not MD5
8. **Don't Disable Security Features** - Keep protections enabled
9. **Don't Log Sensitive Data** - Redact passwords, keys
10. **Don't Assume Safety** - Continuously test and monitor

## Security Metrics

### Key Performance Indicators (KPIs)

- **Mean Time to Detect (MTTD)**: < 5 minutes
- **Mean Time to Respond (MTTR)**: < 1 hour
- **False Positive Rate**: < 5%
- **Security Test Coverage**: > 90%
- **Vulnerability Patching Time**: < 24 hours
- **Audit Log Completeness**: > 99.9%

### Monitoring Dashboards

Create dashboards for:
- Failed permission checks (spike = attack)
- Path traversal attempts (> 0 = attack)
- Rate limit violations (> threshold = DoS)
- Database errors (spike = injection attempt)
- Sensitive file access attempts (> 0 = breach attempt)

## Compliance

### Standards Compliance

- ✅ **OWASP Top 10**: Addressed all major vulnerabilities
- ✅ **CWE/SANS Top 25**: Mitigated critical weaknesses
- ✅ **GDPR**: Data protection and privacy by design
- ✅ **SOC 2**: Security controls and audit logging

## Conclusion

The Cowork system implements enterprise-grade security with defense-in-depth architecture. Following this security guide ensures the system remains secure against evolving threats.

**Remember**: Security is not a one-time effort. Continuous monitoring, testing, and improvement are essential.

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [CWE Top 25](https://cwe.mitre.org/top25/)
- [SQLite Security](https://www.sqlite.org/security.html)
- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
