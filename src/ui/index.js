/**
 * UI Module Index
 *
 * Re-exports all UI components and utilities.
 */

export * from "./colors.js";
export * from "./spinner.js";

import { colors, themes, setTheme, themed, symbols, getSymbols } from "./colors.js";
import { Spinner, spinnerFrames, createSpinner, ProgressBar } from "./spinner.js";

// Re-export colors object explicitly
export { colors };

export default {
  colors,
  themes,
  setTheme,
  themed,
  symbols,
  getSymbols,
  Spinner,
  spinnerFrames,
  createSpinner,
  ProgressBar
};
