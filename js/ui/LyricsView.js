/**
 * 歌词列表渲染、高亮与点读
 * @module ui/LyricsView
 */

import { addClass, delegate, qsa, removeClass, setHTML } from '../utils/dom.js';
import { escapeHtml } from '../utils/escape.js';

const MODE_CLASS = {
  english: 'english-translation',
  chinese: 'chinese-translation',
  blur: 'blur-translation',
};

export class LyricsView {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.display
   * @param {HTMLElement} [options.container]
   * @param {number} [options.scrollThreshold=0.22]
   * @param {(index: number, time: number) => void} [options.onActivate]
   */
  constructor(options) {
    this.display = options.display;
    this.container = options.container;
    this.scrollThreshold = options.scrollThreshold ?? 0.22;
    this.onActivate = options.onActivate;
    this.lineEls = [];
    this.activeIndex = -1;
    this.abort = new AbortController();
    this.#bind();
  }

  /**
   * @param {Array<{time: number, english: string, chinese?: string}>} lyrics
   */
  render(lyrics) {
    if (!this.display) return;

    if (this.container) this.container.scrollTop = 0;
    this.activeIndex = -1;

    if (!lyrics.length) {
      this.setEmpty('没有歌词数据');
      return;
    }

    const html = lyrics
      .map((lyric, index) => {
        const chinese = lyric.chinese
          ? `<div class="lyric-translation">${escapeHtml(lyric.chinese)}</div>`
          : '';
        return `<div class="lyric-line" data-index="${index}" data-time="${lyric.time}" tabindex="0" role="button" aria-label="播放第 ${index + 1} 句">
            <div class="lyric-text">${escapeHtml(lyric.english)}</div>
            ${chinese}
          </div>`;
      })
      .join('');

    setHTML(this.display, html);
    this.lineEls = qsa('.lyric-line', this.display);
  }

  setEmpty(message) {
    if (!this.display) return;
    this.lineEls = [];
    this.activeIndex = -1;
    setHTML(this.display, `<p class="placeholder">${escapeHtml(message)}</p>`);
  }

  /**
   * @param {number} index
   */
  highlight(index) {
    if (index === this.activeIndex) return;

    if (this.activeIndex >= 0) {
      removeClass(this.lineEls[this.activeIndex], 'active');
    }

    if (index >= 0) {
      const line = this.lineEls[index];
      if (line) {
        addClass(line, 'active');
        if (this.#shouldScroll(line)) {
          line.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }

    this.activeIndex = index;
  }

  /**
   * @param {string} mode
   */
  applyTranslationMode(mode) {
    const body = document.body;
    body.classList.toggle(MODE_CLASS.english, mode === 'english');
    body.classList.toggle(MODE_CLASS.chinese, mode === 'chinese');
    body.classList.toggle(MODE_CLASS.blur, mode === 'blur');
  }

  destroy() {
    this.abort.abort();
    this.lineEls = [];
  }

  #bind() {
    if (!this.display) return;
    const signal = this.abort.signal;

    const activate = (event) => {
      const line = event.target.closest('.lyric-line');
      if (!line) return;
      const index = parseInt(line.dataset.index, 10);
      const time = parseFloat(line.dataset.time);
      if (!Number.isFinite(index) || !Number.isFinite(time)) return;
      this.onActivate?.(index, time);
    };

    delegate(this.display, 'click', '.lyric-line', activate, { signal });
    delegate(this.display, 'keydown', '.lyric-line', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      activate(event);
    }, { signal });
  }

  #shouldScroll(line) {
    if (!this.container) return true;
    const containerRect = this.container.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    const pad = containerRect.height * this.scrollThreshold;
    return lineRect.top < containerRect.top + pad || lineRect.bottom > containerRect.bottom - pad;
  }
}
