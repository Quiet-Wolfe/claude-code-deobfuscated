/**
 * CLI Module Index
 *
 * Main entry point for the Claude Code CLI.
 */

export * from "./args.js";

import { parseArgs, generateHelp, generateVersion } from "./args.js";
import { debug, info, error as logError, writeStdout, writeStderr } from "../utils/logger.js";
import { getSettings } from "../config/settings.js";
import { getClient } from "../api/anthropic-client.js";
import { getToolDefinitions, executeTool, markFileAsRead } from "../tools/index.js";
import { getCurrentConversation, Message, Conversation } from "../services/conversation.js";
import { VERSION, EXIT_CODES } from "../constants/index.js";
import { colors, createSpinner } from "../ui/index.js";

/**
 * Main CLI entry point
 * @param {string[]} argv - Command line arguments
 */
export async function main(argv = process.argv.slice(2)) {
  try {
    // Parse arguments
    const args = parseArgs(argv);

    // Handle help
    if (args.help) {
      writeStdout(generateHelp() + "\n");
      process.exit(EXIT_CODES.SUCCESS);
    }

    // Handle version
    if (args.version) {
      writeStdout(generateVersion() + "\n");
      process.exit(EXIT_CODES.SUCCESS);
    }

    // Load settings
    const settings = getSettings(args.cwd);

    // Apply debug settings
    if (args.debug || settings.debug) {
      process.env.CLAUDE_DEBUG = "1";
    }

    debug(`Claude Code v${VERSION} starting`);
    debug(`Arguments: ${JSON.stringify(args)}`);

    // Get initial prompt from positional args or stdin
    let initialPrompt = args._.join(" ");

    // If no prompt and stdin is not a TTY, read from stdin
    if (!initialPrompt && !process.stdin.isTTY) {
      initialPrompt = await readStdin();
    }

    // Handle print mode
    if (args.print) {
      await runPrintMode(args, settings, initialPrompt);
      return;
    }

    // Handle continue/resume
    if (args.continue || args.resume) {
      await runContinueMode(args, settings, initialPrompt);
      return;
    }

    // Interactive mode
    await runInteractiveMode(args, settings, initialPrompt);
  } catch (err) {
    logError(err);
    process.exit(EXIT_CODES.ERROR);
  }
}

/**
 * Read from stdin
 * @returns {Promise<string>}
 */
async function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");

    process.stdin.on("data", (chunk) => {
      data += chunk;
    });

    process.stdin.on("end", () => {
      resolve(data.trim());
    });

    // Handle case where stdin is empty
    setTimeout(() => {
      if (!data) {
        resolve("");
      }
    }, 100);
  });
}

/**
 * Run in print mode (non-interactive)
 * @param {object} args - Parsed arguments
 * @param {object} settings - Settings
 * @param {string} prompt - Initial prompt
 */
async function runPrintMode(args, settings, prompt) {
  if (!prompt) {
    writeStderr("Error: No prompt provided for print mode\n");
    process.exit(EXIT_CODES.INVALID_ARGS);
  }

  debug("Running in print mode");

  const client = getClient({
    apiKey: settings.apiKey,
    model: args.model || settings.model
  });

  const conversation = getCurrentConversation({ cwd: args.cwd });
  conversation.addMessage(Message.user(prompt));

  try {
    const response = await client.createMessage({
      messages: conversation.getAPIMessages(),
      tools: getToolDefinitions(),
      maxTokens: args.maxTokens || settings.maxTokens
    });

    // Handle response
    if (response.content) {
      for (const block of response.content) {
        if (block.type === "text") {
          writeStdout(block.text);
        } else if (block.type === "tool_use") {
          // Execute tool
          const result = await executeTool(block.name, block.input, { cwd: args.cwd });
          debug(`Tool ${block.name} result: ${JSON.stringify(result)}`);
        }
      }
    }

    if (response.stop_reason === "end_turn") {
      writeStdout("\n");
    }
  } catch (err) {
    writeStderr(`Error: ${err.message}\n`);
    process.exit(EXIT_CODES.ERROR);
  }
}

/**
 * Run in continue/resume mode
 * @param {object} args - Parsed arguments
 * @param {object} settings - Settings
 * @param {string} prompt - Additional prompt
 */
async function runContinueMode(args, settings, prompt) {
  debug("Running in continue mode");

  let conversation;

  if (args.resume) {
    // Resume specific session
    conversation = Conversation.load(args.resume);
    if (!conversation) {
      writeStderr(`Error: Session not found: ${args.resume}\n`);
      process.exit(EXIT_CODES.ERROR);
    }
  } else {
    // Continue most recent
    conversation = Conversation.getMostRecent();
    if (!conversation) {
      writeStderr("Error: No previous conversation found\n");
      process.exit(EXIT_CODES.ERROR);
    }
  }

  debug(`Resuming session: ${conversation.sessionId}`);

  // Add new prompt if provided
  if (prompt) {
    conversation.addMessage(Message.user(prompt));
  }

  // TODO: Continue conversation...
  writeStdout(`Resumed session ${conversation.sessionId}\n`);
}

/**
 * Run in interactive mode
 * @param {object} args - Parsed arguments
 * @param {object} settings - Settings
 * @param {string} initialPrompt - Initial prompt
 */
async function runInteractiveMode(args, settings, initialPrompt) {
  debug("Running in interactive mode");

  // Print welcome message
  writeStdout(`\n${colors.claude("Claude Code")} v${VERSION}\n`);
  writeStdout(colors.dim("Type your message or /help for commands\n\n"));

  const conversation = getCurrentConversation({ cwd: args.cwd });

  // Handle initial prompt
  if (initialPrompt) {
    conversation.addMessage(Message.user(initialPrompt));
    // TODO: Process initial prompt
  }

  // TODO: Start interactive loop
  // This would involve:
  // 1. Reading user input (using readline or similar)
  // 2. Sending messages to the API
  // 3. Handling tool use
  // 4. Displaying responses
  // 5. Handling slash commands

  writeStdout(colors.dim("Interactive mode not fully implemented in deobfuscated version.\n"));
  writeStdout(colors.dim("See the original cli.js for full functionality.\n"));
}

export default {
  main,
  runPrintMode,
  runContinueMode,
  runInteractiveMode
};
