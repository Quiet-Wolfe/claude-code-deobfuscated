/**
 * SlashCommand Tool
 *
 * Executes a slash command within the main conversation.
 * Slash commands are user-defined commands stored in .claude/commands/ directories.
 */

import { BaseTool } from "./base-tool.js";
import { debug } from "../utils/logger.js";
import { join } from "path";
import { existsSync, readFileSync } from "../utils/fs-utils.js";
import { getClaudeConfigDir } from "../utils/fs-utils.js";

/**
 * Slash command registry
 */
class SlashCommandRegistry {
  constructor() {
    this.commands = new Map();
  }

  /**
   * Register a command
   * @param {object} command - Command definition
   */
  register(command) {
    this.commands.set(command.name, command);
  }

  /**
   * Get a command by name
   * @param {string} name - Command name (without leading /)
   * @returns {object|undefined}
   */
  get(name) {
    // Remove leading slash if present
    const cmdName = name.startsWith("/") ? name.slice(1) : name;
    return this.commands.get(cmdName);
  }

  /**
   * Check if a command exists
   * @param {string} name - Command name
   * @returns {boolean}
   */
  has(name) {
    const cmdName = name.startsWith("/") ? name.slice(1) : name;
    return this.commands.has(cmdName);
  }

  /**
   * Get all available commands
   * @returns {object[]}
   */
  getAll() {
    return Array.from(this.commands.values());
  }

  /**
   * Load commands from a directory
   * @param {string} dir - Commands directory
   * @param {string} location - Location identifier (user/project)
   */
  loadFromDirectory(dir, location) {
    if (!existsSync(dir)) {
      return;
    }

    try {
      const fs = require("fs");
      const files = fs.readdirSync(dir);

      for (const file of files) {
        if (file.endsWith(".md")) {
          try {
            const cmdPath = join(dir, file);
            const content = readFileSync(cmdPath, { encoding: "utf8" });
            const name = file.replace(".md", "");

            // Parse the command file for description (first line starting with #)
            let description = "";
            const lines = content.split("\n");
            for (const line of lines) {
              if (line.startsWith("# ")) {
                description = line.slice(2).trim();
                break;
              } else if (line.startsWith("<!-- ") && line.includes("description:")) {
                const match = line.match(/description:\s*(.+?)(?:\s*-->|$)/);
                if (match) {
                  description = match[1].trim();
                  break;
                }
              }
            }

            this.register({
              name,
              description: description || `Command from ${file}`,
              prompt: content,
              location,
              path: cmdPath
            });
          } catch (err) {
            debug(`Failed to load command ${file}: ${err.message}`);
          }
        }
      }
    } catch (err) {
      debug(`Failed to load commands from ${dir}: ${err.message}`);
    }
  }

  /**
   * Load commands from user config
   */
  loadUserCommands() {
    const commandsDir = join(getClaudeConfigDir(), "commands");
    this.loadFromDirectory(commandsDir, "user");
  }

  /**
   * Load commands from project directory
   * @param {string} projectDir - Project directory
   */
  loadProjectCommands(projectDir) {
    const commandsDir = join(projectDir, ".claude", "commands");
    this.loadFromDirectory(commandsDir, "project");
  }
}

// Global command registry
export const slashCommandRegistry = new SlashCommandRegistry();

/**
 * SlashCommand Tool Implementation
 */
export class SlashCommandTool extends BaseTool {
  constructor() {
    super({
      name: "SlashCommand",
      description: `Execute a slash command within the main conversation.

When you use this tool or when a user types a slash command, you will see a command message followed by the expanded prompt.

Usage:
- command (required): The slash command to execute, including any arguments
- Example: command: "/review-pr 123"

IMPORTANT: Only use this tool for custom slash commands that appear in the Available Commands list. Do NOT use for:
- Built-in CLI commands (like /help, /clear, etc.)
- Commands not shown in the list
- Commands you think might exist but aren't listed

Notes:
- When a user requests multiple slash commands, execute each one sequentially
- Do not invoke a command that is already running`,
      inputSchema: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The slash command to execute with its arguments, e.g., \"/review-pr 123\""
          }
        },
        required: ["command"]
      },
      requiresPermission: false
    });
  }

  /**
   * Parse command and arguments
   * @param {string} commandStr - Full command string
   * @returns {object} Parsed command
   */
  parseCommand(commandStr) {
    const trimmed = commandStr.trim();
    const parts = trimmed.split(/\s+/);
    const name = parts[0].startsWith("/") ? parts[0].slice(1) : parts[0];
    const args = parts.slice(1);

    return { name, args, argsString: args.join(" ") };
  }

  /**
   * Expand variables in prompt
   * @param {string} prompt - Prompt template
   * @param {object} vars - Variables to expand
   * @returns {string} Expanded prompt
   */
  expandVariables(prompt, vars) {
    let result = prompt;

    // Replace $ARGUMENTS with full args string
    result = result.replace(/\$ARGUMENTS/g, vars.argsString || "");

    // Replace $1, $2, etc. with individual arguments
    for (let i = 0; i < vars.args.length; i++) {
      result = result.replace(new RegExp(`\\$${i + 1}`, "g"), vars.args[i]);
    }

    return result;
  }

  /**
   * Execute the slash command
   * @param {object} input - Tool input
   * @param {object} context - Execution context
   * @returns {Promise<object>} Tool result
   */
  async execute(input, context = {}) {
    const { command: commandStr } = input;

    debug(`SlashCommand tool executing: ${commandStr}`);

    // Parse the command
    const { name, args, argsString } = this.parseCommand(commandStr);

    // Check for built-in commands that shouldn't be handled here
    const builtinCommands = ["help", "clear", "compact", "exit", "quit", "config", "doctor", "init", "bug"];
    if (builtinCommands.includes(name)) {
      return this.error(`"/${name}" is a built-in command and should not be executed via this tool.`);
    }

    // Get the command
    const command = slashCommandRegistry.get(name);
    if (!command) {
      // List available commands in error message
      const available = slashCommandRegistry.getAll();
      if (available.length === 0) {
        return this.error(`Command "/${name}" not found. No custom slash commands are available.`);
      }

      const cmdList = available.map(c => `- /${c.name}: ${c.description || "(no description)"}`).join("\n");
      return this.error(`Command "/${name}" not found. Available commands:\n${cmdList}`);
    }

    // Expand variables in the prompt
    const expandedPrompt = this.expandVariables(command.prompt, { args, argsString });

    // Return the command's prompt to be executed
    return this.success({
      commandName: command.name,
      args,
      argsString,
      prompt: expandedPrompt,
      location: command.location,
      message: `<command-message>${name} is running…</command-message>\n\n${expandedPrompt}`
    });
  }
}

// Export singleton instance
export const slashCommandTool = new SlashCommandTool();

export default SlashCommandTool;
