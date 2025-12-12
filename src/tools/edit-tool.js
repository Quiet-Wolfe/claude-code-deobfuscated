/**
 * Edit Tool
 *
 * Performs exact string replacements in files.
 * Supports single replacements and replace-all operations.
 */

import { readFileSync, writeFileSync, existsSync } from "../utils/fs-utils.js";
import { BaseTool, ToolResultStatus } from "./base-tool.js";
import { debug } from "../utils/logger.js";

/**
 * Edit Tool Implementation
 */
export class EditTool extends BaseTool {
  constructor() {
    super({
      name: "Edit",
      description: `Performs exact string replacements in files.

Usage:
- You must use your Read tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file.
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if old_string is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use replace_all to change every instance of old_string.
- Use replace_all for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.`,
      inputSchema: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "The absolute path to the file to modify"
          },
          old_string: {
            type: "string",
            description: "The text to replace"
          },
          new_string: {
            type: "string",
            description: "The text to replace it with (must be different from old_string)"
          },
          replace_all: {
            type: "boolean",
            description: "Replace all occurrences of old_string (default false)",
            default: false
          }
        },
        required: ["file_path", "old_string", "new_string"]
      },
      requiresPermission: true
    });

    // Track files that have been read
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
   * Count occurrences of a string in content
   * @param {string} content - Content to search
   * @param {string} searchString - String to find
   * @returns {number} Number of occurrences
   */
  countOccurrences(content, searchString) {
    let count = 0;
    let pos = 0;
    while ((pos = content.indexOf(searchString, pos)) !== -1) {
      count++;
      pos += searchString.length;
    }
    return count;
  }

  /**
   * Execute the edit operation
   * @param {object} input - Tool input
   * @param {object} context - Execution context
   * @returns {Promise<object>} Tool result
   */
  async execute(input, context = {}) {
    const { file_path, old_string, new_string, replace_all = false } = input;

    debug(`Edit tool executing for: ${file_path}`);

    // Validate path is absolute
    if (!file_path.startsWith("/") && !file_path.match(/^[A-Za-z]:\\/)) {
      return this.error("file_path must be an absolute path");
    }

    // Check if file exists
    if (!existsSync(file_path)) {
      return this.error(`File not found: ${file_path}`);
    }

    // Check if file was read first
    if (!this.hasBeenRead(file_path) && !context.skipReadCheck) {
      return this.error(
        `You must read the file before editing it. ` +
        `Please use the Read tool to read ${file_path} first.`
      );
    }

    // Validate old_string and new_string are different
    if (old_string === new_string) {
      return this.error("old_string and new_string must be different");
    }

    // Validate old_string is not empty
    if (old_string.length === 0) {
      return this.error("old_string cannot be empty");
    }

    try {
      // Read current file content
      const content = readFileSync(file_path, { encoding: "utf8" });

      // Check if old_string exists in file
      const occurrences = this.countOccurrences(content, old_string);

      if (occurrences === 0) {
        return this.error(
          `old_string not found in file. Make sure you're using the exact text ` +
          `from the file, including whitespace and indentation.`
        );
      }

      // If not replace_all and multiple occurrences, require more context
      if (!replace_all && occurrences > 1) {
        return this.error(
          `old_string appears ${occurrences} times in the file. ` +
          `Either provide more context to make it unique, or set replace_all to true ` +
          `to replace all occurrences.`
        );
      }

      // Perform replacement
      let newContent;
      let replacedCount;

      if (replace_all) {
        newContent = content.split(old_string).join(new_string);
        replacedCount = occurrences;
      } else {
        // Replace only first occurrence
        const index = content.indexOf(old_string);
        newContent = content.substring(0, index) + new_string + content.substring(index + old_string.length);
        replacedCount = 1;
      }

      // Write updated content
      writeFileSync(file_path, newContent, { encoding: "utf8" });

      debug(`Edit tool replaced ${replacedCount} occurrence(s) in: ${file_path}`);

      return this.success({
        path: file_path,
        replacements: replacedCount,
        oldLength: old_string.length,
        newLength: new_string.length
      });
    } catch (err) {
      debug(`Edit tool error: ${err.message}`);

      if (err.code === "EACCES") {
        return this.permissionDenied(`Permission denied: ${file_path}`);
      }

      return this.error(`Failed to edit file: ${err.message}`);
    }
  }
}

// Export singleton instance
export const editTool = new EditTool();

export default EditTool;
