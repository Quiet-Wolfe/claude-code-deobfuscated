/**
 * UI Module Index
 *
 * Re-exports all UI components and utilities.
 */

export * from "./colors.js";
export * from "./spinner.js";

import colors from "./colors.js";
import spinner from "./spinner.js";

export { colors, spinner };

export default {
  ...colors,
  ...spinner
};
