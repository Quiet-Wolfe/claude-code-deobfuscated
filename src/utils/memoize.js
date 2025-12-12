/**
 * Memoization Utilities
 *
 * Provides memoization functions for caching expensive computations.
 * Based on lodash memoize implementation.
 */

/**
 * Simple Map-based cache
 */
class MapCache {
  constructor(entries = []) {
    this.data = new Map();
    for (const [key, value] of entries) {
      this.set(key, value);
    }
  }

  clear() {
    this.data.clear();
    return this;
  }

  delete(key) {
    const result = this.data.delete(key);
    return result;
  }

  get(key) {
    return this.data.get(key);
  }

  has(key) {
    return this.data.has(key);
  }

  set(key, value) {
    this.data.set(key, value);
    return this;
  }

  get size() {
    return this.data.size;
  }
}

/**
 * Create a memoized function that caches results
 * @param {Function} fn - Function to memoize
 * @param {Function} resolver - Optional function to resolve cache key
 * @returns {Function} Memoized function
 */
export function memoize(fn, resolver) {
  if (typeof fn !== "function" || (resolver != null && typeof resolver !== "function")) {
    throw new TypeError("Expected a function");
  }

  const memoized = function (...args) {
    const key = resolver ? resolver.apply(this, args) : args[0];
    const cache = memoized.cache;

    if (cache.has(key)) {
      return cache.get(key);
    }

    const result = fn.apply(this, args);
    memoized.cache = cache.set(key, result) || cache;
    return result;
  };

  memoized.cache = new (memoize.Cache || MapCache)();
  return memoized;
}

// Allow custom cache implementation
memoize.Cache = MapCache;

/**
 * Memoize with a maximum cache size (LRU eviction)
 * @param {Function} fn - Function to memoize
 * @param {object} options - Options including maxSize
 * @returns {Function} Memoized function with LRU cache
 */
export function memoizeLRU(fn, options = {}) {
  const maxSize = options.maxSize || 100;
  const resolver = options.resolver;
  const cache = new Map();
  const order = [];

  return function (...args) {
    const key = resolver ? resolver.apply(this, args) : args[0];

    if (cache.has(key)) {
      // Move to end (most recently used)
      const index = order.indexOf(key);
      if (index > -1) {
        order.splice(index, 1);
        order.push(key);
      }
      return cache.get(key);
    }

    const result = fn.apply(this, args);

    // Evict oldest if at capacity
    if (order.length >= maxSize) {
      const oldest = order.shift();
      cache.delete(oldest);
    }

    cache.set(key, result);
    order.push(key);
    return result;
  };
}

/**
 * Memoize with time-based expiration
 * @param {Function} fn - Function to memoize
 * @param {number} ttlMs - Time to live in milliseconds
 * @param {Function} resolver - Optional key resolver
 * @returns {Function} Memoized function with TTL
 */
export function memoizeTTL(fn, ttlMs, resolver) {
  const cache = new Map();

  return function (...args) {
    const key = resolver ? resolver.apply(this, args) : args[0];
    const now = Date.now();

    if (cache.has(key)) {
      const entry = cache.get(key);
      if (now - entry.timestamp < ttlMs) {
        return entry.value;
      }
      cache.delete(key);
    }

    const result = fn.apply(this, args);
    cache.set(key, { value: result, timestamp: now });
    return result;
  };
}

/**
 * Memoize async functions
 * @param {Function} fn - Async function to memoize
 * @param {Function} resolver - Optional key resolver
 * @returns {Function} Memoized async function
 */
export function memoizeAsync(fn, resolver) {
  const cache = new Map();
  const pending = new Map();

  return async function (...args) {
    const key = resolver ? resolver.apply(this, args) : args[0];

    // Return cached result
    if (cache.has(key)) {
      return cache.get(key);
    }

    // Wait for pending request with same key
    if (pending.has(key)) {
      return pending.get(key);
    }

    // Execute and cache
    const promise = fn.apply(this, args);
    pending.set(key, promise);

    try {
      const result = await promise;
      cache.set(key, result);
      return result;
    } finally {
      pending.delete(key);
    }
  };
}

/**
 * Create a function that only executes once
 * @param {Function} fn - Function to execute once
 * @returns {Function} Function that only runs once
 */
export function once(fn) {
  let called = false;
  let result;

  return function (...args) {
    if (!called) {
      called = true;
      result = fn.apply(this, args);
    }
    return result;
  };
}

/**
 * Debounce function execution
 * @param {Function} fn - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @param {object} options - Options for leading/trailing execution
 * @returns {Function} Debounced function
 */
export function debounce(fn, wait, options = {}) {
  let timeout;
  let lastArgs;
  let lastThis;
  let result;
  let lastCallTime;
  let lastInvokeTime = 0;
  const leading = !!options.leading;
  const trailing = options.trailing !== false;
  const maxWait = options.maxWait;

  function invokeFunc(time) {
    const args = lastArgs;
    const thisArg = lastThis;
    lastArgs = lastThis = undefined;
    lastInvokeTime = time;
    result = fn.apply(thisArg, args);
    return result;
  }

  function shouldInvoke(time) {
    const timeSinceLastCall = time - lastCallTime;
    const timeSinceLastInvoke = time - lastInvokeTime;

    return (
      lastCallTime === undefined ||
      timeSinceLastCall >= wait ||
      timeSinceLastCall < 0 ||
      (maxWait !== undefined && timeSinceLastInvoke >= maxWait)
    );
  }

  function timerExpired() {
    const time = Date.now();
    if (shouldInvoke(time)) {
      return trailingEdge(time);
    }
    timeout = setTimeout(timerExpired, remainingWait(time));
  }

  function remainingWait(time) {
    const timeSinceLastCall = time - lastCallTime;
    const timeSinceLastInvoke = time - lastInvokeTime;
    const timeWaiting = wait - timeSinceLastCall;

    return maxWait !== undefined
      ? Math.min(timeWaiting, maxWait - timeSinceLastInvoke)
      : timeWaiting;
  }

  function leadingEdge(time) {
    lastInvokeTime = time;
    timeout = setTimeout(timerExpired, wait);
    return leading ? invokeFunc(time) : result;
  }

  function trailingEdge(time) {
    timeout = undefined;
    if (trailing && lastArgs) {
      return invokeFunc(time);
    }
    lastArgs = lastThis = undefined;
    return result;
  }

  function debounced(...args) {
    const time = Date.now();
    const isInvoking = shouldInvoke(time);

    lastArgs = args;
    lastThis = this;
    lastCallTime = time;

    if (isInvoking) {
      if (timeout === undefined) {
        return leadingEdge(time);
      }
      if (maxWait !== undefined) {
        timeout = setTimeout(timerExpired, wait);
        return invokeFunc(time);
      }
    }
    if (timeout === undefined) {
      timeout = setTimeout(timerExpired, wait);
    }
    return result;
  }

  debounced.cancel = function () {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    lastInvokeTime = 0;
    lastArgs = lastCallTime = lastThis = timeout = undefined;
  };

  debounced.flush = function () {
    return timeout === undefined ? result : trailingEdge(Date.now());
  };

  return debounced;
}

/**
 * Throttle function execution
 * @param {Function} fn - Function to throttle
 * @param {number} wait - Wait time in milliseconds
 * @param {object} options - Options for leading/trailing execution
 * @returns {Function} Throttled function
 */
export function throttle(fn, wait, options = {}) {
  return debounce(fn, wait, {
    leading: options.leading !== false,
    trailing: options.trailing !== false,
    maxWait: wait
  });
}

export default {
  memoize,
  memoizeLRU,
  memoizeTTL,
  memoizeAsync,
  once,
  debounce,
  throttle
};
