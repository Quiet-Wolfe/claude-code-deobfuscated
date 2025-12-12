/**
 * Colors and Theming
 *
 * Provides color utilities and theme definitions for terminal output.
 * Uses chalk for ANSI color support.
 */

// ANSI escape codes for colors (fallback if chalk isn't available)
const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",

  // Foreground colors
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",

  // Bright foreground colors
  brightBlack: "\x1b[90m",
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue: "\x1b[94m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",
  brightWhite: "\x1b[97m",

  // Background colors
  bgBlack: "\x1b[40m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
  bgWhite: "\x1b[47m"
};

/**
 * Simple color function creator
 * @param {string} code - ANSI code
 * @returns {Function} Color function
 */
function createColorFn(code) {
  return (text) => `${code}${text}${ANSI.reset}`;
}

/**
 * Color functions using ANSI codes
 */
export const colors = {
  reset: (text) => `${ANSI.reset}${text}`,
  bold: createColorFn(ANSI.bold),
  dim: createColorFn(ANSI.dim),
  italic: createColorFn(ANSI.italic),
  underline: createColorFn(ANSI.underline),

  // Standard colors
  black: createColorFn(ANSI.black),
  red: createColorFn(ANSI.red),
  green: createColorFn(ANSI.green),
  yellow: createColorFn(ANSI.yellow),
  blue: createColorFn(ANSI.blue),
  magenta: createColorFn(ANSI.magenta),
  cyan: createColorFn(ANSI.cyan),
  white: createColorFn(ANSI.white),

  // Bright colors
  brightBlack: createColorFn(ANSI.brightBlack),
  brightRed: createColorFn(ANSI.brightRed),
  brightGreen: createColorFn(ANSI.brightGreen),
  brightYellow: createColorFn(ANSI.brightYellow),
  brightBlue: createColorFn(ANSI.brightBlue),
  brightMagenta: createColorFn(ANSI.brightMagenta),
  brightCyan: createColorFn(ANSI.brightCyan),
  brightWhite: createColorFn(ANSI.brightWhite),

  // Semantic colors
  error: createColorFn(ANSI.red),
  warning: createColorFn(ANSI.yellow),
  success: createColorFn(ANSI.green),
  info: createColorFn(ANSI.cyan),
  muted: createColorFn(ANSI.brightBlack),

  // Claude brand color (orange/coral)
  claude: createColorFn(ANSI.brightMagenta)
};

/**
 * Theme definitions
 */
export const themes = {
  default: {
    primary: "cyan",
    secondary: "magenta",
    success: "green",
    warning: "yellow",
    error: "red",
    info: "blue",
    muted: "brightBlack",
    text: "white",
    background: "black",
    accent: "brightCyan",
    claude: "brightMagenta"
  },
  dark: {
    primary: "brightCyan",
    secondary: "brightMagenta",
    success: "brightGreen",
    warning: "brightYellow",
    error: "brightRed",
    info: "brightBlue",
    muted: "brightBlack",
    text: "brightWhite",
    background: "black",
    accent: "cyan",
    claude: "magenta"
  },
  light: {
    primary: "blue",
    secondary: "magenta",
    success: "green",
    warning: "yellow",
    error: "red",
    info: "cyan",
    muted: "brightBlack",
    text: "black",
    background: "white",
    accent: "brightBlue",
    claude: "brightMagenta"
  }
};

// Current theme
let currentTheme = themes.default;

/**
 * Set the current theme
 * @param {string|object} theme - Theme name or theme object
 */
export function setTheme(theme) {
  if (typeof theme === "string") {
    if (themes[theme]) {
      currentTheme = themes[theme];
    }
  } else if (typeof theme === "object") {
    currentTheme = { ...themes.default, ...theme };
  }
}

/**
 * Get a themed color function
 * @param {string} semantic - Semantic color name
 * @returns {Function} Color function
 */
export function themed(semantic) {
  const colorName = currentTheme[semantic] || semantic;
  return colors[colorName] || colors.white;
}

/**
 * Unicode symbols for terminal output
 */
export const symbols = {
  tick: "✓",
  cross: "✗",
  warning: "⚠",
  info: "ℹ",
  bullet: "•",
  arrow: "→",
  arrowRight: "→",
  arrowLeft: "←",
  arrowUp: "↑",
  arrowDown: "↓",
  ellipsis: "…",
  pointer: "❯",
  line: "─",
  corner: "└",
  tee: "├",
  vertical: "│",
  square: "■",
  squareSmall: "◾",
  circle: "●",
  circleFilled: "◉",
  circleEmpty: "○",
  star: "★",
  heart: "♥",
  play: "▶",
  pause: "⏸",
  stop: "⏹"
};

// Fallback symbols for terminals that don't support Unicode
export const symbolsFallback = {
  tick: "√",
  cross: "×",
  warning: "!",
  info: "i",
  bullet: "*",
  arrow: "->",
  arrowRight: "->",
  arrowLeft: "<-",
  arrowUp: "^",
  arrowDown: "v",
  ellipsis: "...",
  pointer: ">",
  line: "-",
  corner: "+",
  tee: "+",
  vertical: "|",
  square: "#",
  squareSmall: "#",
  circle: "o",
  circleFilled: "@",
  circleEmpty: "o",
  star: "*",
  heart: "<3",
  play: ">",
  pause: "||",
  stop: "[]"
};

/**
 * Check if terminal supports Unicode
 * @returns {boolean}
 */
export function supportsUnicode() {
  if (process.platform === "win32") {
    return (
      Boolean(process.env.CI) ||
      Boolean(process.env.WT_SESSION) || // Windows Terminal
      process.env.TERM_PROGRAM === "vscode" ||
      process.env.TERM === "xterm-256color" ||
      process.env.TERM === "alacritty"
    );
  }

  return process.env.TERM !== "linux"; // Linux console doesn't support Unicode well
}

/**
 * Get the appropriate symbol set
 * @returns {object} Symbol set
 */
export function getSymbols() {
  return supportsUnicode() ? symbols : symbolsFallback;
}

// Shorthand exports
export const pA = colors; // Matches original obfuscated name for chalk
export const X1 = getSymbols(); // Matches original obfuscated name for symbols

export default {
  colors,
  themes,
  setTheme,
  themed,
  symbols,
  symbolsFallback,
  supportsUnicode,
  getSymbols,
  pA,
  X1
};
