/**
 * Claude Code Constants
 *
 * This module exports all constant values used throughout Claude Code.
 */

export const VERSION = "2.0.67";
export const BUILD_TIME = "2025-12-11T23:56:06Z";

export const PACKAGE_INFO = {
  name: "@anthropic-ai/claude-code",
  version: VERSION,
  buildTime: BUILD_TIME,
  packageUrl: "@anthropic-ai/claude-code",
  readmeUrl: "https://code.claude.com/docs/en/overview",
  issuesUrl: "https://github.com/anthropics/claude-code/issues",
  feedbackChannel: "https://github.com/anthropics/claude-code/issues"
};

// API Configuration
export const API_CONFIG = {
  baseUrl: "https://api.anthropic.com",
  defaultModel: "claude-sonnet-4-20250514",
  defaultMaxTokens: 16000,
  streamingEnabled: true
};

// Model identifiers
export const MODELS = {
  CLAUDE_SONNET: "claude-sonnet-4-20250514",
  CLAUDE_OPUS: "claude-opus-4-5-20251101",
  CLAUDE_HAIKU: "claude-haiku-3-5-20241022"
};

// Tool names
export const TOOL_NAMES = {
  READ: "Read",
  WRITE: "Write",
  EDIT: "Edit",
  MULTI_EDIT: "MultiEdit",
  BASH: "Bash",
  GLOB: "Glob",
  GREP: "Grep",
  TASK: "Task",
  WEB_SEARCH: "WebSearch",
  WEB_FETCH: "WebFetch",
  TODO_WRITE: "TodoWrite",
  NOTEBOOK_EDIT: "NotebookEdit"
};

// Message types
export const MESSAGE_TYPES = {
  USER: "user",
  ASSISTANT: "assistant",
  SYSTEM: "system",
  TOOL_USE: "tool_use",
  TOOL_RESULT: "tool_result"
};

// Permission modes
export const PERMISSION_MODES = {
  DEFAULT: "default",
  ALLOW_ALL: "allowAll",
  DENY_ALL: "denyAll",
  BYPASS: "bypassPermissions"
};

// Output styles
export const OUTPUT_STYLES = {
  STREAMING: "streaming",
  FULL: "full",
  JSON: "json"
};

// Exit codes
export const EXIT_CODES = {
  SUCCESS: 0,
  ERROR: 1,
  INVALID_ARGS: 2,
  PERMISSION_DENIED: 3,
  NETWORK_ERROR: 4
};

// File size limits
export const FILE_LIMITS = {
  MAX_READ_SIZE: 256 * 1024, // 256KB
  MAX_WRITE_SIZE: 10 * 1024 * 1024, // 10MB
  MAX_LINE_LENGTH: 2000,
  DEFAULT_READ_LINES: 2000
};

// UI Constants
export const UI_CONSTANTS = {
  SPINNER_INTERVAL: 80,
  DEBOUNCE_DELAY: 100,
  MAX_HISTORY_LENGTH: 1000
};

// Unicode symbols for terminal output
export const SYMBOLS = {
  tick: "\u2713",
  cross: "\u2717",
  warning: "\u26A0",
  info: "\u2139",
  bullet: "\u2022",
  arrow: "\u2192",
  ellipsis: "\u2026"
};

export default {
  VERSION,
  BUILD_TIME,
  PACKAGE_INFO,
  API_CONFIG,
  MODELS,
  TOOL_NAMES,
  MESSAGE_TYPES,
  PERMISSION_MODES,
  OUTPUT_STYLES,
  EXIT_CODES,
  FILE_LIMITS,
  UI_CONSTANTS,
  SYMBOLS
};
