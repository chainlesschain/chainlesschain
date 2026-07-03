# anthropic-client

**Source**: `src/main/llm/anthropic-client.js`

---

## const

```javascript
const
```

* Anthropic Claude API client.
 * Supports chat and streaming via the Messages API.

---

## function modelRejectsSamplingParams(model)

```javascript
function modelRejectsSamplingParams(model)
```

* Claude models that reject sampling params (temperature / top_p / top_k) with a
 * 400 per the Anthropic Messages API: Opus 4.7 and 4.8, plus Fable 5 / Mythos 5.
 * Sonnet 4.6, Opus 4.6, Haiku 4.5, and Claude 3.x still accept them. Exported
 * for tests.

---

