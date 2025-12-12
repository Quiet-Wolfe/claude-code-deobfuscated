/**
 * File System Utilities
 *
 * Provides file system operations with proper error handling,
 * performance monitoring, and symlink resolution.
 */

import * as fs from "fs";
import { stat, open } from "fs/promises";
import { join, dirname, resolve, basename, extname } from "path";
import { homedir } from "os";
import { debug } from "./logger.js";

// Threshold for slow operation warnings (ms)
const SLOW_OPERATION_THRESHOLD = 5;

/**
 * Wrapper for synchronous fs operations with performance monitoring
 * @param {string} operation - Name of the operation
 * @param {Function} fn - Function to execute
 * @returns {*} Result of the operation
 */
function measureSync(operation, fn) {
  const start = performance.now();
  try {
    return fn();
  } finally {
    const duration = performance.now() - start;
    if (duration > SLOW_OPERATION_THRESHOLD) {
      debug(`[SLOW OPERATION DETECTED] fs.${operation} (${duration.toFixed(1)}ms)`);
    }
  }
}

/**
 * Check if a path exists
 * @param {string} path - Path to check
 * @returns {boolean}
 */
export function existsSync(path) {
  return measureSync("existsSync", () => fs.existsSync(path));
}

/**
 * Get file stats synchronously
 * @param {string} path - Path to stat
 * @returns {fs.Stats}
 */
export function statSync(path) {
  return measureSync("statSync", () => fs.statSync(path));
}

/**
 * Get file stats (following symlinks) asynchronously
 * @param {string} path - Path to stat
 * @returns {Promise<fs.Stats>}
 */
export async function statAsync(path) {
  return stat(path);
}

/**
 * Get file stats (not following symlinks) synchronously
 * @param {string} path - Path to stat
 * @returns {fs.Stats}
 */
export function lstatSync(path) {
  return measureSync("lstatSync", () => fs.lstatSync(path));
}

/**
 * Read file contents synchronously
 * @param {string} path - Path to read
 * @param {object} options - Read options
 * @returns {string|Buffer}
 */
export function readFileSync(path, options = { encoding: "utf8" }) {
  return measureSync("readFileSync", () =>
    fs.readFileSync(path, { encoding: options.encoding })
  );
}

/**
 * Read file as buffer synchronously
 * @param {string} path - Path to read
 * @returns {Buffer}
 */
export function readFileBytesSync(path) {
  return measureSync("readFileBytesSync", () => fs.readFileSync(path));
}

/**
 * Write file synchronously with optional atomic write
 * @param {string} path - Path to write
 * @param {string|Buffer} content - Content to write
 * @param {object} options - Write options
 */
export function writeFileSync(path, content, options = {}) {
  return measureSync("writeFileSync", () => {
    const fileExists = fs.existsSync(path);

    if (!options.flush) {
      const writeOptions = { encoding: options.encoding || "utf8" };
      if (!fileExists) {
        writeOptions.mode = options.mode ?? 0o600;
      } else if (options.mode !== undefined) {
        writeOptions.mode = options.mode;
      }
      fs.writeFileSync(path, content, writeOptions);
      return;
    }

    // Atomic write with flush
    const tempPath = `${path}.tmp.${process.pid}`;
    let fd;
    try {
      fd = fs.openSync(tempPath, "w", fileExists ? undefined : (options.mode ?? 0o600));
      fs.writeSync(fd, content);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(tempPath, path);
    } finally {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch {}
      }
      try { fs.unlinkSync(tempPath); } catch {}
    }
  });
}

/**
 * Read first N bytes of a file synchronously
 * @param {string} path - Path to read
 * @param {number} length - Number of bytes to read
 * @returns {object} Object with buffer and bytesRead
 */
export function readBytesSync(path, length) {
  return measureSync("readSync", () => {
    let fd;
    try {
      fd = fs.openSync(path, "r");
      const buffer = Buffer.alloc(length);
      const bytesRead = fs.readSync(fd, buffer, 0, length, 0);
      return { buffer, bytesRead };
    } finally {
      if (fd !== undefined) {
        fs.closeSync(fd);
      }
    }
  });
}

/**
 * Resolve symlink and return resolved path
 * @param {string} path - Path to resolve
 * @returns {object} Object with resolvedPath and isSymlink flag
 */
export function resolveSymlink(path) {
  if (!fs.existsSync(path)) {
    return { resolvedPath: path, isSymlink: false };
  }

  try {
    const resolvedPath = fs.realpathSync(path);
    return {
      resolvedPath,
      isSymlink: resolvedPath !== path
    };
  } catch {
    return { resolvedPath: path, isSymlink: false };
  }
}

/**
 * Get all possible paths for a file (original + resolved symlink)
 * @param {string} path - Path to check
 * @returns {string[]} Array of paths
 */
export function getAllPaths(path) {
  const paths = [path];
  const { resolvedPath, isSymlink } = resolveSymlink(path);

  if (isSymlink && resolvedPath !== path) {
    paths.push(resolvedPath);
  }

  return paths;
}

/**
 * Get the current working directory
 * @returns {string}
 */
export function getCwd() {
  return process.cwd();
}

/**
 * Get the home directory
 * @returns {string}
 */
export function getHomeDir() {
  return homedir();
}

/**
 * Read file lines in reverse order (from end to start)
 * Useful for reading log files from the end
 * @param {string} path - Path to read
 * @yields {string} Lines in reverse order
 */
export async function* readLinesReverse(path) {
  const fileHandle = await open(path, "r");

  try {
    const stats = await fileHandle.stat();
    let remaining = stats.size;
    let partial = "";
    const buffer = Buffer.alloc(4096);

    while (remaining > 0) {
      const chunkSize = Math.min(4096, remaining);
      remaining -= chunkSize;

      await fileHandle.read(buffer, 0, chunkSize, remaining);
      const lines = (buffer.toString("utf8", 0, chunkSize) + partial).split("\n");
      partial = lines[0] || "";

      for (let i = lines.length - 1; i >= 1; i--) {
        const line = lines[i];
        if (line) yield line;
      }
    }

    if (partial) yield partial;
  } finally {
    await fileHandle.close();
  }
}

/**
 * Ensure a directory exists, creating it if necessary
 * @param {string} dirPath - Directory path
 */
export function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Check if path is a directory
 * @param {string} path - Path to check
 * @returns {boolean}
 */
export function isDirectorySync(path) {
  try {
    return fs.statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if path is a file
 * @param {string} path - Path to check
 * @returns {boolean}
 */
export function isFileSync(path) {
  try {
    return fs.statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Get the Claude config directory (~/.claude)
 * @returns {string}
 */
export function getClaudeConfigDir() {
  return join(homedir(), ".claude");
}

/**
 * Get the Claude local installation directory
 * @returns {string}
 */
export function getClaudeLocalDir() {
  return join(getClaudeConfigDir(), "local");
}

export default {
  existsSync,
  statSync,
  statAsync,
  lstatSync,
  readFileSync,
  readFileBytesSync,
  writeFileSync,
  readBytesSync,
  resolveSymlink,
  getAllPaths,
  getCwd,
  getHomeDir,
  readLinesReverse,
  ensureDirSync,
  isDirectorySync,
  isFileSync,
  getClaudeConfigDir,
  getClaudeLocalDir
};
