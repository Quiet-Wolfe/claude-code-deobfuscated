/**
 * Conversation Service
 *
 * Manages conversation state, message history, and session persistence.
 */

import { randomUUID } from "crypto";
import { join } from "path";
import { debug } from "../utils/logger.js";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  ensureDirSync,
  getClaudeConfigDir
} from "../utils/fs-utils.js";
import { MESSAGE_TYPES } from "../constants/index.js";

/**
 * Get the conversations directory
 * @returns {string}
 */
export function getConversationsDir() {
  return join(getClaudeConfigDir(), "conversations");
}

/**
 * Generate a new session ID
 * @returns {string}
 */
export function generateSessionId() {
  return randomUUID();
}

/**
 * Generate a new message ID
 * @returns {string}
 */
export function generateMessageId() {
  return randomUUID();
}

/**
 * Conversation message structure
 */
export class Message {
  constructor(options = {}) {
    this.id = options.id || generateMessageId();
    this.type = options.type || MESSAGE_TYPES.USER;
    this.content = options.content || "";
    this.timestamp = options.timestamp || Date.now();
    this.metadata = options.metadata || {};

    // For tool use messages
    this.toolUseId = options.toolUseId || null;
    this.toolName = options.toolName || null;
    this.toolInput = options.toolInput || null;
    this.toolResult = options.toolResult || null;
  }

  /**
   * Create a user message
   * @param {string} content - Message content
   * @returns {Message}
   */
  static user(content) {
    return new Message({
      type: MESSAGE_TYPES.USER,
      content
    });
  }

  /**
   * Create an assistant message
   * @param {string} content - Message content
   * @returns {Message}
   */
  static assistant(content) {
    return new Message({
      type: MESSAGE_TYPES.ASSISTANT,
      content
    });
  }

  /**
   * Create a system message
   * @param {string} content - Message content
   * @returns {Message}
   */
  static system(content) {
    return new Message({
      type: MESSAGE_TYPES.SYSTEM,
      content
    });
  }

  /**
   * Create a tool use message
   * @param {string} toolName - Tool name
   * @param {object} toolInput - Tool input
   * @param {string} toolUseId - Tool use ID
   * @returns {Message}
   */
  static toolUse(toolName, toolInput, toolUseId) {
    return new Message({
      type: MESSAGE_TYPES.TOOL_USE,
      toolName,
      toolInput,
      toolUseId: toolUseId || generateMessageId()
    });
  }

  /**
   * Create a tool result message
   * @param {string} toolUseId - Tool use ID
   * @param {*} result - Tool result
   * @returns {Message}
   */
  static toolResult(toolUseId, result) {
    return new Message({
      type: MESSAGE_TYPES.TOOL_RESULT,
      toolUseId,
      toolResult: result
    });
  }

  /**
   * Convert to API format
   * @returns {object}
   */
  toAPIFormat() {
    if (this.type === MESSAGE_TYPES.USER) {
      return {
        role: "user",
        content: this.content
      };
    }

    if (this.type === MESSAGE_TYPES.ASSISTANT) {
      return {
        role: "assistant",
        content: this.content
      };
    }

    if (this.type === MESSAGE_TYPES.TOOL_USE) {
      return {
        role: "assistant",
        content: [{
          type: "tool_use",
          id: this.toolUseId,
          name: this.toolName,
          input: this.toolInput
        }]
      };
    }

    if (this.type === MESSAGE_TYPES.TOOL_RESULT) {
      return {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: this.toolUseId,
          content: typeof this.toolResult === "string"
            ? this.toolResult
            : JSON.stringify(this.toolResult)
        }]
      };
    }

    return {
      role: "user",
      content: this.content
    };
  }

  /**
   * Serialize to JSON
   * @returns {object}
   */
  toJSON() {
    return {
      id: this.id,
      type: this.type,
      content: this.content,
      timestamp: this.timestamp,
      metadata: this.metadata,
      toolUseId: this.toolUseId,
      toolName: this.toolName,
      toolInput: this.toolInput,
      toolResult: this.toolResult
    };
  }

  /**
   * Create from JSON
   * @param {object} json - JSON object
   * @returns {Message}
   */
  static fromJSON(json) {
    return new Message(json);
  }
}

/**
 * Conversation class
 */
export class Conversation {
  constructor(options = {}) {
    this.sessionId = options.sessionId || generateSessionId();
    this.messages = options.messages || [];
    this.createdAt = options.createdAt || Date.now();
    this.updatedAt = options.updatedAt || Date.now();
    this.metadata = options.metadata || {};
    this.cwd = options.cwd || process.cwd();
  }

  /**
   * Add a message to the conversation
   * @param {Message} message - Message to add
   */
  addMessage(message) {
    if (!(message instanceof Message)) {
      message = new Message(message);
    }
    this.messages.push(message);
    this.updatedAt = Date.now();
  }

  /**
   * Get all messages
   * @returns {Message[]}
   */
  getMessages() {
    return this.messages;
  }

  /**
   * Get messages in API format
   * @returns {object[]}
   */
  getAPIMessages() {
    return this.messages.map((m) => m.toAPIFormat());
  }

  /**
   * Get the last N messages
   * @param {number} n - Number of messages
   * @returns {Message[]}
   */
  getLastMessages(n) {
    return this.messages.slice(-n);
  }

  /**
   * Clear all messages
   */
  clear() {
    this.messages = [];
    this.updatedAt = Date.now();
  }

  /**
   * Save conversation to disk
   * @param {string} dir - Directory to save to
   */
  save(dir = getConversationsDir()) {
    ensureDirSync(dir);
    const filePath = join(dir, `${this.sessionId}.json`);
    const data = JSON.stringify(this.toJSON(), null, 2);
    writeFileSync(filePath, data, { encoding: "utf8" });
    debug(`Saved conversation to ${filePath}`);
  }

  /**
   * Serialize to JSON
   * @returns {object}
   */
  toJSON() {
    return {
      sessionId: this.sessionId,
      messages: this.messages.map((m) => m.toJSON()),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      metadata: this.metadata,
      cwd: this.cwd
    };
  }

  /**
   * Load conversation from disk
   * @param {string} sessionId - Session ID
   * @param {string} dir - Directory to load from
   * @returns {Conversation|null}
   */
  static load(sessionId, dir = getConversationsDir()) {
    const filePath = join(dir, `${sessionId}.json`);

    if (!existsSync(filePath)) {
      debug(`Conversation not found: ${filePath}`);
      return null;
    }

    try {
      const data = readFileSync(filePath, { encoding: "utf8" });
      const json = JSON.parse(data);
      return Conversation.fromJSON(json);
    } catch (err) {
      debug(`Failed to load conversation: ${err.message}`);
      return null;
    }
  }

  /**
   * Create from JSON
   * @param {object} json - JSON object
   * @returns {Conversation}
   */
  static fromJSON(json) {
    return new Conversation({
      ...json,
      messages: json.messages.map((m) => Message.fromJSON(m))
    });
  }

  /**
   * Get the most recent conversation
   * @param {string} dir - Directory to search
   * @returns {Conversation|null}
   */
  static getMostRecent(dir = getConversationsDir()) {
    if (!existsSync(dir)) {
      return null;
    }

    try {
      const files = require("fs").readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => ({
          name: f,
          path: join(dir, f),
          mtime: require("fs").statSync(join(dir, f)).mtime.getTime()
        }))
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length === 0) {
        return null;
      }

      const sessionId = files[0].name.replace(".json", "");
      return Conversation.load(sessionId, dir);
    } catch (err) {
      debug(`Failed to get most recent conversation: ${err.message}`);
      return null;
    }
  }
}

// Current conversation singleton
let currentConversation = null;

/**
 * Get or create the current conversation
 * @param {object} options - Options for new conversation
 * @returns {Conversation}
 */
export function getCurrentConversation(options = {}) {
  if (!currentConversation) {
    currentConversation = new Conversation(options);
  }
  return currentConversation;
}

/**
 * Set the current conversation
 * @param {Conversation} conversation - Conversation to set
 */
export function setCurrentConversation(conversation) {
  currentConversation = conversation;
}

/**
 * Get the current session ID
 * @returns {string|null}
 */
export function getCurrentSessionId() {
  return currentConversation?.sessionId || null;
}

// Shorthand for session ID (matches original W0 function)
export const W0 = getCurrentSessionId;

export default {
  Message,
  Conversation,
  getConversationsDir,
  generateSessionId,
  generateMessageId,
  getCurrentConversation,
  setCurrentConversation,
  getCurrentSessionId,
  W0
};
