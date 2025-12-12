#!/usr/bin/env node
/**
 * Claude Code - Deobfuscated Entry Point
 *
 * This is the modular, readable version of Claude Code.
 *
 * The code has been reorganized from the original bundled cli.js into
 * separate modules for better maintainability and modification.
 *
 * Module Structure:
 *   src/
 *   ├── constants/     - Application constants
 *   ├── utils/         - Utility functions
 *   │   ├── logger.js  - Logging utilities
 *   │   ├── fs-utils.js - Filesystem utilities
 *   │   └── memoize.js - Memoization utilities
 *   ├── config/        - Configuration management
 *   │   └── settings.js - Settings loader
 *   ├── api/           - API client
 *   │   └── anthropic-client.js - Anthropic API
 *   ├── tools/         - Tool implementations
 *   │   ├── base-tool.js  - Base tool class
 *   │   ├── read-tool.js  - File reading
 *   │   ├── write-tool.js - File writing
 *   │   ├── edit-tool.js  - File editing
 *   │   ├── bash-tool.js  - Command execution
 *   │   ├── glob-tool.js  - File pattern matching
 *   │   └── grep-tool.js  - Content searching
 *   ├── ui/            - Terminal UI
 *   │   ├── colors.js  - Color utilities
 *   │   └── spinner.js - Loading spinners
 *   ├── services/      - Business logic
 *   │   └── conversation.js - Conversation management
 *   └── cli/           - CLI interface
 *       ├── args.js    - Argument parsing
 *       └── index.js   - Main CLI logic
 *
 * Note: This deobfuscated version provides the core structure and
 * key functionality. The original cli.js contains additional features
 * including the full React/Ink UI, MCP support, and AWS integrations.
 *
 * For full functionality, use the original cli.js. This version is
 * intended for learning, modification, and extension purposes.
 *
 * @version 2.0.67
 * @author Anthropic
 * @license SEE LICENSE IN README.md
 */

import { main } from "./src/index.js";

// Run the CLI
main(process.argv.slice(2)).catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
