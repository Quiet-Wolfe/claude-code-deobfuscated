/**
 * Grep Tool
 *
 * Powerful search tool for finding patterns in file contents.
 * Built on ripgrep for fast searching.
 */

import { spawn } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { BaseTool } from "./base-tool.js";
import { debug } from "../utils/logger.js";
import { getCwd } from "../utils/fs-utils.js";

// Get the directory containing the ripgrep binary
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Get the path to the ripgrep binary based on platform
 * @returns {string} Path to rg binary
 */
function getRipgrepPath() {
  const platform = process.platform;
  const arch = process.arch;

  let platformDir;
  if (platform === "darwin") {
    platformDir = arch === "arm64" ? "arm64-darwin" : "x64-darwin";
  } else if (platform === "linux") {
    platformDir = arch === "arm64" ? "arm64-linux" : "x64-linux";
  } else if (platform === "win32") {
    platformDir = "x64-win32";
  } else {
    return "rg"; // Fall back to system rg
  }

  const vendorPath = join(__dirname, "..", "..", "vendor", "ripgrep", platformDir, platform === "win32" ? "rg.exe" : "rg");

  if (existsSync(vendorPath)) {
    return vendorPath;
  }

  return "rg"; // Fall back to system rg
}

/**
 * Grep Tool Implementation
 */
export class GrepTool extends BaseTool {
  constructor() {
    super({
      name: "Grep",
      description: `A powerful search tool built on ripgrep.

Usage:
- ALWAYS use Grep for search tasks. NEVER invoke grep or rg as a Bash command.
- Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
- Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")
- Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts
- Use Task tool for open-ended searches requiring multiple rounds
- Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping
- Multiline matching: By default patterns match within single lines only. For cross-line patterns, use multiline: true`,
      inputSchema: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "The regular expression pattern to search for in file contents"
          },
          path: {
            type: "string",
            description: "File or directory to search in. Defaults to current working directory."
          },
          glob: {
            type: "string",
            description: 'Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}")'
          },
          type: {
            type: "string",
            description: "File type to search (e.g., js, py, rust, go, java)"
          },
          output_mode: {
            type: "string",
            enum: ["content", "files_with_matches", "count"],
            description: 'Output mode: "content" shows lines, "files_with_matches" shows paths, "count" shows counts'
          },
          "-i": {
            type: "boolean",
            description: "Case insensitive search"
          },
          "-n": {
            type: "boolean",
            description: "Show line numbers in output (requires output_mode: content)"
          },
          "-A": {
            type: "number",
            description: "Number of lines to show after each match"
          },
          "-B": {
            type: "number",
            description: "Number of lines to show before each match"
          },
          "-C": {
            type: "number",
            description: "Number of lines to show before and after each match"
          },
          multiline: {
            type: "boolean",
            description: "Enable multiline mode where . matches newlines"
          },
          head_limit: {
            type: "number",
            description: "Limit output to first N entries"
          },
          offset: {
            type: "number",
            description: "Skip first N entries before applying head_limit"
          }
        },
        required: ["pattern"]
      },
      requiresPermission: false
    });

    this.rgPath = getRipgrepPath();
  }

  /**
   * Build ripgrep command arguments
   * @param {object} input - Tool input
   * @param {string} searchPath - Path to search
   * @returns {string[]} Command arguments
   */
  buildArgs(input, searchPath) {
    const args = [];

    // Pattern
    args.push("-e", input.pattern);

    // Output mode
    const outputMode = input.output_mode || "files_with_matches";
    if (outputMode === "files_with_matches") {
      args.push("-l");
    } else if (outputMode === "count") {
      args.push("-c");
    }

    // Case insensitive
    if (input["-i"]) {
      args.push("-i");
    }

    // Line numbers (only for content mode)
    if (outputMode === "content" && input["-n"] !== false) {
      args.push("-n");
    }

    // Context lines
    if (input["-A"]) {
      args.push("-A", String(input["-A"]));
    }
    if (input["-B"]) {
      args.push("-B", String(input["-B"]));
    }
    if (input["-C"]) {
      args.push("-C", String(input["-C"]));
    }

    // Multiline
    if (input.multiline) {
      args.push("-U", "--multiline-dotall");
    }

    // File type filter
    if (input.type) {
      args.push("--type", input.type);
    }

    // Glob filter
    if (input.glob) {
      args.push("--glob", input.glob);
    }

    // Max results
    if (input.head_limit) {
      args.push("-m", String(input.head_limit + (input.offset || 0)));
    }

    // Common exclusions
    args.push("--hidden");
    args.push("-g", "!.git");
    args.push("-g", "!node_modules");
    args.push("-g", "!*.min.js");
    args.push("-g", "!*.map");
    args.push("-g", "!package-lock.json");
    args.push("-g", "!yarn.lock");

    // Search path
    args.push(searchPath);

    return args;
  }

  /**
   * Execute ripgrep and return results
   * @param {string[]} args - Command arguments
   * @returns {Promise<object>} Search results
   */
  runRipgrep(args) {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";

      const proc = spawn(this.rgPath, args, {
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"]
      });

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        // ripgrep returns 1 for no matches, 0 for matches, 2 for errors
        resolve({
          code,
          stdout: stdout.trim(),
          stderr: stderr.trim()
        });
      });

      proc.on("error", (err) => {
        resolve({
          code: -1,
          stdout: "",
          stderr: err.message
        });
      });
    });
  }

  /**
   * Execute the grep operation
   * @param {object} input - Tool input
   * @param {object} context - Execution context
   * @returns {Promise<object>} Tool result
   */
  async execute(input, context = {}) {
    const { pattern, path: searchPath, offset = 0, head_limit } = input;

    debug(`Grep tool executing with pattern: ${pattern}`);

    // Validate pattern
    if (!pattern || pattern.trim().length === 0) {
      return this.error("Pattern cannot be empty");
    }

    // Determine search path
    const resolvedPath = searchPath || context.cwd || getCwd();

    // Validate path exists
    if (!existsSync(resolvedPath)) {
      return this.error(`Path not found: ${resolvedPath}`);
    }

    try {
      const args = this.buildArgs(input, resolvedPath);
      debug(`Running: ${this.rgPath} ${args.join(" ")}`);

      const result = await this.runRipgrep(args);

      // Handle errors
      if (result.code === 2) {
        return this.error(`Search failed: ${result.stderr}`);
      }

      if (result.code === -1) {
        return this.error(`Failed to run ripgrep: ${result.stderr}`);
      }

      // No matches
      if (result.code === 1 || !result.stdout) {
        return this.success("No matches found", { matchCount: 0 });
      }

      // Process output
      let output = result.stdout;
      let lines = output.split("\n").filter(Boolean);

      // Apply offset
      if (offset > 0) {
        lines = lines.slice(offset);
      }

      // Apply head limit
      if (head_limit && lines.length > head_limit) {
        lines = lines.slice(0, head_limit);
      }

      output = lines.join("\n");

      return this.success(output, {
        matchCount: lines.length,
        pattern,
        path: resolvedPath
      });
    } catch (err) {
      debug(`Grep tool error: ${err.message}`);
      return this.error(`Search failed: ${err.message}`);
    }
  }
}

// Export singleton instance
export const grepTool = new GrepTool();

export default GrepTool;
