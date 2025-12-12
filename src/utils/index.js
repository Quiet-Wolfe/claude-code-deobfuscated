/**
 * Utility Functions Index
 *
 * Re-exports all utility modules for convenient importing.
 */

export * from "./logger.js";
export * from "./fs-utils.js";
export * from "./memoize.js";

// Import defaults for re-export
import logger from "./logger.js";
import fsUtils from "./fs-utils.js";
import memoizeUtils from "./memoize.js";

export { logger, fsUtils, memoizeUtils };

export default {
  ...logger,
  ...fsUtils,
  ...memoizeUtils
};
