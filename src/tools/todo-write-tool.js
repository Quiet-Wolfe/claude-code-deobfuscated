/**
 * TodoWrite Tool
 *
 * Manages a structured task list for tracking progress during coding sessions.
 * Helps organize complex tasks and demonstrate thoroughness to the user.
 */

import { BaseTool } from "./base-tool.js";
import { debug } from "../utils/logger.js";

/**
 * Todo item status values
 */
export const TodoStatus = {
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed"
};

/**
 * In-memory todo storage
 */
let currentTodos = [];

/**
 * TodoWrite Tool Implementation
 */
export class TodoWriteTool extends BaseTool {
  constructor() {
    super({
      name: "TodoWrite",
      description: `Use this tool to create and manage a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.

## When to Use This Tool
Use this tool proactively in these scenarios:
1. Complex multi-step tasks - When a task requires 3 or more distinct steps
2. Non-trivial and complex tasks - Tasks that require careful planning
3. User explicitly requests todo list
4. User provides multiple tasks
5. After receiving new instructions - Immediately capture user requirements
6. When you start working on a task - Mark it as in_progress BEFORE beginning work
7. After completing a task - Mark it as completed

## When NOT to Use This Tool
Skip using this tool when:
1. There is only a single, straightforward task
2. The task is trivial and tracking provides no benefit
3. The task can be completed in less than 3 trivial steps
4. The task is purely conversational or informational

## Task States
- pending: Task not yet started
- in_progress: Currently working on (limit to ONE at a time)
- completed: Task finished successfully

IMPORTANT: Task descriptions must have two forms:
- content: The imperative form (e.g., "Run tests")
- activeForm: The present continuous form (e.g., "Running tests")`,
      inputSchema: {
        type: "object",
        properties: {
          todos: {
            type: "array",
            description: "The updated todo list",
            items: {
              type: "object",
              properties: {
                content: {
                  type: "string",
                  description: "The task description in imperative form"
                },
                status: {
                  type: "string",
                  enum: ["pending", "in_progress", "completed"],
                  description: "The current status of the task"
                },
                activeForm: {
                  type: "string",
                  description: "The task description in present continuous form"
                }
              },
              required: ["content", "status", "activeForm"]
            }
          }
        },
        required: ["todos"]
      },
      requiresPermission: false
    });
  }

  /**
   * Get current todos
   * @returns {object[]}
   */
  getTodos() {
    return [...currentTodos];
  }

  /**
   * Get the currently in-progress task
   * @returns {object|null}
   */
  getCurrentTask() {
    return currentTodos.find((t) => t.status === TodoStatus.IN_PROGRESS) || null;
  }

  /**
   * Get pending tasks
   * @returns {object[]}
   */
  getPendingTasks() {
    return currentTodos.filter((t) => t.status === TodoStatus.PENDING);
  }

  /**
   * Get completed tasks
   * @returns {object[]}
   */
  getCompletedTasks() {
    return currentTodos.filter((t) => t.status === TodoStatus.COMPLETED);
  }

  /**
   * Execute the todo write operation
   * @param {object} input - Tool input
   * @param {object} context - Execution context
   * @returns {Promise<object>} Tool result
   */
  async execute(input, context = {}) {
    const { todos } = input;

    debug(`TodoWrite: Updating ${todos.length} todos`);

    // Validate todos
    for (const todo of todos) {
      if (!todo.content || todo.content.trim().length === 0) {
        return this.error("Todo content cannot be empty");
      }
      if (!todo.activeForm || todo.activeForm.trim().length === 0) {
        return this.error("Todo activeForm cannot be empty");
      }
      if (!Object.values(TodoStatus).includes(todo.status)) {
        return this.error(`Invalid status: ${todo.status}`);
      }
    }

    // Check for multiple in_progress items
    const inProgressCount = todos.filter((t) => t.status === TodoStatus.IN_PROGRESS).length;
    if (inProgressCount > 1) {
      debug(`Warning: ${inProgressCount} tasks marked as in_progress`);
    }

    // Update todos
    currentTodos = todos.map((todo, index) => ({
      id: index,
      content: todo.content,
      status: todo.status,
      activeForm: todo.activeForm,
      updatedAt: Date.now()
    }));

    // Generate summary
    const summary = {
      total: currentTodos.length,
      pending: this.getPendingTasks().length,
      inProgress: inProgressCount,
      completed: this.getCompletedTasks().length
    };

    debug(`TodoWrite: ${summary.completed}/${summary.total} completed`);

    return this.success({
      message: "Todos have been modified successfully.",
      summary
    });
  }
}

/**
 * Clear all todos (for testing)
 */
export function clearTodos() {
  currentTodos = [];
}

/**
 * Get all todos (for external access)
 */
export function getAllTodos() {
  return [...currentTodos];
}

// Export singleton instance
export const todoWriteTool = new TodoWriteTool();

export default TodoWriteTool;
