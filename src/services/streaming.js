/**
 * Streaming Service
 *
 * Handles streaming responses from the Anthropic API.
 * Provides event-based handling of streamed content, tool use, and errors.
 */

import { debug } from "../utils/logger.js";
import { EventEmitter } from "events";

/**
 * Stream event types
 */
export const StreamEventType = {
  MESSAGE_START: "message_start",
  CONTENT_BLOCK_START: "content_block_start",
  CONTENT_BLOCK_DELTA: "content_block_delta",
  CONTENT_BLOCK_STOP: "content_block_stop",
  MESSAGE_DELTA: "message_delta",
  MESSAGE_STOP: "message_stop",
  PING: "ping",
  ERROR: "error"
};

/**
 * Content block types
 */
export const ContentBlockType = {
  TEXT: "text",
  TOOL_USE: "tool_use",
  THINKING: "thinking"
};

/**
 * Stream handler for processing SSE events
 */
export class StreamHandler extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.currentMessage = null;
    this.currentBlocks = [];
    this.currentBlockIndex = -1;
    this.isComplete = false;
    this.error = null;
  }

  /**
   * Process a stream event
   * @param {object} event - Stream event
   */
  processEvent(event) {
    const { type, ...data } = event;

    debug(`Stream event: ${type}`);

    switch (type) {
      case StreamEventType.MESSAGE_START:
        this.handleMessageStart(data);
        break;
      case StreamEventType.CONTENT_BLOCK_START:
        this.handleContentBlockStart(data);
        break;
      case StreamEventType.CONTENT_BLOCK_DELTA:
        this.handleContentBlockDelta(data);
        break;
      case StreamEventType.CONTENT_BLOCK_STOP:
        this.handleContentBlockStop(data);
        break;
      case StreamEventType.MESSAGE_DELTA:
        this.handleMessageDelta(data);
        break;
      case StreamEventType.MESSAGE_STOP:
        this.handleMessageStop(data);
        break;
      case StreamEventType.PING:
        // Ignore pings
        break;
      case StreamEventType.ERROR:
        this.handleError(data);
        break;
      default:
        debug(`Unknown stream event type: ${type}`);
    }
  }

  /**
   * Handle message_start event
   * @param {object} data - Event data
   */
  handleMessageStart(data) {
    this.currentMessage = data.message || {};
    this.currentBlocks = [];
    this.emit("message_start", this.currentMessage);
  }

  /**
   * Handle content_block_start event
   * @param {object} data - Event data
   */
  handleContentBlockStart(data) {
    const { index, content_block } = data;
    this.currentBlockIndex = index;

    const block = {
      index,
      type: content_block.type,
      ...content_block
    };

    // Initialize block content based on type
    if (block.type === ContentBlockType.TEXT) {
      block.text = block.text || "";
    } else if (block.type === ContentBlockType.TOOL_USE) {
      block.input = block.input || {};
      block.inputJson = "";
    } else if (block.type === ContentBlockType.THINKING) {
      block.thinking = block.thinking || "";
    }

    this.currentBlocks[index] = block;
    this.emit("content_block_start", block);
  }

  /**
   * Handle content_block_delta event
   * @param {object} data - Event data
   */
  handleContentBlockDelta(data) {
    const { index, delta } = data;
    const block = this.currentBlocks[index];

    if (!block) {
      debug(`No block found for index ${index}`);
      return;
    }

    if (delta.type === "text_delta") {
      block.text += delta.text || "";
      this.emit("text_delta", { index, text: delta.text, block });
    } else if (delta.type === "input_json_delta") {
      block.inputJson += delta.partial_json || "";
      this.emit("input_json_delta", { index, json: delta.partial_json, block });
    } else if (delta.type === "thinking_delta") {
      block.thinking += delta.thinking || "";
      this.emit("thinking_delta", { index, thinking: delta.thinking, block });
    }

    this.emit("content_block_delta", { index, delta, block });
  }

  /**
   * Handle content_block_stop event
   * @param {object} data - Event data
   */
  handleContentBlockStop(data) {
    const { index } = data;
    const block = this.currentBlocks[index];

    if (block && block.type === ContentBlockType.TOOL_USE && block.inputJson) {
      try {
        block.input = JSON.parse(block.inputJson);
      } catch (err) {
        debug(`Failed to parse tool input JSON: ${err.message}`);
        block.input = {};
      }
    }

    this.emit("content_block_stop", block);
  }

  /**
   * Handle message_delta event
   * @param {object} data - Event data
   */
  handleMessageDelta(data) {
    const { delta, usage } = data;

    if (this.currentMessage) {
      if (delta.stop_reason) {
        this.currentMessage.stop_reason = delta.stop_reason;
      }
      if (delta.stop_sequence) {
        this.currentMessage.stop_sequence = delta.stop_sequence;
      }
      if (usage) {
        this.currentMessage.usage = {
          ...this.currentMessage.usage,
          ...usage
        };
      }
    }

    this.emit("message_delta", { delta, usage });
  }

  /**
   * Handle message_stop event
   * @param {object} data - Event data
   */
  handleMessageStop(data) {
    this.isComplete = true;

    // Finalize message
    if (this.currentMessage) {
      this.currentMessage.content = this.currentBlocks;
    }

    this.emit("message_stop", this.currentMessage);
    this.emit("complete", this.currentMessage);
  }

  /**
   * Handle error event
   * @param {object} data - Event data
   */
  handleError(data) {
    this.error = data.error || data;
    this.emit("error", this.error);
  }

  /**
   * Get the complete message
   * @returns {object|null}
   */
  getMessage() {
    return this.currentMessage;
  }

  /**
   * Get all content blocks
   * @returns {object[]}
   */
  getBlocks() {
    return this.currentBlocks;
  }

  /**
   * Check if stream is complete
   * @returns {boolean}
   */
  isStreamComplete() {
    return this.isComplete;
  }
}

/**
 * Parse SSE stream
 * @param {ReadableStream} stream - Response stream
 * @returns {AsyncGenerator<object>}
 */
export async function* parseSSEStream(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse complete events from buffer
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      let eventType = null;
      let eventData = "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          eventData = line.slice(6);
        } else if (line === "" && eventType && eventData) {
          // Complete event
          try {
            const parsed = JSON.parse(eventData);
            yield { type: eventType, ...parsed };
          } catch (err) {
            debug(`Failed to parse SSE event data: ${err.message}`);
          }
          eventType = null;
          eventData = "";
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Create a stream processor for Anthropic API responses
 * @param {Response} response - Fetch response
 * @param {object} options - Options
 * @returns {StreamHandler}
 */
export async function processStream(response, options = {}) {
  const handler = new StreamHandler(options);

  // Process the stream
  const processAsync = async () => {
    try {
      if (!response.body) {
        throw new Error("No response body");
      }

      for await (const event of parseSSEStream(response.body)) {
        handler.processEvent(event);
      }
    } catch (err) {
      handler.handleError({ error: err });
    }
  };

  // Start processing
  processAsync();

  return handler;
}

/**
 * Collect all text from a stream
 * @param {StreamHandler} handler - Stream handler
 * @returns {Promise<string>}
 */
export function collectText(handler) {
  return new Promise((resolve, reject) => {
    let text = "";

    handler.on("text_delta", ({ text: delta }) => {
      text += delta;
    });

    handler.on("complete", () => {
      resolve(text);
    });

    handler.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Collect all tool uses from a stream
 * @param {StreamHandler} handler - Stream handler
 * @returns {Promise<object[]>}
 */
export function collectToolUses(handler) {
  return new Promise((resolve, reject) => {
    const toolUses = [];

    handler.on("content_block_stop", (block) => {
      if (block && block.type === ContentBlockType.TOOL_USE) {
        toolUses.push({
          id: block.id,
          name: block.name,
          input: block.input
        });
      }
    });

    handler.on("complete", () => {
      resolve(toolUses);
    });

    handler.on("error", (err) => {
      reject(err);
    });
  });
}

export default {
  StreamEventType,
  ContentBlockType,
  StreamHandler,
  parseSSEStream,
  processStream,
  collectText,
  collectToolUses
};
