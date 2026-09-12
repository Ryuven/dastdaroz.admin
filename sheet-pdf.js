// ═══════════════════════════════════════════════════════════════
//  sheet-pdf.js — PDF Bottom Sheet
//  dastdaroz / home.html
//
//  Самостоятельный модуль, не зависит от sheet.js.
//  Структура и стили повторяют sheet.js, но тело рендерит PDF.
//
//  Использование:
//    import { SheetPdf } from './sheet-pdf.js';
//
//    // 1. Зарегистрировать (один раз, при инициализации)
//    SheetPdf.define({
//      id:     'oferta',
//      title:  'Публичная оферта',
//      url:    'https://dastdaroz.shop/help/terms.pdf',
//      zIndex: 700,           // опционально, по умолчанию 700
//    });
//
//    // 2. Открыть / закрыть
//    window.openOfertaSheet  = () => SheetPdf.open('oferta');
//    window.closeOfertaSheet = () => SheetPdf.close('oferta');
//
//  PDF загружается лениво при первом открытии и кэшируется.
//  При ошибке показывается кнопка «Повторить».
// ═══════════════════════════════════════════════════════════════


// ── PDF.js CDN ────────────────────────────────────────────────
const _PDFJS_SRC    = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const _PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';


// ── Стили ─────────────────────────────────────────────────────
const _CSS = `
/* ── PDF SHEET OVERLAY ───────────────────────────────────── */
.bsp-ov {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.45);
  opacity: 0; pointer-events: none;
  transition: opacity .28s;
}
.bsp-ov.open { opacity: 1; pointer-events: all; }

/* ── PDF SHEET BOX ───────────────────────────────────────── */
.bsp-box {
  position: fixed; left: 0; right: 0; bottom: 0;
  height: 100svh;
  background: var(--s1, #fff);
  border-radius: 22px 22px 0 0;
  transform: translateY(100%);
  transition: transform .38s cubic-bezier(.32,0,.18,1);
  display: flex; flex-direction: column;
  overflow: hidden;
  will-change: transform;
}
.bsp-box.open { transform: translateY(0); }

/* ── DRAG HANDLE ─────────────────────────────────────────── */
.bsp-drag {
  width: 36px; height: 4px;
  border-radius: 99px;
  background: rgba(0,0,0,.11);
  margin: 10px auto 0;
  flex-shrink: 0;
  cursor: grab;
  touch-action: none;
}

/* ── HEADER ──────────────────────────────────────────────── */
.bsp-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 18px 14px;
  border-bottom: 1px solid rgba(0,0,0,.07);
  flex-shrink: 0;
}
.bsp-head-title {
  font-family: var(--fd, 'Unbounded', sans-serif);
  font-weight: 900; font-size: 1rem;
  color: var(--tx, #171f1a);
}
.bsp-close {
  background: var(--s2, #edf4ef); border: none;
  width: 32px; height: 32px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; color: var(--tx2, #3d5244); flex-shrink: 0;
  transition: background .13s;
}
.bsp-close:hover { background: var(--s3, #e0ede3); }

/* ── BODY (скроллится) ───────────────────────────────────── */
.bsp-body {
  flex: 1; overflow-y: auto; overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  background: var(--s2, #edf4ef);
  padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 16px);
}

/* ── СКЕЛЕТОНЫ A4 (пока грузится PDF) ───────────────────── */
.bsp-skl-wrap {
  padding: 14px;
  display: flex; flex-direction: column; gap: 12px;
}
.bsp-skl-page {
  width: 100%;
  aspect-ratio: 210 / 297;    /* пропорции листа A4 */
  border-radius: 10px;
  background: linear-gradient(
    90deg,
    var(--s3, #e0ede3) 25%,
    var(--bg, #f3f7f4) 50%,
    var(--s3, #e0ede3) 75%
  );
  background-size: 200% 100%;
  animation: bsp-shimmer 1.5s ease-in-out infinite;
}
.bsp-skl-page:nth-child(2) { animation-delay: .18s; }

@keyframes bsp-shimmer {
  from { background-position: 100% 0; }
  to   { background-position: -100% 0; }
}

/* ── СТРАНИЦЫ PDF ────────────────────────────────────────── */
.bsp-pages {
  padding: 14px;
  display: flex; flex-direction: column; gap: 10px;
}
.bsp-page-canvas {
  display: block; width: 100%;    /* CSS-ширина; высота задаётся inline */
  border-radius: 10px;
  box-shadow: 0 2px 14px rgba(0,0,0,.09);
  background: #fff;
}

/* ── ОШИБКА ──────────────────────────────────────────────── */
.bsp-err {
  padding: 52px 20px; text-align: center;
}
.bsp-err-ico { font-size: 2rem; margin-bottom: 12px; }
.bsp-err-txt {
  font-size: .78rem; color: var(--tx3, #7a9882); line-height: 1.6;
  margin-bottom: 18px;
}
.bsp-err-retry {
  padding: 10px 24px;
  background: var(--acc, #1a9e4a); color: #fff;
  border: none; border-radius: 10px;
  font-size: .76rem; font-weight: 700;
  font-family: var(--fs, inherit);
  cursor: pointer; transition: opacity .15s;
}
.bsp-err-retry:hover { opacity: .88; }
`;

let _cssReady = false;
function _ensureCSS() {
  if (_cssReady) return;
  const el = document.createElement('style');
  el.id = 'bsp-styles';
  el.textContent = _CSS;
  document.head.appendChild(el);
  _cssReady = true;
}


// ── PDF.js (ленивая загрузка, один раз) ──────────────────────
let _pdfJsState = 'idle'; // 'idle' | 'loading' | 'ready' | 'error'
let _pdfJsQueue = [];

async function _ensurePdfJs() {
  if (_pdfJsState === 'ready') return;
  if (_pdfJsState === 'loading') {
    return new Promise((res, rej) => _pdfJsQueue.push({ res, rej }));
  }

  _pdfJsState = 'loading';
  try {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = _PDFJS_SRC;
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = _PDFJS_WORKER;
    _pdfJsState = 'ready';
    _pdfJsQueue.forEach(p => p.res());
  } catch (e) {
    _pdfJsState = 'error';
    _pdfJsQueue.forEach(p => p.rej(e));
    throw e;
  } finally {
    _pdfJsQueue = [];
  }
}


// ── Реестр ───────────────────────────────────────────────────
const _reg = {};


// ── Внутренний рендер ─────────────────────────────────────────
async function _render(id) {
  const s = _reg[id];
  const { body, url } = s;

  // Сбрасываем флаг — рендер начался заново
  s.rendered = false;

  // 1. Два A4-скелетона
  body.innerHTML = `
    <div class="bsp-skl-wrap">
      <div class="bsp-skl-page"></div>
      <div class="bsp-skl-page"></div>
    </div>`;

  try {
    // 2. Загружаем PDF.js и документ
    await _ensurePdfJs();
    const pdf = await window.pdfjsLib.getDocument(url).promise;

    // 3. Рендерим страницы
    body.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'bsp-pages';
    body.appendChild(wrap);

    // Высокое качество: физическое разрешение экрана, минимум 2×
    const dpr        = Math.max(window.devicePixelRatio || 1, 2);
    const cssWidth   = body.clientWidth - 28; // 14px паддинг с каждой стороны

    for (let p = 1; p <= pdf.numPages; p++) {
      const page   = await pdf.getPage(p);
      const baseVp = page.getViewport({ scale: 1 });

      // scale подбирается так, чтобы страница точно вписалась по ширине
      const scale  = (cssWidth / baseVp.width) * dpr;
      const vp     = page.getViewport({ scale });

      const canvas   = document.createElement('canvas');
      // Физический размер canvas = полное разрешение (чёткость)
      canvas.width   = Math.round(vp.width);
      canvas.height  = Math.round(vp.height);
      // CSS-размер = «сжатый» до экранных пикселей
      canvas.className            = 'bsp-page-canvas';
      canvas.style.height         = Math.round(vp.height / dpr) + 'px';
      wrap.appendChild(canvas);

      await page.render({
        canvasContext: canvas.getContext('2d', { alpha: false }),
        viewport:      vp,
      }).promise;
    }

    s.rendered = true;

  } catch (err) {
    console.error('[SheetPdf] render error:', err);

    // Кнопка «Повторить» через делегирование — без глобальной переменной
    body.innerHTML = `
      <div class="bsp-err">
        <div class="bsp-err-ico">⚠️</div>
        <div class="bsp-err-txt">
          Не удалось загрузить документ.<br>Проверьте соединение и попробуйте снова.
        </div>
        <button class="bsp-err-retry" data-retry="${id}">Повторить</button>
      </div>`;
  }
}


// ── Публичный API ─────────────────────────────────────────────
export const SheetPdf = {

  /**
   * Зарегистрировать PDF sheet (вызывается один раз при init).
   *
   * @param {object} cfg
   * @param {string}  cfg.id      — ключ ('oferta', 'manual', …)
   * @param {string}  cfg.title   — заголовок в шапке
   * @param {string}  cfg.url     — полный URL PDF-файла
   * @param {number} [cfg.zIndex] — z-index overlay (по умолч. 700)
   */
  define({ id, title, url, zIndex = 700 }) {
    _ensureCSS();

    if (_reg[id]) {
      console.warn(`[SheetPdf] "${id}" already defined — skipping`);
      return;
    }

    // Overlay
    const ov = document.createElement('div');
    ov.className  = 'bsp-ov';
    ov.style.zIndex = zIndex;
    ov.addEventListener('click', () => SheetPdf.close(id));

    // Box
    const box = document.createElement('div');
    box.className   = 'bsp-box';
    box.style.zIndex = zIndex + 1;

    // Drag handle
    const drag = document.createElement('div');
    drag.className = 'bsp-drag';

    // Header
    const head = document.createElement('div');
    head.className = 'bsp-head';

    const titleEl = document.createElement('div');
    titleEl.className   = 'bsp-head-title';
    titleEl.textContent = title;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'bsp-close';
    closeBtn.setAttribute('aria-label', 'Закрыть');
    closeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" stroke-width="2.5">
      <line x1="18" y1="6"  x2="6"  y2="18"/>
      <line x1="6"  y1="6"  x2="18" y2="18"/>
    </svg>`;
    closeBtn.addEventListener('click', () => SheetPdf.close(id));

    head.append(titleEl, closeBtn);

    // Body (сюда рендерятся страницы)
    const body = document.createElement('div');
    body.className = 'bsp-body';

    // Делегирование кнопки «Повторить»
    body.addEventListener('click', e => {
      const btn = e.target.closest('[data-retry]');
      if (btn) _render(btn.dataset.retry);
    });

    box.append(drag, head, body);
    document.body.append(ov, box);

    _reg[id] = { ov, box, body, url, rendered: false };
  },

  /**
   * Открыть PDF sheet.
   * PDF загружается при первом открытии; при повторных — кэшируется.
   */
  open(id) {
    const s = _reg[id];
    if (!s) { console.warn(`[SheetPdf] open: "${id}" not defined`); return; }
    s.ov.classList.add('open');
    s.box.classList.add('open');
    document.body.style.overflow = 'hidden';

    // Рендерим только если ещё не отрисовано
    if (!s.rendered) _render(id);
  },

  /** Закрыть PDF sheet */
  close(id) {
    const s = _reg[id];
    if (!s) return;
    s.ov.classList.remove('open');
    s.box.classList.remove('open');
    document.body.style.overflow = '';
  },

  /** true если sheet сейчас открыт */
  isOpen(id) {
    return _reg[id]?.box.classList.contains('open') ?? false;
  },
};
