/**
 * 通用工具
 * @module utils/helpers
 */

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function throttle(func, wait = 300) {
  let lastCall = 0;
  return function throttled(...args) {
    const now = Date.now();
    if (now - lastCall >= wait) {
      lastCall = now;
      return func.apply(this, args);
    }
  };
}

export function debounce(func, wait = 300) {
  let timeoutId;
  function debounced(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      timeoutId = null;
      func.apply(this, args);
    }, wait);
  }
  debounced.cancel = () => {
    clearTimeout(timeoutId);
    timeoutId = null;
  };
  return debounced;
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * 倍速展示：整数补一位小数，保持 1.0x / 1.25x 风格统一
 * @param {number} rate
 * @returns {string}
 */
export function formatRate(rate) {
  if (!Number.isFinite(rate)) return '1.0x';
  return `${Number.isInteger(rate) ? rate.toFixed(1) : rate}x`;
}
