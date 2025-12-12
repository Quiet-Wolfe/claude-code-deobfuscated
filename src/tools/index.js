/**
 * Tools Module Index
 *
 * Exports all tool implementations and the tool registry.
 */

export * from "./base-tool.js";
export * from "./read-tool.js";
export * from "./write-tool.js";
export * from "./edit-tool.js";
export * from "./bash-tool.js";
export * from "./glob-tool.js";
export * from "./grep-tool.js";

import { globalRegistry } from "./base-tool.js";
import { readTool } from "./read-tool.js";
import { writeTool } from "./write-tool.js";
import { editTool } from "./edit-tool.js";
import { bashTool } from "./bash-tool.js";
import { globTool } from "./glob-tool.js";
import { grepTool } from "./grep-tool.js";

// Register all built-in tools
globalRegistry.register(readTool);
globalRegistry.register(writeTool);
globalRegistry.register(editTool);
globalRegistry.register(bashTool);
globalRegistry.register(globTool);
globalRegistry.register(grepTool);

export { globalRegistry };

/**
 * Get all tool definitions for the API
 * @returns {object[]} Tool definitions
 */
export function getToolDefinitions() {
  return globalRegistry.getToolDefinitions();
}

/**
 * Execute a tool by name
 * @param {string} name - Tool name
 * @param {object} input - Tool input
 * @param {object} context - Execution context
 * @returns {Promise<object>} Tool result
 */
export async function executeTool(name, input, context = {}) {
  return globalRegistry.execute(name, input, context);
}

/**
 * Link read tracking between tools
 * When a file is read, mark it as read for write/edit tools
 */
export function markFileAsRead(filePath) {
  writeTool.markAsRead(filePath);
  editTool.markAsRead(filePath);
}

export default {
  globalRegistry,
  getToolDefinitions,
  executeTool,
  markFileAsRead,
  readTool,
  writeTool,
  editTool,
  bashTool,
  globTool,
  grepTool
};
