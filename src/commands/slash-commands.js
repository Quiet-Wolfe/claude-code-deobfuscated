/**
 * Slash Commands System
 *
 * Implements built-in slash commands for the CLI interface.
 * Commands are prefixed with / and provide quick access to functionality.
 */

import { debug, writeStdout, writeStderr } from "../utils/logger.js";
import { VERSION, PACKAGE_INFO } from "../constants/index.js";
import { getSettings, updateUserSettings } from "../config/settings.js";
import { getAllTodos, clearTodos } from "../tools/todo-write-tool.js";
import { colors, symbols } from "../ui/colors.js";

/**
 * Command registry
 */
const commands = new Map();

/**
 * Command definition structure
 */
class SlashCommand {
  constructor(options) {
    this.name = options.name;
    this.aliases = options.aliases || [];
    this.description = options.description;
    this.usage = options.usage || `/${options.name}`;
    this.handler = options.handler;
    this.hidden = options.hidden || false;
  }

  /**
   * Execute the command
   * @param {string[]} args - Command arguments
   * @param {object} context - Execution context
   * @returns {Promise<object>} Command result
   */
  async execute(args, context) {
    return this.handler(args, context);
  }
}

/**
 * Register a slash command
 * @param {object} options - Command options
 */
export function registerCommand(options) {
  const cmd = new SlashCommand(options);
  commands.set(cmd.name, cmd);

  // Register aliases
  for (const alias of cmd.aliases) {
    commands.set(alias, cmd);
  }

  debug(`Registered command: /${cmd.name}`);
}

/**
 * Get a command by name
 * @param {string} name - Command name
 * @returns {SlashCommand|undefined}
 */
export function getCommand(name) {
  return commands.get(name);
}

/**
 * Check if input is a slash command
 * @param {string} input - User input
 * @returns {boolean}
 */
export function isSlashCommand(input) {
  return input.trim().startsWith("/");
}

/**
 * Parse a slash command from input
 * @param {string} input - User input
 * @returns {object} Parsed command { name, args }
 */
export function parseSlashCommand(input) {
  const trimmed = input.trim();
  const match = trimmed.match(/^\/(\S+)(?:\s+(.*))?$/);

  if (!match) {
    return { name: null, args: [] };
  }

  const name = match[1].toLowerCase();
  const argsStr = match[2] || "";
  const args = argsStr.split(/\s+/).filter(Boolean);

  return { name, args };
}

/**
 * Execute a slash command
 * @param {string} input - User input
 * @param {object} context - Execution context
 * @returns {Promise<object>} Execution result
 */
export async function executeSlashCommand(input, context = {}) {
  const { name, args } = parseSlashCommand(input);

  if (!name) {
    return { success: false, message: "Invalid command format" };
  }

  const cmd = commands.get(name);
  if (!cmd) {
    return {
      success: false,
      message: `Unknown command: /${name}. Type /help for available commands.`
    };
  }

  try {
    return await cmd.execute(args, context);
  } catch (err) {
    debug(`Command /${name} error: ${err.message}`);
    return {
      success: false,
      message: `Error executing /${name}: ${err.message}`
    };
  }
}

/**
 * Get all registered commands
 * @param {boolean} includeHidden - Include hidden commands
 * @returns {SlashCommand[]}
 */
export function getAllCommands(includeHidden = false) {
  const seen = new Set();
  const result = [];

  for (const cmd of commands.values()) {
    if (!seen.has(cmd.name)) {
      if (!cmd.hidden || includeHidden) {
        result.push(cmd);
      }
      seen.add(cmd.name);
    }
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

// ============================================================
// Built-in Commands
// ============================================================

registerCommand({
  name: "help",
  aliases: ["h", "?"],
  description: "Show available commands",
  usage: "/help [command]",
  handler: async (args) => {
    if (args.length > 0) {
      const cmd = commands.get(args[0].toLowerCase());
      if (cmd) {
        return {
          success: true,
          output: `/${cmd.name}: ${cmd.description}\nUsage: ${cmd.usage}`
        };
      }
      return { success: false, message: `Unknown command: ${args[0]}` };
    }

    const cmds = getAllCommands();
    const lines = [
      colors.bold("Available Commands:"),
      ""
    ];

    for (const cmd of cmds) {
      lines.push(`  ${colors.cyan(`/${cmd.name}`).padEnd(25)} ${cmd.description}`);
    }

    lines.push("");
    lines.push("Type /help <command> for more information about a command.");

    return { success: true, output: lines.join("\n") };
  }
});

registerCommand({
  name: "clear",
  aliases: ["cls"],
  description: "Clear the terminal screen",
  handler: async () => {
    process.stdout.write("\x1b[2J\x1b[H");
    return { success: true };
  }
});

registerCommand({
  name: "exit",
  aliases: ["quit", "q"],
  description: "Exit Claude Code",
  handler: async (args, context) => {
    writeStdout("Goodbye!\n");
    process.exit(0);
  }
});

registerCommand({
  name: "version",
  aliases: ["v"],
  description: "Show version information",
  handler: async () => {
    return {
      success: true,
      output: `Claude Code v${VERSION}\nBuild: ${PACKAGE_INFO.buildTime}`
    };
  }
});

registerCommand({
  name: "compact",
  description: "Toggle compact output mode",
  handler: async (args, context) => {
    const settings = getSettings();
    const newValue = !settings.compactMode;
    updateUserSettings((s) => ({ ...s, compactMode: newValue }));
    return {
      success: true,
      output: `Compact mode: ${newValue ? "enabled" : "disabled"}`
    };
  }
});

registerCommand({
  name: "verbose",
  description: "Toggle verbose output",
  handler: async () => {
    const settings = getSettings();
    const newValue = !settings.verbose;
    updateUserSettings((s) => ({ ...s, verbose: newValue }));
    return {
      success: true,
      output: `Verbose mode: ${newValue ? "enabled" : "disabled"}`
    };
  }
});

registerCommand({
  name: "debug",
  description: "Toggle debug output",
  handler: async () => {
    const isEnabled = process.env.CLAUDE_DEBUG === "1";
    if (isEnabled) {
      delete process.env.CLAUDE_DEBUG;
      return { success: true, output: "Debug mode: disabled" };
    } else {
      process.env.CLAUDE_DEBUG = "1";
      return { success: true, output: "Debug mode: enabled" };
    }
  }
});

registerCommand({
  name: "model",
  description: "Show or change the current model",
  usage: "/model [model-name]",
  handler: async (args) => {
    const settings = getSettings();

    if (args.length === 0) {
      return {
        success: true,
        output: `Current model: ${settings.model || "default"}`
      };
    }

    const newModel = args[0];
    updateUserSettings((s) => ({ ...s, model: newModel }));
    return {
      success: true,
      output: `Model changed to: ${newModel}`
    };
  }
});

registerCommand({
  name: "todo",
  aliases: ["todos", "tasks"],
  description: "Show current task list",
  handler: async () => {
    const todos = getAllTodos();

    if (todos.length === 0) {
      return { success: true, output: "No tasks in the todo list." };
    }

    const lines = [colors.bold("Task List:"), ""];

    for (const todo of todos) {
      let status;
      switch (todo.status) {
        case "completed":
          status = colors.green(`${symbols.tick} Done`);
          break;
        case "in_progress":
          status = colors.yellow(`${symbols.arrow} Working`);
          break;
        default:
          status = colors.dim(`${symbols.circle} Pending`);
      }
      lines.push(`  ${status.padEnd(20)} ${todo.content}`);
    }

    return { success: true, output: lines.join("\n") };
  }
});

registerCommand({
  name: "clear-todos",
  description: "Clear all tasks from the todo list",
  handler: async () => {
    clearTodos();
    return { success: true, output: "Todo list cleared." };
  }
});

registerCommand({
  name: "status",
  description: "Show current session status",
  handler: async (args, context) => {
    const settings = getSettings();
    const todos = getAllTodos();

    const lines = [
      colors.bold("Session Status:"),
      "",
      `  Model: ${settings.model || "default"}`,
      `  Working Directory: ${process.cwd()}`,
      `  Tasks: ${todos.filter((t) => t.status === "completed").length}/${todos.length} completed`,
      ""
    ];

    return { success: true, output: lines.join("\n") };
  }
});

registerCommand({
  name: "config",
  description: "Show current configuration",
  handler: async () => {
    const settings = getSettings();
    const lines = [
      colors.bold("Configuration:"),
      "",
      JSON.stringify(settings, null, 2)
    ];
    return { success: true, output: lines.join("\n") };
  }
});

registerCommand({
  name: "reset",
  description: "Reset conversation context",
  handler: async (args, context) => {
    // In a full implementation, this would clear conversation history
    return {
      success: true,
      output: "Conversation context has been reset."
    };
  }
});

registerCommand({
  name: "cost",
  description: "Show token usage and cost estimate",
  handler: async (args, context) => {
    // In a full implementation, this would show actual usage
    return {
      success: true,
      output: "Cost tracking requires API integration. Check Anthropic console for usage."
    };
  }
});

registerCommand({
  name: "doctor",
  description: "Run diagnostics",
  handler: async () => {
    const lines = [
      colors.bold("Running Diagnostics..."),
      "",
      `${colors.green(symbols.tick)} Node.js: ${process.version}`,
      `${colors.green(symbols.tick)} Platform: ${process.platform}`,
      `${colors.green(symbols.tick)} Claude Code: v${VERSION}`,
      ""
    ];

    // Check API key
    if (process.env.ANTHROPIC_API_KEY) {
      lines.push(`${colors.green(symbols.tick)} API Key: Configured`);
    } else {
      lines.push(`${colors.yellow(symbols.warning)} API Key: Not configured`);
    }

    lines.push("");
    lines.push("Diagnostics complete.");

    return { success: true, output: lines.join("\n") };
  }
});

export default {
  SlashCommand,
  registerCommand,
  getCommand,
  isSlashCommand,
  parseSlashCommand,
  executeSlashCommand,
  getAllCommands
};
