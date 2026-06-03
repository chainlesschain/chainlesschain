# Mobile Device Testing Scripts

This directory contains test scripts for mobile device pairing and data synchronization features.

## Test Scripts

### 1. test-mobile-client.js
**Purpose**: Verify mobile client can connect to the signaling server

**Usage**:
```bash
node tests/mobile/test-mobile-client.js
```

**What it tests**:
- WebSocket connection to signaling server (ws://localhost:9001)
- Mobile device registration
- Peer list retrieval
- Real-time peer status updates

---

### 2. test-pairing.js
**Purpose**: Simulate mobile device initiating pairing flow

**Usage**:
```bash
node tests/mobile/test-pairing.js
```

**What it tests**:
- Mobile device registration
- Pairing code generation (6-digit)
- QR code data generation
- Waiting for PC confirmation
- WebRTC offer/answer exchange (simulated)

**Output**: Provides pairing code and QR data JSON for PC to scan

---

### 3. test-pc-pairing.js
**Purpose**: Simulate PC confirming mobile pairing request

**Usage**:
```bash
# First run test-pairing.js to get pairing code and mobile peer ID
# Then update the script with those values and run:
node tests/mobile/test-pc-pairing.js
```

**What it tests**:
- PC device registration
- Sending pairing confirmation to mobile
- WebRTC answer response (simulated)

**Note**: Update `pairingCode`, `pcPeerId`, and `mobilePeerId` variables before running

---

### 4. test-data-sync.js
**Purpose**: Test knowledge base, project files, and PC status synchronization

**Usage**:
```bash
node tests/mobile/test-data-sync.js
```

**What it tests**:
- Knowledge base operations:
  - List notes
  - Search notes
  - Get folders
  - Get tags
- Project operations:
  - List projects
- PC status monitoring:
  - System info
  - Services status
  - Real-time status

**Requirements**: PC application must be running with signaling server active

---

## Prerequisites

### 1. Install Dependencies
```bash
npm install ws
```

### 2. Start Signaling Server
The signaling server must be running on `ws://localhost:9001`. This is typically started with the desktop application.

### 3. PC Application
For pairing and data sync tests, the PC desktop application must be running.

---

## Test Flow

### Complete Pairing Flow Test

1. **Start Mobile Client**:
   ```bash
   node tests/mobile/test-mobile-client.js
   ```
   Keep this running in terminal 1.

2. **Initiate Pairing** (in terminal 2):
   ```bash
   node tests/mobile/test-pairing.js
   ```
   Copy the pairing code and mobile peer ID from output.

3. **Confirm from PC** (in terminal 3):
   - Update `test-pc-pairing.js` with the pairing code and peer IDs
   - Run:
     ```bash
     node tests/mobile/test-pc-pairing.js
     ```

4. **Test Data Sync** (after pairing):
   ```bash
   node tests/mobile/test-data-sync.js
   ```

---

## Troubleshooting

### Connection Refused
- Ensure signaling server is running on port 9001
- Check if desktop application is started

### Peer Offline
- Verify the target peer ID is correct
- Ensure both devices are registered to the same signaling server

### No Response
- Check network connectivity
- Verify WebSocket connection is established
- Look for errors in desktop application logs

---

## Related Documentation

- **P2P Architecture**: `docs/design/系统设计_个人移动AI管理系统.md`
- **Mobile Features**: See "移动端功能" section in system design doc
- **Signaling Protocol**: Desktop app implements WebSocket signaling at `desktop-app-vue/src/main/p2p/`

---

## Notes

- These are **integration tests** that require the full signaling infrastructure
- Tests use **mock WebRTC** data (not actual peer connections)
- For unit tests of P2P components, see `desktop-app-vue/tests/integration/p2p-messaging.test.js`
- Pairing codes are 6-digit random numbers (100000-999999)
- All timestamps are in Unix milliseconds
