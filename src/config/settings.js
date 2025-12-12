/**
 * Settings Management
 *
 * Handles loading, saving, and merging settings from various sources:
 * - System defaults
 * - User settings (~/.claude/settings.json)
 * - Project settings (.claude/settings.json)
 * - Environment variables
 * - Command line arguments
 */

import { join } from "path";
import { homedir } from "os";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  ensureDirSync,
  getClaudeConfigDir
} from "../utils/fs-utils.js";
import { debug } from "../utils/logger.js";
import { memoize } from "../utils/memoize.js";

// Settings file names
const SETTINGS_FILE = "settings.json";
const LOCAL_SETTINGS_FILE = "settings.local.json";
const PROJECT_CONFIG_DIR = ".claude";

/**
 * Default settings
 */
export const DEFAULT_SETTINGS = {
  // API settings
  apiKey: null,
  model: "claude-sonnet-4-20250514",
  maxTokens: 16000,
  maxThinkingTokens: null,

  // Behavior settings
  verbose: false,
  debug: false,
  autoApprove: false,

  // Editor settings
  preferredEditor: null,

  // Permission settings
  permissions: {
    allowRead: true,
    allowWrite: true,
    allowExecute: false,
    allowNetwork: true
  },

  // UI settings
  outputStyle: "streaming",
  theme: "auto",
  showTimestamps: false,

  // Git settings
  autoCommit: false,
  commitMessageStyle: "conventional",

  // MCP settings
  mcpServers: {},

  // Installation settings
  installMethod: null
};

/**
 * Get the user settings directory path
 * @returns {string}
 */
export function getUserSettingsDir() {
  return getClaudeConfigDir();
}

/**
 * Get the user settings file path
 * @returns {string}
 */
export function getUserSettingsPath() {
  return join(getUserSettingsDir(), SETTINGS_FILE);
}

/**
 * Get the project settings directory path
 * @param {string} cwd - Current working directory
 * @returns {string}
 */
export function getProjectSettingsDir(cwd = process.cwd()) {
  return join(cwd, PROJECT_CONFIG_DIR);
}

/**
 * Get the project settings file path
 * @param {string} cwd - Current working directory
 * @returns {string}
 */
export function getProjectSettingsPath(cwd = process.cwd()) {
  return join(getProjectSettingsDir(cwd), SETTINGS_FILE);
}

/**
 * Load settings from a JSON file
 * @param {string} path - Path to settings file
 * @returns {object|null} Settings object or null if file doesn't exist
 */
export function loadSettingsFile(path) {
  try {
    if (!existsSync(path)) {
      return null;
    }
    const content = readFileSync(path, { encoding: "utf8" });
    return JSON.parse(content);
  } catch (error) {
    debug(`Failed to load settings from ${path}: ${error.message}`);
    return null;
  }
}

/**
 * Save settings to a JSON file
 * @param {string} path - Path to settings file
 * @param {object} settings - Settings object
 */
export function saveSettingsFile(path, settings) {
  try {
    const dir = join(path, "..");
    ensureDirSync(dir);
    const content = JSON.stringify(settings, null, 2);
    writeFileSync(path, content + "\n", { encoding: "utf8" });
  } catch (error) {
    debug(`Failed to save settings to ${path}: ${error.message}`);
    throw error;
  }
}

/**
 * Load user settings
 * @returns {object} User settings
 */
export function loadUserSettings() {
  const path = getUserSettingsPath();
  return loadSettingsFile(path) || {};
}

/**
 * Load project settings
 * @param {string} cwd - Current working directory
 * @returns {object} Project settings
 */
export function loadProjectSettings(cwd = process.cwd()) {
  const path = getProjectSettingsPath(cwd);
  return loadSettingsFile(path) || {};
}

/**
 * Save user settings
 * @param {object} settings - Settings to save
 */
export function saveUserSettings(settings) {
  const path = getUserSettingsPath();
  saveSettingsFile(path, settings);
}

/**
 * Save project settings
 * @param {object} settings - Settings to save
 * @param {string} cwd - Current working directory
 */
export function saveProjectSettings(settings, cwd = process.cwd()) {
  const path = getProjectSettingsPath(cwd);
  saveSettingsFile(path, settings);
}

/**
 * Deep merge two objects
 * @param {object} target - Target object
 * @param {object} source - Source object
 * @returns {object} Merged object
 */
export function deepMerge(target, source) {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }

  return result;
}

/**
 * Load settings from environment variables
 * @returns {object} Settings from environment
 */
export function loadEnvSettings() {
  const settings = {};

  if (process.env.ANTHROPIC_API_KEY) {
    settings.apiKey = process.env.ANTHROPIC_API_KEY;
  }

  if (process.env.CLAUDE_MODEL) {
    settings.model = process.env.CLAUDE_MODEL;
  }

  if (process.env.CLAUDE_MAX_TOKENS) {
    settings.maxTokens = parseInt(process.env.CLAUDE_MAX_TOKENS, 10);
  }

  if (process.env.CLAUDE_DEBUG === "1" || process.env.CLAUDE_DEBUG === "true") {
    settings.debug = true;
  }

  if (process.env.CLAUDE_VERBOSE === "1" || process.env.CLAUDE_VERBOSE === "true") {
    settings.verbose = true;
  }

  return settings;
}

/**
 * Get merged settings from all sources
 * Memoized to avoid repeated file reads
 */
export const getSettings = memoize(function (cwd = process.cwd()) {
  const userSettings = loadUserSettings();
  const projectSettings = loadProjectSettings(cwd);
  const envSettings = loadEnvSettings();

  // Merge in order of precedence (later overrides earlier)
  let settings = deepMerge(DEFAULT_SETTINGS, userSettings);
  settings = deepMerge(settings, projectSettings);
  settings = deepMerge(settings, envSettings);

  return settings;
});

/**
 * Clear the settings cache (for testing or after settings change)
 */
export function clearSettingsCache() {
  getSettings.cache.clear();
}

/**
 * Update a specific setting
 * @param {Function} updater - Function that receives current settings and returns updated settings
 */
export function updateUserSettings(updater) {
  const currentSettings = loadUserSettings();
  const newSettings = updater(currentSettings);
  saveUserSettings(newSettings);
  clearSettingsCache();
}

/**
 * Get a specific setting value
 * @param {string} key - Setting key (supports dot notation for nested keys)
 * @param {*} defaultValue - Default value if setting not found
 * @returns {*} Setting value
 */
export function getSetting(key, defaultValue = undefined) {
  const settings = getSettings();
  const keys = key.split(".");

  let value = settings;
  for (const k of keys) {
    if (value === undefined || value === null) {
      return defaultValue;
    }
    value = value[k];
  }

  return value !== undefined ? value : defaultValue;
}

// Alias for backward compatibility
export const c1 = getSettings;
export const i0 = updateUserSettings;

export default {
  DEFAULT_SETTINGS,
  getUserSettingsDir,
  getUserSettingsPath,
  getProjectSettingsDir,
  getProjectSettingsPath,
  loadSettingsFile,
  saveSettingsFile,
  loadUserSettings,
  loadProjectSettings,
  saveUserSettings,
  saveProjectSettings,
  deepMerge,
  loadEnvSettings,
  getSettings,
  clearSettingsCache,
  updateUserSettings,
  getSetting,
  c1,
  i0
};
