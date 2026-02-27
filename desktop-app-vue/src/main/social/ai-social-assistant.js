/**
 * AI Social Assistant
 *
 * Provides AI-powered social interaction assistance using the LLM manager.
 * Falls back to template-based suggestions when the LLM service is unavailable.
 *
 * Features:
 * - Suggest contextual replies for conversations
 * - Summarize conversation threads
 * - Draft posts with specified style and tone
 * - Analyze social relationships
 * - Recommend discussion topics
 * - Generate ice-breaker messages
 * - Generate hashtags for content
 *
 * @module social/ai-social-assistant
 * @version 0.45.0
 */

import { logger } from "../utils/logger.js";
import EventEmitter from "events";

// ============================================================
// Constants
// ============================================================

const REPLY_STYLES = {
  FRIENDLY: "friendly",
  PROFESSIONAL: "professional",
  CASUAL: "casual",
  HUMOROUS: "humorous",
  EMPATHETIC: "empathetic",
  FORMAL: "formal",
  CONCISE: "concise",
};

const POST_STYLES = {
  INFORMATIVE: "informative",
  CONVERSATIONAL: "conversational",
  PERSUASIVE: "persuasive",
  STORYTELLING: "storytelling",
};

const POST_LENGTHS = {
  SHORT: "short",
  MEDIUM: "medium",
  LONG: "long",
};

// Template-based fallback suggestions
const FALLBACK_REPLIES = {
  [REPLY_STYLES.FRIENDLY]: [
    "That's a great point! I'd love to hear more about your thoughts on this.",
    "Thanks for sharing! This is really interesting.",
    "I totally agree! Have you considered looking at it from this angle?",
  ],
  [REPLY_STYLES.PROFESSIONAL]: [
    "Thank you for your input. I appreciate your perspective on this matter.",
    "That's an insightful observation. Let me share my thoughts on this.",
    "I value your contribution to this discussion. Here's my perspective.",
  ],
  [REPLY_STYLES.CASUAL]: [
    "Haha, nice one! What do you think about...",
    "Oh cool, that's pretty interesting!",
    "Yeah, I see what you mean. Have you tried...",
  ],
  [REPLY_STYLES.HUMOROUS]: [
    "Well, that escalated quickly! But seriously though...",
    "You make a compelling argument, and I can't argue with that logic!",
    "I couldn't have said it better myself - and trust me, I tried!",
  ],
  [REPLY_STYLES.EMPATHETIC]: [
    "I understand how you feel. That must have been quite an experience.",
    "Thank you for being so open about this. Your feelings are completely valid.",
    "I hear you, and I want you to know that I'm here to support you.",
  ],
  [REPLY_STYLES.FORMAL]: [
    "I acknowledge your contribution and would like to offer the following perspective.",
    "Regarding the matter at hand, I believe this warrants further consideration.",
    "Thank you for bringing this to our attention. Allow me to elaborate.",
  ],
  [REPLY_STYLES.CONCISE]: [
    "Agreed. Good point.",
    "Interesting take. Worth exploring.",
    "Makes sense. Let's proceed.",
  ],
};

const FALLBACK_ICE_BREAKERS = [
  "I noticed we share some common interests! What got you started with %INTEREST%?",
  "Hi there! I've been curious about %INTEREST% lately. What's your take on it?",
  "Hey! Your profile caught my eye. I'd love to learn more about your experience with %INTEREST%.",
  "Hello! I see you're into %INTEREST% too. Have you come across anything interesting recently?",
];

const FALLBACK_HASHTAGS = [
  "#community",
  "#decentralized",
  "#web3",
  "#social",
  "#tech",
];

// ============================================================
// AISocialAssistant
// ============================================================

class AISocialAssistant extends EventEmitter {
  constructor(llmManager) {
    super();

    this.llmManager = llmManager;
    this.initialized = false;
    this._contextWindow = []; // Rolling context window for conversation history
    this._maxContextSize = 20;
  }

  /**
   * Initialize the AI social assistant
   */
  async initialize() {
    logger.info("[AISocialAssistant] Initializing AI social assistant...");

    try {
      this.initialized = true;
      logger.info("[AISocialAssistant] AI social assistant initialized successfully");
    } catch (_error) {
      logger.error("[AISocialAssistant] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Check if the LLM service is available.
   * @private
   * @returns {boolean}
   */
  _isLLMAvailable() {
    return !!(this.llmManager && this.llmManager.isInitialized);
  }

  /**
   * Send a chat request to the LLM.
   * @private
   * @param {string} systemPrompt - The system prompt
   * @param {string} userMessage - The user message
   * @returns {string|null} The LLM response or null on failure
   */
  async _llmChat(systemPrompt, userMessage) {
    try {
      if (!this._isLLMAvailable()) {
        return null;
      }

      const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ];

      const result = await this.llmManager.chat(messages, {
        temperature: 0.7,
        maxTokens: 1024,
      });

      if (result && result.content) {
        return typeof result.content === "string"
          ? result.content
          : result.content.toString();
      }

      return null;
    } catch (_error) {
      logger.warn("[AISocialAssistant] LLM chat failed, using fallback:", error.message);
      return null;
    }
  }

  /**
   * Suggest a reply based on conversation context and desired style.
   *
   * @param {Array<Object>} conversationContext - Array of { role, content } messages
   * @param {string} [style] - The reply style (friendly, professional, casual, humorous, empathetic)
   * @returns {Object} Suggested reply
   */
  async suggestReply(conversationContext, style = REPLY_STYLES.FRIENDLY) {
    try {
      if (!conversationContext || !Array.isArray(conversationContext) || conversationContext.length === 0) {
        throw new Error("Conversation context is required");
      }

      const systemPrompt = `You are a social conversation assistant. Generate a natural, ${style} reply suggestion based on the conversation context. Reply with ONLY the suggested message text, no explanations.`;

      const contextStr = conversationContext
        .map((msg) => `${msg.role || "user"}: ${msg.content}`)
        .join("\n");

      const llmResult = await this._llmChat(
        systemPrompt,
        `Here is the conversation:\n${contextStr}\n\nSuggest a ${style} reply:`,
      );

      if (llmResult) {
        return {
          suggestion: llmResult.trim(),
          style,
          source: "llm",
        };
      }

      // Fallback to templates
      const templates = FALLBACK_REPLIES[style] || FALLBACK_REPLIES[REPLY_STYLES.FRIENDLY];
      const randomIndex = Math.floor(Math.random() * templates.length);

      return {
        suggestion: templates[randomIndex],
        style,
        source: "template",
      };
    } catch (_error) {
      logger.error("[AISocialAssistant] Failed to suggest reply:", error);
      throw error;
    }
  }

  /**
   * Summarize a conversation thread.
   *
   * @param {Array<Object>} messages - Array of { role, content, timestamp? } messages
   * @returns {Object} Conversation summary
   */
  async summarizeConversation(messages) {
    try {
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        throw new Error("Messages are required");
      }

      const systemPrompt =
        "You are a conversation summarizer. Provide a concise summary of the following conversation, highlighting key topics, decisions, and action items. Keep the summary under 200 words.";

      const messagesStr = messages
        .map((msg) => `${msg.role || "user"}: ${msg.content}`)
        .join("\n");

      const llmResult = await this._llmChat(systemPrompt, messagesStr);

      if (llmResult) {
        return {
          summary: llmResult.trim(),
          messageCount: messages.length,
          source: "llm",
        };
      }

      // Fallback: simple extractive summary
      const uniqueParticipants = new Set(messages.map((m) => m.role || "user"));
      const wordCount = messages.reduce(
        (sum, m) => sum + (m.content || "").split(/\s+/).length,
        0,
      );

      return {
        summary: `Conversation with ${uniqueParticipants.size} participant(s), ${messages.length} messages, approximately ${wordCount} words. Topics discussed include the subjects from the latest messages.`,
        messageCount: messages.length,
        source: "template",
      };
    } catch (_error) {
      logger.error("[AISocialAssistant] Failed to summarize conversation:", error);
      throw error;
    }
  }

  /**
   * Draft a social media post on a given topic.
   *
   * @param {string} topic - The topic to write about
   * @param {string} [style] - The writing style
   * @param {string} [length] - The desired length (short, medium, long)
   * @returns {Object} The drafted post
   */
  async draftPost(topic, style = POST_STYLES.CONVERSATIONAL, length = POST_LENGTHS.MEDIUM) {
    try {
      if (!topic || topic.trim().length === 0) {
        throw new Error("Topic is required");
      }

      const lengthGuidance = {
        [POST_LENGTHS.SHORT]: "Keep the post under 100 words.",
        [POST_LENGTHS.MEDIUM]: "Write a post of about 100-200 words.",
        [POST_LENGTHS.LONG]: "Write a detailed post of about 200-400 words.",
      };

      const systemPrompt = `You are a social media content creator. Write a ${style} post about the given topic. ${lengthGuidance[length] || lengthGuidance[POST_LENGTHS.MEDIUM]} Reply with ONLY the post content.`;

      const llmResult = await this._llmChat(
        systemPrompt,
        `Write a post about: ${topic.trim()}`,
      );

      if (llmResult) {
        return {
          content: llmResult.trim(),
          topic: topic.trim(),
          style,
          length,
          source: "llm",
        };
      }

      // Fallback template
      return {
        content: `Thoughts on ${topic.trim()}:\n\nThis is an interesting topic that deserves more discussion in our community. What are your thoughts? I'd love to hear different perspectives on this.\n\n#discussion #community`,
        topic: topic.trim(),
        style,
        length,
        source: "template",
      };
    } catch (_error) {
      logger.error("[AISocialAssistant] Failed to draft post:", error);
      throw error;
    }
  }

  /**
   * Analyze a social relationship based on interaction history.
   *
   * @param {string} friendDid - The friend's DID
   * @param {Object} [context] - Optional interaction context
   * @param {number} [context.messageCount] - Number of messages exchanged
   * @param {number} [context.daysSinceFirstContact] - Days since first contact
   * @param {Array<string>} [context.commonTopics] - Common topics
   * @returns {Object} Relationship analysis
   */
  async analyzeRelationship(friendDid, context = {}) {
    try {
      if (!friendDid) {
        throw new Error("Friend DID is required");
      }

      const systemPrompt =
        "You are a social relationship analyst. Based on the interaction data provided, analyze the relationship and provide insights about communication patterns, relationship strength, and suggestions for improvement. Keep the analysis concise and actionable.";

      const contextStr = [
        `Friend: ${friendDid}`,
        context.messageCount != null
          ? `Messages exchanged: ${context.messageCount}`
          : null,
        context.daysSinceFirstContact != null
          ? `Days since first contact: ${context.daysSinceFirstContact}`
          : null,
        context.commonTopics && context.commonTopics.length > 0
          ? `Common topics: ${context.commonTopics.join(", ")}`
          : null,
      ]
        .filter(Boolean)
        .join("\n");

      const llmResult = await this._llmChat(
        systemPrompt,
        `Analyze this relationship:\n${contextStr}`,
      );

      if (llmResult) {
        return {
          friendDid,
          analysis: llmResult.trim(),
          source: "llm",
        };
      }

      // Fallback analysis
      const messageCount = context.messageCount || 0;
      let strength = "new";
      if (messageCount > 100) {strength = "strong";}
      else if (messageCount > 30) {strength = "growing";}
      else if (messageCount > 5) {strength = "developing";}

      return {
        friendDid,
        analysis: `Relationship strength: ${strength}. ${messageCount > 0 ? `You've exchanged ${messageCount} messages.` : "No messages exchanged yet."} ${context.commonTopics && context.commonTopics.length > 0 ? `Common interests: ${context.commonTopics.join(", ")}.` : "Try finding common topics to strengthen this connection."}`,
        source: "template",
      };
    } catch (_error) {
      logger.error("[AISocialAssistant] Failed to analyze relationship:", error);
      throw error;
    }
  }

  /**
   * Recommend discussion topics based on user interests.
   *
   * @param {Array<string>} userInterests - List of user interests
   * @returns {Object} Recommended topics
   */
  async recommendTopics(userInterests) {
    try {
      if (!userInterests || !Array.isArray(userInterests) || userInterests.length === 0) {
        throw new Error("User interests are required");
      }

      const systemPrompt =
        "You are a content recommendation engine. Based on the user's interests, suggest 5 engaging discussion topics that would be interesting for a decentralized social platform. Return ONLY the topics as a numbered list.";

      const llmResult = await this._llmChat(
        systemPrompt,
        `User interests: ${userInterests.join(", ")}`,
      );

      if (llmResult) {
        // Parse numbered list from LLM output
        const topics = llmResult
          .split("\n")
          .map((line) => line.replace(/^\d+[\.\)]\s*/, "").trim())
          .filter((line) => line.length > 0);

        return {
          topics,
          basedOn: userInterests,
          source: "llm",
        };
      }

      // Fallback topics based on interests
      const fallbackTopics = userInterests.map(
        (interest) => `What's the latest development in ${interest}?`,
      );

      // Add some generic topics
      fallbackTopics.push(
        "How can decentralized technology improve our daily lives?",
        "What challenges do you see in building privacy-preserving applications?",
      );

      return {
        topics: fallbackTopics.slice(0, 5),
        basedOn: userInterests,
        source: "template",
      };
    } catch (_error) {
      logger.error("[AISocialAssistant] Failed to recommend topics:", error);
      throw error;
    }
  }

  /**
   * Generate an ice-breaker message for starting a conversation.
   *
   * @param {Object} friendProfile - The friend's profile information
   * @param {string} [friendProfile.name] - The friend's name or alias
   * @param {Array<string>} [friendProfile.interests] - The friend's interests
   * @param {string} [friendProfile.bio] - The friend's bio
   * @returns {Object} Ice-breaker suggestion
   */
  async breakIce(friendProfile) {
    try {
      if (!friendProfile) {
        throw new Error("Friend profile is required");
      }

      const systemPrompt =
        "You are a social conversation starter. Generate a natural, friendly ice-breaker message to start a conversation with someone. The message should feel genuine, not generic. Reply with ONLY the message text.";

      const profileStr = [
        friendProfile.name ? `Name: ${friendProfile.name}` : null,
        friendProfile.interests && friendProfile.interests.length > 0
          ? `Interests: ${friendProfile.interests.join(", ")}`
          : null,
        friendProfile.bio ? `Bio: ${friendProfile.bio}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      const llmResult = await this._llmChat(
        systemPrompt,
        `Generate an ice-breaker for:\n${profileStr || "A new contact"}`,
      );

      if (llmResult) {
        return {
          message: llmResult.trim(),
          source: "llm",
        };
      }

      // Fallback ice-breaker
      const interest =
        friendProfile.interests && friendProfile.interests.length > 0
          ? friendProfile.interests[0]
          : "this community";

      const randomIndex = Math.floor(Math.random() * FALLBACK_ICE_BREAKERS.length);
      const template = FALLBACK_ICE_BREAKERS[randomIndex];

      return {
        message: template.replace("%INTEREST%", interest),
        source: "template",
      };
    } catch (_error) {
      logger.error("[AISocialAssistant] Failed to generate ice-breaker:", error);
      throw error;
    }
  }

  /**
   * Generate hashtags for a piece of content.
   *
   * @param {string} content - The content to generate hashtags for
   * @returns {Object} Generated hashtags
   */
  async generateHashtags(content) {
    try {
      if (!content || content.trim().length === 0) {
        throw new Error("Content is required");
      }

      const systemPrompt =
        "You are a hashtag generator. Generate 5-8 relevant hashtags for the given content. Return ONLY the hashtags, each prefixed with #, separated by spaces.";

      const llmResult = await this._llmChat(
        systemPrompt,
        content.trim(),
      );

      if (llmResult) {
        const hashtags = llmResult
          .split(/\s+/)
          .map((tag) => tag.trim())
          .filter((tag) => tag.startsWith("#") && tag.length > 1);

        if (hashtags.length > 0) {
          return {
            hashtags,
            source: "llm",
          };
        }
      }

      // Fallback: extract keywords and turn them into hashtags
      const words = content
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 3);

      // Get unique words by frequency
      const wordFreq = {};
      for (const word of words) {
        wordFreq[word] = (wordFreq[word] || 0) + 1;
      }

      const topWords = Object.entries(wordFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([word]) => `#${word}`);

      const hashtags = topWords.length > 0 ? topWords : FALLBACK_HASHTAGS;

      return {
        hashtags,
        source: "template",
      };
    } catch (_error) {
      logger.error("[AISocialAssistant] Failed to generate hashtags:", error);
      throw error;
    }
  }

  /**
   * Add messages to the rolling context window.
   * @param {Array<Object>} messages - Messages to add
   */
  addToContext(messages) {
    if (!Array.isArray(messages)) {return;}
    this._contextWindow.push(...messages);
    if (this._contextWindow.length > this._maxContextSize) {
      this._contextWindow = this._contextWindow.slice(-this._maxContextSize);
    }
  }

  /**
   * Get the current context window.
   * @returns {Array<Object>} Context messages
   */
  getContextWindow() {
    return [...this._contextWindow];
  }

  /**
   * Clear the context window.
   */
  clearContext() {
    this._contextWindow = [];
  }

  /**
   * Suggest multiple reply variants in different styles.
   * @param {Array<Object>} conversationContext - Conversation messages
   * @param {Array<string>} [styles] - Styles to generate
   * @returns {Object} Multi-style reply suggestions
   */
  async suggestMultiStyleReplies(conversationContext, styles) {
    try {
      const targetStyles = styles || [REPLY_STYLES.FORMAL, REPLY_STYLES.FRIENDLY, REPLY_STYLES.CONCISE];

      this.addToContext(conversationContext);

      const fullContext = this._contextWindow;
      const results = {};

      for (const style of targetStyles) {
        results[style] = await this.suggestReply(fullContext, style);
      }

      return {
        replies: results,
        styles: targetStyles,
        contextSize: fullContext.length,
      };
    } catch (_error) {
      logger.error("[AISocialAssistant] Failed to suggest multi-style replies:", error);
      throw error;
    }
  }

  /**
   * Generate a context-aware enhanced reply using conversation history.
   * @param {Array<Object>} conversationContext - Current conversation messages
   * @param {string} [style] - Reply style
   * @param {Object} [options] - Enhancement options
   * @returns {Object} Enhanced reply with metadata
   */
  async enhancedReply(conversationContext, style = REPLY_STYLES.FRIENDLY, options = {}) {
    try {
      if (!conversationContext || conversationContext.length === 0) {
        throw new Error("Conversation context is required");
      }

      this.addToContext(conversationContext);

      const systemPrompt = `You are an advanced social conversation assistant with deep contextual awareness. Generate a ${style} reply that:
1. References earlier points in the conversation when relevant
2. Matches the emotional tone of the conversation
3. Adds value through insight or helpful information
4. Feels natural and authentic

Reply with a JSON object:
{"reply": "the suggested reply", "confidence": 0.0-1.0, "reasoning": "brief explanation"}
Reply with ONLY valid JSON.`;

      const contextStr = this._contextWindow
        .map((msg) => `${msg.role || "user"}: ${msg.content}`)
        .join("\n");

      const llmResult = await this._llmChat(
        systemPrompt,
        `Full conversation context:\n${contextStr}\n\nGenerate a ${style} reply:`,
      );

      if (llmResult) {
        try {
          const parsed = JSON.parse(llmResult.replace(/```json?\n?/g, "").replace(/```/g, "").trim());
          return {
            suggestion: parsed.reply || llmResult.trim(),
            style,
            confidence: parsed.confidence || 0.7,
            reasoning: parsed.reasoning || "",
            contextSize: this._contextWindow.length,
            source: "llm",
          };
        } catch (_) {
          return {
            suggestion: llmResult.trim(),
            style,
            confidence: 0.5,
            reasoning: "",
            contextSize: this._contextWindow.length,
            source: "llm",
          };
        }
      }

      // Fallback
      const result = await this.suggestReply(conversationContext, style);
      result.contextSize = this._contextWindow.length;
      return result;
    } catch (_error) {
      logger.error("[AISocialAssistant] Enhanced reply failed:", error);
      throw error;
    }
  }

  /**
   * Close the AI social assistant
   */
  async close() {
    logger.info("[AISocialAssistant] Closing AI social assistant");

    this.removeAllListeners();
    this.initialized = false;
  }
}

module.exports = {
  AISocialAssistant,
  REPLY_STYLES,
  POST_STYLES,
  POST_LENGTHS,
};
