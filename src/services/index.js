/**
 * Services Module Index
 *
 * Exports all service modules for conversation, streaming, REPL,
 * MCP support, permissions, and hooks.
 */

export * from "./conversation.js";
export * from "./streaming.js";
export * from "./repl.js";
export * from "./mcp.js";
export * from "./permissions.js";
export * from "./hooks.js";

import conversation from "./conversation.js";
import streaming from "./streaming.js";
import repl from "./repl.js";
import mcp from "./mcp.js";
import permissions from "./permissions.js";
import hooks from "./hooks.js";

export default {
  ...conversation,
  ...streaming,
  ...repl,
  ...mcp,
  ...permissions,
  ...hooks
};
