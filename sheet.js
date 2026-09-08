// ═══════════════════════════════════════════════════════════════
//  sheet.js — Единый базовый модуль для всех bottom sheets
//  dastdaroz / home.html
//
//  Использование:
//    import { Sheet } from './sheet.js';
//
//    // 1. Зарегистрировать sheet (один раз при инициализации)
//    Sheet.define({
//      id:      'city',
//      title:   'Выбор города',
//      zIndex:  700,
//      onOpen:  () => _loadCities(),
//      onClose: () => {},
//    });
//
//    // 2. Наполнить тело контентом (один раз)
//    Sheet.body('city').innerHTML = `<div id="citysh-list">…</div>`;
//
//    // 3. Открыть / закрыть
//    Sheet.open('city');
//    Sheet.close('city');
//
//    // 4. Дополнительные утилиты
//    Sheet.setTitle('city', 'Новый заголовок');
//    Sheet.isOpen('city');   // → true / false
// ═══════════════════════════════════════════════════════════════


// ── Базовые стили (инжектируются в <head> один раз) ───────────
const _BASE_CSS = `
/* ── BASE SHEET ─────────────────────────────────────────────── */

/* Затемнение */
.bs-ov {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.45);
  opacity: 0; pointer-events: none;
  transition: opacity .28s;
}
.bs-ov.open { opacity: 1; pointer-events: all; }

/* Сам sheet — выезжает снизу вверх, занимает весь экран */
.bs-box {
  position: fixed; left: 0; right: 0; bottom: 0;
  height: 100svh;
  background: var(--s1, #212121);
  border-radius: 22px 22px 0 0;
  transform: translateY(100%);
  transition: transform .38s cubic-bezier(.32,0,.18,1);
  display: flex; flex-direction: column;
  overflow: hidden;
  will-change: transform;
}
.bs-box.open { transform: translateY(0); }

/* Drag-handle */
.bs-drag {
  width: 36px; height: 4px;
  border-radius: 99px;
  background: rgba(255,255,255,.13);
  margin: 10px auto 0;
  flex-shrink: 0;
  cursor: grab;
  touch-action: none;
}

/* Шапка */
.bs-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 18px 14px;
  border-bottom: 1px solid rgba(255,255,255,.07);
  flex-shrink: 0;
}
.bs-head-title {
  font-family: var(--fd, 'Unbounded', sans-serif);
  font-weight: 900; font-size: 1rem;
  color: var(--tx, #e8e8e8);
}

/* Кнопка закрытия */
.bs-close {
  background: var(--s2, #2a2a2a);
  border: none;
  width: 32px; height: 32px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  color: var(--tx2, #888888);
  flex-shrink: 0;
  transition: background .13s;
}
.bs-close:hover { background: var(--s3, #2f2f2f); }

/* Тело — сюда идёт весь уникальный контент */
.bs-body {
  flex: 1;
  overflow-y: auto; overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 16px);
}
`;

let _cssReady = false;
function _ensureCSS() {
  if (_cssReady) return;
  const el = document.createElement('style');
  el.id = 'bs-base-styles';
  el.textContent = _BASE_CSS;
  document.head.appendChild(el);
  _cssReady = true;
}


// ── Реестр всех sheet-ов ──────────────────────────────────────
const _reg = {};


// ── Публичный API ─────────────────────────────────────────────
export const Sheet = {

  /**
   * Регистрирует новый sheet и создаёт его DOM-структуру.
   *
   * @param {object} cfg
   * @param {string}   cfg.id       — уникальный ключ (напр. 'city', 'caddr')
   * @param {string}   cfg.title    — текст заголовка
   * @param {number}  [cfg.zIndex=600] — z-index overlay; box получает zIndex+1
   * @param {Function}[cfg.onOpen]  — коллбэк при открытии (опц.)
   * @param {Function}[cfg.onClose] — коллбэк при закрытии (опц.)
   */
  define({ id, title, zIndex = 600, onOpen = null, onClose = null }) {
    _ensureCSS();

    if (_reg[id]) {
      console.warn(`[Sheet] "${id}" already defined, skipping`);
      return;
    }

    // ── Overlay ─────────────────────────────────────────────
    const ov = document.createElement('div');
    ov.className = 'bs-ov';
    ov.id = `bs-ov-${id}`;
    ov.style.zIndex = zIndex;
    ov.addEventListener('click', () => Sheet.close(id));

    // ── Box ──────────────────────────────────────────────────
    const box = document.createElement('div');
    box.className = 'bs-box';
    box.id = `bs-${id}`;
    box.style.zIndex = zIndex + 1;

    // Drag handle
    const drag = document.createElement('div');
    drag.className = 'bs-drag';
    box.appendChild(drag);

    // Шапка
    const head = document.createElement('div');
    head.className = 'bs-head';

    const titleEl = document.createElement('div');
    titleEl.className = 'bs-head-title';
    titleEl.textContent = title;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'bs-close';
    closeBtn.setAttribute('aria-label', 'Закрыть');
    closeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2.5">
      <line x1="18" y1="6"  x2="6"  y2="18"/>
      <line x1="6"  y1="6"  x2="18" y2="18"/>
    </svg>`;
    closeBtn.addEventListener('click', () => Sheet.close(id));

    head.append(titleEl, closeBtn);
    box.appendChild(head);

    // Тело — сюда будет вставляться уникальный контент
    const body = document.createElement('div');
    body.className = 'bs-body';
    body.id = `bs-body-${id}`;
    box.appendChild(body);

    document.body.append(ov, box);

    _reg[id] = { ov, box, body, onOpen, onClose };
  },

  // ─────────────────────────────────────────────────────────

  /** Открыть sheet */
  open(id) {
    const s = _reg[id];
    if (!s) { console.warn(`[Sheet] open: "${id}" not defined`); return; }
    s.ov.classList.add('open');
    s.box.classList.add('open');
    document.body.style.overflow = 'hidden';
    s.onOpen?.();
  },

  /** Закрыть sheet */
  close(id) {
    const s = _reg[id];
    if (!s) return;
    s.ov.classList.remove('open');
    s.box.classList.remove('open');
    document.body.style.overflow = '';
    s.onClose?.();
  },

  /**
   * Получить DOM-элемент тела sheet (div.bs-body).
   * Используется для вставки уникального контента:
   *   Sheet.body('city').innerHTML = `...`;
   */
  body(id) {
    return _reg[id]?.body ?? null;
  },

  /** Изменить заголовок sheet в рантайме */
  setTitle(id, title) {
    const s = _reg[id];
    if (s) s.box.querySelector('.bs-head-title').textContent = title;
  },

  /** true если sheet сейчас открыт */
  isOpen(id) {
    return _reg[id]?.box.classList.contains('open') ?? false;
  },

  /** Закрыть все открытые sheet-ы (например при навигации) */
  closeAll() {
    for (const id of Object.keys(_reg)) {
      if (Sheet.isOpen(id)) Sheet.close(id);
    }
  },
};


// ═══════════════════════════════════════════════════════════════
//  МИГРАЦИЯ СУЩЕСТВУЮЩИХ SHEETS — ЧТО МЕНЯТЬ В app.js / home.html
// ═══════════════════════════════════════════════════════════════
//
//  ── 1. CITY SHEET ────────────────────────────────────────────
//
//  В app.js (секция 22. Выбор города) заменить всё на:
//
//  function _initCitySheet() {
//    Sheet.define({
//      id:     'city',
//      title:  'Выбор города',
//      zIndex: 700,
//      onOpen: _loadCities,
//    });
//
//    Sheet.body('city').innerHTML = `
//      <p class="citysh-subtitle">
//        Все магазины и доставка будут показаны для выбранного города
//      </p>
//      <div class="citysh-list" id="citysh-list">
//        <div class="citysh-empty">Загружаем города…</div>
//      </div>
//    `;
//  }
//
//  window.openCitySheet  = () => Sheet.open('city');
//  window.closeCitySheet = () => Sheet.close('city');
//
//  В home.html УДАЛИТЬ блок HTML:
//    <div class="citysh-ov" ...>
//    <div class="citysh" ...>...</div>
//
//  В home.html УДАЛИТЬ CSS:
//    .citysh-ov { ... }   .citysh { ... }
//    .citysh-drag { ... } .citysh-head { ... }
//    .citysh-title { ... } .citysh-close { ... }
//  (оставить только .citysh-list, .citysh-item*, .citysh-subtitle, .citysh-empty)
//
//
//  ── 2. CART ADDRESS SHEET (caddrsh) ──────────────────────────
//
//  function _initCaddrSheet() {
//    Sheet.define({
//      id:     'caddr',
//      title:  'Адрес доставки',
//      zIndex: 700,
//    });
//
//    Sheet.body('caddr').innerHTML = `
//      <div class="caddrsh-list" id="caddrsh-list">
//        <div class="caddrsh-empty">Адреса загружаются…</div>
//      </div>
//      <div style="padding:0 18px 4px;flex-shrink:0">
//        <button class="caddrsh-goto" onclick="openAddAddrSheet()">
//          + Новый адрес
//        </button>
//      </div>
//    `;
//  }
//
//  window.openCartAddrSheet  = () => Sheet.open('caddr');
//  window.closeCartAddrSheet = () => Sheet.close('caddr');
//
//  В home.html УДАЛИТЬ:
//    <div class="caddrsh-ov" ...>
//    <div class="caddrsh" ...>...</div>
//
//  В home.html УДАЛИТЬ CSS:
//    .caddrsh-ov { ... }  .caddrsh { ... }
//    .caddrsh-drag { ... } .caddrsh-head { ... }
//    .caddrsh-title { ... } .caddrsh-close { ... }
//
//
//  ── 3. ADD ADDRESS SHEET (addaddr) ───────────────────────────
//
//  function _initAddAddrSheet() {
//    Sheet.define({
//      id:     'addaddr',
//      title:  'Новый адрес',
//      zIndex: 710,
//    });
//
//    Sheet.body('addaddr').innerHTML = `
//      <div style="padding:0 20px">
//        <label class="addaddr-lbl">Адрес</label>
//        <input class="addaddr-inp" id="addaddr-inp" .../>
//        <label class="addaddr-lbl">Комментарий</label>
//        <textarea class="addaddr-inp" id="addaddr-comment" ...></textarea>
//        <button class="addaddr-save" onclick="saveAddr()">Сохранить</button>
//      </div>
//    `;
//  }
//
//  window.openAddAddrSheet  = () => Sheet.open('addaddr');
//  window.closeAddAddrSheet = () => Sheet.close('addaddr');
//
//
//  ── ИНИЦИАЛИЗАЦИЯ (вызвать в init() или onAuthStateChanged) ──
//
//  _initCitySheet();
//  _initCaddrSheet();
//  _initAddAddrSheet();
//  // ... и т.д. для других sheets
//
// ═══════════════════════════════════════════════════════════════
