/**
 * REPL Service
 *
 * Provides interactive Read-Eval-Print Loop functionality for Claude Code.
 * Handles user input, command processing, and response display.
 */

import * as readline from "readline";
import { debug, writeStdout, writeStderr } from "../utils/logger.js";
import { colors } from "../ui/colors.js";
import { createSpinner } from "../ui/spinner.js";
import { getClient } from "../api/anthropic-client.js";
import { getToolDefinitions, executeTool, markFileAsRead } from "../tools/index.js";
import { getCurrentConversation, Message } from "./conversation.js";
import { StreamHandler, ContentBlockType } from "./streaming.js";
import { checkPermission, grantPermission, formatPermissionRequest, PermissionDecision } from "./permissions.js";
import { runPreToolHooks, runPostToolHooks } from "./hooks.js";
import { slashCommandRegistry } from "../tools/slash-command-tool.js";
import { skillRegistry } from "../tools/skill-tool.js";

/**
 * Built-in slash commands
 */
const BUILTIN_COMMANDS = {
  help: {
    description: "Show help message",
    handler: showHelp
  },
  clear: {
    description: "Clear the conversation history",
    handler: clearConversation
  },
  compact: {
    description: "Compact the conversation (summarize old messages)",
    handler: compactConversation
  },
  exit: {
    description: "Exit Claude Code",
    handler: exitRepl
  },
  quit: {
    description: "Exit Claude Code (alias for /exit)",
    handler: exitRepl
  },
  config: {
    description: "Show or modify configuration",
    handler: showConfig
  },
  history: {
    description: "Show conversation history",
    handler: showHistory
  },
  undo: {
    description: "Undo the last message",
    handler: undoLastMessage
  },
  tasks: {
    description: "Show running background tasks",
    handler: showTasks
  }
};

/**
 * Show help message
 * @param {REPL} repl - REPL instance
 */
function showHelp(repl) {
  writeStdout("\n" + colors.bold("Claude Code Help") + "\n\n");
  writeStdout(colors.dim("Built-in Commands:") + "\n");

  for (const [name, cmd] of Object.entries(BUILTIN_COMMANDS)) {
    writeStdout(`  ${colors.cyan(`/${name}`)} - ${cmd.description}\n`);
  }

  const customCommands = slashCommandRegistry.getAll();
  if (customCommands.length > 0) {
    writeStdout("\n" + colors.dim("Custom Commands:") + "\n");
    for (const cmd of customCommands) {
      writeStdout(`  ${colors.cyan(`/${cmd.name}`)} - ${cmd.description}\n`);
    }
  }

  const skills = skillRegistry.getAll();
  if (skills.length > 0) {
    writeStdout("\n" + colors.dim("Available Skills:") + "\n");
    for (const skill of skills) {
      writeStdout(`  ${colors.magenta(skill.name)} - ${skill.description}\n`);
    }
  }

  writeStdout("\n" + colors.dim("Keyboard Shortcuts:") + "\n");
  writeStdout("  Ctrl+C - Cancel current operation\n");
  writeStdout("  Ctrl+D - Exit Claude Code\n");
  writeStdout("  Ctrl+L - Clear screen\n");
  writeStdout("\n");
}

/**
 * Clear conversation
 * @param {REPL} repl - REPL instance
 */
function clearConversation(repl) {
  repl.conversation.clear();
  writeStdout(colors.green("✓ Conversation cleared\n"));
}

/**
 * Compact conversation
 * @param {REPL} repl - REPL instance
 */
async function compactConversation(repl) {
  writeStdout(colors.dim("Compacting conversation...\n"));
  // TODO: Implement conversation compaction
  writeStdout(colors.yellow("Conversation compaction not yet implemented\n"));
}

/**
 * Exit REPL
 * @param {REPL} repl - REPL instance
 */
function exitRepl(repl) {
  repl.stop();
}

/**
 * Show config
 * @param {REPL} repl - REPL instance
 */
function showConfig(repl) {
  writeStdout("\n" + colors.bold("Configuration") + "\n\n");
  writeStdout(`  Model: ${colors.cyan(repl.settings.model)}\n`);
  writeStdout(`  Working Directory: ${colors.cyan(repl.settings.cwd || process.cwd())}\n`);
  writeStdout(`  Max Tokens: ${colors.cyan(repl.settings.maxTokens)}\n`);
  writeStdout("\n");
}

/**
 * Show history
 * @param {REPL} repl - REPL instance
 */
function showHistory(repl) {
  const messages = repl.conversation.getMessages();

  if (messages.length === 0) {
    writeStdout(colors.dim("No messages in history\n"));
    return;
  }

  writeStdout("\n" + colors.bold("Conversation History") + "\n\n");

  for (const msg of messages) {
    const role = msg.type === "user" ? colors.green("You") : colors.blue("Claude");
    const content = typeof msg.content === "string"
      ? msg.content.substring(0, 100) + (msg.content.length > 100 ? "..." : "")
      : "(complex content)";
    writeStdout(`  ${role}: ${content}\n`);
  }

  writeStdout("\n");
}

/**
 * Undo last message
 * @param {REPL} repl - REPL instance
 */
function undoLastMessage(repl) {
  const messages = repl.conversation.getMessages();
  if (messages.length === 0) {
    writeStdout(colors.yellow("No messages to undo\n"));
    return;
  }

  // Remove last two messages (user + assistant)
  const removed = messages.splice(-2);
  repl.conversation.messages = messages;
  writeStdout(colors.green(`✓ Undid ${removed.length} message(s)\n`));
}

/**
 * Show tasks
 * @param {REPL} repl - REPL instance
 */
function showTasks(repl) {
  const { sessionManager } = require("../tools/bash-tool.js");
  const sessions = sessionManager.getActiveSessions();

  if (sessions.length === 0) {
    writeStdout(colors.dim("No background tasks running\n"));
    return;
  }

  writeStdout("\n" + colors.bold("Running Tasks") + "\n\n");

  for (const session of sessions) {
    const duration = Date.now() - session.startTime;
    writeStdout(`  ${colors.cyan(session.id)} - Running for ${Math.round(duration / 1000)}s\n`);
  }

  writeStdout("\n");
}

/**
 * REPL class for interactive mode
 */
export class REPL {
  constructor(options = {}) {
    this.settings = options.settings || {};
    this.args = options.args || {};
    this.conversation = options.conversation || getCurrentConversation({ cwd: this.settings.cwd });
    this.client = null;
    this.rl = null;
    this.isRunning = false;
    this.isProcessing = false;
    this.spinner = null;
  }

  /**
   * Initialize the REPL
   */
  async initialize() {
    // Initialize client
    this.client = getClient({
      apiKey: this.settings.apiKey,
      model: this.args.model || this.settings.model
    });

    // Load custom commands and skills
    slashCommandRegistry.loadUserCommands();
    slashCommandRegistry.loadProjectCommands(this.settings.cwd || process.cwd());
    skillRegistry.loadUserSkills();
    skillRegistry.loadProjectSkills(this.settings.cwd || process.cwd());

    // Create readline interface
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      prompt: colors.claude("> ")
    });

    // Handle line input
    this.rl.on("line", async (line) => {
      await this.handleInput(line);
    });

    // Handle close
    this.rl.on("close", () => {
      this.stop();
    });

    // Handle SIGINT (Ctrl+C)
    this.rl.on("SIGINT", () => {
      if (this.isProcessing) {
        writeStdout("\n" + colors.yellow("Interrupted\n"));
        this.isProcessing = false;
        if (this.spinner) {
          this.spinner.stop();
        }
      } else {
        writeStdout("\n" + colors.dim("Press Ctrl+D to exit\n"));
      }
      this.prompt();
    });

    debug("REPL initialized");
  }

  /**
   * Start the REPL
   */
  async start() {
    this.isRunning = true;
    this.prompt();
  }

  /**
   * Stop the REPL
   */
  stop() {
    if (!this.isRunning) return;

    this.isRunning = false;
    writeStdout("\n" + colors.dim("Goodbye!\n"));

    // Save conversation
    try {
      this.conversation.save();
      debug("Conversation saved");
    } catch (err) {
      debug(`Failed to save conversation: ${err.message}`);
    }

    if (this.rl) {
      this.rl.close();
    }

    process.exit(0);
  }

  /**
   * Show prompt
   */
  prompt() {
    if (this.isRunning && this.rl) {
      this.rl.prompt();
    }
  }

  /**
   * Handle user input
   * @param {string} input - User input
   */
  async handleInput(input) {
    const trimmed = input.trim();

    // Empty input
    if (!trimmed) {
      this.prompt();
      return;
    }

    // Slash command
    if (trimmed.startsWith("/")) {
      await this.handleSlashCommand(trimmed);
      this.prompt();
      return;
    }

    // Regular message
    await this.handleMessage(trimmed);
    this.prompt();
  }

  /**
   * Handle slash command
   * @param {string} input - Command input
   */
  async handleSlashCommand(input) {
    const parts = input.slice(1).split(/\s+/);
    const name = parts[0].toLowerCase();
    const args = parts.slice(1);

    // Check built-in commands first
    const builtin = BUILTIN_COMMANDS[name];
    if (builtin) {
      await builtin.handler(this, args);
      return;
    }

    // Check custom commands
    const custom = slashCommandRegistry.get(name);
    if (custom) {
      const expandedPrompt = custom.prompt.replace(/\$ARGUMENTS/g, args.join(" "));
      await this.handleMessage(expandedPrompt);
      return;
    }

    writeStdout(colors.red(`Unknown command: /${name}\n`));
    writeStdout(colors.dim("Use /help to see available commands\n"));
  }

  /**
   * Handle regular message
   * @param {string} content - Message content
   */
  async handleMessage(content) {
    this.isProcessing = true;

    // Add user message
    this.conversation.addMessage(Message.user(content));

    try {
      // Process the conversation
      await this.processConversation();
    } catch (err) {
      writeStderr(colors.red(`Error: ${err.message}\n`));
      debug(`Error processing message: ${err.stack}`);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process the conversation (send to API and handle response)
   */
  async processConversation() {
    let continueProcessing = true;

    while (continueProcessing) {
      // Show spinner
      this.spinner = createSpinner("Thinking...");
      this.spinner.start();

      try {
        // Send to API
        const response = await this.client.createMessage({
          messages: this.conversation.getAPIMessages(),
          tools: getToolDefinitions(),
          maxTokens: this.args.maxTokens || this.settings.maxTokens
        });

        this.spinner.stop();

        // Handle response
        continueProcessing = await this.handleResponse(response);
      } catch (err) {
        this.spinner.stop();
        throw err;
      }
    }
  }

  /**
   * Handle API response
   * @param {object} response - API response
   * @returns {boolean} Whether to continue processing (for tool use)
   */
  async handleResponse(response) {
    if (!response.content || response.content.length === 0) {
      return false;
    }

    const toolUses = [];

    // Process content blocks
    for (const block of response.content) {
      if (block.type === "text") {
        writeStdout("\n" + block.text + "\n\n");
      } else if (block.type === "tool_use") {
        toolUses.push(block);
      }
    }

    // If no tool uses, we're done
    if (toolUses.length === 0) {
      // Add assistant message
      const textContent = response.content
        .filter(b => b.type === "text")
        .map(b => b.text)
        .join("\n");
      this.conversation.addMessage(Message.assistant(textContent));
      return false;
    }

    // Add assistant message with tool use
    this.conversation.addMessage({
      type: "assistant",
      content: response.content
    });

    // Execute tools
    const toolResults = [];
    for (const toolUse of toolUses) {
      const result = await this.executeToolWithPermission(toolUse);
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: typeof result === "string" ? result : JSON.stringify(result)
      });
    }

    // Add tool results
    this.conversation.addMessage({
      type: "user",
      content: toolResults
    });

    // Continue processing for tool responses
    return response.stop_reason === "tool_use";
  }

  /**
   * Execute a tool with permission checking
   * @param {object} toolUse - Tool use block
   * @returns {Promise<*>} Tool result
   */
  async executeToolWithPermission(toolUse) {
    const { id, name, input } = toolUse;

    debug(`Executing tool: ${name}`);
    writeStdout(colors.dim(`\n[Using ${name}...]\n`));

    // Run pre-hooks
    try {
      const hookResult = await runPreToolHooks(name, input);
      if (hookResult.blocked) {
        writeStdout(colors.yellow(`[${name} blocked: ${hookResult.message}]\n`));
        return { error: hookResult.message };
      }
    } catch (err) {
      debug(`Pre-hook error: ${err.message}`);
    }

    // Check permission
    const permResult = checkPermission(name, input);
    if (permResult.decision === PermissionDecision.DENY) {
      writeStdout(colors.red(`[${name} denied: ${permResult.reason}]\n`));
      return { error: "Permission denied" };
    }

    if (permResult.decision === PermissionDecision.ASK) {
      const granted = await this.askPermission(name, input);
      if (!granted) {
        return { error: "Permission denied by user" };
      }
      grantPermission(name, input, false);
    }

    // Execute the tool
    try {
      const result = await executeTool(name, input, { cwd: this.settings.cwd });

      // Track file reads
      if (name === "Read" && input.file_path) {
        markFileAsRead(input.file_path);
      }

      // Run post-hooks
      try {
        await runPostToolHooks(name, input, result);
      } catch (err) {
        debug(`Post-hook error: ${err.message}`);
      }

      // Display result summary
      if (result.status === "success") {
        const preview = typeof result.data === "string"
          ? result.data.substring(0, 100) + (result.data.length > 100 ? "..." : "")
          : "(result)";
        writeStdout(colors.dim(`[${name} completed: ${preview}]\n`));
      } else {
        writeStdout(colors.yellow(`[${name} warning: ${result.error || "unknown error"}]\n`));
      }

      return result.data || result;
    } catch (err) {
      writeStdout(colors.red(`[${name} error: ${err.message}]\n`));
      return { error: err.message };
    }
  }

  /**
   * Ask user for permission
   * @param {string} toolName - Tool name
   * @param {object} input - Tool input
   * @returns {Promise<boolean>} Whether permission was granted
   */
  async askPermission(toolName, input) {
    const request = formatPermissionRequest(toolName, input);

    writeStdout("\n" + colors.yellow("Permission required: ") + colors.bold(request.description) + "\n");
    for (const detail of request.details) {
      writeStdout(colors.dim(`  ${detail}\n`));
    }

    return new Promise((resolve) => {
      const rl = require("readline").createInterface({
        input: process.stdin,
        output: process.stdout
      });

      rl.question(colors.cyan("Allow? [y/N/always] "), (answer) => {
        rl.close();
        const normalized = answer.trim().toLowerCase();

        if (normalized === "y" || normalized === "yes") {
          resolve(true);
        } else if (normalized === "always" || normalized === "a") {
          grantPermission(toolName, input, true);
          resolve(true);
        } else {
          resolve(false);
        }
      });
    });
  }
}

/**
 * Create and start a REPL
 * @param {object} options - REPL options
 * @returns {Promise<REPL>}
 */
export async function startREPL(options = {}) {
  const repl = new REPL(options);
  await repl.initialize();
  await repl.start();
  return repl;
}

export default {
  REPL,
  startREPL,
  BUILTIN_COMMANDS
};
