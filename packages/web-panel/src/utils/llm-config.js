/**
 * Save an LLM API key through the authenticated WS protocol. The key is sent
 * as structured request data and is never interpolated into a CLI command or
 * exposed through process argv.
 */
export async function saveLlmApiKey(ws, apiKey) {
  if (!ws || typeof ws.sendRaw !== 'function') {
    throw new Error('WebSocket configuration API is unavailable')
  }
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new Error('API Key cannot be empty')
  }

  const response = await ws.sendRaw(
    {
      type: 'config-set-secret',
      key: 'llm.apiKey',
      value: apiKey,
    },
    15000,
  )

  if (response?.success !== true) {
    throw new Error(response?.message || 'API Key save failed')
  }
  return response
}
