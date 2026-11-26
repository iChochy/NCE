/**
 * 打赏弹窗
 * @module ui/modal
 */

import { CONFIG } from '../config.js';

export class SupportModal {
  constructor(options = {}) {
    this.modal = options.modal || document.getElementById('supportModal');
    this.openBtn = options.openBtn || document.getElementById('supportBtn');
    this.closeBtn = options.closeBtn || document.getElementById('supportCloseBtn');
    this.isOpen = false;
    this.animationDuration = options.animationDuration || CONFIG.UI.MODAL_ANIMATION_DURATION;
  }

  init() {
    if (!this.modal || !this.openBtn || !this.closeBtn) return;

    this.openBtn.addEventListener('click', () => this.open());
    this.closeBtn.addEventListener('click', () => this.close());
    this.modal.addEventListener('click', (event) => {
      if (event.target === this.modal) this.close();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.isOpen) this.close();
    });
  }

  open() {
    if (!this.modal || this.isOpen) return;
    this.modal.classList.add('open');
    this.modal.setAttribute('aria-hidden', 'false');
    this.isOpen = true;
    // 点击按钮后浏览器会把焦点移回按钮，等一帧再把焦点放进弹窗
    requestAnimationFrame(() => {
      if (this.isOpen) this.closeBtn?.focus();
    });
  }

  close() {
    if (!this.modal || !this.isOpen) return;
    this.modal.classList.remove('open');
    this.modal.setAttribute('aria-hidden', 'true');
    this.isOpen = false;
    this.openBtn?.focus();
  }
}
