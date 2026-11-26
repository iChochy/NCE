/**
 * 通用单选菜单：点击按钮展开选项列表，选中后立即生效
 * @module ui/OptionMenu
 */

import { addClass, on, qs, removeClass, toggleClass } from '../utils/dom.js';

const VIEWPORT_PADDING = 8;
const ANCHOR_GAP = 6;

function createCheckIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'option-menu-check');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M4 10.5l4 4 8-9');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}

export class OptionMenu {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.button 触发按钮
   * @param {HTMLElement} options.root 菜单容器
   * @param {Array<{value: string, label: string, icon?: string}>} options.items 选项
   * @param {HTMLElement} [options.iconSource] 图标来源，默认取触发按钮
   * @param {(value: string) => void} [options.onSelect] 选中回调
   * @param {() => void} [options.onOpen] 展开回调，用于收起其他菜单
   */
  constructor(options = {}) {
    this.button = options.button;
    this.root = options.root;
    this.options = options.items || [];
    this.iconSource = options.iconSource || options.button;
    this.onSelect = options.onSelect;
    this.onOpen = options.onOpen;

    this.items = [];
    this.activeValue = '';
    this.isOpen = false;
    this.abort = new AbortController();

    this.#render();
    this.#bind();
  }

  /**
   * 标记当前生效的选项
   * @param {string} value
   */
  setActive(value) {
    this.activeValue = value;
    for (const item of this.items) {
      const checked = item.dataset.value === value;
      item.setAttribute('aria-checked', checked ? 'true' : 'false');
      toggleClass(item, 'active', checked);
    }
  }

  /**
   * 展开菜单并把焦点移到指定项
   * @param {number} [focusIndex]
   */
  show(focusIndex = -1) {
    if (!this.root || !this.items.length) return;

    if (!this.isOpen) this.onOpen?.();

    // 先定位再显示，避免淡出/淡入瞬间出现在旧的左上角位置
    this.#position();
    this.isOpen = true;
    addClass(this.root, 'open');
    addClass(this.button, 'menu-open');
    this.button.setAttribute('aria-expanded', 'true');

    const index = focusIndex >= 0 ? focusIndex : this.#activeIndex();
    this.items[Math.min(index, this.items.length - 1)]?.focus({ preventScroll: true });
  }

  /**
   * 收起菜单
   * @param {{restoreFocus?: boolean}} [options]
   */
  hide(options = {}) {
    if (!this.root || !this.isOpen) return;

    this.isOpen = false;
    removeClass(this.root, 'open');
    removeClass(this.button, 'menu-open');
    this.button.setAttribute('aria-expanded', 'false');
    // 保留 left/top：淡出期间元素停在原处，否则会先跳回左上角再消失

    if (options.restoreFocus === false) return;
    if (this.root.contains(document.activeElement)) {
      this.button.focus({ preventScroll: true });
    }
  }

  toggle() {
    if (this.isOpen) {
      this.hide();
    } else {
      this.show();
    }
  }

  destroy() {
    this.abort.abort();
    this.items = [];
    this.root?.replaceChildren();
  }

  #render() {
    if (!this.root) return;

    const fragment = document.createDocumentFragment();

    for (const option of this.options) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'option-menu-item';
      item.dataset.value = option.value;
      item.tabIndex = -1;
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', 'false');

      if (option.icon) {
        const iconWrap = document.createElement('span');
        iconWrap.className = 'option-menu-icon';
        const icon = qs(`.${option.icon}`, this.iconSource);
        if (icon) iconWrap.appendChild(icon.cloneNode(true));
        item.appendChild(iconWrap);
      }

      const label = document.createElement('span');
      label.className = 'option-menu-label';
      label.textContent = option.label;

      item.append(label, createCheckIcon());
      fragment.appendChild(item);
      this.items.push(item);
    }

    this.root.replaceChildren(fragment);
  }

  #bind() {
    const { signal } = this.abort;

    on(this.button, 'click', (event) => {
      event.preventDefault();
      this.toggle();
    }, { signal });

    on(this.button, 'keydown', (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      this.show(event.key === 'ArrowUp' ? this.items.length - 1 : 0);
    }, { signal });

    on(this.root, 'click', (event) => {
      const item = event.target.closest('.option-menu-item');
      if (!item) return;
      this.#select(item.dataset.value);
    }, { signal });

    on(this.root, 'keydown', (event) => this.#onMenuKeydown(event), { signal });

    on(document, 'pointerdown', (event) => {
      if (!this.isOpen) return;
      if (this.root.contains(event.target) || this.button.contains(event.target)) return;
      this.hide({ restoreFocus: false });
    }, { signal });

    on(window, 'resize', () => this.hide({ restoreFocus: false }), { signal });
  }

  #onMenuKeydown(event) {
    const items = this.items;
    if (!items.length) return;

    const index = items.indexOf(document.activeElement);

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        items[(index + 1) % items.length].focus({ preventScroll: true });
        break;
      case 'ArrowUp':
        event.preventDefault();
        items[(index - 1 + items.length) % items.length].focus({ preventScroll: true });
        break;
      case 'Home':
        event.preventDefault();
        items[0].focus({ preventScroll: true });
        break;
      case 'End':
        event.preventDefault();
        items[items.length - 1].focus({ preventScroll: true });
        break;
      case 'Escape':
        event.preventDefault();
        this.hide();
        break;
      case 'Tab':
        event.preventDefault();
        this.hide();
        break;
      default:
        break;
    }
  }

  #select(value) {
    if (!value) return;
    this.setActive(value);
    this.hide();
    this.onSelect?.(value);
  }

  #activeIndex() {
    const index = this.items.findIndex((item) => item.dataset.value === this.activeValue);
    return index >= 0 ? index : 0;
  }

  /**
   * 依据按钮位置在视口内定位菜单，空间不足时向上展开
   * 用 offsetWidth / offsetHeight 取未受 transform 影响的真实尺寸
   */
  #position() {
    if (!this.root || !this.button) return;

    const buttonRect = this.button.getBoundingClientRect();
    const menuWidth = this.root.offsetWidth;
    const menuHeight = this.root.offsetHeight;
    if (!menuWidth || !menuHeight) return;

    const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - VIEWPORT_PADDING - menuWidth);

    let left = buttonRect.right - menuWidth;
    left = Math.min(Math.max(left, VIEWPORT_PADDING), maxLeft);

    let top = buttonRect.bottom + ANCHOR_GAP;
    if (top + menuHeight > window.innerHeight - VIEWPORT_PADDING) {
      top = Math.max(VIEWPORT_PADDING, buttonRect.top - ANCHOR_GAP - menuHeight);
    }

    this.root.style.left = `${Math.round(left)}px`;
    this.root.style.top = `${Math.round(top)}px`;
  }
}
