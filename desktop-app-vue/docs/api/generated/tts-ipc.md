# tts-ipc

**Source**: `src/main/speech/tts-ipc.js`

**Generated**: 2026-02-15T10:10:53.368Z

---

## const

```javascript
const
```

* Text-to-Speech IPC Handlers
 *
 * Provides IPC interface for TTS:
 * - Speech synthesis
 * - Voice management
 * - Provider configuration
 *
 * @module tts-ipc
 * @version 1.0.0

---

## function registerTTSIPC(options =

```javascript
function registerTTSIPC(options =
```

* Register TTS IPC handlers
 * @param {Object} options - Options
 * @param {TTSManager} options.ttsManager - TTS manager instance
 * @param {Object} [options.ipcMain] - Custom IPC main (for testing)
 * @returns {Object} Handler update functions

---

## ipc.handle('tts:check-status', async () =>

```javascript
ipc.handle('tts:check-status', async () =>
```

* Check TTS status

---

## ipc.handle('tts:get-stats', async () =>

```javascript
ipc.handle('tts:get-stats', async () =>
```

* Get statistics

---

## ipc.handle('tts:synthesize', async (event,

```javascript
ipc.handle('tts:synthesize', async (event,
```

* Synthesize text to speech

---

## ipc.handle('tts:synthesize-edge', async (event,

```javascript
ipc.handle('tts:synthesize-edge', async (event,
```

* Synthesize with Edge TTS specifically

---

## ipc.handle('tts:synthesize-local', async (event,

```javascript
ipc.handle('tts:synthesize-local', async (event,
```

* Synthesize with Local TTS (Piper) specifically

---

## ipc.handle('tts:synthesize-to-file', async (event,

```javascript
ipc.handle('tts:synthesize-to-file', async (event,
```

* Synthesize to file

---

## ipc.handle('tts:get-voices', async (event,

```javascript
ipc.handle('tts:get-voices', async (event,
```

* Get available voices

---

## ipc.handle('tts:get-edge-voices', async (event,

```javascript
ipc.handle('tts:get-edge-voices', async (event,
```

* Get Edge TTS voices

---

## ipc.handle('tts:get-local-models', async () =>

```javascript
ipc.handle('tts:get-local-models', async () =>
```

* Get Local TTS (Piper) models

---

## ipc.handle('tts:clear-cache', async () =>

```javascript
ipc.handle('tts:clear-cache', async () =>
```

* Clear TTS cache

---

