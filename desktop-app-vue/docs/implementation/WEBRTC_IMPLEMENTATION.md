# WebRTC P2P Voice/Video Call Implementation

## Overview

ChainlessChain desktop application now has fully functional P2P voice and video calling capabilities using WebRTC. The implementation bridges Electron's main and renderer processes to properly handle media streams while maintaining security and performance.

## Architecture

### Main Process Components

#### 1. VoiceVideoManager (`src/main/p2p/voice-video-manager.js`)
- Manages WebRTC peer connections using the `wrtc` package
- Handles call lifecycle (initiate, accept, reject, end)
- Manages call sessions and state
- Provides quality monitoring and statistics
- **Key Fix**: Now properly requests media streams from renderer process instead of using mock streams

#### 2. MediaStreamBridge (`src/main/p2p/media-stream-bridge.js`)
- Bridges media stream requests between main and renderer processes
- Manages stream lifecycle and track state
- Handles stream metadata (streamId, tracks, constraints)
- Provides timeout and error handling

#### 3. P2PEnhancedManager (`src/main/p2p/p2p-enhanced-manager.js`)
- Integrates all P2P features (messaging, file transfer, calls)
- Connects VoiceVideoManager with MediaStreamBridge
- Manages event flow between components
- Provides unified API for P2P operations

#### 4. P2PEnhancedIPC (`src/main/p2p/p2p-enhanced-ipc.js`)
- Handles IPC communication with renderer process
- Forwards events to renderer (call events, media stream requests)
- Provides IPC handlers for call operations
- **Key Fix**: Now forwards media stream bridge events to renderer

### Renderer Process Components

#### 1. MediaStreamHandler (`src/renderer/utils/mediaStreamHandler.js`)
- Handles `getUserMedia` requests from main process
- Manages media streams in renderer process
- Supports audio, video, and screen sharing
- **Key Fixes**:
  - Added screen sharing support using `desktopCapturer`
  - Provides `getAvailableScreenSources()` for UI selection
  - Properly initialized in `main.js`

#### 2. CallWindow Component (`src/renderer/components/call/CallWindow.vue`)
- Full-screen call interface
- Video display and audio-only mode
- Control buttons (mute, video toggle, end call, settings)
- Real-time quality indicators

#### 3. useP2PCall Composable (`src/renderer/composables/useP2PCall.js`)
- Vue 3 composable for call management
- Methods: `startAudioCall`, `startVideoCall`, `startScreenShare`
- State management: `activeCall`, `incomingCall`, `callStats`
- Event handling for call lifecycle

## How It Works

### Call Flow

#### 1. Initiating a Call

```javascript
// Renderer process (Vue component)
const { startVideoCall } = useP2PCall();
await startVideoCall(peerId);

// Main process flow:
// 1. VoiceVideoManager.startCall() is called
// 2. Emits 'media:stream-required' event
// 3. P2PEnhancedManager catches event and calls MediaStreamBridge.requestMediaStream()
// 4. MediaStreamBridge emits 'request-media-stream' event
// 5. P2PEnhancedIPC forwards to renderer as 'media-stream:request'
// 6. MediaStreamHandler in renderer calls getUserMedia()
// 7. Sends 'media-stream:ready' back to main process
// 8. MediaStreamBridge resolves promise with stream info
// 9. VoiceVideoManager creates WebRTC connection with stream
// 10. Sends call offer to peer via P2P network
```

#### 2. Receiving a Call

```javascript
// Main process receives call offer via P2P
// 1. VoiceVideoManager creates session in RINGING state
// 2. Emits 'call:incoming' event
// 3. P2PEnhancedIPC forwards to renderer
// 4. CallWindow shows incoming call notification
// 5. User accepts/rejects call
```

#### 3. Accepting a Call

```javascript
// Renderer process
await acceptCall(callId);

// Main process flow:
// 1. VoiceVideoManager.acceptCall() is called
// 2. Requests media stream (same flow as initiating)
// 3. Creates WebRTC answer
// 4. Sends answer to peer
// 5. Connection established
```

### Screen Sharing Flow

```javascript
// Renderer process
const { startScreenShare } = useP2PCall();

// 1. Get available sources (optional)
const sources = await window.mediaStreamHandler.getAvailableScreenSources();

// 2. Start screen share with selected source
await startScreenShare(peerId, { sourceId: sources[0].id });

// Main process:
// 1. VoiceVideoManager requests 'screen' type stream
// 2. MediaStreamHandler.getScreenStream() uses desktopCapturer
// 3. Returns screen stream
// 4. WebRTC connection established with screen track
```

## Key Improvements

### 1. Real Media Stream Support
**Before**: VoiceVideoManager used mock MediaStream objects in main process
**After**: Properly requests real media streams from renderer process via MediaStreamBridge

### 2. Screen Sharing Support
**Before**: Threw error "Screen sharing needs to be implemented in renderer"
**After**: Full screen sharing support with source selection

### 3. Event Forwarding
**Before**: Media stream bridge events not forwarded to renderer
**After**: All media stream events properly forwarded via P2PEnhancedIPC

### 4. Renderer Initialization
**Before**: MediaStreamHandler not initialized
**After**: Automatically initialized in `main.js`

## API Reference

### Main Process API

#### VoiceVideoManager

```javascript
// Start a call
const callId = await voiceVideoManager.startCall(peerId, CallType.VIDEO, options);

// Accept a call
await voiceVideoManager.acceptCall(callId);

// Reject a call
await voiceVideoManager.rejectCall(callId);

// End a call
await voiceVideoManager.endCall(callId);

// Toggle mute
await voiceVideoManager.toggleMute(callId);

// Toggle video
await voiceVideoManager.toggleVideo(callId);

// Get call info
const info = voiceVideoManager.getCallInfo(callId);

// Get statistics
const stats = voiceVideoManager.getStats();
```

#### MediaStreamBridge

```javascript
// Request media stream
const streamInfo = await mediaStreamBridge.requestMediaStream(
  'video', // 'audio' | 'video' | 'screen'
  constraints,
  { callId, peerId, timeout: 30000 }
);

// Stop media stream
mediaStreamBridge.stopMediaStream(streamId);

// Toggle track
mediaStreamBridge.toggleTrack(streamId, 'audio', false);

// Get stream info
const info = mediaStreamBridge.getStreamInfo(streamId);
```

### Renderer Process API

#### IPC Channels

```javascript
// Start call
await ipcRenderer.invoke('p2p-enhanced:start-call', { peerId, type: 'video' });

// Accept call
await ipcRenderer.invoke('p2p-enhanced:accept-call', { callId });

// Reject call
await ipcRenderer.invoke('p2p-enhanced:reject-call', { callId });

// End call
await ipcRenderer.invoke('p2p-enhanced:end-call', { callId });

// Toggle mute
await ipcRenderer.invoke('p2p-enhanced:toggle-mute', { callId });

// Toggle video
await ipcRenderer.invoke('p2p-enhanced:toggle-video', { callId });
```

#### Events

```javascript
// Call events
ipcRenderer.on('p2p-enhanced:call-incoming', (event, data) => {
  // Handle incoming call
});

ipcRenderer.on('p2p-enhanced:call-connected', (event, data) => {
  // Call connected
});

ipcRenderer.on('p2p-enhanced:call-ended', (event, data) => {
  // Call ended
});

ipcRenderer.on('p2p-enhanced:call-remote-stream', (event, data) => {
  // Remote stream available
});

// Media stream events
ipcRenderer.on('media-stream:request', (event, data) => {
  // Main process requesting media stream
});

ipcRenderer.on('media-stream:stop', (event, data) => {
  // Stop media stream
});
```

#### MediaStreamHandler

```javascript
// Get available screen sources
const sources = await window.mediaStreamHandler.getAvailableScreenSources();
// Returns: [{ id, name, thumbnail, type }]

// Get active streams
const streams = window.mediaStreamHandler.getActiveStreams();

// Get specific stream
const stream = window.mediaStreamHandler.getStream(streamId);
```

#### useP2PCall Composable

```javascript
import { useP2PCall } from '@/composables/useP2PCall';

const {
  activeCall,
  incomingCall,
  callStats,
  startAudioCall,
  startVideoCall,
  startScreenShare,
  acceptCall,
  rejectCall,
  endCall,
  toggleMute,
  toggleVideo
} = useP2PCall();

// Start video call
await startVideoCall(peerId);

// Start screen share
await startScreenShare(peerId, { sourceId: 'screen:0:0' });

// Accept incoming call
await acceptCall(incomingCall.value.callId);
```

## Configuration

### ICE Servers

Configure STUN/TURN servers in P2PEnhancedManager initialization:

```javascript
const p2pEnhancedManager = new P2PEnhancedManager(p2pManager, database, {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: 'turn:your-turn-server.com:3478',
      username: 'user',
      credential: 'pass'
    }
  ]
});
```

### Media Constraints

```javascript
const options = {
  audioConstraints: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  },
  videoConstraints: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 }
  },
  callTimeout: 60000, // 60 seconds
  qualityCheckInterval: 5000 // 5 seconds
};
```

## Testing

### Manual Testing

1. **Audio Call**:
   ```bash
   cd desktop-app-vue
   npm run dev
   # In app: Navigate to contacts, click audio call button
   ```

2. **Video Call**:
   ```bash
   # Same as audio, click video call button
   ```

3. **Screen Share**:
   ```bash
   # In call window, click screen share button
   # Select screen/window from picker
   ```

### Automated Testing

```bash
cd desktop-app-vue
npm run test:webrtc
```

## Troubleshooting

### Issue: "Permission denied" for camera/microphone

**Solution**: Check system permissions for camera/microphone access

### Issue: "No media stream received"

**Solution**:
1. Check that MediaStreamHandler is initialized in renderer
2. Verify IPC event forwarding in P2PEnhancedIPC
3. Check browser console for getUserMedia errors

### Issue: Screen sharing not working

**Solution**:
1. Ensure desktopCapturer is available in renderer
2. Check that sourceId is valid
3. Verify Electron version supports desktopCapturer

### Issue: Call quality is poor

**Solution**:
1. Check network connectivity
2. Configure TURN server for NAT traversal
3. Adjust video constraints (lower resolution/framerate)
4. Monitor call statistics via `getCallInfo()`

## Performance Considerations

1. **Video Resolution**: Default 720p, adjust based on network
2. **Frame Rate**: Default 30fps, can reduce to 15fps for bandwidth
3. **Audio Quality**: Echo cancellation and noise suppression enabled by default
4. **Screen Sharing**: Full screen capture can be CPU intensive

## Security

1. **E2E Encryption**: WebRTC uses DTLS-SRTP for media encryption
2. **Signaling**: Call signaling uses Signal Protocol for E2E encryption
3. **Permissions**: Camera/microphone access requires user permission
4. **Privacy**: Media streams never leave the P2P connection

## Future Enhancements

1. **Multi-party Calls**: Support for conference calls (3+ participants)
2. **Call Recording**: Record calls locally
3. **Virtual Backgrounds**: Blur/replace background in video calls
4. **Noise Cancellation**: Advanced audio processing
5. **Bandwidth Adaptation**: Automatic quality adjustment based on network
6. **Call History UI**: Dedicated page for call history
7. **Push Notifications**: Native notifications for incoming calls

## References

- [WebRTC API](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- [Electron desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer)
- [wrtc Package](https://github.com/node-webrtc/node-webrtc)
- [libp2p](https://libp2p.io/)
- [Signal Protocol](https://signal.org/docs/)

## Support

For issues or questions:
- GitHub Issues: https://github.com/anthropics/chainlesschain/issues
- Documentation: `/docs/`
- Code: `/desktop-app-vue/src/main/p2p/` and `/desktop-app-vue/src/renderer/`
