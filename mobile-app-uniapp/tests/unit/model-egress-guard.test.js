import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import LLMManager from '../../src/services/llm/llm-manager.js'
import LLMService from '../../src/services/llm.js'
import aiBackendService from '../../src/services/ai-backend.js'
import MultimodalManager from '../../src/services/llm/multimodal-manager.js'
import StreamManager from '../../src/services/llm/stream-manager.js'
import EmbeddingsService from '../../src/services/rag/embeddings-service.js'
import Reranker from '../../src/services/rag/reranker.js'
import OCRService from '../../src/services/image/ocr-service.js'
import voiceManagerModule from '../../src/services/voice/voice-manager.js'
import { MODEL_EGRESS_INGRESS_FAILED } from '../../src/services/llm/model-egress-guard.js'

describe('UniApp model egress default deny', () => {
  let request
  let fetch

  beforeEach(() => {
    request = vi.fn()
    fetch = vi.fn()
    vi.stubGlobal('uni', { request, getStorageSync: vi.fn() })
    vi.stubGlobal('fetch', fetch)
  })

  async function expectDenied(operation) {
    await expect(Promise.resolve().then(operation)).rejects.toMatchObject({
      code: MODEL_EGRESS_INGRESS_FAILED,
    })
    expect(request).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  }

  it('rejects the shared LLM manager before mode selection or transport', async () => {
    await expectDenied(() => new LLMManager().chat([{ role: 'user', content: 'secret' }]))
  })

  it('rejects LLM bootstrap before WebLLM loading or backend discovery', async () => {
    const CreateMLCEngine = vi.fn()
    vi.stubGlobal('window', { webllm: { CreateMLCEngine } })
    const llmManager = new LLMManager()

    await expectDenied(() => llmManager.initialize())
    await expectDenied(() => llmManager.detectBestMode())
    await expectDenied(() => llmManager.initializeWebLLM())
    expect(CreateMLCEngine).not.toHaveBeenCalled()
  })

  it('rejects the legacy provider service before direct OpenAI or Ollama transport', async () => {
    await expectDenied(() => new LLMService().query('secret'))
  })

  it('rejects legacy LLM health probes and model enumeration before transport', async () => {
    const legacyService = new LLMService()

    await expectDenied(() => legacyService.checkStatus())
    await expectDenied(() => legacyService.getModels())
  })

  it('rejects the backend chat facade before it sends message content', async () => {
    await expectDenied(() => aiBackendService.chat([{ role: 'user', content: 'secret' }]))
  })

  it('rejects backend health probing before it opens a transport', async () => {
    await expectDenied(() => aiBackendService.checkStatus())
  })

  it('rejects multimodal content before image preprocessing or provider transport', async () => {
    await expectDenied(() => new MultimodalManager().chat([
      { role: 'user', content: 'secret', images: ['data:image/png;base64,canary'] },
    ]))
  })

  it('rejects direct streaming helpers before starting an external stream', async () => {
    await expectDenied(() => new StreamManager().streamWithOpenAI([
      { role: 'user', content: 'secret' },
    ]))
  })

  it('rejects RAG embedding transport and local transformer inference before input use', async () => {
    const embeddings = new EmbeddingsService({ mode: 'api' })
    await expectDenied(() => embeddings.generateWithAPI('secret'))
    await expectDenied(() => embeddings.testAPIConnection())

    embeddings.transformer = vi.fn()
    await expectDenied(() => embeddings.generateWithTransformers('secret'))

    embeddings.currentMode = 'api'
    embeddings.cache.set(embeddings.getCacheKey('secret'), { value: [1], timestamp: Date.now() })
    await expectDenied(() => embeddings.generateEmbedding('secret'))
  })

  it('rejects embedding bootstrap before mode discovery, model download, or API probing', async () => {
    const pipeline = vi.fn()
    vi.stubGlobal('window', { transformers: { pipeline } })
    const embeddings = new EmbeddingsService({ mode: 'auto' })

    await expectDenied(() => embeddings.initialize())
    await expectDenied(() => embeddings.detectBestMode())
    await expectDenied(() => embeddings.initializeTransformers())
    expect(pipeline).not.toHaveBeenCalled()
  })

  it('rejects RAG LLM reranking before a provider call without authenticated ingress', async () => {
    const reranker = new Reranker({ llmEndpoint: 'https://example.invalid/rerank' })

    await expectDenied(() => reranker.rerankByLLM('private query', [{
      metadata: { title: 'private', content: 'document' },
    }]))
  })

  it('keeps Knowledge RAG bootstrap and backend health probing behind the terminal guard', () => {
    const source = readFileSync(
      new URL('../../src/services/knowledge-rag.js', import.meta.url),
      'utf8',
    )

    expect(source).toMatch(/async _initialize\(\) \{\s+rejectLegacyModelEgress\(\)/)
    expect(source).toMatch(
      /async _checkBackendAvailability\(\) \{\s+rejectLegacyModelEgress\(\)/,
    )
  })

  it('rejects every OCR provider helper before image content reaches a recognition provider', async () => {
    const ocr = new OCRService({ mode: 'api' })

    await expectDenied(() => ocr.recognizeWithTesseract('/tmp/private.png', {}))
    await expectDenied(() => ocr.recognizeWithAPI('/tmp/private.png', {}))
    await expectDenied(() => ocr.recognizeWithBaidu('/tmp/private.png', {}))
    await expectDenied(() => ocr.recognizeWithTencent('/tmp/private.png', {}))
  })

  it('rejects OCR bootstrap and discovery before worker creation, health probes, or token requests', async () => {
    const createWorker = vi.fn()
    vi.stubGlobal('window', { Tesseract: { createWorker } })
    const ocr = new OCRService({ mode: 'auto' })

    await expectDenied(() => ocr.initialize())
    await expectDenied(() => ocr.detectBestMode())
    await expectDenied(() => ocr.initializeTesseract())
    await expectDenied(() => ocr.getBaiduAccessToken())
    await expectDenied(() => ocr.recognizeBatch(['/tmp/private.png']))

    expect(createWorker).not.toHaveBeenCalled()
  })

  it('rejects cloud ASR and TTS provider helpers before audio or text reaches a provider', async () => {
    const { SpeechRecognitionManager, TextToSpeechManager } = voiceManagerModule
    const asr = new SpeechRecognitionManager()
    const tts = new TextToSpeechManager()

    await expectDenied(() => asr.recognizeWithIflytek('private-audio', {}))
    await expectDenied(() => asr.recognizeWithBaidu('private-audio', {}))
    await expectDenied(() => asr.recognizeWithAliyun('private-audio', {}))
    await expectDenied(() => asr.recognizeWithTencent('private-audio', {}))
    await expectDenied(() => tts.synthesizeWithIflytek('private text', {}))
    await expectDenied(() => tts.synthesizeWithBaidu('private text', {}))
    await expectDenied(() => tts.synthesizeWithAliyun('private text', {}))
    await expectDenied(() => tts.synthesizeWithTencent('private text', {}))
  })

})
