/**
 * MultiEdit Tool
 *
 * Performs multiple edits in a single file atomically.
 * All edits succeed or all fail together.
 */

import { readFileSync, writeFileSync, existsSync } from "../utils/fs-utils.js";
import { BaseTool } from "./base-tool.js";
import { debug } from "../utils/logger.js";

/**
 * MultiEdit Tool Implementation
 */
export class MultiEditTool extends BaseTool {
  constructor() {
    super({
      name: "MultiEdit",
      description: `Performs multiple exact string replacements in a single file atomically.

All edits are applied together - if any edit fails, none are applied.
This is useful when you need to make several related changes to a file.

Usage:
- You must read the file before editing (same as Edit tool)
- Each edit specifies old_string and new_string
- Edits are applied in order from the array
- If old_string is not found or not unique (and replace_all is false), the operation fails
- Use this instead of multiple Edit calls when changes are related`,
      inputSchema: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "The absolute path to the file to modify"
          },
          edits: {
            type: "array",
            description: "Array of edits to apply",
            items: {
              type: "object",
              properties: {
                old_string: {
                  type: "string",
                  description: "The text to replace"
                },
                new_string: {
                  type: "string",
                  description: "The text to replace it with"
                },
                replace_all: {
                  type: "boolean",
                  description: "Replace all occurrences (default: false)"
                }
              },
              required: ["old_string", "new_string"]
            }
          }
        },
        required: ["file_path", "edits"]
      },
      requiresPermission: true
    });

    // Track read files
    this.readFiles = new Set();
  }

  /**
   * Mark a file as read
   * @param {string} path - File path
   */
  markAsRead(path) {
    this.readFiles.add(path);
  }

  /**
   * Check if file was read
   * @param {string} path - File path
   * @returns {boolean}
   */
  hasBeenRead(path) {
    return this.readFiles.has(path);
  }

  /**
   * Count occurrences of a string
   * @param {string} content - Content to search
   * @param {string} search - String to find
   * @returns {number}
   */
  countOccurrences(content, search) {
    let count = 0;
    let pos = 0;
    while ((pos = content.indexOf(search, pos)) !== -1) {
      count++;
      pos += search.length;
    }
    return count;
  }

  /**
   * Validate all edits can be applied
   * @param {string} content - File content
   * @param {object[]} edits - Edits to validate
   * @returns {object} Validation result
   */
  validateEdits(content, edits) {
    const errors = [];
    let workingContent = content;

    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i];

      if (!edit.old_string) {
        errors.push(`Edit ${i + 1}: old_string cannot be empty`);
        continue;
      }

      if (edit.old_string === edit.new_string) {
        errors.push(`Edit ${i + 1}: old_string and new_string are identical`);
        continue;
      }

      const occurrences = this.countOccurrences(workingContent, edit.old_string);

      if (occurrences === 0) {
        errors.push(`Edit ${i + 1}: old_string not found in file`);
        continue;
      }

      if (!edit.replace_all && occurrences > 1) {
        errors.push(
          `Edit ${i + 1}: old_string appears ${occurrences} times. ` +
          `Use replace_all: true or provide more context.`
        );
        continue;
      }

      // Apply edit to working content for subsequent validation
      if (edit.replace_all) {
        workingContent = workingContent.split(edit.old_string).join(edit.new_string);
      } else {
        const index = workingContent.indexOf(edit.old_string);
        workingContent =
          workingContent.substring(0, index) +
          edit.new_string +
          workingContent.substring(index + edit.old_string.length);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      resultContent: workingContent
    };
  }

  /**
   * Execute the multi-edit operation
   * @param {object} input - Tool input
   * @param {object} context - Execution context
   * @returns {Promise<object>} Tool result
   */
  async execute(input, context = {}) {
    const { file_path, edits } = input;

    debug(`MultiEdit: ${edits.length} edits to ${file_path}`);

    // Validate path
    if (!file_path.startsWith("/") && !file_path.match(/^[A-Za-z]:\\/)) {
      return this.error("file_path must be an absolute path");
    }

    // Check file exists
    if (!existsSync(file_path)) {
      return this.error(`File not found: ${file_path}`);
    }

    // Check if read first
    if (!this.hasBeenRead(file_path) && !context.skipReadCheck) {
      return this.error(
        "You must read the file before editing it. " +
        `Please use the Read tool to read ${file_path} first.`
      );
    }

    // Validate edits array
    if (!Array.isArray(edits) || edits.length === 0) {
      return this.error("edits must be a non-empty array");
    }

    try {
      // Read current content
      const content = readFileSync(file_path, { encoding: "utf8" });

      // Validate all edits
      const validation = this.validateEdits(content, edits);

      if (!validation.valid) {
        return this.error(
          `Validation failed:\n${validation.errors.map((e) => `  - ${e}`).join('\n')}`
        );
      }

      // Apply edits (validation already computed the result)
      writeFileSync(file_path, validation.resultContent, { encoding: "utf8" });

      // Count total replacements
      let totalReplacements = 0;
      let testContent = content;
      for (const edit of edits) {
        const count = this.countOccurrences(testContent, edit.old_string);
        totalReplacements += edit.replace_all ? count : 1;
        if (edit.replace_all) {
          testContent = testContent.split(edit.old_string).join(edit.new_string);
        } else {
          const idx = testContent.indexOf(edit.old_string);
          testContent =
            testContent.substring(0, idx) +
            edit.new_string +
            testContent.substring(idx + edit.old_string.length);
        }
      }

      debug(`MultiEdit: Applied ${edits.length} edits, ${totalReplacements} total replacements`);

      return this.success({
        path: file_path,
        editsApplied: edits.length,
        totalReplacements
      });
    } catch (err) {
      debug(`MultiEdit error: ${err.message}`);

      if (err.code === "EACCES") {
        return this.permissionDenied(`Permission denied: ${file_path}`);
      }

      return this.error(`Failed to edit file: ${err.message}`);
    }
  }
}

// Export singleton instance
export const multiEditTool = new MultiEditTool();

export default MultiEditTool;
