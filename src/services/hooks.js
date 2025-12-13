/**
 * Hooks System
 *
 * Provides pre and post execution hooks for tool calls.
 * Hooks can modify inputs, validate execution, or perform side effects.
 */

import { spawn } from "child_process";
import { debug } from "../utils/logger.js";

/**
 * Hook types
 */
export const HookType = {
  PRE_TOOL: "PreToolUse",
  POST_TOOL: "PostToolUse",
  NOTIFICATION: "Notification",
  STOP: "Stop"
};

/**
 * Hook result actions
 */
export const HookAction = {
  ALLOW: "allow",      // Continue with execution
  BLOCK: "block",      // Block the execution
  MODIFY: "modify",    // Modify the input
  SKIP: "skip"         // Skip this hook
};

/**
 * Hook registration store
 */
class HookRegistry {
  constructor() {
    this.hooks = new Map();
    this.shellHooks = [];
  }

  /**
   * Register a JavaScript hook
   * @param {string} type - Hook type
   * @param {Function} handler - Hook handler function
   * @param {object} options - Hook options
   * @returns {string} Hook ID
   */
  register(type, handler, options = {}) {
    if (!this.hooks.has(type)) {
      this.hooks.set(type, []);
    }

    const hookId = `hook_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const hook = {
      id: hookId,
      type,
      handler,
      matcher: options.matcher || (() => true),
      priority: options.priority || 0,
      timeout: options.timeout || 10000
    };

    const hooks = this.hooks.get(type);
    hooks.push(hook);

    // Sort by priority (higher first)
    hooks.sort((a, b) => b.priority - a.priority);

    debug(`Registered hook ${hookId} for ${type}`);
    return hookId;
  }

  /**
   * Register a shell command hook
   * @param {object} config - Shell hook configuration
   */
  registerShellHook(config) {
    const hook = {
      id: `shell_${Date.now()}`,
      type: config.type,
      command: config.command,
      matcher: config.matcher || {},
      timeout: config.timeout || 10000
    };

    this.shellHooks.push(hook);
    debug(`Registered shell hook ${hook.id}: ${config.command}`);
    return hook.id;
  }

  /**
   * Unregister a hook
   * @param {string} hookId - Hook ID
   */
  unregister(hookId) {
    for (const [type, hooks] of this.hooks) {
      const index = hooks.findIndex((h) => h.id === hookId);
      if (index !== -1) {
        hooks.splice(index, 1);
        debug(`Unregistered hook ${hookId}`);
        return true;
      }
    }

    const shellIndex = this.shellHooks.findIndex((h) => h.id === hookId);
    if (shellIndex !== -1) {
      this.shellHooks.splice(shellIndex, 1);
      debug(`Unregistered shell hook ${hookId}`);
      return true;
    }

    return false;
  }

  /**
   * Get hooks for a type
   * @param {string} type - Hook type
   * @returns {object[]} Hooks
   */
  getHooks(type) {
    return this.hooks.get(type) || [];
  }

  /**
   * Get shell hooks for a type
   * @param {string} type - Hook type
   * @returns {object[]} Shell hooks
   */
  getShellHooks(type) {
    return this.shellHooks.filter((h) => h.type === type);
  }

  /**
   * Clear all hooks
   */
  clear() {
    this.hooks.clear();
    this.shellHooks = [];
  }
}

// Global hook registry
const hookRegistry = new HookRegistry();

/**
 * Execute a shell hook
 * @param {object} hook - Shell hook config
 * @param {object} context - Execution context
 * @returns {Promise<object>} Hook result
 */
async function executeShellHook(hook, context) {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      HOOK_TYPE: hook.type,
      HOOK_TOOL_NAME: context.toolName || "",
      HOOK_INPUT: JSON.stringify(context.input || {}),
      HOOK_OUTPUT: JSON.stringify(context.output || {})
    };

    const proc = spawn("bash", ["-c", hook.command], {
      env,
      timeout: hook.timeout
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        // Try to parse stdout as JSON for modified input
        try {
          const result = JSON.parse(stdout.trim());
          resolve({
            action: result.action || HookAction.ALLOW,
            modifiedInput: result.input,
            message: result.message
          });
        } catch {
          resolve({ action: HookAction.ALLOW });
        }
      } else if (code === 2) {
        // Exit code 2 means block
        resolve({
          action: HookAction.BLOCK,
          message: stderr || stdout || "Blocked by hook"
        });
      } else {
        // Other non-zero = allow with warning
        debug(`Shell hook exited with code ${code}: ${stderr}`);
        resolve({ action: HookAction.ALLOW });
      }
    });

    proc.on("error", (err) => {
      debug(`Shell hook error: ${err.message}`);
      resolve({ action: HookAction.ALLOW });
    });
  });
}

/**
 * Match a tool against hook matcher
 * @param {object} matcher - Matcher config
 * @param {string} toolName - Tool name
 * @param {object} input - Tool input
 * @returns {boolean} Whether it matches
 */
function matchesHook(matcher, toolName, input) {
  if (typeof matcher === "function") {
    return matcher(toolName, input);
  }

  if (matcher.toolName) {
    if (Array.isArray(matcher.toolName)) {
      if (!matcher.toolName.includes(toolName)) return false;
    } else if (matcher.toolName !== toolName) {
      return false;
    }
  }

  if (matcher.inputPattern) {
    const inputStr = JSON.stringify(input);
    if (!new RegExp(matcher.inputPattern).test(inputStr)) {
      return false;
    }
  }

  return true;
}

/**
 * Run pre-tool hooks
 * @param {string} toolName - Tool name
 * @param {object} input - Tool input
 * @returns {Promise<object>} Hook result
 */
export async function runPreToolHooks(toolName, input) {
  const hooks = hookRegistry.getHooks(HookType.PRE_TOOL);
  const shellHooks = hookRegistry.getShellHooks(HookType.PRE_TOOL);

  let currentInput = input;
  const results = [];

  // Run JavaScript hooks
  for (const hook of hooks) {
    if (!matchesHook(hook.matcher, toolName, currentInput)) {
      continue;
    }

    try {
      const result = await Promise.race([
        hook.handler(toolName, currentInput),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Hook timeout")), hook.timeout)
        )
      ]);

      results.push({ hookId: hook.id, result });

      if (result.action === HookAction.BLOCK) {
        return {
          blocked: true,
          message: result.message || "Blocked by hook",
          results
        };
      }

      if (result.action === HookAction.MODIFY && result.modifiedInput) {
        currentInput = result.modifiedInput;
      }
    } catch (err) {
      debug(`Pre-tool hook ${hook.id} error: ${err.message}`);
    }
  }

  // Run shell hooks
  for (const hook of shellHooks) {
    if (!matchesHook(hook.matcher, toolName, currentInput)) {
      continue;
    }

    const result = await executeShellHook(hook, { toolName, input: currentInput });
    results.push({ hookId: hook.id, result });

    if (result.action === HookAction.BLOCK) {
      return {
        blocked: true,
        message: result.message || "Blocked by shell hook",
        results
      };
    }

    if (result.action === HookAction.MODIFY && result.modifiedInput) {
      currentInput = result.modifiedInput;
    }
  }

  return {
    blocked: false,
    input: currentInput,
    results
  };
}

/**
 * Run post-tool hooks
 * @param {string} toolName - Tool name
 * @param {object} input - Tool input
 * @param {object} output - Tool output
 * @returns {Promise<void>}
 */
export async function runPostToolHooks(toolName, input, output) {
  const hooks = hookRegistry.getHooks(HookType.POST_TOOL);
  const shellHooks = hookRegistry.getShellHooks(HookType.POST_TOOL);

  // Run JavaScript hooks
  for (const hook of hooks) {
    if (!matchesHook(hook.matcher, toolName, input)) {
      continue;
    }

    try {
      await Promise.race([
        hook.handler(toolName, input, output),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Hook timeout")), hook.timeout)
        )
      ]);
    } catch (err) {
      debug(`Post-tool hook ${hook.id} error: ${err.message}`);
    }
  }

  // Run shell hooks
  for (const hook of shellHooks) {
    if (!matchesHook(hook.matcher, toolName, input)) {
      continue;
    }

    await executeShellHook(hook, { toolName, input, output });
  }
}

/**
 * Register a pre-tool hook
 * @param {Function} handler - Hook handler
 * @param {object} options - Hook options
 * @returns {string} Hook ID
 */
export function onPreTool(handler, options = {}) {
  return hookRegistry.register(HookType.PRE_TOOL, handler, options);
}

/**
 * Register a post-tool hook
 * @param {Function} handler - Hook handler
 * @param {object} options - Hook options
 * @returns {string} Hook ID
 */
export function onPostTool(handler, options = {}) {
  return hookRegistry.register(HookType.POST_TOOL, handler, options);
}

/**
 * Configure hooks from settings
 * @param {object} hooksConfig - Hooks configuration object
 */
export function configureHooks(hooksConfig) {
  for (const [hookType, configs] of Object.entries(hooksConfig)) {
    for (const config of configs) {
      if (config.command) {
        // Shell hook
        hookRegistry.registerShellHook({
          type: hookType,
          command: config.command,
          matcher: config.matcher,
          timeout: config.timeout
        });
      } else if (config.handler) {
        // JavaScript hook
        hookRegistry.register(hookType, config.handler, {
          matcher: config.matcher,
          timeout: config.timeout
        });
      }
    }
  }
}

/**
 * Get the hook registry
 * @returns {HookRegistry}
 */
export function getHookRegistry() {
  return hookRegistry;
}

/**
 * Clear all hooks
 */
export function clearHooks() {
  hookRegistry.clear();
}

export default {
  HookType,
  HookAction,
  hookRegistry,
  runPreToolHooks,
  runPostToolHooks,
  onPreTool,
  onPostTool,
  configureHooks,
  getHookRegistry,
  clearHooks
};
