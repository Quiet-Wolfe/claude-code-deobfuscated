/**
 * Command Line Arguments Parser
 *
 * Parses and validates command line arguments for Claude Code.
 */

import { VERSION, PACKAGE_INFO } from "../constants/index.js";

/**
 * CLI option definitions
 */
export const OPTIONS = {
  // Mode options
  print: {
    flags: ["-p", "--print"],
    description: "Print mode - output response without interactive UI",
    type: "boolean"
  },
  continue: {
    flags: ["-c", "--continue"],
    description: "Continue the most recent conversation",
    type: "boolean"
  },
  resume: {
    flags: ["-r", "--resume"],
    description: "Resume a specific conversation by session ID",
    type: "string",
    argName: "session-id"
  },

  // Output options
  outputFormat: {
    flags: ["--output-format"],
    description: "Output format (text, json, stream-json)",
    type: "string",
    choices: ["text", "json", "stream-json"],
    default: "text"
  },
  verbose: {
    flags: ["-v", "--verbose"],
    description: "Enable verbose output",
    type: "boolean"
  },
  debug: {
    flags: ["--debug"],
    description: "Enable debug output",
    type: "boolean"
  },

  // Model options
  model: {
    flags: ["-m", "--model"],
    description: "Model to use for responses",
    type: "string"
  },
  maxTokens: {
    flags: ["--max-tokens"],
    description: "Maximum tokens in response",
    type: "number"
  },
  maxThinkingTokens: {
    flags: ["--max-thinking-tokens"],
    description: "Maximum tokens for extended thinking",
    type: "number"
  },

  // Permission options
  allowedTools: {
    flags: ["--allowedTools"],
    description: "Comma-separated list of allowed tools",
    type: "string"
  },
  disallowedTools: {
    flags: ["--disallowedTools"],
    description: "Comma-separated list of disallowed tools",
    type: "string"
  },
  dangerouslySkipPermissions: {
    flags: ["--dangerously-skip-permissions"],
    description: "Skip all permission prompts (use with caution)",
    type: "boolean"
  },

  // System prompt options
  systemPrompt: {
    flags: ["--system-prompt"],
    description: "Custom system prompt",
    type: "string"
  },
  appendSystemPrompt: {
    flags: ["--append-system-prompt"],
    description: "Text to append to the system prompt",
    type: "string"
  },

  // MCP options
  mcpConfig: {
    flags: ["--mcp-config"],
    description: "Path to MCP configuration file",
    type: "string"
  },

  // Other options
  cwd: {
    flags: ["--cwd"],
    description: "Working directory",
    type: "string"
  },
  version: {
    flags: ["-V", "--version"],
    description: "Show version number",
    type: "boolean"
  },
  help: {
    flags: ["-h", "--help"],
    description: "Show help",
    type: "boolean"
  }
};

/**
 * Parse command line arguments
 * @param {string[]} argv - Command line arguments
 * @returns {object} Parsed arguments
 */
export function parseArgs(argv = process.argv.slice(2)) {
  const result = {
    _: [], // Positional arguments
    _raw: argv
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    // Check if it's a flag
    if (arg.startsWith("-")) {
      let found = false;

      // Find matching option
      for (const [key, opt] of Object.entries(OPTIONS)) {
        if (opt.flags.includes(arg)) {
          found = true;

          if (opt.type === "boolean") {
            result[key] = true;
          } else {
            // Get the value
            i++;
            if (i >= argv.length) {
              throw new Error(`Option ${arg} requires a value`);
            }
            const value = argv[i];

            if (opt.type === "number") {
              result[key] = parseInt(value, 10);
              if (isNaN(result[key])) {
                throw new Error(`Option ${arg} requires a number`);
              }
            } else {
              result[key] = value;
            }

            // Validate choices
            if (opt.choices && !opt.choices.includes(result[key])) {
              throw new Error(
                `Invalid value for ${arg}. Must be one of: ${opt.choices.join(", ")}`
              );
            }
          }
          break;
        }
      }

      // Handle --key=value format
      if (!found && arg.includes("=")) {
        const [key, value] = arg.split("=", 2);
        for (const [optKey, opt] of Object.entries(OPTIONS)) {
          if (opt.flags.includes(key)) {
            found = true;
            if (opt.type === "number") {
              result[optKey] = parseInt(value, 10);
            } else if (opt.type === "boolean") {
              result[optKey] = value !== "false" && value !== "0";
            } else {
              result[optKey] = value;
            }
            break;
          }
        }
      }

      if (!found) {
        // Unknown option - store it anyway
        if (arg.startsWith("--no-")) {
          const key = arg.slice(5).replace(/-./g, (x) => x[1].toUpperCase());
          result[key] = false;
        } else {
          const key = arg.replace(/^-+/, "").replace(/-./g, (x) => x[1].toUpperCase());
          if (i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
            i++;
            result[key] = argv[i];
          } else {
            result[key] = true;
          }
        }
      }
    } else {
      // Positional argument
      result._.push(arg);
    }

    i++;
  }

  // Apply defaults
  for (const [key, opt] of Object.entries(OPTIONS)) {
    if (result[key] === undefined && opt.default !== undefined) {
      result[key] = opt.default;
    }
  }

  return result;
}

/**
 * Generate help text
 * @returns {string}
 */
export function generateHelp() {
  const lines = [
    `Claude Code v${VERSION}`,
    "",
    "Usage: claude [options] [prompt]",
    "",
    "Options:"
  ];

  for (const [key, opt] of Object.entries(OPTIONS)) {
    const flags = opt.flags.join(", ");
    let line = `  ${flags.padEnd(30)}`;
    line += opt.description;

    if (opt.choices) {
      line += ` (${opt.choices.join("|")})`;
    }
    if (opt.default !== undefined) {
      line += ` [default: ${opt.default}]`;
    }

    lines.push(line);
  }

  lines.push("");
  lines.push("Examples:");
  lines.push('  claude "What is the weather today?"');
  lines.push('  claude -p "Explain this code" < file.js');
  lines.push("  claude --continue");
  lines.push("  claude --resume abc123");
  lines.push("");
  lines.push(`Documentation: ${PACKAGE_INFO.readmeUrl}`);
  lines.push(`Report issues: ${PACKAGE_INFO.issuesUrl}`);

  return lines.join("\n");
}

/**
 * Generate version string
 * @returns {string}
 */
export function generateVersion() {
  return `Claude Code v${VERSION}`;
}

export default {
  OPTIONS,
  parseArgs,
  generateHelp,
  generateVersion
};
