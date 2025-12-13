/**
 * BashOutput Tool
 *
 * Retrieves output from a running or completed background bash shell.
 */

import { BaseTool } from "./base-tool.js";
import { sessionManager } from "./bash-tool.js";
import { debug } from "../utils/logger.js";

/**
 * BashOutput Tool Implementation
 */
export class BashOutputTool extends BaseTool {
  constructor() {
    super({
      name: "BashOutput",
      description: `Retrieves output from a running or completed background bash shell.

- Takes a shell_id parameter identifying the shell
- Always returns only new output since the last check
- Returns stdout and stderr output along with shell status
- Supports optional regex filtering to show only lines matching a pattern
- Use this tool when you need to monitor or check the output of a long-running shell
- Shell IDs can be found using the /tasks command`,
      inputSchema: {
        type: "object",
        properties: {
          bash_id: {
            type: "string",
            description: "The ID of the background shell to retrieve output from"
          },
          filter: {
            type: "string",
            description: "Optional regular expression to filter the output lines. Only lines matching this regex will be included in the result."
          }
        },
        required: ["bash_id"]
      },
      requiresPermission: false
    });

    // Track last read position for each session
    this.readPositions = new Map();
  }

  /**
   * Execute the bash output retrieval
   * @param {object} input - Tool input
   * @param {object} context - Execution context
   * @returns {Promise<object>} Tool result
   */
  async execute(input, context = {}) {
    const { bash_id, filter } = input;

    debug(`BashOutput tool retrieving output for: ${bash_id}`);

    // Get the session
    const session = sessionManager.getSession(bash_id);
    if (!session) {
      return this.error(`No shell session found with ID: ${bash_id}`);
    }

    // Get last read position for this session
    const lastPosition = this.readPositions.get(bash_id) || 0;
    const newOutput = session.output.slice(lastPosition);

    // Update read position
    this.readPositions.set(bash_id, session.output.length);

    // Combine output
    let stdout = "";
    let stderr = "";

    for (const entry of newOutput) {
      if (entry.type === "stdout") {
        stdout += entry.data;
      } else if (entry.type === "stderr") {
        stderr += entry.data;
      }
    }

    // Apply filter if provided
    if (filter) {
      try {
        const regex = new RegExp(filter);
        const filterLines = (text) => {
          return text.split("\n")
            .filter(line => regex.test(line))
            .join("\n");
        };
        stdout = filterLines(stdout);
        stderr = filterLines(stderr);
      } catch (err) {
        return this.error(`Invalid regex filter: ${err.message}`);
      }
    }

    // Build status info
    const status = {
      isRunning: session.isRunning,
      sessionId: session.id,
      startTime: session.startTime,
      endTime: session.endTime,
      exitCode: session.exitCode
    };

    // Build output text
    let output = "";
    if (stdout) {
      output += stdout;
    }
    if (stderr) {
      if (output) output += "\n";
      output += stderr;
    }

    if (!output && !session.isRunning) {
      output = "(no new output)";
    } else if (!output && session.isRunning) {
      output = "(no new output yet, command still running)";
    }

    return this.success({
      output,
      status: session.isRunning ? "running" : "completed",
      exitCode: session.exitCode,
      ...status
    });
  }
}

// Export singleton instance
export const bashOutputTool = new BashOutputTool();

export default BashOutputTool;
