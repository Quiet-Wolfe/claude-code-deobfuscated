/**
 * Read Tool
 *
 * Reads files from the local filesystem with support for:
 * - Text files with line numbers
 * - Binary files (images, PDFs)
 * - Partial file reading (offset/limit)
 * - Large file handling
 */

import { readFileSync, existsSync, statSync, isDirectorySync } from "../utils/fs-utils.js";
import { BaseTool, ToolResultStatus } from "./base-tool.js";
import { FILE_LIMITS } from "../constants/index.js";
import { debug } from "../utils/logger.js";
import { extname } from "path";

// File extensions that should be treated as binary
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".ico", ".svg",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".zip", ".tar", ".gz", ".rar", ".7z",
  ".exe", ".dll", ".so", ".dylib",
  ".mp3", ".mp4", ".wav", ".avi", ".mov", ".mkv",
  ".wasm", ".node"
]);

// File extensions that are images (for special handling)
const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".ico", ".svg"
]);

/**
 * Read Tool Implementation
 */
export class ReadTool extends BaseTool {
  constructor() {
    super({
      name: "Read",
      description: `Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to ${FILE_LIMITS.DEFAULT_READ_LINES} lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- Any lines longer than ${FILE_LIMITS.MAX_LINE_LENGTH} characters will be truncated
- Results are returned using cat -n format, with line numbers starting at 1
- This tool allows Claude Code to read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually as Claude Code is a multimodal LLM.
- This tool can read PDF files (.pdf). PDFs are processed page by page, extracting both text and visual content for analysis.
- This tool can read Jupyter notebooks (.ipynb files) and returns all cells with their outputs, combining code, text, and visualizations.
- This tool can only read files, not directories. To read a directory, use an ls command via the Bash tool.
- You can call multiple tools in a single response. It is always better to speculatively read multiple potentially useful files in parallel.
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot, ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.`,
      inputSchema: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "The absolute path to the file to read"
          },
          offset: {
            type: "number",
            description: "The line number to start reading from. Only provide if the file is too large to read at once"
          },
          limit: {
            type: "number",
            description: "The number of lines to read. Only provide if the file is too large to read at once."
          }
        },
        required: ["file_path"]
      },
      requiresPermission: false
    });
  }

  /**
   * Check if file is binary based on extension
   * @param {string} filePath - File path
   * @returns {boolean}
   */
  isBinaryFile(filePath) {
    const ext = extname(filePath).toLowerCase();
    return BINARY_EXTENSIONS.has(ext);
  }

  /**
   * Check if file is an image
   * @param {string} filePath - File path
   * @returns {boolean}
   */
  isImageFile(filePath) {
    const ext = extname(filePath).toLowerCase();
    return IMAGE_EXTENSIONS.has(ext);
  }

  /**
   * Format text content with line numbers
   * @param {string} content - File content
   * @param {number} offset - Starting line number (1-indexed)
   * @param {number} limit - Maximum lines to include
   * @returns {string} Formatted content with line numbers
   */
  formatWithLineNumbers(content, offset = 1, limit = FILE_LIMITS.DEFAULT_READ_LINES) {
    const lines = content.split("\n");
    const startIndex = Math.max(0, offset - 1);
    const endIndex = Math.min(lines.length, startIndex + limit);

    const formattedLines = [];
    const maxLineNumWidth = String(endIndex).length;

    for (let i = startIndex; i < endIndex; i++) {
      const lineNum = i + 1;
      const padding = " ".repeat(maxLineNumWidth - String(lineNum).length);
      let line = lines[i];

      // Truncate long lines
      if (line.length > FILE_LIMITS.MAX_LINE_LENGTH) {
        line = line.substring(0, FILE_LIMITS.MAX_LINE_LENGTH) + "... [truncated]";
      }

      formattedLines.push(`${padding}${lineNum}\t${line}`);
    }

    return formattedLines.join("\n");
  }

  /**
   * Execute the read operation
   * @param {object} input - Tool input
   * @param {object} context - Execution context
   * @returns {Promise<object>} Tool result
   */
  async execute(input, context = {}) {
    const { file_path, offset, limit } = input;

    debug(`Read tool executing for: ${file_path}`);

    // Validate path is absolute
    if (!file_path.startsWith("/") && !file_path.match(/^[A-Za-z]:\\/)) {
      return this.error("file_path must be an absolute path");
    }

    // Check if file exists
    if (!existsSync(file_path)) {
      return this.error(`File not found: ${file_path}`);
    }

    // Check if it's a directory
    if (isDirectorySync(file_path)) {
      return this.error(
        `Cannot read directory: ${file_path}. Use the Bash tool with 'ls' to list directory contents.`
      );
    }

    try {
      const stats = statSync(file_path);
      const fileSize = stats.size;

      // Handle image files
      if (this.isImageFile(file_path)) {
        const imageData = readFileSync(file_path);
        const base64 = Buffer.from(imageData).toString("base64");
        const ext = extname(file_path).toLowerCase().slice(1);
        const mimeType = ext === "svg" ? "image/svg+xml" : `image/${ext === "jpg" ? "jpeg" : ext}`;

        return this.success({
          type: "image",
          mediaType: mimeType,
          data: base64
        });
      }

      // Handle PDF files
      if (extname(file_path).toLowerCase() === ".pdf") {
        // Return indication that this is a PDF - actual PDF processing
        // would require additional libraries
        return this.success({
          type: "pdf",
          path: file_path,
          size: fileSize,
          message: "PDF file detected. Content extraction requires PDF processing."
        });
      }

      // Handle Jupyter notebooks
      if (extname(file_path).toLowerCase() === ".ipynb") {
        const content = readFileSync(file_path, { encoding: "utf8" });
        try {
          const notebook = JSON.parse(content);
          return this.success({
            type: "notebook",
            cells: notebook.cells || [],
            metadata: notebook.metadata || {}
          });
        } catch (parseError) {
          return this.error(`Failed to parse Jupyter notebook: ${parseError.message}`);
        }
      }

      // Handle binary files
      if (this.isBinaryFile(file_path)) {
        return this.success({
          type: "binary",
          path: file_path,
          size: fileSize,
          message: `Binary file (${fileSize} bytes). Cannot display content.`
        });
      }

      // Check file size
      if (fileSize > FILE_LIMITS.MAX_READ_SIZE && !offset && !limit) {
        const lineEstimate = Math.ceil(fileSize / 50); // Rough estimate
        return this.error(
          `File content (${(fileSize / 1024 / 1024).toFixed(1)}MB) exceeds maximum allowed size ` +
          `(${FILE_LIMITS.MAX_READ_SIZE / 1024}KB). Please use offset and limit parameters to read ` +
          `specific portions of the file, or use the GrepTool to search for specific content.`
        );
      }

      // Read text file
      const content = readFileSync(file_path, { encoding: "utf8" });

      // Handle empty files
      if (content.length === 0) {
        return this.success({
          type: "empty",
          message: "File exists but has empty contents."
        });
      }

      // Format with line numbers
      const startLine = offset || 1;
      const lineLimit = limit || FILE_LIMITS.DEFAULT_READ_LINES;
      const formatted = this.formatWithLineNumbers(content, startLine, lineLimit);

      // Check if content was truncated
      const totalLines = content.split("\n").length;
      const metadata = {
        totalLines,
        startLine,
        endLine: Math.min(startLine + lineLimit - 1, totalLines)
      };

      if (metadata.endLine < totalLines) {
        metadata.truncated = true;
        metadata.message = `Showing lines ${metadata.startLine}-${metadata.endLine} of ${totalLines}`;
      }

      return this.success(formatted, metadata);
    } catch (err) {
      debug(`Read tool error: ${err.message}`);
      return this.error(`Failed to read file: ${err.message}`);
    }
  }
}

// Export singleton instance
export const readTool = new ReadTool();

export default ReadTool;
