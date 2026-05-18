# Signal E2E Encryption Test Guide

## Overview

This document describes the comprehensive test suite for Signal Protocol E2E encryption in ChainlessChain's P2P messaging system.

## Test Structure

```
tests/
├── unit/p2p/
│   ├── signal-session-manager.test.js   # Unit tests with mocking
│   └── signal-security.test.js          # Security property tests
├── e2e/
│   └── signal-protocol-e2e.test.js      # Playwright E2E tests (browser)
scripts/
└── test-signal-encryption.js            # Standalone Node.js test script
```

## Running Tests

### Quick Start

```bash
cd desktop-app-vue

# Run all Signal-related unit tests
npm run test -- --grep "Signal"

# Run standalone Node.js test (real crypto)
node scripts/test-signal-encryption.js

# Run Vitest unit tests
npx vitest run tests/unit/p2p/signal-session-manager.test.js
npx vitest run tests/unit/p2p/signal-security.test.js
```

### Test Commands

| Command                                  | Description                    |
| ---------------------------------------- | ------------------------------ |
| `npm run test`                           | Run all Vitest tests           |
| `npm run test:e2e`                       | Run Playwright E2E tests       |
| `node scripts/test-signal-encryption.js` | Run standalone encryption test |

## Test Categories

### 1. Unit Tests (`signal-session-manager.test.js`)

Tests core SignalSessionManager functionality with mocked crypto operations:

- **Initialization**: Manager creation, config handling
- **Pre Key Bundle**: Generation, validation, structure
- **Session Management**: Creation, deletion, lookup
- **Encryption/Decryption**: Message processing, type handling
- **ArrayBuffer Conversion**: Type conversions, edge cases
- **LocalSignalProtocolStore**: Session storage, key storage

### 2. Security Tests (`signal-security.test.js`)

Tests security properties of the implementation:

- **Forward Secrecy**: Different keys per message, unique ciphertexts
- **Message Authenticity**: Type indicators, registration IDs
- **Key Isolation**: Unique keys per user, separate storage
- **Session Security**: State tracking, deletion
- **Pre Key Bundle Validation**: Input validation, error handling
- **Data Type Security**: Memory safety, buffer handling
- **Error Handling Security**: No information leakage
- **Memory Security**: Sensitive data cleanup

### 3. Standalone Test (`test-signal-encryption.js`)

Real-world test using actual WebCrypto:

- Full encryption/decryption flow
- Multi-user communication
- Performance benchmarks
- Security property verification

## Key Fixes Applied

### ArrayBuffer Conversion (signal-session-manager.js)

Fixed issues with type conversion in `arrayBufferFromObject()`:

```javascript
// Before: Could fail with Uint8Array
if (obj instanceof ArrayBuffer) return obj;

// After: Handles Uint8Array first, creates new copy
if (obj instanceof Uint8Array) {
  const buffer = new ArrayBuffer(obj.length);
  const view = new Uint8Array(buffer);
  view.set(obj);
  return buffer;
}
```

### Pre Key Bundle Validation

Added input validation in `processPreKeyBundle()`:

- Validates bundle is not null
- Validates registration ID > 0
- Validates identity key exists
- Validates signed pre key exists with public key

### New Helper Methods

Added `toUint8Array()` and `ensureArrayBuffer()` for consistent type handling.

## Test Coverage

| Module                | Unit Tests | Security Tests | E2E Tests |
| --------------------- | ---------- | -------------- | --------- |
| Identity Management   | ✅         | ✅             | ✅        |
| Pre-key Generation    | ✅         | ✅             | ✅        |
| Session Establishment | ✅         | ✅             | ✅        |
| Encryption            | ✅         | ✅             | ✅        |
| Decryption            | ✅         | ✅             | ✅        |
| Forward Secrecy       | -          | ✅             | ✅        |
| Message Authenticity  | -          | ✅             | ✅        |
| Error Handling        | ✅         | ✅             | ✅        |
| Performance           | -          | -              | ✅        |

## Known Limitations

### WebCrypto Compatibility

The `@privacyresearch/libsignal-protocol-typescript` library requires WebCrypto API, which:

- Works in: Electron renderer, Chromium, standalone Node.js 18+
- Fails in: jsdom environment (Vitest default)

**Solution**: Unit tests use mocks; real crypto tests use standalone script or Playwright.

### Test Environment

```javascript
// In test environment, mock crypto operations
vi.mock('@privacyresearch/libsignal-protocol-typescript', () => ({...}));

// In standalone test, use real crypto
if (!global.crypto) {
  global.crypto = require('crypto').webcrypto;
}
```

## Troubleshooting

### "Failed to execute 'importKey' on 'SubtleCrypto'"

**Cause**: WebCrypto not available in test environment.

**Solution**:

1. Use mocked tests in Vitest
2. Run `node scripts/test-signal-encryption.js` for real crypto tests

### "Pre key bundle is required"

**Cause**: Passing null/undefined to `processPreKeyBundle()`.

**Solution**: Ensure bundle is valid before calling.

### ArrayBuffer Type Mismatch

**Cause**: Signal library returns Uint8Array, code expects ArrayBuffer.

**Solution**: Use `ensureArrayBuffer()` or `toUint8Array()` helpers.

## Security Considerations

1. **Key Material**: Never log or expose private keys
2. **Session Storage**: Sessions are in-memory by default
3. **Identity Trust**: Current implementation trusts all identities (TODO: implement TOFU)
4. **Pre-key Rotation**: Pre-keys should be rotated periodically (TODO)

## Future Improvements

1. [ ] Trust-On-First-Use (TOFU) for identity verification
2. [ ] Pre-key rotation mechanism
3. [ ] Session persistence encryption
4. [ ] Group messaging support
5. [ ] Key backup and recovery
6. [ ] Cross-platform testing (macOS, Linux)

## References

- [Signal Protocol Specification](https://signal.org/docs/)
- [@privacyresearch/libsignal-protocol-typescript](https://github.com/nicktmro/libsignal-protocol-typescript)
- [X3DH Key Agreement Protocol](https://signal.org/docs/specifications/x3dh/)
- [Double Ratchet Algorithm](https://signal.org/docs/specifications/doubleratchet/)
