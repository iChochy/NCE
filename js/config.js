/**
 * 全局常量
 * @module config
 */

export const CONFIG = {
  DEFAULT_BOOK_KEY: 'YL5A',

  STORAGE_KEYS: {
    BOOK_SELECTION: 'selectedBookKey',
    LOOP_MODE: 'loopMode',
    PLAYBACK_RATE: 'playbackRate',
    TRANSLATION_MODE: 'translationMode',
    THEME: 'theme',
  },

  AVAILABLE_SPEEDS: [0.5, 0.8, 1.0, 1.2, 1.5, 1.8, 2.0],
  TRANSLATION_MODES: ['show', 'english', 'chinese', 'blur'],
  LOOP_MODES: ['off', 'click', 'follow', 'one', 'list', 'book'],

  PLAYER: {
    MAX_AUDIO_CACHE: 1,
    MAX_LRC_CACHE: 1,
    TIME_OFFSET: 0.3,
    FOLLOW_WAIT_RATIO: 1.2,
  },

  UI: {
    LYRIC_SCROLL_THRESHOLD: 0.1,
    THEME_ANIMATION_DURATION: 300,
    MODAL_ANIMATION_DURATION: 200,
  },

  ERROR_MESSAGES: {
    LOAD_BOOKS: '加载课本数据失败',
    LOAD_CONFIG: '课件配置加载失败',
    LOAD_LYRIC: '加载歌词失败',
    NO_DATA: '未找到可用课本数据',
    LOAD_FAILED: '加载失败',
  },
};

export function createInitialState() {
  return {
    books: [],
    units: [],
    bookPath: '',
    bookKey: '',
    currentLyrics: [],
    currentLyricIndex: -1,
    currentUnitIndex: -1,
    loopMode: 'off',
    playbackRate: 1.0,
    translationMode: 'show',
    sentenceLoopIndex: -1,
    followSentenceIndex: -1,
    followWaitIndex: -1,
  };
}
