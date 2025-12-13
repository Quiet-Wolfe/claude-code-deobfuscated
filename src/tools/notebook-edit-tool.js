/**
 * NotebookEdit Tool
 *
 * Edits Jupyter notebook (.ipynb) files by replacing, inserting,
 * or deleting cells.
 */

import { readFileSync, writeFileSync, existsSync } from "../utils/fs-utils.js";
import { BaseTool } from "./base-tool.js";
import { debug } from "../utils/logger.js";

/**
 * Cell types
 */
export const CellType = {
  CODE: "code",
  MARKDOWN: "markdown",
  RAW: "raw"
};

/**
 * Edit modes
 */
export const EditMode = {
  REPLACE: "replace",
  INSERT: "insert",
  DELETE: "delete"
};

/**
 * NotebookEdit Tool Implementation
 */
export class NotebookEditTool extends BaseTool {
  constructor() {
    super({
      name: "NotebookEdit",
      description: `Completely replaces the contents of a specific cell in a Jupyter notebook (.ipynb file) with new source.

Jupyter notebooks are interactive documents that combine code, text, and visualizations, commonly used for data analysis and scientific computing.

Usage:
- The notebook_path parameter must be an absolute path, not a relative path
- The cell_number is 0-indexed
- Use edit_mode=insert to add a new cell at the index specified by cell_number
- Use edit_mode=delete to delete the cell at the index specified by cell_number
- Use edit_mode=replace (default) to replace the cell content`,
      inputSchema: {
        type: "object",
        properties: {
          notebook_path: {
            type: "string",
            description: "The absolute path to the Jupyter notebook file to edit"
          },
          new_source: {
            type: "string",
            description: "The new source for the cell"
          },
          cell_id: {
            type: "string",
            description: "The ID of the cell to edit. For insert, the new cell will be inserted after this cell."
          },
          cell_type: {
            type: "string",
            enum: ["code", "markdown"],
            description: "The type of the cell. Required for insert mode."
          },
          edit_mode: {
            type: "string",
            enum: ["replace", "insert", "delete"],
            description: "The type of edit to make. Defaults to replace."
          }
        },
        required: ["notebook_path", "new_source"]
      },
      requiresPermission: true
    });

    // Track read notebooks
    this.readNotebooks = new Set();
  }

  /**
   * Mark a notebook as read
   * @param {string} path - Notebook path
   */
  markAsRead(path) {
    this.readNotebooks.add(path);
  }

  /**
   * Check if notebook was read
   * @param {string} path - Notebook path
   * @returns {boolean}
   */
  hasBeenRead(path) {
    return this.readNotebooks.has(path);
  }

  /**
   * Parse a notebook file
   * @param {string} path - Path to notebook
   * @returns {object} Parsed notebook
   */
  parseNotebook(path) {
    const content = readFileSync(path, { encoding: "utf8" });
    return JSON.parse(content);
  }

  /**
   * Write a notebook file
   * @param {string} path - Path to notebook
   * @param {object} notebook - Notebook object
   */
  writeNotebook(path, notebook) {
    const content = JSON.stringify(notebook, null, 1);
    writeFileSync(path, content, { encoding: "utf8" });
  }

  /**
   * Find cell index by ID
   * @param {object[]} cells - Array of cells
   * @param {string} cellId - Cell ID to find
   * @returns {number} Index or -1 if not found
   */
  findCellIndex(cells, cellId) {
    if (!cellId) return -1;
    return cells.findIndex((cell) => cell.id === cellId);
  }

  /**
   * Create a new cell
   * @param {string} source - Cell source
   * @param {string} cellType - Cell type
   * @returns {object} New cell object
   */
  createCell(source, cellType) {
    const lines = source.split('\n');
    // Ensure each line ends with newline except the last
    const sourceArray = lines.map((line, i) =>
      i < lines.length - 1 ? line + '\n' : line
    );

    const cell = {
      cell_type: cellType,
      metadata: {},
      source: sourceArray
    };

    if (cellType === CellType.CODE) {
      cell.execution_count = null;
      cell.outputs = [];
    }

    // Generate a unique ID
    cell.id = `cell-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    return cell;
  }

  /**
   * Execute the notebook edit
   * @param {object} input - Tool input
   * @param {object} context - Execution context
   * @returns {Promise<object>} Tool result
   */
  async execute(input, context = {}) {
    const {
      notebook_path,
      new_source,
      cell_id,
      cell_type,
      edit_mode = EditMode.REPLACE
    } = input;

    debug(`NotebookEdit: ${edit_mode} in ${notebook_path}`);

    // Validate path
    if (!notebook_path.startsWith("/") && !notebook_path.match(/^[A-Za-z]:\\/)) {
      return this.error("notebook_path must be an absolute path");
    }

    // Check file exists
    if (!existsSync(notebook_path)) {
      return this.error(`Notebook not found: ${notebook_path}`);
    }

    // Check extension
    if (!notebook_path.endsWith('.ipynb')) {
      return this.error("File must be a Jupyter notebook (.ipynb)");
    }

    // Check if read first
    if (!this.hasBeenRead(notebook_path) && !context.skipReadCheck) {
      return this.error(
        "You must read the notebook before editing it. " +
        `Please use the Read tool to read ${notebook_path} first.`
      );
    }

    try {
      // Parse notebook
      const notebook = this.parseNotebook(notebook_path);

      if (!notebook.cells || !Array.isArray(notebook.cells)) {
        return this.error("Invalid notebook format: missing cells array");
      }

      let targetIndex;
      let action;

      switch (edit_mode) {
        case EditMode.INSERT: {
          // Insert requires cell_type
          if (!cell_type) {
            return this.error("cell_type is required for insert mode");
          }

          // Find insert position
          if (cell_id) {
            targetIndex = this.findCellIndex(notebook.cells, cell_id);
            if (targetIndex === -1) {
              return this.error(`Cell not found: ${cell_id}`);
            }
            targetIndex++; // Insert after the specified cell
          } else {
            targetIndex = 0; // Insert at beginning
          }

          // Create and insert new cell
          const newCell = this.createCell(new_source, cell_type);
          notebook.cells.splice(targetIndex, 0, newCell);
          action = `Inserted new ${cell_type} cell at index ${targetIndex}`;
          break;
        }

        case EditMode.DELETE: {
          // Find cell to delete
          if (cell_id) {
            targetIndex = this.findCellIndex(notebook.cells, cell_id);
          } else {
            return this.error("cell_id is required for delete mode");
          }

          if (targetIndex === -1) {
            return this.error(`Cell not found: ${cell_id}`);
          }

          // Delete the cell
          notebook.cells.splice(targetIndex, 1);
          action = `Deleted cell at index ${targetIndex}`;
          break;
        }

        case EditMode.REPLACE:
        default: {
          // Find cell to replace
          if (cell_id) {
            targetIndex = this.findCellIndex(notebook.cells, cell_id);
          } else {
            // Default to first cell if no ID specified
            targetIndex = 0;
          }

          if (targetIndex === -1) {
            return this.error(`Cell not found: ${cell_id}`);
          }

          if (targetIndex >= notebook.cells.length) {
            return this.error(`Cell index out of range: ${targetIndex}`);
          }

          // Update cell source
          const cell = notebook.cells[targetIndex];
          const lines = new_source.split('\n');
          cell.source = lines.map((line, i) =>
            i < lines.length - 1 ? line + '\n' : line
          );

          // Update cell type if specified
          if (cell_type && cell_type !== cell.cell_type) {
            cell.cell_type = cell_type;
            if (cell_type === CellType.CODE) {
              cell.execution_count = null;
              cell.outputs = [];
            } else {
              delete cell.execution_count;
              delete cell.outputs;
            }
          }

          action = `Replaced cell at index ${targetIndex}`;
          break;
        }
      }

      // Write updated notebook
      this.writeNotebook(notebook_path, notebook);

      debug(`NotebookEdit: ${action}`);

      return this.success({
        path: notebook_path,
        action,
        mode: edit_mode,
        cellCount: notebook.cells.length
      });
    } catch (err) {
      debug(`NotebookEdit error: ${err.message}`);

      if (err instanceof SyntaxError) {
        return this.error("Invalid notebook JSON format");
      }

      return this.error(`Failed to edit notebook: ${err.message}`);
    }
  }
}

// Export singleton instance
export const notebookEditTool = new NotebookEditTool();

export default NotebookEditTool;
