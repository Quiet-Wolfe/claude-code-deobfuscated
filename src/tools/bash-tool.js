/**
 * Bash Tool
 *
 * Executes bash commands in a persistent shell session.
 * Supports timeouts, background execution, and output streaming.
 */

import { spawn } from "child_process";
import { BaseTool, ToolResultStatus } from "./base-tool.js";
import { debug } from "../utils/logger.js";
import { getCwd } from "../utils/fs-utils.js";

// Maximum timeout (10 minutes)
const MAX_TIMEOUT = 600000;
const DEFAULT_TIMEOUT = 120000;
const MAX_OUTPUT_LENGTH = 30000;

/**
 * Shell session manager for persistent shell sessions
 */
class ShellSessionManager {
  constructor() {
    this.sessions = new Map();
    this.nextId = 1;
  }

  /**
   * Create a new shell session
   * @param {object} options - Session options
   * @returns {object} Session info
   */
  createSession(options = {}) {
    const id = `shell_${this.nextId++}`;
    const cwd = options.cwd || getCwd();

    const session = {
      id,
      cwd,
      process: null,
      output: [],
      isRunning: false,
      startTime: null,
      endTime: null
    };

    this.sessions.set(id, session);
    return session;
  }

  /**
   * Get a session by ID
   * @param {string} id - Session ID
   * @returns {object|undefined}
   */
  getSession(id) {
    return this.sessions.get(id);
  }

  /**
   * Kill a session
   * @param {string} id - Session ID
   */
  killSession(id) {
    const session = this.sessions.get(id);
    if (session?.process) {
      session.process.kill("SIGTERM");
      setTimeout(() => {
        if (session.process && !session.process.killed) {
          session.process.kill("SIGKILL");
        }
      }, 5000);
    }
    this.sessions.delete(id);
  }

  /**
   * Get all active sessions
   * @returns {object[]}
   */
  getActiveSessions() {
    return Array.from(this.sessions.values()).filter((s) => s.isRunning);
  }
}

// Global session manager
export const sessionManager = new ShellSessionManager();

/**
 * Bash Tool Implementation
 */
export class BashTool extends BaseTool {
  constructor() {
    super({
      name: "Bash",
      description: `Executes a given bash command in a persistent shell session with optional timeout, ensuring proper handling and security measures.

IMPORTANT: This tool is for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files) - use the specialized tools for this instead.

Before executing the command, please follow these steps:

1. Directory Verification:
   - If the command will create new directories or files, first use ls to verify the parent directory exists and is the correct location
   - For example, before running "mkdir foo/bar", first use ls foo to check that "foo" exists and is the intended parent directory

2. Command Execution:
   - Always quote file paths that contain spaces with double quotes (e.g., cd "path with spaces/file.txt")
   - After ensuring proper quoting, execute the command.
   - Capture the output of the command.

Usage notes:
  - The command argument is required.
  - You can specify an optional timeout in milliseconds (up to 600000ms / 10 minutes). If not specified, commands will timeout after 120000ms (2 minutes).
  - If the output exceeds 30000 characters, output will be truncated before being returned to you.
  - You can use the run_in_background parameter to run the command in the background.`,
      inputSchema: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The command to execute"
          },
          description: {
            type: "string",
            description: "Clear, concise description of what this command does in 5-10 words"
          },
          timeout: {
            type: "number",
            description: "Optional timeout in milliseconds (max 600000)"
          },
          run_in_background: {
            type: "boolean",
            description: "Set to true to run this command in the background"
          }
        },
        required: ["command"]
      },
      requiresPermission: true
    });
  }

  /**
   * Truncate output if too long
   * @param {string} output - Command output
   * @returns {string} Possibly truncated output
   */
  truncateOutput(output) {
    if (output.length <= MAX_OUTPUT_LENGTH) {
      return output;
    }

    const truncated = output.substring(0, MAX_OUTPUT_LENGTH);
    const remaining = output.length - MAX_OUTPUT_LENGTH;
    return `${truncated}\n\n... [${remaining} characters truncated] ...`;
  }

  /**
   * Execute a command
   * @param {string} command - Command to execute
   * @param {object} options - Execution options
   * @returns {Promise<object>} Execution result
   */
  executeCommand(command, options = {}) {
    return new Promise((resolve, reject) => {
      const timeout = Math.min(options.timeout || DEFAULT_TIMEOUT, MAX_TIMEOUT);
      const cwd = options.cwd || getCwd();

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const proc = spawn("bash", ["-c", command], {
        cwd,
        env: { ...process.env, TERM: "dumb" },
        shell: false
      });

      const timeoutId = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) {
            proc.kill("SIGKILL");
          }
        }, 5000);
      }, timeout);

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        clearTimeout(timeoutId);

        if (timedOut) {
          resolve({
            timedOut: true,
            stdout: this.truncateOutput(stdout),
            stderr: this.truncateOutput(stderr),
            code: null
          });
        } else {
          resolve({
            timedOut: false,
            stdout: this.truncateOutput(stdout),
            stderr: this.truncateOutput(stderr),
            code
          });
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timeoutId);
        reject(err);
      });
    });
  }

  /**
   * Execute a command in the background
   * @param {string} command - Command to execute
   * @param {object} options - Execution options
   * @returns {object} Session info
   */
  executeBackground(command, options = {}) {
    const session = sessionManager.createSession({ cwd: options.cwd });

    const proc = spawn("bash", ["-c", command], {
      cwd: session.cwd,
      env: { ...process.env, TERM: "dumb" },
      shell: false,
      detached: true
    });

    session.process = proc;
    session.isRunning = true;
    session.startTime = Date.now();

    proc.stdout.on("data", (data) => {
      session.output.push({ type: "stdout", data: data.toString(), time: Date.now() });
    });

    proc.stderr.on("data", (data) => {
      session.output.push({ type: "stderr", data: data.toString(), time: Date.now() });
    });

    proc.on("close", (code) => {
      session.isRunning = false;
      session.endTime = Date.now();
      session.exitCode = code;
    });

    return session;
  }

  /**
   * Execute the bash operation
   * @param {object} input - Tool input
   * @param {object} context - Execution context
   * @returns {Promise<object>} Tool result
   */
  async execute(input, context = {}) {
    const { command, description, timeout, run_in_background } = input;

    debug(`Bash tool executing: ${command}`);

    // Validate command
    if (!command || command.trim().length === 0) {
      return this.error("Command cannot be empty");
    }

    // Check for dangerous commands (basic safety check)
    const dangerousPatterns = [
      /rm\s+-rf\s+\/(?!\w)/,  // rm -rf /
      /:(){ :\|:& };:/,       // Fork bomb
      /mkfs\./,               // Format filesystem
      /dd\s+.*of=\/dev\//     // Write to device
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        return this.error("Command blocked for safety reasons");
      }
    }

    try {
      // Background execution
      if (run_in_background) {
        const session = this.executeBackground(command, { cwd: context.cwd });
        return this.success({
          background: true,
          sessionId: session.id,
          message: `Command started in background. Use BashOutput tool with session ID "${session.id}" to check output.`
        });
      }

      // Foreground execution
      const result = await this.executeCommand(command, {
        timeout,
        cwd: context.cwd
      });

      if (result.timedOut) {
        return {
          status: ToolResultStatus.TIMEOUT,
          error: `Command timed out after ${timeout || DEFAULT_TIMEOUT}ms`,
          data: {
            stdout: result.stdout,
            stderr: result.stderr
          }
        };
      }

      // Combine stdout and stderr for output
      let output = "";
      if (result.stdout) {
        output += result.stdout;
      }
      if (result.stderr) {
        if (output) output += "\n";
        output += result.stderr;
      }

      if (result.code !== 0) {
        return this.error(output || `Command exited with code ${result.code}`, {
          exitCode: result.code
        });
      }

      return this.success(output || "(no output)", {
        exitCode: result.code
      });
    } catch (err) {
      debug(`Bash tool error: ${err.message}`);
      return this.error(`Failed to execute command: ${err.message}`);
    }
  }
}

// Export singleton instance
export const bashTool = new BashTool();

export default BashTool;
