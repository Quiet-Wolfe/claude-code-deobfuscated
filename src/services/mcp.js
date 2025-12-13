/**
 * MCP Service
 *
 * Model Context Protocol (MCP) server management.
 * Handles connecting to MCP servers, tool discovery, and resource management.
 */

import { spawn } from "child_process";
import { debug } from "../utils/logger.js";
import { join } from "path";
import { existsSync, readFileSync } from "../utils/fs-utils.js";
import { getClaudeConfigDir } from "../utils/fs-utils.js";
import { EventEmitter } from "events";

/**
 * MCP server transport types
 */
export const MCPTransportType = {
  STDIO: "stdio",
  HTTP: "http",
  SSE: "sse"
};

/**
 * MCP server connection status
 */
export const MCPConnectionStatus = {
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  ERROR: "error"
};

/**
 * MCP Server class
 */
export class MCPServer extends EventEmitter {
  constructor(name, config) {
    super();
    this.name = name;
    this.config = config;
    this.status = MCPConnectionStatus.DISCONNECTED;
    this.process = null;
    this.tools = [];
    this.resources = [];
    this.prompts = [];
    this.error = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
  }

  /**
   * Connect to the server
   */
  async connect() {
    if (this.status === MCPConnectionStatus.CONNECTED) {
      return;
    }

    this.status = MCPConnectionStatus.CONNECTING;
    this.emit("status", this.status);

    try {
      if (this.config.type === MCPTransportType.STDIO) {
        await this.connectStdio();
      } else if (this.config.type === MCPTransportType.HTTP) {
        await this.connectHTTP();
      } else {
        throw new Error(`Unsupported transport type: ${this.config.type}`);
      }

      this.status = MCPConnectionStatus.CONNECTED;
      this.emit("status", this.status);

      // Initialize - get capabilities
      await this.initialize();
    } catch (err) {
      this.status = MCPConnectionStatus.ERROR;
      this.error = err;
      this.emit("status", this.status);
      this.emit("error", err);
      throw err;
    }
  }

  /**
   * Connect via stdio transport
   */
  async connectStdio() {
    const { command, args = [], env = {} } = this.config;

    debug(`Connecting to MCP server ${this.name} via stdio: ${command} ${args.join(" ")}`);

    this.process = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"]
    });

    let buffer = "";

    this.process.stdout.on("data", (data) => {
      buffer += data.toString();

      // Parse complete JSON-RPC messages
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim()) {
          try {
            const message = JSON.parse(line);
            this.handleMessage(message);
          } catch (err) {
            debug(`Failed to parse MCP message: ${err.message}`);
          }
        }
      }
    });

    this.process.stderr.on("data", (data) => {
      debug(`MCP server ${this.name} stderr: ${data.toString()}`);
    });

    this.process.on("close", (code) => {
      debug(`MCP server ${this.name} closed with code ${code}`);
      this.status = MCPConnectionStatus.DISCONNECTED;
      this.emit("status", this.status);
    });

    this.process.on("error", (err) => {
      debug(`MCP server ${this.name} error: ${err.message}`);
      this.status = MCPConnectionStatus.ERROR;
      this.error = err;
      this.emit("error", err);
    });
  }

  /**
   * Connect via HTTP transport
   */
  async connectHTTP() {
    const { url, headers = {} } = this.config;

    debug(`Connecting to MCP server ${this.name} via HTTP: ${url}`);

    // Test connection
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        ...headers
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP connection failed: ${response.status}`);
    }

    // Store connection info
    this.httpUrl = url;
    this.httpHeaders = headers;
  }

  /**
   * Initialize the server (get capabilities)
   */
  async initialize() {
    // Send initialize request
    const result = await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {
        roots: { listChanged: true },
        sampling: {}
      },
      clientInfo: {
        name: "claude-code",
        version: "2.0.67"
      }
    });

    debug(`MCP server ${this.name} initialized:`, result);

    // Get available tools
    await this.refreshTools();

    // Get available resources
    await this.refreshResources();

    // Get available prompts
    await this.refreshPrompts();

    // Send initialized notification
    this.sendNotification("notifications/initialized", {});
  }

  /**
   * Disconnect from the server
   */
  disconnect() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }

    this.status = MCPConnectionStatus.DISCONNECTED;
    this.emit("status", this.status);
  }

  /**
   * Send a JSON-RPC request
   * @param {string} method - Method name
   * @param {object} params - Parameters
   * @returns {Promise<*>} Result
   */
  sendRequest(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;

      const message = {
        jsonrpc: "2.0",
        id,
        method,
        params
      };

      this.pendingRequests.set(id, { resolve, reject });

      if (this.config.type === MCPTransportType.STDIO && this.process) {
        this.process.stdin.write(JSON.stringify(message) + "\n");
      } else if (this.config.type === MCPTransportType.HTTP) {
        this.sendHTTPRequest(message)
          .then(resolve)
          .catch(reject);
      }

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error("Request timeout"));
        }
      }, 30000);
    });
  }

  /**
   * Send a JSON-RPC notification
   * @param {string} method - Method name
   * @param {object} params - Parameters
   */
  sendNotification(method, params = {}) {
    const message = {
      jsonrpc: "2.0",
      method,
      params
    };

    if (this.config.type === MCPTransportType.STDIO && this.process) {
      this.process.stdin.write(JSON.stringify(message) + "\n");
    }
  }

  /**
   * Send HTTP request
   * @param {object} message - JSON-RPC message
   * @returns {Promise<*>}
   */
  async sendHTTPRequest(message) {
    const response = await fetch(this.httpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.httpHeaders
      },
      body: JSON.stringify(message)
    });

    if (!response.ok) {
      throw new Error(`HTTP request failed: ${response.status}`);
    }

    const result = await response.json();

    if (result.error) {
      throw new Error(result.error.message || "Unknown error");
    }

    return result.result;
  }

  /**
   * Handle incoming message
   * @param {object} message - JSON-RPC message
   */
  handleMessage(message) {
    if (message.id !== undefined) {
      // Response
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);

        if (message.error) {
          pending.reject(new Error(message.error.message || "Unknown error"));
        } else {
          pending.resolve(message.result);
        }
      }
    } else if (message.method) {
      // Notification or request from server
      this.handleNotification(message.method, message.params);
    }
  }

  /**
   * Handle notification from server
   * @param {string} method - Method name
   * @param {object} params - Parameters
   */
  handleNotification(method, params) {
    debug(`MCP notification from ${this.name}: ${method}`, params);

    switch (method) {
      case "notifications/tools/list_changed":
        this.refreshTools();
        break;
      case "notifications/resources/list_changed":
        this.refreshResources();
        break;
      case "notifications/prompts/list_changed":
        this.refreshPrompts();
        break;
      default:
        debug(`Unknown notification: ${method}`);
    }
  }

  /**
   * Refresh available tools
   */
  async refreshTools() {
    try {
      const result = await this.sendRequest("tools/list");
      this.tools = result.tools || [];
      this.emit("tools", this.tools);
    } catch (err) {
      debug(`Failed to refresh tools: ${err.message}`);
    }
  }

  /**
   * Refresh available resources
   */
  async refreshResources() {
    try {
      const result = await this.sendRequest("resources/list");
      this.resources = result.resources || [];
      this.emit("resources", this.resources);
    } catch (err) {
      debug(`Failed to refresh resources: ${err.message}`);
    }
  }

  /**
   * Refresh available prompts
   */
  async refreshPrompts() {
    try {
      const result = await this.sendRequest("prompts/list");
      this.prompts = result.prompts || [];
      this.emit("prompts", this.prompts);
    } catch (err) {
      debug(`Failed to refresh prompts: ${err.message}`);
    }
  }

  /**
   * Call a tool
   * @param {string} name - Tool name
   * @param {object} arguments_ - Tool arguments
   * @returns {Promise<*>}
   */
  async callTool(name, arguments_ = {}) {
    return this.sendRequest("tools/call", { name, arguments: arguments_ });
  }

  /**
   * Read a resource
   * @param {string} uri - Resource URI
   * @returns {Promise<*>}
   */
  async readResource(uri) {
    return this.sendRequest("resources/read", { uri });
  }

  /**
   * Get a prompt
   * @param {string} name - Prompt name
   * @param {object} arguments_ - Prompt arguments
   * @returns {Promise<*>}
   */
  async getPrompt(name, arguments_ = {}) {
    return this.sendRequest("prompts/get", { name, arguments: arguments_ });
  }
}

/**
 * MCP Manager class
 */
export class MCPManager {
  constructor() {
    this.servers = new Map();
    this.config = {};
  }

  /**
   * Load MCP configuration
   */
  loadConfig() {
    // Load from user config
    const userConfigPath = join(getClaudeConfigDir(), "claude_desktop_config.json");
    if (existsSync(userConfigPath)) {
      try {
        const content = readFileSync(userConfigPath, { encoding: "utf8" });
        const config = JSON.parse(content);
        this.config = { ...this.config, ...config.mcpServers };
      } catch (err) {
        debug(`Failed to load user MCP config: ${err.message}`);
      }
    }

    // Load from project config
    const projectConfigPath = join(process.cwd(), ".claude", "mcp.json");
    if (existsSync(projectConfigPath)) {
      try {
        const content = readFileSync(projectConfigPath, { encoding: "utf8" });
        const config = JSON.parse(content);
        this.config = { ...this.config, ...config.mcpServers };
      } catch (err) {
        debug(`Failed to load project MCP config: ${err.message}`);
      }
    }
  }

  /**
   * Add a server configuration
   * @param {string} name - Server name
   * @param {object} config - Server config
   */
  addServer(name, config) {
    this.config[name] = config;
  }

  /**
   * Remove a server configuration
   * @param {string} name - Server name
   */
  removeServer(name) {
    delete this.config[name];
    const server = this.servers.get(name);
    if (server) {
      server.disconnect();
      this.servers.delete(name);
    }
  }

  /**
   * Connect to a server
   * @param {string} name - Server name
   * @returns {Promise<MCPServer>}
   */
  async connect(name) {
    const config = this.config[name];
    if (!config) {
      throw new Error(`Unknown MCP server: ${name}`);
    }

    let server = this.servers.get(name);
    if (!server) {
      server = new MCPServer(name, config);
      this.servers.set(name, server);
    }

    await server.connect();
    return server;
  }

  /**
   * Connect to all configured servers
   */
  async connectAll() {
    const results = [];

    for (const name of Object.keys(this.config)) {
      try {
        await this.connect(name);
        results.push({ name, success: true });
      } catch (err) {
        results.push({ name, success: false, error: err.message });
      }
    }

    return results;
  }

  /**
   * Disconnect from a server
   * @param {string} name - Server name
   */
  disconnect(name) {
    const server = this.servers.get(name);
    if (server) {
      server.disconnect();
    }
  }

  /**
   * Disconnect from all servers
   */
  disconnectAll() {
    for (const server of this.servers.values()) {
      server.disconnect();
    }
  }

  /**
   * Get a server
   * @param {string} name - Server name
   * @returns {MCPServer|undefined}
   */
  getServer(name) {
    return this.servers.get(name);
  }

  /**
   * Get all connected servers
   * @returns {MCPServer[]}
   */
  getConnectedServers() {
    return Array.from(this.servers.values())
      .filter(s => s.status === MCPConnectionStatus.CONNECTED);
  }

  /**
   * Get all tools from all connected servers
   * @returns {object[]}
   */
  getAllTools() {
    const tools = [];

    for (const server of this.getConnectedServers()) {
      for (const tool of server.tools) {
        tools.push({
          ...tool,
          server: server.name,
          name: `mcp__${server.name}__${tool.name}`
        });
      }
    }

    return tools;
  }

  /**
   * Get all resources from all connected servers
   * @returns {object[]}
   */
  getAllResources() {
    const resources = [];

    for (const server of this.getConnectedServers()) {
      for (const resource of server.resources) {
        resources.push({
          ...resource,
          server: server.name
        });
      }
    }

    return resources;
  }

  /**
   * Call an MCP tool
   * @param {string} fullName - Full tool name (mcp__server__tool)
   * @param {object} arguments_ - Tool arguments
   * @returns {Promise<*>}
   */
  async callTool(fullName, arguments_ = {}) {
    const match = fullName.match(/^mcp__([^_]+)__(.+)$/);
    if (!match) {
      throw new Error(`Invalid MCP tool name: ${fullName}`);
    }

    const [, serverName, toolName] = match;
    const server = this.servers.get(serverName);

    if (!server) {
      throw new Error(`MCP server not connected: ${serverName}`);
    }

    return server.callTool(toolName, arguments_);
  }
}

// Global MCP manager
export const mcpManager = new MCPManager();

export default {
  MCPTransportType,
  MCPConnectionStatus,
  MCPServer,
  MCPManager,
  mcpManager
};
