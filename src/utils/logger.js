/**
 * Logger Module
 *
 * Provides logging functionality with support for different log levels,
 * debug filtering, and output formatting.
 */

import { performance } from "perf_hooks";

// Log levels
export const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  SILENT: 4
};

// Current log level (can be set via environment variable)
let currentLogLevel = process.env.CLAUDE_DEBUG ? LOG_LEVELS.DEBUG : LOG_LEVELS.INFO;

// Debug filter for selective logging
let debugFilter = null;

/**
 * Parse debug filter string into include/exclude sets
 * @param {string} filterString - Comma-separated filter string (prefix with ! to exclude)
 * @returns {object|null} Filter configuration or null if no valid filter
 */
export function parseDebugFilter(filterString) {
  if (!filterString || filterString.trim() === "") {
    return null;
  }

  const parts = filterString.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) {
    return null;
  }

  const hasExclusions = parts.some((p) => p.startsWith("!"));
  const hasInclusions = parts.some((p) => !p.startsWith("!"));

  // Can't mix inclusions and exclusions
  if (hasExclusions && hasInclusions) {
    return null;
  }

  const items = parts.map((p) => p.replace(/^!/, "").toLowerCase());

  return {
    include: hasExclusions ? [] : items,
    exclude: hasExclusions ? items : [],
    isExclusive: hasExclusions
  };
}

/**
 * Extract tags from a log message for filtering
 * @param {string} message - Log message
 * @returns {string[]} Array of extracted tags
 */
export function extractLogTags(message) {
  const tags = [];

  // Extract MCP server name
  const mcpMatch = message.match(/^MCP server ["']([^"']+)["']/);
  if (mcpMatch?.[1]) {
    tags.push("mcp");
    tags.push(mcpMatch[1].toLowerCase());
  } else {
    // Extract prefix before colon
    const prefixMatch = message.match(/^([^:[]+):/);
    if (prefixMatch?.[1]) {
      tags.push(prefixMatch[1].trim().toLowerCase());
    }
  }

  // Extract bracketed prefix
  const bracketMatch = message.match(/^\[([^\]]+)]/);
  if (bracketMatch?.[1]) {
    tags.push(bracketMatch[1].trim().toLowerCase());
  }

  // Check for statsig
  if (message.toLowerCase().includes("statsig event:")) {
    tags.push("statsig");
  }

  // Extract component name
  const componentMatch = message.match(/:\s*([^:]+?)(?:\s+(?:type|mode|status|event))?:/);
  if (componentMatch?.[1]) {
    const component = componentMatch[1].trim().toLowerCase();
    if (component.length < 30 && !component.includes(" ")) {
      tags.push(component);
    }
  }

  return Array.from(new Set(tags));
}

/**
 * Check if a message should be logged based on filter
 * @param {string} message - Log message
 * @param {object} filter - Filter configuration
 * @returns {boolean} Whether the message passes the filter
 */
export function passesFilter(message, filter) {
  if (!filter) return true;

  const tags = extractLogTags(message);
  if (tags.length === 0) return false;

  if (filter.isExclusive) {
    return !tags.some((tag) => filter.exclude.includes(tag));
  } else {
    return tags.some((tag) => filter.include.includes(tag));
  }
}

/**
 * Set the current log level
 * @param {number} level - Log level from LOG_LEVELS
 */
export function setLogLevel(level) {
  currentLogLevel = level;
}

/**
 * Set debug filter
 * @param {string} filterString - Filter string
 */
export function setDebugFilter(filterString) {
  debugFilter = parseDebugFilter(filterString);
}

/**
 * Format a log message with timestamp and level
 * @param {string} level - Log level name
 * @param {string} message - Log message
 * @returns {string} Formatted message
 */
function formatMessage(level, message) {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level}] ${message}`;
}

/**
 * Write to stdout efficiently (handles large strings)
 * @param {string} text - Text to write
 */
export function writeStdout(text) {
  for (let i = 0; i < text.length; i += 2000) {
    process.stdout.write(text.substring(i, i + 2000));
  }
}

/**
 * Write to stderr efficiently (handles large strings)
 * @param {string} text - Text to write
 */
export function writeStderr(text) {
  for (let i = 0; i < text.length; i += 2000) {
    process.stderr.write(text.substring(i, i + 2000));
  }
}

/**
 * Debug log
 * @param {string} message - Message to log
 * @param {object} options - Additional options
 */
export function debug(message, options = {}) {
  if (currentLogLevel > LOG_LEVELS.DEBUG) return;
  if (!passesFilter(message, debugFilter)) return;

  const formatted = formatMessage("DEBUG", message);
  writeStderr(formatted + "\n");
}

/**
 * Info log
 * @param {string} message - Message to log
 */
export function info(message) {
  if (currentLogLevel > LOG_LEVELS.INFO) return;
  writeStdout(message + "\n");
}

/**
 * Warning log
 * @param {string} message - Message to log
 */
export function warn(message) {
  if (currentLogLevel > LOG_LEVELS.WARN) return;
  const formatted = formatMessage("WARN", message);
  writeStderr(formatted + "\n");
}

/**
 * Error log
 * @param {string|Error} messageOrError - Message or Error to log
 */
export function error(messageOrError) {
  if (currentLogLevel > LOG_LEVELS.ERROR) return;

  const message = messageOrError instanceof Error
    ? messageOrError.message
    : String(messageOrError);

  const formatted = formatMessage("ERROR", message);
  writeStderr(formatted + "\n");
}

/**
 * Performance timer for measuring operation duration
 */
export class PerformanceTimer {
  constructor(name) {
    this.name = name;
    this.start = performance.now();
  }

  end() {
    const duration = performance.now() - this.start;
    debug(`[PERF] ${this.name}: ${duration.toFixed(1)}ms`);
    return duration;
  }

  static measure(name, fn) {
    const timer = new PerformanceTimer(name);
    try {
      return fn();
    } finally {
      timer.end();
    }
  }

  static async measureAsync(name, fn) {
    const timer = new PerformanceTimer(name);
    try {
      return await fn();
    } finally {
      timer.end();
    }
  }
}

// Convenience exports
export const f = debug;  // Shorthand for debug (matches original obfuscated name)
export const r = error;  // Shorthand for error (matches original obfuscated name)

export default {
  LOG_LEVELS,
  setLogLevel,
  setDebugFilter,
  debug,
  info,
  warn,
  error,
  writeStdout,
  writeStderr,
  PerformanceTimer,
  f,
  r
};
