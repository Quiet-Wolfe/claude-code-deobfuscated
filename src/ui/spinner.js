/**
 * Spinner Component
 *
 * Animated loading spinners for terminal output.
 */

import { UI_CONSTANTS } from "../constants/index.js";

/**
 * Spinner frame sets
 */
export const spinnerFrames = {
  dots: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  dots2: ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"],
  line: ["-", "\\", "|", "/"],
  arrow: ["←", "↖", "↑", "↗", "→", "↘", "↓", "↙"],
  bounce: ["⠁", "⠂", "⠄", "⠂"],
  clock: ["🕐", "🕑", "🕒", "🕓", "🕔", "🕕", "🕖", "🕗", "🕘", "🕙", "🕚", "🕛"],
  earth: ["🌍", "🌎", "🌏"],
  moon: ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"],
  simple: ["◐", "◓", "◑", "◒"],
  simpleDots: [".", "..", "...", ".."],
  pulse: ["█", "▓", "▒", "░", "▒", "▓"]
};

/**
 * Spinner class for animated loading indicators
 */
export class Spinner {
  constructor(options = {}) {
    this.frames = options.frames || spinnerFrames.dots;
    this.interval = options.interval || UI_CONSTANTS.SPINNER_INTERVAL;
    this.text = options.text || "";
    this.stream = options.stream || process.stderr;
    this.color = options.color || null;

    this.frameIndex = 0;
    this.timer = null;
    this.isSpinning = false;
  }

  /**
   * Get the current frame
   * @returns {string}
   */
  get frame() {
    return this.frames[this.frameIndex];
  }

  /**
   * Render the spinner
   */
  render() {
    const frame = this.frame;
    const text = this.text ? ` ${this.text}` : "";
    const output = `\r${frame}${text}`;

    this.stream.write(output);
  }

  /**
   * Clear the spinner line
   */
  clear() {
    this.stream.write("\r\x1b[K"); // Clear line
  }

  /**
   * Start the spinner
   * @param {string} text - Optional text to display
   * @returns {Spinner} this
   */
  start(text) {
    if (text) {
      this.text = text;
    }

    if (this.isSpinning) {
      return this;
    }

    this.isSpinning = true;
    this.render();

    this.timer = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
      this.render();
    }, this.interval);

    return this;
  }

  /**
   * Stop the spinner
   * @param {object} options - Stop options
   * @returns {Spinner} this
   */
  stop(options = {}) {
    if (!this.isSpinning) {
      return this;
    }

    clearInterval(this.timer);
    this.timer = null;
    this.isSpinning = false;
    this.frameIndex = 0;

    if (options.clear !== false) {
      this.clear();
    }

    if (options.text) {
      const symbol = options.symbol || "";
      this.stream.write(`${symbol}${options.text}\n`);
    }

    return this;
  }

  /**
   * Stop with success state
   * @param {string} text - Success message
   * @returns {Spinner} this
   */
  succeed(text) {
    return this.stop({
      text: text || this.text,
      symbol: "✓ "
    });
  }

  /**
   * Stop with failure state
   * @param {string} text - Failure message
   * @returns {Spinner} this
   */
  fail(text) {
    return this.stop({
      text: text || this.text,
      symbol: "✗ "
    });
  }

  /**
   * Stop with warning state
   * @param {string} text - Warning message
   * @returns {Spinner} this
   */
  warn(text) {
    return this.stop({
      text: text || this.text,
      symbol: "⚠ "
    });
  }

  /**
   * Stop with info state
   * @param {string} text - Info message
   * @returns {Spinner} this
   */
  info(text) {
    return this.stop({
      text: text || this.text,
      symbol: "ℹ "
    });
  }

  /**
   * Update the spinner text
   * @param {string} text - New text
   * @returns {Spinner} this
   */
  setText(text) {
    this.text = text;
    if (this.isSpinning) {
      this.render();
    }
    return this;
  }

  /**
   * Update the spinner frames
   * @param {string[]|string} frames - New frames or preset name
   * @returns {Spinner} this
   */
  setFrames(frames) {
    if (typeof frames === "string" && spinnerFrames[frames]) {
      this.frames = spinnerFrames[frames];
    } else if (Array.isArray(frames)) {
      this.frames = frames;
    }
    this.frameIndex = 0;
    return this;
  }
}

/**
 * Create a new spinner instance
 * @param {object|string} options - Options or text
 * @returns {Spinner}
 */
export function createSpinner(options = {}) {
  if (typeof options === "string") {
    options = { text: options };
  }
  return new Spinner(options);
}

/**
 * Simple progress bar
 */
export class ProgressBar {
  constructor(options = {}) {
    this.total = options.total || 100;
    this.current = 0;
    this.width = options.width || 30;
    this.complete = options.complete || "█";
    this.incomplete = options.incomplete || "░";
    this.stream = options.stream || process.stderr;
    this.format = options.format || ":bar :percent";
  }

  /**
   * Update progress
   * @param {number} value - Current value
   */
  update(value) {
    this.current = Math.min(value, this.total);
    this.render();
  }

  /**
   * Increment progress
   * @param {number} amount - Amount to increment
   */
  tick(amount = 1) {
    this.update(this.current + amount);
  }

  /**
   * Render the progress bar
   */
  render() {
    const percent = Math.round((this.current / this.total) * 100);
    const filled = Math.round((this.current / this.total) * this.width);
    const empty = this.width - filled;

    const bar = this.complete.repeat(filled) + this.incomplete.repeat(empty);
    const output = this.format
      .replace(":bar", bar)
      .replace(":percent", `${percent}%`)
      .replace(":current", String(this.current))
      .replace(":total", String(this.total));

    this.stream.write(`\r${output}`);
  }

  /**
   * Complete the progress bar
   */
  complete() {
    this.update(this.total);
    this.stream.write("\n");
  }
}

// Shorthand for creating spinner (matches original d9 function)
export const d9 = createSpinner;

export default {
  Spinner,
  spinnerFrames,
  createSpinner,
  ProgressBar,
  d9
};
