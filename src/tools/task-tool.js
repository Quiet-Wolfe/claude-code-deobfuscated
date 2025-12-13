/**
 * Task Tool
 *
 * Launches specialized agents (subprocesses) to handle complex,
 * multi-step tasks autonomously.
 */

import { BaseTool } from "./base-tool.js";
import { debug } from "../utils/logger.js";
import { getClient } from "../api/anthropic-client.js";
import { getToolDefinitions } from "./index.js";

/**
 * Available agent types and their configurations
 */
export const AgentTypes = {
  "general-purpose": {
    description: "General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks.",
    tools: "*", // All tools
    systemPromptAddition: "You are a helpful assistant that can search code, read files, and complete complex tasks."
  },
  "Explore": {
    description: "Fast agent specialized for exploring codebases. Use for finding files, searching code, or understanding architecture.",
    tools: "*",
    systemPromptAddition: "You are a code exploration assistant. Focus on quickly finding relevant files and code patterns."
  },
  "Plan": {
    description: "Agent for planning implementations. Creates structured plans before coding.",
    tools: "*",
    systemPromptAddition: "You are a planning assistant. Create detailed, actionable implementation plans."
  },
  "claude-code-guide": {
    description: "Use when user asks about Claude Code features or how to use them.",
    tools: ["Glob", "Grep", "Read", "WebFetch", "WebSearch"],
    systemPromptAddition: "You are a Claude Code documentation expert. Help users understand features and capabilities."
  }
};

/**
 * Task Tool Implementation
 */
export class TaskTool extends BaseTool {
  constructor() {
    super({
      name: "Task",
      description: `Launch a new agent to handle complex, multi-step tasks autonomously.

The Task tool launches specialized agents (subprocesses) that autonomously handle complex tasks.

Available agent types:
- general-purpose: For researching complex questions, searching code, multi-step tasks
- Explore: Fast agent for exploring codebases, finding files, searching code
- Plan: For planning implementations before coding
- claude-code-guide: For questions about Claude Code features

When to use:
- Complex tasks requiring multiple steps
- Code exploration and research
- Tasks matching an agent's specialization

When NOT to use:
- Reading a specific file (use Read tool directly)
- Simple searches (use Glob or Grep directly)
- Tasks unrelated to agent descriptions

Usage notes:
- Launch multiple agents concurrently when possible
- Agents are stateless - include all context in the prompt
- The agent's output is not visible to the user until you summarize it`,
      inputSchema: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description: "A short (3-5 word) description of the task"
          },
          prompt: {
            type: "string",
            description: "The task for the agent to perform"
          },
          subagent_type: {
            type: "string",
            description: "The type of specialized agent to use",
            enum: Object.keys(AgentTypes)
          },
          model: {
            type: "string",
            description: "Optional model to use (sonnet, opus, haiku)",
            enum: ["sonnet", "opus", "haiku"]
          },
          resume: {
            type: "string",
            description: "Optional agent ID to resume from"
          }
        },
        required: ["description", "prompt", "subagent_type"]
      },
      requiresPermission: false
    });

    // Track running agents
    this.runningAgents = new Map();
    this.agentCounter = 0;
  }

  /**
   * Get model ID from shorthand
   * @param {string} shorthand - Model shorthand
   * @returns {string} Full model ID
   */
  getModelId(shorthand) {
    const models = {
      sonnet: "claude-sonnet-4-20250514",
      opus: "claude-opus-4-5-20251101",
      haiku: "claude-haiku-3-5-20241022"
    };
    return models[shorthand] || models.sonnet;
  }

  /**
   * Get tools for agent type
   * @param {string} agentType - Agent type
   * @returns {object[]} Tool definitions
   */
  getAgentTools(agentType) {
    const config = AgentTypes[agentType];
    if (!config) return [];

    if (config.tools === "*") {
      return getToolDefinitions();
    }

    return getToolDefinitions().filter((tool) =>
      config.tools.includes(tool.name)
    );
  }

  /**
   * Execute agent task
   * @param {object} input - Tool input
   * @param {object} context - Execution context
   * @returns {Promise<object>} Tool result
   */
  async execute(input, context = {}) {
    const { description, prompt, subagent_type, model, resume } = input;

    debug(`Task: Starting ${subagent_type} agent - "${description}"`);

    // Validate agent type
    if (!AgentTypes[subagent_type]) {
      return this.error(
        `Unknown agent type: ${subagent_type}. ` +
        `Available types: ${Object.keys(AgentTypes).join(", ")}`
      );
    }

    // Validate prompt
    if (!prompt || prompt.trim().length === 0) {
      return this.error("Prompt cannot be empty");
    }

    // Generate agent ID
    const agentId = resume || `agent_${++this.agentCounter}_${Date.now()}`;

    // Check for resumption
    if (resume && this.runningAgents.has(resume)) {
      const existing = this.runningAgents.get(resume);
      debug(`Task: Resuming agent ${resume}`);
      // In a full implementation, we'd continue the conversation
      return this.success({
        agentId: resume,
        resumed: true,
        message: "Agent resumed (full implementation requires conversation state)"
      });
    }

    try {
      const agentConfig = AgentTypes[subagent_type];
      const tools = this.getAgentTools(subagent_type);
      const modelId = model ? this.getModelId(model) : this.getModelId("sonnet");

      // In a full implementation, this would:
      // 1. Create a new conversation with the agent
      // 2. Run tool use loop until completion
      // 3. Return the final result

      // For now, we simulate the agent execution
      const systemPrompt = `You are a specialized ${subagent_type} agent.
${agentConfig.systemPromptAddition}

Task: ${description}

Instructions: ${prompt}

Complete this task autonomously using the available tools. When done, provide a clear summary of what you found or accomplished.`;

      debug(`Task: Agent ${agentId} running with model ${modelId}`);
      debug(`Task: System prompt length: ${systemPrompt.length}`);
      debug(`Task: Available tools: ${tools.map((t) => t.name).join(", ")}`);

      // Track the agent
      this.runningAgents.set(agentId, {
        id: agentId,
        type: subagent_type,
        description,
        prompt,
        model: modelId,
        startTime: Date.now(),
        status: "running"
      });

      // In production, this would call the API and run a tool use loop
      // For now, return a placeholder indicating the structure

      const result = {
        agentId,
        type: subagent_type,
        description,
        status: "completed",
        message: `Agent task "${description}" would execute here with model ${modelId}. ` +
                 `This requires a full agentic loop implementation with the Anthropic API.`,
        availableTools: tools.map((t) => t.name),
        note: "Full implementation requires running the API message loop with tool execution."
      };

      // Update agent status
      this.runningAgents.set(agentId, {
        ...this.runningAgents.get(agentId),
        status: "completed",
        endTime: Date.now()
      });

      debug(`Task: Agent ${agentId} completed`);

      return this.success(result);
    } catch (err) {
      debug(`Task error: ${err.message}`);

      if (this.runningAgents.has(agentId)) {
        this.runningAgents.set(agentId, {
          ...this.runningAgents.get(agentId),
          status: "failed",
          error: err.message
        });
      }

      return this.error(`Agent execution failed: ${err.message}`);
    }
  }

  /**
   * Get status of an agent
   * @param {string} agentId - Agent ID
   * @returns {object|null} Agent status
   */
  getAgentStatus(agentId) {
    return this.runningAgents.get(agentId) || null;
  }

  /**
   * Get all running agents
   * @returns {object[]} Array of running agents
   */
  getRunningAgents() {
    return Array.from(this.runningAgents.values())
      .filter((a) => a.status === "running");
  }
}

// Export singleton instance
export const taskTool = new TaskTool();

export default TaskTool;
