# extended-tools-tts

**Source**: `src/main/ai-engine/extended-tools-tts.js`

**Generated**: 2026-02-17T10:13:18.279Z

---

## const

```javascript
const
```

* Text-to-Speech Tools Integration
 *
 * Registers TTS tools with the function caller:
 * - Text to speech synthesis
 * - Voice listing
 *
 * @module extended-tools-tts
 * @version 1.0.0

---

## class TTSToolsHandler

```javascript
class TTSToolsHandler
```

* TTS Tools Handler

---

## setTTSManager(ttsManager)

```javascript
setTTSManager(ttsManager)
```

* Set TTSManager reference
   * @param {Object} ttsManager - TTSManager instance

---

## register(functionCaller)

```javascript
register(functionCaller)
```

* Register all TTS tools
   * @param {FunctionCaller} functionCaller - Function caller instance

---

## function getTTSTools()

```javascript
function getTTSTools()
```

* Get TTS Tools Handler singleton
 * @returns {TTSToolsHandler}

---

