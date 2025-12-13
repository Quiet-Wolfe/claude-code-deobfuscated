/**
 * Permission System
 *
 * Manages tool permissions and approval prompts.
 * Controls which tools can execute and whether user approval is needed.
 */

import { debug } from "../utils/logger.js";
import { PERMISSION_MODES } from "../constants/index.js";

/**
 * Permission decision types
 */
export const PermissionDecision = {
  ALLOW: "allow",
  DENY: "deny",
  ASK: "ask"
};

/**
 * Permission context - tracks state across a session
 */
class PermissionContext {
  constructor() {
    this.mode = PERMISSION_MODES.DEFAULT;
    this.allowedTools = new Set();
    this.deniedTools = new Set();
    this.sessionApprovals = new Map(); // tool+input hash -> approval
    this.permanentApprovals = new Map();
    this.pendingRequests = [];
  }

  /**
   * Set permission mode
   * @param {string} mode - Permission mode
   */
  setMode(mode) {
    if (!Object.values(PERMISSION_MODES).includes(mode)) {
      throw new Error(`Invalid permission mode: ${mode}`);
    }
    this.mode = mode;
    debug(`Permission mode set to: ${mode}`);
  }

  /**
   * Allow a specific tool
   * @param {string} toolName - Tool name
   */
  allowTool(toolName) {
    this.allowedTools.add(toolName);
    this.deniedTools.delete(toolName);
  }

  /**
   * Deny a specific tool
   * @param {string} toolName - Tool name
   */
  denyTool(toolName) {
    this.deniedTools.add(toolName);
    this.allowedTools.delete(toolName);
  }

  /**
   * Check if a tool is explicitly allowed
   * @param {string} toolName - Tool name
   * @returns {boolean}
   */
  isToolAllowed(toolName) {
    return this.allowedTools.has(toolName);
  }

  /**
   * Check if a tool is explicitly denied
   * @param {string} toolName - Tool name
   * @returns {boolean}
   */
  isToolDenied(toolName) {
    return this.deniedTools.has(toolName);
  }

  /**
   * Reset session approvals
   */
  resetSessionApprovals() {
    this.sessionApprovals.clear();
  }

  /**
   * Generate a hash for tool+input combination
   * @param {string} toolName - Tool name
   * @param {object} input - Tool input
   * @returns {string} Hash
   */
  generateApprovalKey(toolName, input) {
    return `${toolName}:${JSON.stringify(input)}`;
  }

  /**
   * Check if a specific tool+input was approved this session
   * @param {string} toolName - Tool name
   * @param {object} input - Tool input
   * @returns {boolean}
   */
  hasSessionApproval(toolName, input) {
    const key = this.generateApprovalKey(toolName, input);
    return this.sessionApprovals.has(key);
  }

  /**
   * Record a session approval
   * @param {string} toolName - Tool name
   * @param {object} input - Tool input
   */
  recordSessionApproval(toolName, input) {
    const key = this.generateApprovalKey(toolName, input);
    this.sessionApprovals.set(key, { toolName, input, timestamp: Date.now() });
  }
}

// Global permission context
let permissionContext = new PermissionContext();

/**
 * Get the current permission context
 * @returns {PermissionContext}
 */
export function getPermissionContext() {
  return permissionContext;
}

/**
 * Reset permission context
 */
export function resetPermissionContext() {
  permissionContext = new PermissionContext();
}

/**
 * Tools that never require permission
 */
const ALWAYS_ALLOWED_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "Task",
  "TodoWrite",
  "WebSearch",
  "WebFetch"
]);

/**
 * Tools that always require permission
 */
const ALWAYS_REQUIRE_PERMISSION = new Set([
  "Bash",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit"
]);

/**
 * Check if a tool can use permission
 * @param {string} toolName - Tool name
 * @param {object} input - Tool input
 * @param {object} options - Additional options
 * @returns {object} Permission decision
 */
export function checkPermission(toolName, input, options = {}) {
  const ctx = permissionContext;

  debug(`Checking permission for ${toolName}`);

  // Bypass mode - allow everything
  if (ctx.mode === PERMISSION_MODES.BYPASS) {
    debug(`Permission: ALLOW (bypass mode)`);
    return {
      decision: PermissionDecision.ALLOW,
      reason: "Bypass mode enabled"
    };
  }

  // Deny all mode
  if (ctx.mode === PERMISSION_MODES.DENY_ALL) {
    debug(`Permission: DENY (deny all mode)`);
    return {
      decision: PermissionDecision.DENY,
      reason: "Deny all mode enabled"
    };
  }

  // Allow all mode
  if (ctx.mode === PERMISSION_MODES.ALLOW_ALL) {
    debug(`Permission: ALLOW (allow all mode)`);
    return {
      decision: PermissionDecision.ALLOW,
      reason: "Allow all mode enabled"
    };
  }

  // Check if explicitly denied
  if (ctx.isToolDenied(toolName)) {
    debug(`Permission: DENY (tool explicitly denied)`);
    return {
      decision: PermissionDecision.DENY,
      reason: `Tool ${toolName} is denied`
    };
  }

  // Check if explicitly allowed
  if (ctx.isToolAllowed(toolName)) {
    debug(`Permission: ALLOW (tool explicitly allowed)`);
    return {
      decision: PermissionDecision.ALLOW,
      reason: `Tool ${toolName} is allowed`
    };
  }

  // Always allowed tools
  if (ALWAYS_ALLOWED_TOOLS.has(toolName)) {
    debug(`Permission: ALLOW (always allowed tool)`);
    return {
      decision: PermissionDecision.ALLOW,
      reason: `Tool ${toolName} does not require permission`
    };
  }

  // Check session approval
  if (ctx.hasSessionApproval(toolName, input)) {
    debug(`Permission: ALLOW (session approval)`);
    return {
      decision: PermissionDecision.ALLOW,
      reason: "Previously approved this session"
    };
  }

  // Tools requiring permission
  if (ALWAYS_REQUIRE_PERMISSION.has(toolName)) {
    debug(`Permission: ASK (requires permission)`);
    return {
      decision: PermissionDecision.ASK,
      reason: `Tool ${toolName} requires permission`
    };
  }

  // Default: allow read-only, ask for write operations
  debug(`Permission: ALLOW (default policy)`);
  return {
    decision: PermissionDecision.ALLOW,
    reason: "Default policy"
  };
}

/**
 * Record that permission was granted
 * @param {string} toolName - Tool name
 * @param {object} input - Tool input
 * @param {boolean} permanent - Whether to save permanently
 */
export function grantPermission(toolName, input, permanent = false) {
  const ctx = permissionContext;

  if (permanent) {
    ctx.allowTool(toolName);
  } else {
    ctx.recordSessionApproval(toolName, input);
  }

  debug(`Permission granted for ${toolName}`);
}

/**
 * Record that permission was denied
 * @param {string} toolName - Tool name
 * @param {boolean} permanent - Whether to save permanently
 */
export function denyPermission(toolName, permanent = false) {
  const ctx = permissionContext;

  if (permanent) {
    ctx.denyTool(toolName);
  }

  debug(`Permission denied for ${toolName}`);
}

/**
 * Set permission mode
 * @param {string} mode - Permission mode
 */
export function setPermissionMode(mode) {
  permissionContext.setMode(mode);
}

/**
 * Format permission request for display
 * @param {string} toolName - Tool name
 * @param {object} input - Tool input
 * @returns {object} Formatted request
 */
export function formatPermissionRequest(toolName, input) {
  let description = `Allow ${toolName}?`;
  let details = [];

  switch (toolName) {
    case "Bash":
      description = `Run command?`;
      details.push(`Command: ${input.command}`);
      if (input.description) {
        details.push(`Description: ${input.description}`);
      }
      break;

    case "Write":
      description = `Write file?`;
      details.push(`Path: ${input.file_path}`);
      details.push(`Size: ${input.content?.length || 0} characters`);
      break;

    case "Edit":
    case "MultiEdit":
      description = `Edit file?`;
      details.push(`Path: ${input.file_path}`);
      break;

    case "NotebookEdit":
      description = `Edit notebook?`;
      details.push(`Path: ${input.notebook_path}`);
      details.push(`Mode: ${input.edit_mode || 'replace'}`);
      break;

    default:
      details.push(`Input: ${JSON.stringify(input, null, 2)}`);
  }

  return {
    toolName,
    description,
    details,
    input
  };
}

/**
 * Check if bypass permissions is allowed
 * This might be disabled by enterprise settings
 * @returns {boolean}
 */
export function canBypassPermissions() {
  // In a full implementation, this would check:
  // 1. Enterprise policy settings
  // 2. Local settings
  // 3. Environment variables
  const disableBypass = process.env.CLAUDE_DISABLE_PERMISSION_BYPASS === "1";
  return !disableBypass;
}

export default {
  PermissionDecision,
  PermissionContext,
  getPermissionContext,
  resetPermissionContext,
  checkPermission,
  grantPermission,
  denyPermission,
  setPermissionMode,
  formatPermissionRequest,
  canBypassPermissions,
  ALWAYS_ALLOWED_TOOLS,
  ALWAYS_REQUIRE_PERMISSION
};
