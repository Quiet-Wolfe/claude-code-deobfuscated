/**
 * Anthropic API Client
 *
 * Handles communication with the Anthropic API for Claude models.
 * Supports streaming, message creation, and tool use.
 */

import { debug, error as logError } from "../utils/logger.js";
import { API_CONFIG, MODELS } from "../constants/index.js";

/**
 * Default API configuration
 */
const DEFAULT_CONFIG = {
  baseUrl: "https://api.anthropic.com",
  version: "2023-06-01",
  timeout: 600000, // 10 minutes
  maxRetries: 3,
  retryDelay: 1000
};

/**
 * API Error class for Anthropic-specific errors
 */
export class AnthropicError extends Error {
  constructor(message, statusCode, type, details = {}) {
    super(message);
    this.name = "AnthropicError";
    this.statusCode = statusCode;
    this.type = type;
    this.details = details;
  }

  static fromResponse(response, body) {
    const error = body?.error || {};
    return new AnthropicError(
      error.message || `HTTP ${response.status}`,
      response.status,
      error.type || "api_error",
      { response, body }
    );
  }
}

/**
 * Rate limit error
 */
export class RateLimitError extends AnthropicError {
  constructor(message, retryAfter) {
    super(message, 429, "rate_limit_error");
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

/**
 * Authentication error
 */
export class AuthenticationError extends AnthropicError {
  constructor(message) {
    super(message, 401, "authentication_error");
    this.name = "AuthenticationError";
  }
}

/**
 * Anthropic API Client
 */
export class AnthropicClient {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
    this.baseUrl = options.baseUrl || DEFAULT_CONFIG.baseUrl;
    this.version = options.version || DEFAULT_CONFIG.version;
    this.timeout = options.timeout || DEFAULT_CONFIG.timeout;
    this.maxRetries = options.maxRetries ?? DEFAULT_CONFIG.maxRetries;
    this.retryDelay = options.retryDelay || DEFAULT_CONFIG.retryDelay;
    this.defaultModel = options.model || MODELS.CLAUDE_SONNET;
    this.betas = options.betas || [];

    // Request interceptors
    this.requestInterceptors = [];
    this.responseInterceptors = [];
  }

  /**
   * Add a request interceptor
   * @param {Function} interceptor - Function to modify request options
   */
  addRequestInterceptor(interceptor) {
    this.requestInterceptors.push(interceptor);
  }

  /**
   * Add a response interceptor
   * @param {Function} interceptor - Function to process response
   */
  addResponseInterceptor(interceptor) {
    this.responseInterceptors.push(interceptor);
  }

  /**
   * Build request headers
   * @param {object} additionalHeaders - Additional headers to include
   * @returns {object} Headers object
   */
  buildHeaders(additionalHeaders = {}) {
    const headers = {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
      "anthropic-version": this.version,
      ...additionalHeaders
    };

    if (this.betas.length > 0) {
      headers["anthropic-beta"] = this.betas.join(",");
    }

    return headers;
  }

  /**
   * Make an API request with retry logic
   * @param {string} endpoint - API endpoint
   * @param {object} options - Request options
   * @returns {Promise<Response>}
   */
  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    let requestOptions = {
      method: options.method || "POST",
      headers: this.buildHeaders(options.headers),
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: options.signal
    };

    // Apply request interceptors
    for (const interceptor of this.requestInterceptors) {
      requestOptions = await interceptor(requestOptions);
    }

    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        debug(`API request to ${endpoint} (attempt ${attempt + 1})`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url, {
          ...requestOptions,
          signal: options.signal || controller.signal
        });

        clearTimeout(timeoutId);

        // Apply response interceptors
        let processedResponse = response;
        for (const interceptor of this.responseInterceptors) {
          processedResponse = await interceptor(processedResponse);
        }

        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get("retry-after") || "60", 10);
          throw new RateLimitError("Rate limit exceeded", retryAfter);
        }

        // Handle authentication errors
        if (response.status === 401) {
          throw new AuthenticationError("Invalid API key");
        }

        // Handle other errors
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw AnthropicError.fromResponse(response, body);
        }

        return processedResponse;
      } catch (err) {
        lastError = err;

        // Don't retry on auth errors or user abort
        if (err instanceof AuthenticationError || err.name === "AbortError") {
          throw err;
        }

        // Retry on rate limit with backoff
        if (err instanceof RateLimitError && attempt < this.maxRetries) {
          const delay = err.retryAfter * 1000 || this.retryDelay * Math.pow(2, attempt);
          debug(`Rate limited, waiting ${delay}ms before retry`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        // Retry on network errors
        if (attempt < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, attempt);
          debug(`Request failed, retrying in ${delay}ms: ${err.message}`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }
    }

    throw lastError;
  }

  /**
   * Create a message (non-streaming)
   * @param {object} params - Message parameters
   * @returns {Promise<object>} Message response
   */
  async createMessage(params) {
    const response = await this.request("/v1/messages", {
      method: "POST",
      body: {
        model: params.model || this.defaultModel,
        max_tokens: params.maxTokens || 4096,
        messages: params.messages,
        system: params.system,
        tools: params.tools,
        tool_choice: params.toolChoice,
        metadata: params.metadata,
        stop_sequences: params.stopSequences,
        temperature: params.temperature,
        top_p: params.topP,
        top_k: params.topK
      },
      signal: params.signal
    });

    return response.json();
  }

  /**
   * Create a streaming message
   * @param {object} params - Message parameters
   * @yields {object} Stream events
   */
  async *createMessageStream(params) {
    const response = await this.request("/v1/messages", {
      method: "POST",
      headers: {
        Accept: "text/event-stream"
      },
      body: {
        model: params.model || this.defaultModel,
        max_tokens: params.maxTokens || 4096,
        messages: params.messages,
        system: params.system,
        tools: params.tools,
        tool_choice: params.toolChoice,
        metadata: params.metadata,
        stop_sequences: params.stopSequences,
        temperature: params.temperature,
        top_p: params.topP,
        top_k: params.topK,
        stream: true
      },
      signal: params.signal
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") return;

            try {
              const event = JSON.parse(data);
              yield event;
            } catch (parseError) {
              debug(`Failed to parse SSE event: ${parseError.message}`);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Count tokens in a message
   * @param {object} params - Parameters with model and messages
   * @returns {Promise<object>} Token count
   */
  async countTokens(params) {
    const response = await this.request("/v1/messages/count_tokens", {
      method: "POST",
      body: {
        model: params.model || this.defaultModel,
        messages: params.messages,
        system: params.system,
        tools: params.tools
      }
    });

    return response.json();
  }
}

/**
 * Create a singleton client instance
 */
let defaultClient = null;

export function getClient(options = {}) {
  if (!defaultClient || Object.keys(options).length > 0) {
    defaultClient = new AnthropicClient(options);
  }
  return defaultClient;
}

export function resetClient() {
  defaultClient = null;
}

export default {
  AnthropicClient,
  AnthropicError,
  RateLimitError,
  AuthenticationError,
  getClient,
  resetClient
};
