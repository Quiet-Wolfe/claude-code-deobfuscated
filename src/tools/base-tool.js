/**
 * Base Tool Class
 *
 * Provides the foundation for all Claude Code tools.
 * Tools are the primary way Claude interacts with the local system.
 */

import { debug } from "../utils/logger.js";
import { TOOL_NAMES } from "../constants/index.js";

/**
 * Tool result status
 */
export const ToolResultStatus = {
  SUCCESS: "success",
  ERROR: "error",
  PERMISSION_DENIED: "permission_denied",
  TIMEOUT: "timeout",
  ABORTED: "aborted"
};

/**
 * Base class for all tools
 */
export class BaseTool {
  /**
   * Create a new tool
   * @param {object} options - Tool options
   */
  constructor(options = {}) {
    this.name = options.name || "UnnamedTool";
    this.description = options.description || "";
    this.inputSchema = options.inputSchema || { type: "object", properties: {} };
    this.requiresPermission = options.requiresPermission ?? true;
    this.timeout = options.timeout || 120000; // 2 minutes default
  }

  /**
   * Get the tool name
   * @returns {string}
   */
  getName() {
    return this.name;
  }

  /**
   * Get the tool description
   * @returns {string}
   */
  getDescription() {
    return this.description;
  }

  /**
   * Get the JSON schema for tool input
   * @returns {object}
   */
  getInputSchema() {
    return this.inputSchema;
  }

  /**
   * Check if this tool requires permission to execute
   * @returns {boolean}
   */
  needsPermission() {
    return this.requiresPermission;
  }

  /**
   * Validate tool input against schema
   * @param {object} input - Tool input
   * @returns {object} Validation result { valid: boolean, errors: string[] }
   */
  validateInput(input) {
    const errors = [];
    const schema = this.inputSchema;

    if (schema.required) {
      for (const required of schema.required) {
        if (input[required] === undefined) {
          errors.push(`Missing required parameter: ${required}`);
        }
      }
    }

    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        const value = input[key];
        if (value !== undefined) {
          // Type checking
          if (propSchema.type === "string" && typeof value !== "string") {
            errors.push(`Parameter ${key} must be a string`);
          } else if (propSchema.type === "number" && typeof value !== "number") {
            errors.push(`Parameter ${key} must be a number`);
          } else if (propSchema.type === "boolean" && typeof value !== "boolean") {
            errors.push(`Parameter ${key} must be a boolean`);
          } else if (propSchema.type === "array" && !Array.isArray(value)) {
            errors.push(`Parameter ${key} must be an array`);
          } else if (propSchema.type === "object" && typeof value !== "object") {
            errors.push(`Parameter ${key} must be an object`);
          }

          // Enum checking
          if (propSchema.enum && !propSchema.enum.includes(value)) {
            errors.push(`Parameter ${key} must be one of: ${propSchema.enum.join(", ")}`);
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Execute the tool
   * @param {object} input - Tool input
   * @param {object} context - Execution context
   * @returns {Promise<object>} Tool result
   */
  async execute(input, context = {}) {
    throw new Error(`Tool ${this.name} must implement execute()`);
  }

  /**
   * Create a success result
   * @param {*} data - Result data
   * @param {object} metadata - Additional metadata
   * @returns {object} Tool result
   */
  success(data, metadata = {}) {
    return {
      status: ToolResultStatus.SUCCESS,
      data,
      metadata
    };
  }

  /**
   * Create an error result
   * @param {string} message - Error message
   * @param {object} metadata - Additional metadata
   * @returns {object} Tool result
   */
  error(message, metadata = {}) {
    return {
      status: ToolResultStatus.ERROR,
      error: message,
      metadata
    };
  }

  /**
   * Create a permission denied result
   * @param {string} message - Reason for denial
   * @returns {object} Tool result
   */
  permissionDenied(message = "Permission denied") {
    return {
      status: ToolResultStatus.PERMISSION_DENIED,
      error: message
    };
  }

  /**
   * Create a timeout result
   * @returns {object} Tool result
   */
  timedOut() {
    return {
      status: ToolResultStatus.TIMEOUT,
      error: `Tool ${this.name} timed out after ${this.timeout}ms`
    };
  }

  /**
   * Format result for API response
   * @param {object} result - Tool result
   * @returns {object} Formatted result for API
   */
  formatForAPI(result) {
    if (result.status === ToolResultStatus.SUCCESS) {
      return {
        type: "tool_result",
        content: typeof result.data === "string"
          ? result.data
          : JSON.stringify(result.data, null, 2)
      };
    }

    return {
      type: "tool_result",
      is_error: true,
      content: result.error || "Unknown error"
    };
  }

  /**
   * Convert tool to JSON schema format for API
   * @returns {object} Tool definition for API
   */
  toJSON() {
    return {
      name: this.name,
      description: this.description,
      input_schema: this.inputSchema
    };
  }
}

/**
 * Tool registry for managing available tools
 */
export class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  /**
   * Register a tool
   * @param {BaseTool} tool - Tool to register
   */
  register(tool) {
    if (!(tool instanceof BaseTool)) {
      throw new Error("Tool must be an instance of BaseTool");
    }
    this.tools.set(tool.getName(), tool);
    debug(`Registered tool: ${tool.getName()}`);
  }

  /**
   * Get a tool by name
   * @param {string} name - Tool name
   * @returns {BaseTool|undefined}
   */
  get(name) {
    return this.tools.get(name);
  }

  /**
   * Check if a tool exists
   * @param {string} name - Tool name
   * @returns {boolean}
   */
  has(name) {
    return this.tools.has(name);
  }

  /**
   * Get all registered tools
   * @returns {BaseTool[]}
   */
  getAll() {
    return Array.from(this.tools.values());
  }

  /**
   * Get tool definitions for API
   * @returns {object[]}
   */
  getToolDefinitions() {
    return this.getAll().map((tool) => tool.toJSON());
  }

  /**
   * Execute a tool by name
   * @param {string} name - Tool name
   * @param {object} input - Tool input
   * @param {object} context - Execution context
   * @returns {Promise<object>} Tool result
   */
  async execute(name, input, context = {}) {
    const tool = this.get(name);
    if (!tool) {
      return {
        status: ToolResultStatus.ERROR,
        error: `Unknown tool: ${name}`
      };
    }

    // Validate input
    const validation = tool.validateInput(input);
    if (!validation.valid) {
      return {
        status: ToolResultStatus.ERROR,
        error: `Invalid input: ${validation.errors.join(", ")}`
      };
    }

    try {
      return await tool.execute(input, context);
    } catch (err) {
      debug(`Tool ${name} failed: ${err.message}`);
      return tool.error(err.message);
    }
  }
}

// Global tool registry
export const globalRegistry = new ToolRegistry();

export default {
  BaseTool,
  ToolRegistry,
  ToolResultStatus,
  globalRegistry
};
