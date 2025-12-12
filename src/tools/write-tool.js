/**
 * Write Tool
 *
 * Writes files to the local filesystem with support for:
 * - Creating new files
 * - Overwriting existing files
 * - Directory creation
 * - Permission handling
 */

import { writeFileSync, existsSync, ensureDirSync, isDirectorySync } from "../utils/fs-utils.js";
import { BaseTool, ToolResultStatus } from "./base-tool.js";
import { FILE_LIMITS } from "../constants/index.js";
import { debug } from "../utils/logger.js";
import { dirname } from "path";

/**
 * Write Tool Implementation
 */
export class WriteTool extends BaseTool {
  constructor() {
    super({
      name: "Write",
      description: `Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.`,
      inputSchema: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "The absolute path to the file to write (must be absolute, not relative)"
          },
          content: {
            type: "string",
            description: "The content to write to the file"
          }
        },
        required: ["file_path", "content"]
      },
      requiresPermission: true
    });

    // Track files that have been read (for validation)
    this.readFiles = new Set();
  }

  /**
   * Mark a file as having been read
   * @param {string} filePath - File path
   */
  markAsRead(filePath) {
    this.readFiles.add(filePath);
  }

  /**
   * Check if a file has been read
   * @param {string} filePath - File path
   * @returns {boolean}
   */
  hasBeenRead(filePath) {
    return this.readFiles.has(filePath);
  }

  /**
   * Clear the read files tracking
   */
  clearReadTracking() {
    this.readFiles.clear();
  }

  /**
   * Execute the write operation
   * @param {object} input - Tool input
   * @param {object} context - Execution context
   * @returns {Promise<object>} Tool result
   */
  async execute(input, context = {}) {
    const { file_path, content } = input;

    debug(`Write tool executing for: ${file_path}`);

    // Validate path is absolute
    if (!file_path.startsWith("/") && !file_path.match(/^[A-Za-z]:\\/)) {
      return this.error("file_path must be an absolute path");
    }

    // Check content size
    const contentSize = Buffer.byteLength(content, "utf8");
    if (contentSize > FILE_LIMITS.MAX_WRITE_SIZE) {
      return this.error(
        `Content size (${(contentSize / 1024 / 1024).toFixed(1)}MB) exceeds maximum allowed size ` +
        `(${FILE_LIMITS.MAX_WRITE_SIZE / 1024 / 1024}MB)`
      );
    }

    // Check if file exists and whether it was read first
    const fileExists = existsSync(file_path);
    if (fileExists && !this.hasBeenRead(file_path) && !context.skipReadCheck) {
      return this.error(
        `Cannot overwrite existing file without reading it first. ` +
        `Please use the Read tool to read ${file_path} before attempting to write to it.`
      );
    }

    // Check if path is a directory
    if (fileExists && isDirectorySync(file_path)) {
      return this.error(`Cannot write to directory: ${file_path}`);
    }

    try {
      // Ensure parent directory exists
      const parentDir = dirname(file_path);
      if (!existsSync(parentDir)) {
        debug(`Creating parent directory: ${parentDir}`);
        ensureDirSync(parentDir);
      }

      // Write the file
      writeFileSync(file_path, content, {
        encoding: "utf8",
        mode: 0o644 // rw-r--r--
      });

      const action = fileExists ? "updated" : "created";
      const lineCount = content.split("\n").length;

      debug(`Write tool ${action} file: ${file_path} (${lineCount} lines)`);

      return this.success({
        path: file_path,
        action,
        size: contentSize,
        lines: lineCount
      });
    } catch (err) {
      debug(`Write tool error: ${err.message}`);

      // Handle common errors
      if (err.code === "EACCES") {
        return this.permissionDenied(`Permission denied: ${file_path}`);
      }
      if (err.code === "ENOSPC") {
        return this.error("No space left on device");
      }
      if (err.code === "EROFS") {
        return this.error("Read-only file system");
      }

      return this.error(`Failed to write file: ${err.message}`);
    }
  }
}

// Export singleton instance
export const writeTool = new WriteTool();

export default WriteTool;
