/**
 * Anthropic Claude API client.
 * Supports chat and streaming via the Messages API.
 */

const { logger, createLogger } = require('../utils/logger.js');
const axios = require('axios');
const EventEmitter = require('events');

class AnthropicClient extends EventEmitter {
  constructor(config = {}) {
    super();

    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL || 'https://api.anthropic.com';
    this.model = config.model || 'claude-3-opus-20240229';
    this.timeout = config.timeout || 120000;
    this.maxTokens = config.maxTokens || 2000;
    this.anthropicVersion = config.anthropicVersion || '2023-06-01';

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey && { 'x-api-key': this.apiKey }),
        'anthropic-version': this.anthropicVersion,
      },
    });
  }

  normalizeMessages(messages = [], options = {}) {
    let systemPrompt = '';
    let sawSystemMessage = false;
    const normalized = [];

    for (const message of messages) {
      if (!message || !message.role) {continue;}

      const content =
        typeof message.content === 'string'
          ? message.content
          : JSON.stringify(message.content ?? '');

      if (message.role === 'system') {
        sawSystemMessage = true;
        systemPrompt = systemPrompt ? `${systemPrompt}\n${content}` : content;
      } else if (message.role === 'user' || message.role === 'assistant') {
        normalized.push({ role: message.role, content });
      }
    }

    if (!sawSystemMessage && options.systemPrompt) {
      systemPrompt = options.systemPrompt;
    }

    return {
      system: systemPrompt || undefined,
      messages: normalized,
    };
  }

  buildPayload(messages, options = {}, stream = false) {
    const { system, messages: normalized } = this.normalizeMessages(messages, options);
    const maxTokens = options.max_tokens || options.maxTokens || this.maxTokens;

    const payload = {
      model: options.model || this.model,
      max_tokens: maxTokens,
      messages: normalized,
      stream,
    };

    if (system) {payload.system = system;}
    if (options.temperature !== undefined) {payload.temperature = options.temperature;}
    if (options.top_p !== undefined) {payload.top_p = options.top_p;}
    if (options.top_k !== undefined) {payload.top_k = options.top_k;}
    if (Array.isArray(options.stop_sequences) && options.stop_sequences.length > 0) {
      payload.stop_sequences = options.stop_sequences;
    }

    return payload;
  }

  async checkStatus() {
    if (!this.apiKey) {
      return {
        available: false,
        error: 'Anthropic API key is not configured',
        models: [],
      };
    }

    try {
      const response = await this.client.get('/v1/models');
      const models = response.data?.data || [];

      return {
        available: true,
        models: models.map((m) => ({
          name: m.id || m.name || m.model,
        })),
      };
    } catch (error) {
      return {
        available: false,
        error: error.response?.data?.error?.message || error.message,
        models: [],
      };
    }
  }

  async chat(messages, options = {}) {
    try {
      const payload = this.buildPayload(messages, options, false);
      const response = await this.client.post('/v1/messages', payload);
      const blocks = response.data?.content || [];
      const text = blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');

      const usage = response.data?.usage || {};

      return {
        message: { role: 'assistant', content: text },
        text,
        model: response.data?.model || payload.model,
        usage,
        tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
      };
    } catch (error) {
      logger.error('[AnthropicClient] chat failed:', error.response?.data || error);
      throw new Error(error.response?.data?.error?.message || error.message);
    }
  }

  async chatStream(messages, onChunk, options = {}) {
    try {
      const payload = this.buildPayload(messages, options, true);
      const response = await this.client.post('/v1/messages', payload, {
        responseType: 'stream',
      });

      const fullMessage = { role: 'assistant', content: '' };
      let buffer = '';
      let settled = false;

      const maybeResolve = (finishReason = 'stop', resolve) => {
        if (settled) {return;}
        settled = true;
        resolve({
          message: fullMessage,
          text: fullMessage.content,
          model: payload.model,
          finish_reason: finishReason,
        });
      };

      const handleEvent = (event, data, resolve) => {
        if (!data) {return;}
        if (data === '[DONE]') {
          maybeResolve('stop', resolve);
          return;
        }

        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch (e) {
          return;
        }

        if (event === 'content_block_start') {
          const text = parsed.content_block?.text;
          if (text) {
            fullMessage.content += text;
            if (typeof onChunk === 'function') {
              onChunk(text, fullMessage.content);
            }
          }
        } else if (event === 'content_block_delta') {
          const text = parsed.delta?.text;
          if (text) {
            fullMessage.content += text;
            if (typeof onChunk === 'function') {
              onChunk(text, fullMessage.content);
            }
          }
        } else if (event === 'message_stop') {
          maybeResolve('stop', resolve);
        } else if (event === 'message_delta' && parsed.delta?.stop_reason) {
          maybeResolve(parsed.delta.stop_reason, resolve);
        }
      };

      return await new Promise((resolve, reject) => {
        const processBuffer = () => {
          buffer = buffer.replace(/\r\n/g, '\n');
          let boundary = buffer.indexOf('\n\n');
          while (boundary !== -1) {
            const rawEvent = buffer.slice(0, boundary).trim();
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf('\n\n');

            if (!rawEvent) {continue;}

            const lines = rawEvent.split('\n');
            let event = '';
            const dataLines = [];

            for (const line of lines) {
              if (line.startsWith('event:')) {
                event = line.slice('event:'.length).trim();
              } else if (line.startsWith('data:')) {
                dataLines.push(line.slice('data:'.length).trim());
              }
            }

            if (dataLines.length === 0) {continue;}
            const data = dataLines.join('\n');
            handleEvent(event, data, resolve);
          }
        };

        response.data.on('data', (chunk) => {
          buffer += chunk.toString();
          processBuffer();
        });

        response.data.on('error', (error) => {
          if (settled) {return;}
          settled = true;
          reject(error);
        });

        response.data.on('end', () => {
          maybeResolve('stop', resolve);
        });
      });
    } catch (error) {
      logger.error('[AnthropicClient] stream chat failed:', error.response?.data || error);
      throw new Error(error.response?.data?.error?.message || error.message);
    }
  }

  async embeddings() {
    throw new Error('Anthropic does not support embeddings.');
  }
}

module.exports = {
  AnthropicClient,
};
