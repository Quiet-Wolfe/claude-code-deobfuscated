/**
 * Claude Code - Main Module
 *
 * This is the deobfuscated, modular version of Claude Code.
 * The code has been reorganized from the original bundled cli.js
 * into separate, maintainable modules.
 *
 * Module Structure:
 * - constants/: Application constants and configuration values
 * - utils/: Utility functions (logging, filesystem, memoization)
 * - config/: Settings management
 * - api/: Anthropic API client
 * - tools/: Tool implementations (Read, Write, Edit, Bash, etc.)
 * - ui/: Terminal UI components (colors, spinners)
 * - services/: Business logic (conversation management)
 * - cli/: Command line interface
 *
 * Original Version: 2.0.67
 * Build Time: 2025-12-11T23:56:06Z
 */

// Re-export all modules
export * from "./constants/index.js";
export * from "./utils/index.js";
export * from "./config/settings.js";
export * from "./api/anthropic-client.js";
export * from "./tools/index.js";
export * from "./ui/index.js";
export * from "./services/index.js";
export * from "./cli/index.js";

// Import for default export
import constants from "./constants/index.js";
import * as utils from "./utils/index.js";
import * as config from "./config/settings.js";
import * as api from "./api/anthropic-client.js";
import * as tools from "./tools/index.js";
import * as ui from "./ui/index.js";
import * as services from "./services/index.js";
import { main } from "./cli/index.js";

/**
 * Default export provides access to all modules
 */
export default {
  constants,
  utils,
  config,
  api,
  tools,
  ui,
  services,
  main
};

// Also export main as named export for CLI entry
export { main };
