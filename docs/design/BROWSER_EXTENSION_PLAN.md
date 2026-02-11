# Browser Extension API Implementation Plan

## Overview

This document outlines the remaining browser APIs that can be added to the ChainlessChain browser extension. The current implementation (Phase 25 complete) covers approximately 400+ operations across major browser APIs.

## Implementation Status Summary

### Completed Phases (1-25)

| Phase | Category            | Operations | Status      |
| ----- | ------------------- | ---------- | ----------- |
| 1-10  | Core APIs           | ~120       | ✅ Complete |
| 11-15 | DOM & Events        | ~80        | ✅ Complete |
| 16-19 | Storage & Network   | ~60        | ✅ Complete |
| 20-21 | Web APIs & System   | ~45        | ✅ Complete |
| 22    | WebRTC & Components | ~35        | ✅ Complete |
| 23    | Modern Web APIs     | ~56        | ✅ Complete |
| 24    | Hardware & Media    | ~51        | ✅ Complete |
| 25    | Detection & Utility | ~47        | ✅ Complete |

**Total: 400+ operations implemented**

---

## Remaining APIs for Future Phases

### Phase 26: Performance & Analytics APIs (Est. ~30 operations)

**Performance Observer API (Extended)**

- `createPerformanceObserver` - Create performance observer
- `observePerformanceEntries` - Observe specific entry types
- `getPerformanceMarks` - Get performance marks
- `getPerformanceMeasures` - Get performance measures
- `clearPerformanceMarks` - Clear marks
- `clearPerformanceMeasures` - Clear measures

**User Timing API**

- `createPerformanceMark` - Create named mark
- `createPerformanceMeasure` - Create measurement between marks
- `getResourceTimings` - Get resource load timings
- `getNavigationTiming` - Get navigation timing data

**Long Tasks API**

- `observeLongTasks` - Observe long-running tasks
- `getLongTaskEntries` - Get long task entries

**Element Timing API**

- `observeElementTiming` - Observe element render timing
- `markElementForTiming` - Mark element for observation

**Layout Instability API (CLS)**

- `observeLayoutShifts` - Observe layout shift events
- `getLayoutShiftScore` - Get cumulative layout shift score

**Permission Level**: NORMAL to PUBLIC

---

### Phase 27: Experimental & Emerging APIs (Est. ~35 operations)

**Eyedropper API**

- `openEyedropper` - Open color picker
- `isEyedropperSupported` - Check support

**Screen Capture API (Enhanced)**

- `getDisplayMedia` - Capture screen/window
- `selectDisplay` - Select display to capture
- `stopScreenCapture` - Stop capture

**File Handling API**

- `registerFileHandler` - Register as file handler
- `unregisterFileHandler` - Unregister handler
- `getFileHandlerState` - Get registration state

**Web Share Target API**

- `registerShareTarget` - Register as share target
- `getShareData` - Get shared data

**Contact Picker API**

- `selectContacts` - Open contact picker
- `getContactProperties` - Get available properties

**Content Index API**

- `addToContentIndex` - Add content to offline index
- `removeFromContentIndex` - Remove from index
- `getContentIndexItems` - List indexed items

**Periodic Background Sync API**

- `registerPeriodicSync` - Register periodic sync
- `unregisterPeriodicSync` - Unregister sync
- `getPeriodicSyncTags` - Get registered tags

**App Badging API (Extended)**

- `setAppBadge` - Set app badge
- `clearAppBadge` - Clear badge
- `setClientBadge` - Set client badge

**Permission Level**: NORMAL to ADMIN

---

### Phase 28: Security & Privacy APIs (Est. ~25 operations)

**Credential Management API (Extended)**

- `createCredential` - Create new credential
- `getCredentials` - Get stored credentials
- `preventSilentAccess` - Prevent silent credential access

**WebAuthn API**

- `createPublicKeyCredential` - Create WebAuthn credential
- `getPublicKeyCredential` - Get WebAuthn credential
- `isUserVerifyingPlatformAuthenticatorAvailable` - Check UVPA

**Trusted Types API**

- `createTrustedTypePolicy` - Create trusted type policy
- `isTrustedTypesSupported` - Check support
- `getTrustedTypePolicies` - Get policies

**Content Security Policy API**

- `getSecurityPolicyViolations` - Get CSP violations
- `observeCSPViolations` - Observe violations

**Subresource Integrity**

- `validateResourceIntegrity` - Validate SRI
- `generateIntegrityHash` - Generate SRI hash

**Permission Level**: ADMIN to ROOT

---

### Phase 29: Graphics & Rendering APIs (Est. ~40 operations)

**WebGPU API**

- `getGPUAdapter` - Get GPU adapter
- `requestGPUDevice` - Request GPU device
- `createGPUBuffer` - Create GPU buffer
- `createGPUTexture` - Create texture
- `createGPUShaderModule` - Create shader
- `createGPURenderPipeline` - Create render pipeline
- `createGPUComputePipeline` - Create compute pipeline
- `submitGPUCommands` - Submit command buffer
- `isWebGPUSupported` - Check support

**WebGL2 Extensions**

- `getWebGL2Extensions` - Get WebGL2 extensions
- `createWebGL2Context` - Create WebGL2 context
- `compileWebGLShader` - Compile shader
- `linkWebGLProgram` - Link program

**OffscreenCanvas API**

- `createOffscreenCanvas` - Create offscreen canvas
- `transferToOffscreenCanvas` - Transfer to offscreen
- `getOffscreenContext` - Get offscreen context

**ImageBitmap API**

- `createImageBitmap` - Create image bitmap
- `transferImageBitmap` - Transfer bitmap
- `closeImageBitmap` - Close/release bitmap

**Permission Level**: NORMAL to ADMIN

---

### Phase 30: Communication & Messaging APIs (Est. ~25 operations)

**MessageChannel API**

- `createMessageChannel` - Create channel
- `postMessageToPort` - Post to port
- `closeMessagePort` - Close port

**MessagePort API**

- `startMessagePort` - Start port
- `closeMessagePort` - Close port

**CompressionStream API (Extended)**

- `createCompressionStream` - Create stream
- `createDecompressionStream` - Create decompress stream
- `pipeCompression` - Pipe data through

**TransformStream API**

- `createTransformStream` - Create transform stream
- `chainTransformStreams` - Chain multiple streams

**ReadableStream API (Extended)**

- `createReadableStream` - Create readable stream
- `readFromStream` - Read from stream
- `cancelStream` - Cancel stream
- `pipeToWritable` - Pipe to writable

**WritableStream API**

- `createWritableStream` - Create writable stream
- `writeToStream` - Write to stream
- `closeWritableStream` - Close stream

**Permission Level**: NORMAL

---

### Phase 31: Device & Hardware APIs (Est. ~35 operations)

**Generic Sensor API**

- `getAccelerometer` - Get accelerometer data
- `getGyroscope` - Get gyroscope data
- `getMagnetometer` - Get magnetometer data
- `getAmbientLightSensor` - Get light sensor data

**Geolocation API (Enhanced)**

- `getCurrentPosition` - Get current position
- `watchPosition` - Watch position changes
- `clearWatch` - Clear position watch
- `getGeolocationPermission` - Get permission state

**DeviceOrientation API**

- `getDeviceOrientation` - Get orientation
- `watchDeviceOrientation` - Watch orientation
- `getDeviceMotion` - Get motion data

**Battery Status API (Extended)**

- `getBatteryManager` - Get battery manager
- `watchBatteryStatus` - Watch battery changes

**Network Information API (Extended)**

- `getNetworkType` - Get network type
- `getEffectiveType` - Get effective connection type
- `watchNetworkChanges` - Watch for changes
- `getDownlinkMax` - Get max downlink

**Vibration API**

- `vibrate` - Trigger vibration
- `cancelVibration` - Cancel vibration

**Permission Level**: NORMAL to ADMIN

---

### Phase 32: Accessibility & Internationalization (Est. ~20 operations)

**Selection API (Extended)**

- `getSelection` - Get text selection
- `setSelection` - Set selection range
- `collapseSelection` - Collapse selection
- `extendSelection` - Extend selection

**Range API**

- `createRange` - Create range
- `setRangeStart` - Set start position
- `setRangeEnd` - Set end position
- `surroundContents` - Surround with element

**Intl API**

- `formatNumber` - Format number
- `formatDate` - Format date
- `formatRelativeTime` - Format relative time
- `listFormat` - Format lists
- `pluralRules` - Get plural rules
- `segmentText` - Segment text

**Permission Level**: PUBLIC to NORMAL

---

## Implementation Guidelines

### For Each New Phase:

1. **Add to background.js**
   - Command handlers in `handleCommand` switch
   - Implementation functions with `chrome.scripting.executeScript`

2. **Add to browser-extension-server.js**
   - Routing cases in `ExtensionBrowserHandler.handle`

3. **Add to permission-gate.js**
   - Permission levels for each operation

4. **Add Unit Tests**
   - Test routing in browser-extension-server.test.js

5. **Update Documentation**
   - Update this plan document
   - Update CLAUDE.md if needed

### Security Considerations

- **PUBLIC**: Read-only, non-sensitive operations
- **NORMAL**: Standard browser operations
- **ADMIN**: Sensitive data access, hardware control
- **ROOT**: System-level operations, credential management

---

## Priority Recommendations

### High Priority (Implement Next)

1. Phase 26 - Performance APIs (useful for debugging)
2. Phase 29 - Graphics APIs (WebGPU is emerging standard)

### Medium Priority

3. Phase 31 - Device APIs (mobile-first features)
4. Phase 27 - Experimental APIs (future-proofing)

### Lower Priority

5. Phase 28 - Security APIs (specialized use cases)
6. Phase 30 - Communication APIs (advanced patterns)
7. Phase 32 - Accessibility/Intl (niche features)

---

## Estimated Timeline

Each phase requires approximately:

- Development: 2-4 hours
- Testing: 1-2 hours
- Documentation: 30 minutes

**Total remaining: ~210 operations across 7 phases**

---

## References

- [MDN Web APIs](https://developer.mozilla.org/en-US/docs/Web/API)
- [Chrome Platform Status](https://chromestatus.com/)
- [Can I Use](https://caniuse.com/)
- [Web.dev](https://web.dev/)

---

_Last Updated: 2026-02-11_
_Current Version: Phase 25 Complete_
