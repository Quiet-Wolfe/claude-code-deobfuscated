/**
 * KillShell Tool
 *
 * Kills a running background bash shell by its ID.
 */

import { BaseTool } from "./base-tool.js";
import { sessionManager } from "./bash-tool.js";
import { debug } from "../utils/logger.js";

/**
 * KillShell Tool Implementation
 */
export class KillShellTool extends BaseTool {
  constructor() {
    super({
      name: "KillShell",
      description: `Kills a running background bash shell by its ID.

- Takes a shell_id parameter identifying the shell to kill
- Returns a success or failure status
- Use this tool when you need to terminate a long-running shell
- Shell IDs can be found using the /tasks command`,
      inputSchema: {
        type: "object",
        properties: {
          shell_id: {
            type: "string",
            description: "The ID of the background shell to kill"
          }
        },
        required: ["shell_id"]
      },
      requiresPermission: true
    });
  }

  /**
   * Execute the shell kill operation
   * @param {object} input - Tool input
   * @param {object} context - Execution context
   * @returns {Promise<object>} Tool result
   */
  async execute(input, context = {}) {
    const { shell_id } = input;

    debug(`KillShell tool killing session: ${shell_id}`);

    // Get the session
    const session = sessionManager.getSession(shell_id);
    if (!session) {
      return this.error(`No shell session found with ID: ${shell_id}`);
    }

    // Check if already stopped
    if (!session.isRunning) {
      return this.success({
        message: `Shell ${shell_id} was already stopped`,
        wasRunning: false,
        exitCode: session.exitCode
      });
    }

    try {
      // Kill the session
      sessionManager.killSession(shell_id);

      return this.success({
        message: `Successfully killed shell ${shell_id}`,
        wasRunning: true
      });
    } catch (err) {
      debug(`KillShell tool error: ${err.message}`);
      return this.error(`Failed to kill shell: ${err.message}`);
    }
  }
}

// Export singleton instance
export const killShellTool = new KillShellTool();

export default KillShellTool;
