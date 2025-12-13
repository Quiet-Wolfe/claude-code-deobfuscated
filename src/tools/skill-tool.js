/**
 * Skill Tool
 *
 * Executes a skill within the main conversation.
 * Skills provide specialized capabilities and domain knowledge.
 */

import { BaseTool } from "./base-tool.js";
import { debug } from "../utils/logger.js";
import { join } from "path";
import { existsSync, readFileSync } from "../utils/fs-utils.js";
import { getClaudeConfigDir } from "../utils/fs-utils.js";

/**
 * Skill registry for managing available skills
 */
class SkillRegistry {
  constructor() {
    this.skills = new Map();
    this.loadedSkills = new Map();
  }

  /**
   * Register a skill
   * @param {object} skill - Skill definition
   */
  register(skill) {
    this.skills.set(skill.name, skill);
  }

  /**
   * Get a skill by name
   * @param {string} name - Skill name
   * @returns {object|undefined}
   */
  get(name) {
    return this.skills.get(name);
  }

  /**
   * Check if a skill exists
   * @param {string} name - Skill name
   * @returns {boolean}
   */
  has(name) {
    return this.skills.has(name);
  }

  /**
   * Get all available skills
   * @returns {object[]}
   */
  getAll() {
    return Array.from(this.skills.values());
  }

  /**
   * Load skills from user config directory
   */
  loadUserSkills() {
    const skillsDir = join(getClaudeConfigDir(), "skills");
    if (!existsSync(skillsDir)) {
      return;
    }

    try {
      const fs = require("fs");
      const files = fs.readdirSync(skillsDir);

      for (const file of files) {
        if (file.endsWith(".json") || file.endsWith(".md")) {
          try {
            const skillPath = join(skillsDir, file);
            const content = readFileSync(skillPath, { encoding: "utf8" });

            if (file.endsWith(".json")) {
              const skill = JSON.parse(content);
              this.register({
                ...skill,
                location: "user",
                path: skillPath
              });
            } else if (file.endsWith(".md")) {
              // Markdown skills have the prompt as the content
              const name = file.replace(".md", "");
              this.register({
                name,
                description: `Skill loaded from ${file}`,
                prompt: content,
                location: "user",
                path: skillPath
              });
            }
          } catch (err) {
            debug(`Failed to load skill ${file}: ${err.message}`);
          }
        }
      }
    } catch (err) {
      debug(`Failed to load user skills: ${err.message}`);
    }
  }

  /**
   * Load skills from project directory
   * @param {string} projectDir - Project directory
   */
  loadProjectSkills(projectDir) {
    const skillsDir = join(projectDir, ".claude", "skills");
    if (!existsSync(skillsDir)) {
      return;
    }

    try {
      const fs = require("fs");
      const files = fs.readdirSync(skillsDir);

      for (const file of files) {
        if (file.endsWith(".json") || file.endsWith(".md")) {
          try {
            const skillPath = join(skillsDir, file);
            const content = readFileSync(skillPath, { encoding: "utf8" });

            if (file.endsWith(".json")) {
              const skill = JSON.parse(content);
              this.register({
                ...skill,
                location: "project",
                path: skillPath
              });
            } else if (file.endsWith(".md")) {
              const name = file.replace(".md", "");
              this.register({
                name,
                description: `Skill loaded from ${file}`,
                prompt: content,
                location: "project",
                path: skillPath
              });
            }
          } catch (err) {
            debug(`Failed to load skill ${file}: ${err.message}`);
          }
        }
      }
    } catch (err) {
      debug(`Failed to load project skills: ${err.message}`);
    }
  }
}

// Global skill registry
export const skillRegistry = new SkillRegistry();

/**
 * Skill Tool Implementation
 */
export class SkillTool extends BaseTool {
  constructor() {
    super({
      name: "Skill",
      description: `Execute a skill within the main conversation.

When users ask you to perform tasks, check if any of the available skills can help complete the task more effectively. Skills provide specialized capabilities and domain knowledge.

How to use skills:
- Invoke skills using this tool with the skill name only (no arguments)
- When you invoke a skill, you will see a command message indicating the skill is loading
- The skill's prompt will expand and provide detailed instructions

Important:
- Only use skills listed in available_skills
- Do not invoke a skill that is already running
- Do not use this tool for built-in CLI commands`,
      inputSchema: {
        type: "object",
        properties: {
          skill: {
            type: "string",
            description: "The skill name (no arguments). E.g., \"pdf\" or \"xlsx\""
          }
        },
        required: ["skill"]
      },
      requiresPermission: false
    });
  }

  /**
   * Execute the skill
   * @param {object} input - Tool input
   * @param {object} context - Execution context
   * @returns {Promise<object>} Tool result
   */
  async execute(input, context = {}) {
    const { skill: skillName } = input;

    debug(`Skill tool executing: ${skillName}`);

    // Parse skill name (handle fully qualified names like "package:skill")
    let name = skillName;
    if (skillName.includes(":")) {
      const parts = skillName.split(":");
      name = parts[parts.length - 1];
    }

    // Get the skill
    const skill = skillRegistry.get(name);
    if (!skill) {
      // List available skills in error message
      const available = skillRegistry.getAll();
      if (available.length === 0) {
        return this.error(`Skill "${skillName}" not found. No skills are currently available.`);
      }

      const skillList = available.map(s => `- ${s.name}: ${s.description || "(no description)"}`).join("\n");
      return this.error(`Skill "${skillName}" not found. Available skills:\n${skillList}`);
    }

    // Return the skill's prompt to be executed
    return this.success({
      skillName: skill.name,
      prompt: skill.prompt || skill.description,
      location: skill.location,
      message: `<command-message>The "${skill.name}" skill is loading</command-message>\n\n${skill.prompt || skill.description}`
    });
  }
}

// Export singleton instance
export const skillTool = new SkillTool();

export default SkillTool;
