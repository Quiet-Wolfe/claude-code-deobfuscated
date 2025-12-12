/**
 * Glob Tool
 *
 * Fast file pattern matching tool for finding files by name patterns.
 * Supports glob patterns like **\/*.js or src/**\/*.ts.
 */

import { join, relative } from "path";
import { readdirSync, statSync, existsSync } from "fs";
import { BaseTool } from "./base-tool.js";
import { debug } from "../utils/logger.js";
import { getCwd } from "../utils/fs-utils.js";

/**
 * Simple glob pattern matcher
 */
class GlobMatcher {
  constructor(pattern) {
    this.pattern = pattern;
    this.regex = this.patternToRegex(pattern);
  }

  /**
   * Convert glob pattern to regex
   * @param {string} pattern - Glob pattern
   * @returns {RegExp}
   */
  patternToRegex(pattern) {
    let regex = pattern
      // Escape special regex chars except * and ?
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      // ** matches any path segment
      .replace(/\*\*/g, "{{GLOBSTAR}}")
      // * matches anything except /
      .replace(/\*/g, "[^/]*")
      // ? matches single char except /
      .replace(/\?/g, "[^/]")
      // Restore globstar
      .replace(/{{GLOBSTAR}}/g, ".*");

    return new RegExp(`^${regex}$`);
  }

  /**
   * Test if a path matches the pattern
   * @param {string} path - Path to test
   * @returns {boolean}
   */
  matches(path) {
    // Normalize path separators
    const normalizedPath = path.replace(/\\/g, "/");
    return this.regex.test(normalizedPath);
  }
}

/**
 * Glob Tool Implementation
 */
export class GlobTool extends BaseTool {
  constructor() {
    super({
      name: "Glob",
      description: "Fast file pattern matching tool that works with any codebase size. " +
        "Supports glob patterns like **/*.js or src/**/*.ts. " +
        "Returns matching file paths sorted by modification time. " +
        "Use this tool when you need to find files by name patterns. " +
        "When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead. " +
        "You can call multiple tools in a single response. It is always better to speculatively perform multiple searches in parallel if they are potentially useful.",
      inputSchema: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "The glob pattern to match files against"
          },
          path: {
            type: "string",
            description: "The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory."
          }
        },
        required: ["pattern"]
      },
      requiresPermission: false
    });

    // Directories to always ignore
    this.ignoreDirs = new Set([
      "node_modules",
      ".git",
      ".svn",
      ".hg",
      "__pycache__",
      ".pytest_cache",
      ".mypy_cache",
      "dist",
      "build",
      ".next",
      ".nuxt",
      "coverage",
      ".nyc_output",
      "vendor",
      "target"
    ]);
  }

  /**
   * Recursively find files matching pattern
   * @param {string} dir - Directory to search
   * @param {GlobMatcher} matcher - Pattern matcher
   * @param {string} baseDir - Base directory for relative paths
   * @param {object[]} results - Array to collect results
   * @param {number} maxResults - Maximum results to return
   */
  findFiles(dir, matcher, baseDir, results, maxResults = 1000) {
    if (results.length >= maxResults) return;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      debug(`Cannot read directory ${dir}: ${err.message}`);
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxResults) break;

      const fullPath = join(dir, entry.name);
      const relativePath = relative(baseDir, fullPath);

      if (entry.isDirectory()) {
        // Skip ignored directories
        if (this.ignoreDirs.has(entry.name)) {
          continue;
        }

        // Recurse into subdirectory
        this.findFiles(fullPath, matcher, baseDir, results, maxResults);
      } else if (entry.isFile()) {
        // Check if file matches pattern
        if (matcher.matches(relativePath)) {
          try {
            const stats = statSync(fullPath);
            results.push({
              path: fullPath,
              relativePath,
              mtime: stats.mtime.getTime()
            });
          } catch {
            // Skip files we can't stat
          }
        }
      }
    }
  }

  /**
   * Execute the glob operation
   * @param {object} input - Tool input
   * @param {object} context - Execution context
   * @returns {Promise<object>} Tool result
   */
  async execute(input, context = {}) {
    const { pattern, path: searchPath } = input;

    debug(`Glob tool executing with pattern: ${pattern}`);

    // Validate pattern
    if (!pattern || pattern.trim().length === 0) {
      return this.error("Pattern cannot be empty");
    }

    // Determine search directory
    const baseDir = searchPath || context.cwd || getCwd();

    // Validate directory exists
    if (!existsSync(baseDir)) {
      return this.error(`Directory not found: ${baseDir}`);
    }

    try {
      const matcher = new GlobMatcher(pattern);
      const results = [];

      // Find matching files
      this.findFiles(baseDir, matcher, baseDir, results);

      // Sort by modification time (newest first)
      results.sort((a, b) => b.mtime - a.mtime);

      // Return just the paths
      const paths = results.map((r) => r.path);

      if (paths.length === 0) {
        return this.success(`No files found matching pattern: ${pattern}`);
      }

      return this.success(paths.join("\n"), {
        count: paths.length,
        pattern,
        baseDir
      });
    } catch (err) {
      debug(`Glob tool error: ${err.message}`);
      return this.error(`Failed to search files: ${err.message}`);
    }
  }
}

// Export singleton instance
export const globTool = new GlobTool();

export default GlobTool;
