/**
 * 阅读系统协调器：课本、单元、歌词、播放与偏好
 * @module ReadingSystem
 */

import { CONFIG, createInitialState } from './config.js';
import { qs, qsa, on, setText, toggleClass } from './utils/dom.js';
import { clamp, debounce, formatRate } from './utils/helpers.js';
import {
  getStorage,
  setStorage,
  getPlayTime,
  savePlayTime,
  getCurrentUnitIndex,
  saveCurrentUnitIndex,
} from './utils/storage.js';
import { LRCParser } from './utils/LRCParser.js';
import { BookService } from './services/BookService.js';
import { PrefetchService } from './services/PrefetchService.js';
import { AudioController } from './player/AudioController.js';
import { OptionMenu } from './ui/OptionMenu.js';
import { LyricsView } from './ui/LyricsView.js';
import { UnitView } from './ui/UnitView.js';
import { Toast } from './ui/Toast.js';

const LOOP_MODE_LABELS = {
  off: '关闭循环',
  click: '单句点读',
  follow: '跟读模式',
  one: '单句循环',
  list: '本课循环',
  book: '本书循环',
};

const TRANSLATION_LABELS = {
  show: '显示双语',
  english: '显示英文',
  chinese: '显示中文',
  blur: '模糊内容',
};

const TRANSLATION_SHORT_LABELS = {
  show: '双',
  english: '英',
  chinese: '中',
  blur: '糊',
};

export class ReadingSystem {
  constructor() {
    this.config = CONFIG;
    this.state = createInitialState();
    this.bookService = new BookService();
    this.prefetch = new PrefetchService({
      maxLrc: CONFIG.PLAYER.MAX_LRC_CACHE,
      maxAudio: CONFIG.PLAYER.MAX_AUDIO_CACHE,
    });

    this.bookAbort = null;
    this.unitAbort = null;
    this.followTimer = null;
    this.unitLoadId = 0;
    this.ready = false;
    this.persistProgress = debounce(() => this.#saveProgress(), 1500);

    this.player = new AudioController({
      audio: qs('#audioPlayer'),
      playBtn: qs('#playPauseBtn'),
      progressBar: qs('#progressBar'),
      currentTimeEl: qs('#currentTime'),
      durationEl: qs('#duration'),
      onTick: (currentTime, duration) => this.#onAudioTick(currentTime, duration),
      onPersist: () => this.#saveProgress(),
      onEnded: () => this.#onAudioEnded(),
      onLoaded: () => this.toast.show('音频已加载', { type: 'success' }),
      onPlay: () => this.#onAudioPlay(),
      onSeek: () => this.#onAudioSeek(),
    });

    this.lyricsView = new LyricsView({
      display: qs('#lyricsDisplay'),
      container: qs('.lyrics-container'),
      scrollThreshold: CONFIG.UI.LYRIC_SCROLL_THRESHOLD,
      onActivate: (index, time) => this.#onLyricActivate(index, time),
    });

    this.unitView = new UnitView({
      unitList: qs('#unitListContainer'),
      unitSelect: qs('#unitSelect'),
      bookSelects: qsa('.book-select'),
      bookCover: qs('#bookCover'),
      bookTitle: qs('#bookTitle'),
      bookHint: qs('#bookHint'),
      prevBtn: qs('#prevUnitBtn'),
      nextBtn: qs('#nextUnitBtn'),
      onUnitChange: (value) => this.#onUnitNavigate(value),
      onBookChange: (bookKey) => this.#onBookSelect(bookKey),
    });

    this.speedBtn = qs('#speedBtn');
    this.speedText = qs('#speedText');
    this.loopToggleBtn = qs('#loopToggleBtn');
    this.toggleTranslationBtn = qs('#toggleTranslationBtn');

    this.loopMenu = new OptionMenu({
      button: this.loopToggleBtn,
      root: qs('#loopMenu'),
      items: this.config.LOOP_MODES.map((mode) => ({
        value: mode,
        label: LOOP_MODE_LABELS[mode],
        icon: `loop-icon-${mode}`,
      })),
      onSelect: (mode) => this.#setLoopMode(mode),
      onOpen: () => this.#closeMenus(this.loopMenu),
    });

    this.translationMenu = new OptionMenu({
      button: this.toggleTranslationBtn,
      root: qs('#translationMenu'),
      items: this.config.TRANSLATION_MODES.map((mode) => ({
        value: mode,
        label: TRANSLATION_LABELS[mode],
      })),
      onSelect: (mode) => this.#setTranslationMode(mode),
      onOpen: () => this.#closeMenus(this.translationMenu),
    });

    this.speedMenu = new OptionMenu({
      button: this.speedBtn,
      root: qs('#speedMenu'),
      items: this.config.AVAILABLE_SPEEDS.map((rate) => ({
        value: String(rate),
        label: formatRate(rate),
      })),
      onSelect: (value) => this.#setSpeed(Number(value)),
      onOpen: () => this.#closeMenus(this.speedMenu),
    });

    this.toast = new Toast();

    this.abort = new AbortController();
    this.#bindChrome();
    this.init();
  }

  async init() {
    try {
      this.#restorePreferences();
      this.state.books = await this.bookService.loadCatalog();
      await this.applyBookFromHash();
      await this.loadUnitFromStorage();
    } catch (error) {
      if (error?.name === 'AbortError') return;
      console.error('Failed to initialize ReadingSystem:', error);
      this.lyricsView.setEmpty(this.config.ERROR_MESSAGES.LOAD_BOOKS);
    }
  }

  async applyBookFromHash() {
    const keyFromHash = location.hash.slice(1).trim();
    const storedBookKey = getStorage(this.config.STORAGE_KEYS.BOOK_SELECTION);
    const initialBookKey = keyFromHash || storedBookKey || this.config.DEFAULT_BOOK_KEY;
    await this.applyBookChange(initialBookKey);
  }

  async applyBookChange(bookKey) {
    this.#closeMenus();
    this.bookAbort?.abort();
    this.unitAbort?.abort();
    this.unitLoadId += 1;
    this.bookAbort = new AbortController();
    const { signal } = this.bookAbort;

    if (!this.state.books.length) {
      this.state.books = await this.bookService.loadCatalog(signal);
    }

    const resolved = this.bookService.resolve(bookKey, this.config.DEFAULT_BOOK_KEY);
    const resolvedPath = resolved?.path || resolved?.bookPath;
    if (!resolvedPath) {
      this.state.bookPath = '';
      this.state.bookKey = '';
      this.state.units = [];
      this.unitView.clearUnits();
      this.unitView.setBookMeta(null);
      this.lyricsView.setEmpty(this.config.ERROR_MESSAGES.NO_DATA);
      return;
    }

    this.state.bookKey = resolved.key || bookKey;
    this.state.bookPath = resolvedPath.trim().replace(/\/$/, '');
    setStorage(this.config.STORAGE_KEYS.BOOK_SELECTION, this.state.bookKey);
    this.unitView.renderBooks(this.state.books, this.state.bookKey);
    this.unitView.setBookMeta(resolved);

    this.persistProgress.cancel();
    this.#saveProgress();
    this.ready = false;
    this.#clearFollowWait();
    this.player.reset();
    this.state.currentUnitIndex = -1;
    this.state.currentLyrics = [];
    this.lyricsView.setEmpty('加载中...');
    this.prefetch.clear();

    try {
      const { units, coverUrl, bookName, bookLevel } = await this.bookService.loadBook(resolved, signal);
      this.state.units = units;
      this.unitView.setCover(coverUrl);
      this.unitView.setBookMeta({
        ...resolved,
        bookName,
        bookLevel,
      });
      this.unitView.renderUnits(units);
      this.unitView.resetListScroll();
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      console.error(this.config.ERROR_MESSAGES.LOAD_CONFIG, error);
      this.state.units = [];
      this.unitView.clearUnits();
      this.lyricsView.setEmpty(
        `${this.config.ERROR_MESSAGES.LOAD_CONFIG}: ${this.state.bookPath}/book.json`
      );
    }
  }

  async loadUnitFromStorage() {
    if (!this.state.units.length) return;
    const unitIndex = getCurrentUnitIndex(this.state.bookKey);
    const safeIndex = clamp(unitIndex, 0, this.state.units.length - 1);
    await this.loadUnitByIndex(safeIndex, { scroll: true });
  }

  async loadUnitByIndex(unitIndex, options = {}) {
    const unit = this.state.units[unitIndex];
    if (!unit) return;
    if (unitIndex === this.state.currentUnitIndex && this.ready) return;

    this.unitAbort?.abort();
    this.unitAbort = new AbortController();
    const { signal } = this.unitAbort;
    const loadId = ++this.unitLoadId;

    this.persistProgress.cancel();
    this.#saveProgress();
    this.ready = false;
    this.state.currentUnitIndex = unitIndex;
    this.state.currentLyricIndex = -1;
    this.state.sentenceLoopIndex = -1;
    this.state.followSentenceIndex = -1;
    this.#clearFollowWait();
    this.state.currentLyrics = [];
    saveCurrentUnitIndex(this.state.bookKey, unitIndex);

    this.player.reset();
    this.unitView.setActive(unitIndex, { scroll: options.scroll });
    this.unitView.updateNav(unitIndex, this.state.units.length);

    try {
      const lrcText = await this.prefetch.loadLrc(unit.lrc, signal);
      if (loadId !== this.unitLoadId) return;
      this.state.currentLyrics = LRCParser.parse(lrcText, this.config.PLAYER.TIME_OFFSET);
      this.lyricsView.render(this.state.currentLyrics);
    } catch (error) {
      if (error?.name === 'AbortError' || loadId !== this.unitLoadId) return;
      console.error(this.config.ERROR_MESSAGES.LOAD_LYRIC, error);
      this.lyricsView.setEmpty(this.config.ERROR_MESSAGES.LOAD_FAILED);
    }

    if (loadId !== this.unitLoadId) return;

    this.player.setSrc(unit.audio, {
      loop: this.state.loopMode === 'list',
      playbackRate: this.state.playbackRate,
      startTime: getPlayTime(this.state.bookKey, unitIndex),
    });
    this.ready = true;

    this.prefetch.prefetch(this.state.units[unitIndex + 1]);
  }

  destroy() {
    this.#saveProgress();
    this.#clearFollowWait();
    this.bookAbort?.abort();
    this.unitAbort?.abort();
    this.abort.abort();
    this.player.destroy();
    this.loopMenu.destroy();
    this.translationMenu.destroy();
    this.speedMenu.destroy();
    this.lyricsView.destroy();
    this.unitView.destroy();
    this.prefetch.clear();
    this.toast.destroy();
  }

  #bindChrome() {
    const { signal } = this.abort;

    on(window, 'hashchange', () => {
      const newKey = location.hash.slice(1).trim() || this.config.DEFAULT_BOOK_KEY;
      if (newKey === this.state.bookKey) return;
      this.applyBookChange(newKey)
        .then(() => this.loadUnitFromStorage())
        .catch((error) => {
          if (error?.name !== 'AbortError') {
            console.error('Failed to switch book:', error);
          }
        });
    }, { signal });

    on(document, 'visibilitychange', () => {
      if (document.hidden) this.#saveProgress();
    }, { signal });

    on(window, 'pagehide', () => this.#saveProgress(), { signal });
  }

  #restorePreferences() {
    const storedLoop = getStorage(this.config.STORAGE_KEYS.LOOP_MODE);
    if (this.config.LOOP_MODES.includes(storedLoop)) {
      this.state.loopMode = storedLoop;
    } else if (getStorage('loopPlaybackEnabled') === 'true') {
      this.state.loopMode = 'list';
    }

    const storedSpeed = parseFloat(getStorage(this.config.STORAGE_KEYS.PLAYBACK_RATE));
    if (this.config.AVAILABLE_SPEEDS.includes(storedSpeed)) {
      this.state.playbackRate = storedSpeed;
    }

    const storedTranslation = getStorage(this.config.STORAGE_KEYS.TRANSLATION_MODE);
    if (this.config.TRANSLATION_MODES.includes(storedTranslation)) {
      this.state.translationMode = storedTranslation;
    }

    this.player.setLoop(this.state.loopMode === 'list');
    this.player.setRate(this.state.playbackRate);
    this.#updateSpeedUI();
    this.#updateLoopUI();
    this.#updateTranslationUI();
  }

  #onBookSelect(bookKey) {
    if (!bookKey || location.hash.slice(1) === bookKey) return;
    location.hash = bookKey;
  }

  #onUnitNavigate(value) {
    this.#closeMenus();
    if (value === 'prev') {
      if (this.state.currentUnitIndex > 0) {
        this.loadUnitByIndex(this.state.currentUnitIndex - 1);
      }
      return;
    }
    if (value === 'next') {
      if (this.state.currentUnitIndex < this.state.units.length - 1) {
        this.loadUnitByIndex(this.state.currentUnitIndex + 1);
      }
      return;
    }
    if (Number.isFinite(value) && value >= 0) {
      this.loadUnitByIndex(value);
    }
  }

  #onLyricActivate(index, time) {
    if (this.state.loopMode === 'one' || this.state.loopMode === 'click') {
      this.state.sentenceLoopIndex = index;
    }
    if (this.state.loopMode === 'follow') {
      this.#clearFollowWait();
      this.state.followSentenceIndex = index;
    }
    this.#setHighlight(index);
    this.player.seek(time);
    this.player.play();
    this.#saveProgress(time);
  }

  #onAudioPlay() {
    if (this.state.loopMode !== 'follow') return;
    this.#clearFollowWait();
    this.state.followSentenceIndex = LRCParser.findLyricIndexByTime(
      this.state.currentLyrics,
      this.player.currentTime
    );
  }

  #onAudioSeek() {
    if (this.state.loopMode !== 'follow') return;
    this.#clearFollowWait();
    this.state.followSentenceIndex = LRCParser.findLyricIndexByTime(
      this.state.currentLyrics,
      this.player.currentTime
    );
    this.#syncHighlight();
  }

  #onAudioTick(currentTime, duration) {
    if (!this.ready) return;
    this.#handleSentence(currentTime, duration);
    this.#syncHighlight();
    this.persistProgress();
  }

  #lockedSentenceIndex() {
    if (this.state.loopMode !== 'click' && this.state.loopMode !== 'one') return -1;
    return this.state.sentenceLoopIndex;
  }

  #setHighlight(index) {
    if (index === this.state.currentLyricIndex) return;
    this.lyricsView.highlight(index);
    this.state.currentLyricIndex = index;
  }

  #syncHighlight() {
    const locked = this.#lockedSentenceIndex();
    const index = locked >= 0
      ? locked
      : this.state.followWaitIndex >= 0
        ? this.state.followWaitIndex
        : LRCParser.findLyricIndexByTime(this.state.currentLyrics, this.player.currentTime);
    this.#setHighlight(index);
  }

  #handleSentence(currentTime, duration) {
    if (this.state.loopMode === 'follow') {
      this.#handleFollow(currentTime, duration);
      return;
    }

    const locked = this.#lockedSentenceIndex();
    if (locked < 0 || !Number.isFinite(currentTime)) return;

    const boundaries = LRCParser.getSentenceBoundaries(
      this.state.currentLyrics,
      locked,
      duration
    );
    if (!boundaries || !Number.isFinite(boundaries.startTime)) return;

    const endTime = boundaries.endTime;
    if (currentTime < endTime) return;

    this.player.seek(boundaries.startTime);
    if (this.state.loopMode === 'click') {
      this.player.pause();
    }
    this.#setHighlight(locked);
  }

  /**
   * 跟读模式：每句播完后暂停 1.2 倍句长的时间，再继续下一句
   */
  #handleFollow(currentTime, duration) {
    if (!Number.isFinite(currentTime)) return;
    if (this.followTimer !== null || this.state.followWaitIndex >= 0) return;

    const lyrics = this.state.currentLyrics;
    if (!lyrics.length) return;

    const index = LRCParser.findLyricIndexByTime(lyrics, currentTime);

    // 首次进入或用户回退时只同步进度，不触发停留
    if (this.state.followSentenceIndex < 0 || index < this.state.followSentenceIndex) {
      this.state.followSentenceIndex = index;
      return;
    }
    if (index === this.state.followSentenceIndex) return;

    const endedIndex = this.state.followSentenceIndex;
    const boundaries = LRCParser.getSentenceBoundaries(lyrics, endedIndex, duration);
    const next = lyrics[index];
    if (!boundaries || !next) {
      this.state.followSentenceIndex = index;
      return;
    }

    const sentenceDuration = Math.max(0.1, boundaries.endTime - boundaries.startTime);
    const waitMs = (sentenceDuration * this.config.PLAYER.FOLLOW_WAIT_RATIO * 1000)
      / this.state.playbackRate;

    this.player.pause();
    this.player.seek(next.time);
    this.state.followSentenceIndex = index;
    this.state.followWaitIndex = endedIndex;
    this.#setHighlight(endedIndex);
    this.player.setWaiting(true);

    this.followTimer = setTimeout(() => {
      this.followTimer = null;
      this.state.followWaitIndex = -1;
      this.player.setWaiting(false);
      if (this.state.loopMode !== 'follow' || this.state.currentLyrics !== lyrics) return;
      this.player.play();
    }, waitMs);
  }

  #clearFollowWait() {
    if (this.followTimer !== null) {
      clearTimeout(this.followTimer);
      this.followTimer = null;
    }
    this.state.followWaitIndex = -1;
    this.player?.setWaiting(false);
  }

  #setSpeed(rate) {
    if (!this.config.AVAILABLE_SPEEDS.includes(rate)) return;

    const changed = rate !== this.state.playbackRate;
    this.state.playbackRate = rate;
    this.player.setRate(rate);
    setStorage(this.config.STORAGE_KEYS.PLAYBACK_RATE, rate);
    this.#updateSpeedUI();
    if (changed) this.toast.show(`播放速度 ${formatRate(rate)}`);
  }

  #updateSpeedUI() {
    const rate = this.state.playbackRate;
    const text = formatRate(rate);
    setText(this.speedText, text);

    const label = `播放速度：${text}`;
    this.speedBtn.title = label;
    this.speedBtn.setAttribute('aria-label', label);
    this.speedMenu.setActive(String(rate));
  }

  #onAudioEnded() {
    this.#saveProgress();
    this.#clearFollowWait();
    if (!this.state.units.length) return;

    if (this.state.loopMode === 'book') {
      const nextIndex = (this.state.currentUnitIndex + 1) % this.state.units.length;
      this.loadUnitByIndex(nextIndex).then(() => {
        this.player.play();
      });
    }
  }

  #setLoopMode(mode) {
    if (!this.config.LOOP_MODES.includes(mode)) return;

    const changed = mode !== this.state.loopMode;
    this.state.loopMode = mode;

    if ((mode === 'one' || mode === 'click') && this.state.currentLyricIndex >= 0) {
      this.state.sentenceLoopIndex = this.state.currentLyricIndex;
    }
    if (mode === 'follow' || mode === 'list' || mode === 'off' || mode === 'book') {
      this.state.sentenceLoopIndex = -1;
    }

    this.#clearFollowWait();
    this.state.followSentenceIndex = -1;

    setStorage(this.config.STORAGE_KEYS.LOOP_MODE, mode);
    this.player.setLoop(mode === 'list');
    this.#updateLoopUI();
    this.#syncHighlight();
    if (changed) this.toast.show(LOOP_MODE_LABELS[mode] || '播放模式');
  }

  #updateLoopUI() {
    if (!this.loopToggleBtn) return;

    const mode = this.state.loopMode;
    const isClick = mode === 'click';
    const isFollow = mode === 'follow';
    const isOne = mode === 'one';
    const isList = mode === 'list';
    const isBook = mode === 'book';

    toggleClass(this.loopToggleBtn, 'click', isClick);
    toggleClass(this.loopToggleBtn, 'follow', isFollow);
    toggleClass(this.loopToggleBtn, 'one', isOne);
    toggleClass(this.loopToggleBtn, 'list', isList);
    toggleClass(this.loopToggleBtn, 'book', isBook);

    this.loopMenu.setActive(mode);

    const label = `播放模式：${LOOP_MODE_LABELS[mode] || '关闭循环'}`;
    this.loopToggleBtn.title = label;
    this.loopToggleBtn.setAttribute('aria-label', label);
  }

  #setTranslationMode(mode) {
    if (!this.config.TRANSLATION_MODES.includes(mode)) return;

    const changed = mode !== this.state.translationMode;
    this.state.translationMode = mode;
    setStorage(this.config.STORAGE_KEYS.TRANSLATION_MODE, mode);
    this.#updateTranslationUI();
    if (changed) this.toast.show(TRANSLATION_LABELS[mode]);
  }

  #updateTranslationUI() {
    const mode = this.state.translationMode;
    this.lyricsView.applyTranslationMode(mode);
    this.translationMenu.setActive(mode);

    setText(this.toggleTranslationBtn, TRANSLATION_SHORT_LABELS[mode] || '双');
    const label = `翻译显示：${TRANSLATION_LABELS[mode] || '显示双语'}`;
    this.toggleTranslationBtn.title = label;
    this.toggleTranslationBtn.setAttribute('aria-label', label);
  }

  #closeMenus(except) {
    for (const menu of [this.loopMenu, this.translationMenu, this.speedMenu]) {
      if (menu === except) continue;
      menu.hide({ restoreFocus: false });
    }
  }

  #saveProgress(time = this.player.currentTime) {
    if (!this.ready) return;
    if (!this.state.bookKey || this.state.currentUnitIndex < 0) return;
    if (!Number.isFinite(time) || time < 0) return;
    savePlayTime(this.state.bookKey, this.state.currentUnitIndex, time);
  }
}
