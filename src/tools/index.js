/**
 * Tools Module Index
 *
 * Exports all tool implementations and the tool registry.
 */

export * from "./base-tool.js";
export * from "./read-tool.js";
export * from "./write-tool.js";
export * from "./edit-tool.js";
export * from "./multi-edit-tool.js";
export * from "./bash-tool.js";
export * from "./glob-tool.js";
export * from "./grep-tool.js";
export * from "./task-tool.js";
export * from "./todo-write-tool.js";
export * from "./web-search-tool.js";
export * from "./web-fetch-tool.js";
export * from "./notebook-edit-tool.js";
export * from "./bash-output-tool.js";
export * from "./kill-shell-tool.js";
export * from "./skill-tool.js";
export * from "./slash-command-tool.js";

import { globalRegistry } from "./base-tool.js";
import { readTool } from "./read-tool.js";
import { writeTool } from "./write-tool.js";
import { editTool } from "./edit-tool.js";
import { multiEditTool } from "./multi-edit-tool.js";
import { bashTool } from "./bash-tool.js";
import { globTool } from "./glob-tool.js";
import { grepTool } from "./grep-tool.js";
import { taskTool } from "./task-tool.js";
import { todoWriteTool } from "./todo-write-tool.js";
import { webSearchTool } from "./web-search-tool.js";
import { webFetchTool } from "./web-fetch-tool.js";
import { notebookEditTool } from "./notebook-edit-tool.js";
import { bashOutputTool } from "./bash-output-tool.js";
import { killShellTool } from "./kill-shell-tool.js";
import { skillTool } from "./skill-tool.js";
import { slashCommandTool } from "./slash-command-tool.js";

// Register all built-in tools
globalRegistry.register(readTool);
globalRegistry.register(writeTool);
globalRegistry.register(editTool);
globalRegistry.register(multiEditTool);
globalRegistry.register(bashTool);
globalRegistry.register(globTool);
globalRegistry.register(grepTool);
globalRegistry.register(taskTool);
globalRegistry.register(todoWriteTool);
globalRegistry.register(webSearchTool);
globalRegistry.register(webFetchTool);
globalRegistry.register(notebookEditTool);
globalRegistry.register(bashOutputTool);
globalRegistry.register(killShellTool);
globalRegistry.register(skillTool);
globalRegistry.register(slashCommandTool);

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
 * @param {string} filePath - Path to mark as read
 */
export function markFileAsRead(filePath) {
  writeTool.markAsRead(filePath);
  editTool.markAsRead(filePath);
  multiEditTool.markAsRead(filePath);
  notebookEditTool.markAsRead(filePath);
}

/**
 * Get a tool by name
 * @param {string} name - Tool name
 * @returns {BaseTool|undefined}
 */
export function getTool(name) {
  return globalRegistry.get(name);
}

/**
 * Check if a tool exists
 * @param {string} name - Tool name
 * @returns {boolean}
 */
export function hasTool(name) {
  return globalRegistry.has(name);
}

export default {
  globalRegistry,
  getToolDefinitions,
  executeTool,
  markFileAsRead,
  getTool,
  hasTool,
  // Individual tools
  readTool,
  writeTool,
  editTool,
  multiEditTool,
  bashTool,
  globTool,
  grepTool,
  taskTool,
  todoWriteTool,
  webSearchTool,
  webFetchTool,
  notebookEditTool,
  bashOutputTool,
  killShellTool,
  skillTool,
  slashCommandTool
};
