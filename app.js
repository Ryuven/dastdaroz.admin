/**
 * app.js — Dastdaroz Admin Panel
 *
 * Firebase импортируется из firebase.js (без дублирования конфига).
 * Все секции помечены для удобного поиска и будущего рефакторинга
 * на собственный бэкенд (api.dastdaroz.shop).
 *
 * TODO (переход на api.dastdaroz.shop):
 *   - Заменить getDocs / onSnapshot → fetch('/api/...')
 *   - Заменить auth.onAuthStateChanged → проверку JWT-токена
 *   - Оставить auth только для signOut
 */

// ══════════════════════════════════════════════════════════════
// IMPORTS
// ══════════════════════════════════════════════════════════════

import { auth, db } from './firebase.js';

import {
  onAuthStateChanged,
  signOut,
} from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-auth.js';

import {
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  getDocs, collection, query, where, orderBy, onSnapshot,
  serverTimestamp, limit, increment, arrayUnion, arrayRemove, writeBatch,
} from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-firestore.js';

// ══════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════

// Статусы заказов
const SL = {
  reserved:  'Забронирован',
  pending:   'Ожидает',
  confirmed: 'Подтверждён',
  preparing: 'Готовится',
  delivering:'В пути',
  delivered: 'Доставлен',
  cancelled: 'Отменён',
};

// Цвета статусов заказов
const SC = {
  reserved:  'var(--yellow)',
  pending:   'var(--yellow)',
  confirmed: 'var(--acc)',
  preparing: '#a855f7',
  delivering:'var(--cyan)',
  delivered: 'var(--green)',
  cancelled: 'var(--red)',
};

// Категории новостей
const NEWS_CAT_LABELS = {
  'актуали':   'Актуалӣ',
  'ҷомеа':     'Ҷомеа',
  'иқтисод':   'Иқтисод',
  'варзиш':    'Варзиш',
  'технология':'Технология',
};
const NEWS_CAT_EMOJI = {
  'актуали':   '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  'ҷомеа':     '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>',
  'иқтисод':   '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg>',
  'варзиш':    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 000 20 14.5 14.5 0 000-20"/><line x1="2" y1="12" x2="22" y2="12"/></svg>',
  'технология':'<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
};

// Роли сотрудников
const ROLES = {
  admin:    'Администратор',
  support:  'Поддержка',
  moderator:'Модератор',
};



// ══════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════

// Текущий пользователь
let CU = null; // Firebase User
let AD = null; // Данные из Firestore (users/{uid})

// Основные коллекции
let allOrders    = [];  // объединяет bookedOrders + dastdarozOrders + mavsimiOrders + retailerOrders
let allCouriers  = [];
let allClients   = [];
let allProducts  = [];
let allStaff     = [];

let allNews      = [];
let allVacancies = [];
let allPartnerApps = [];

// Курьерские службы
let allDeliveryServices = [];
let _dsEditId = null;

// Ритейлеры (Firestore: retailers/)
let _retailers   = [];
let _retCities   = []; // кэш городов для <select>
let _editRetId   = null;
let _editLocId   = null;
let _editLocRid  = null;

// Legacy: старая коллекция stores/ (не отображается в дашборде)
let allStores = [];

// Города доставки
let allCities   = [];
let _cityFilter = 'all';
let _cityEditId = null;

// Живые заказы (onSnapshot)
let liveOrders = [];

// Состояние фильтров
let ordFilt   = 'all';
let curFilt   = 'all';
let verifFilt = 'all';
let tktFilt   = 'all';
let newsFilt  = 'all';
let hrFilt    = 'all';
let partnerFilt = 'all';

// Редактирование
let assignOid      = null;
let assignCol      = null;  // коллекция заказа при назначении курьера
let editingNewsId  = null;
let editingVacId   = null;

// Unsubscribe refs для onSnapshot
let unsubOrders   = null;  // bookedOrders listener
let unsubDast     = null;  // dastdarozOrders listener
let unsubMav      = null;  // mavsimiOrders listener (активные)
let unsubCouriers = null;

// Лента активности
const actLog = [];

// Поддержка (admin side)
let CHATS          = [];
let unsubChats     = null;
let currentChatId  = null;
let unsubChatMsgs  = null;

// ══════════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════════

/** Экранирует HTML-спецсимволы */
function escHtml(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/** Устанавливает textContent элемента по id */
function set(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

/** Возвращает метку категории новостей */
function newsCatLabel(c) {
  return NEWS_CAT_LABELS[(c || '').toLowerCase()] || (c || '—');
}

/** Возвращает эмодзи категории новостей */
function newsCatEmoji(c) {
  return NEWS_CAT_EMOJI[(c || '').toLowerCase()] || '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
}

/** Генерирует массив случайных чисел для спарклайнов */
function genData(n) {
  return Array.from({ length: n }, () => Math.floor(15 + Math.random() * 85));
}

// ══════════════════════════════════════════════════════════════
// CLOCK
// ══════════════════════════════════════════════════════════════

setInterval(() => {
  const el = document.getElementById('tb-time');
  if (el) el.textContent = new Date().toLocaleTimeString('ru-RU');
}, 1000);

// ══════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════

onAuthStateChanged(auth, async (u) => {
  if (!u) { location.href = 'admin-login.html'; return; }

  CU = u;
  try {
    const snap = await getDoc(doc(db, 'users', CU.uid));
    if (!snap.exists() || !['admin','support','moderator'].includes(snap.data().role)) {
      await signOut(auth);
      location.href = 'admin-login.html';
      return;
    }
    AD = snap.data();
  } catch (e) {
    // ⚠️ ВАЖНО: при любой ошибке чтения — выходим.
    // Никогда не даём доступ если не удалось подтвердить роль.
    console.error('Auth role check failed:', e);
    await signOut(auth).catch(() => {});
    location.href = 'admin-login.html';
    return;
  }

  renderSB();
  startListeners();
  loadAll();
});

// ══════════════════════════════════════════════════════════════
// SIDEBAR
// ══════════════════════════════════════════════════════════════

function renderSB() {
  const name  = AD?.displayName || CU.email || 'Admin';
  const init  = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || 'A';
  set('sb-name', name);
  set('sb-role', ROLES[AD?.role] || AD?.role || '—');
  const av = document.getElementById('sb-av');
  if (av) {
    av.innerHTML = AD?.avatarUrl
      ? `<img src="${AD.avatarUrl}" alt=""/>`
      : init;
  }
}

// ══════════════════════════════════════════════════════════════
// REALTIME LISTENERS
// ══════════════════════════════════════════════════════════════

function startListeners() {
  // ── bookedOrders (статус reserved) ──────────────────────────
  if (unsubOrders) unsubOrders();
  const qBooked = query(
    collection(db, 'bookedOrders'),
    where('status', '==', 'reserved')
  );
  let firstBooked = true;
  unsubOrders = onSnapshot(qBooked, (sn) => {
    const booked = sn.docs.map(d => ({ id: d.id, ...d.data(), _col: 'bookedOrders' }));
    // Мержим: заменяем bookedOrders в liveOrders, сохраняем dastdaroz/mavsimi
    liveOrders = [
      ...booked,
      ...liveOrders.filter(o => o._col !== 'bookedOrders'),
    ];
    renderLiveOrders();
    updateKPI();
    renderDonut();
    if (!firstBooked) {
      sn.docChanges().forEach((ch) => {
        const o = ch.doc.data();
        if (ch.type === 'added') {
          pushAct(`Новая бронь <strong>#${ch.doc.id.slice(-6).toUpperCase()}</strong> от ${o.clientName || 'клиента'}`, 'reserved');
          toast('Новая бронь: #' + ch.doc.id.slice(-6).toUpperCase(), 'info');
        }
      });
    }
    firstBooked = false;
    updateOrdBadge();
  });

  // ── dastdarozOrders (активные) ──────────────────────────────
  if (unsubDast) unsubDast();
  const qDast = query(
    collection(db, 'dastdarozOrders'),
    where('status', 'in', ['pending', 'confirmed', 'preparing', 'delivering'])
  );
  let firstDast = true;
  unsubDast = onSnapshot(qDast, (sn) => {
    const dast = sn.docs.map(d => ({ id: d.id, ...d.data(), _col: 'dastdarozOrders' }));
    liveOrders = [
      ...liveOrders.filter(o => o._col !== 'dastdarozOrders'),
      ...dast,
    ];
    renderLiveOrders();
    updateKPI();
    renderDonut();
    if (!firstDast) {
      sn.docChanges().forEach((ch) => {
        const o = ch.doc.data();
        if (ch.type === 'added') {
          pushAct(`Заказ dastdaroz <strong>#${ch.doc.id.slice(-6).toUpperCase()}</strong> — ${o.clientName || 'клиент'}`, o.status);
          toast('Dastdaroz заказ: #' + ch.doc.id.slice(-6).toUpperCase(), 'info');
        }
        if (ch.type === 'modified') {
          pushAct(`Dastdaroz #${ch.doc.id.slice(-6).toUpperCase()} → ${SL[o.status] || o.status}`, o.status);
        }
      });
    }
    firstDast = false;
    updateOrdBadge();
  });

  // ── mavsimiOrders (активные — только pending, дальше через бэкенд) ──
  if (unsubMav) unsubMav();
  const qMav = query(
    collection(db, 'mavsimiOrders'),
    where('status', '==', 'pending')
  );
  let firstMav = true;
  unsubMav = onSnapshot(qMav, (sn) => {
    const mav = sn.docs.map(d => ({ id: d.id, ...d.data(), _col: 'mavsimiOrders' }));
    liveOrders = [
      ...liveOrders.filter(o => o._col !== 'mavsimiOrders'),
      ...mav,
    ];
    renderLiveOrders();
    updateKPI();
    if (!firstMav) {
      sn.docChanges().forEach((ch) => {
        if (ch.type === 'added') {
          pushAct(`Заказ Мавсими <strong>#${ch.doc.id.slice(-6).toUpperCase()}</strong>`, 'pending');
          toast('Mavsimi заказ: #' + ch.doc.id.slice(-6).toUpperCase(), 'info');
        }
      });
    }
    firstMav = false;
    updateOrdBadge();
  });

  // ── Couriers ────────────────────────────────────────────────
  if (unsubCouriers) unsubCouriers();
  unsubCouriers = onSnapshot(query(collection(db, 'couriers')), (sn) => {
    allCouriers = sn.docs.map(d => ({ id: d.id, ...d.data() }));
    renderOnlineCouriers();
    updateCurKPI();
    if (document.getElementById('page-couriers').classList.contains('active')) {
      renderCouriersPage();
    }
  });

  // Слушаем чаты поддержки
  listenSupportChats();
}

// ══════════════════════════════════════════════════════════════
// LOAD ALL DATA
// ══════════════════════════════════════════════════════════════

async function loadAll() {
  await Promise.all([
    loadOrders(),
    loadClients(),
    loadProducts(),
    loadStaff(),
    loadNewsAdmin(),
    loadVacancies(),
    loadStores(),       // Legacy: коллекция stores/ (не отображается в дашборде)
    loadPartnerApps(),
    loadDeliveryServices(),
  ]);
  renderKPI();
  renderAnalytics();
  renderSupportChats();
  listenTgChats();
}

async function loadOrders() {
  try {
    const safeGet = async (col) => {
      try {
        const q = query(collection(db, col), orderBy('createdAt', 'desc'), limit(300));
        const s = await getDocs(q);
        return s.docs.map(d => ({ id: d.id, ...d.data(), _col: col }));
      } catch { return []; }
    };

    const [booked, dast, mav, ret] = await Promise.all([
      safeGet('bookedOrders'),
      safeGet('dastdarozOrders'),
      safeGet('mavsimiOrders'),
      safeGet('retailerOrders'),
    ]);

    allOrders = [...booked, ...dast, ...mav, ...ret].sort(
      (a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)
    );
    renderAllOrders();
  } catch (e) { console.error('Orders:', e); }
}

async function loadClients() {
  try {
    const snap = await getDocs(query(collection(db, 'users'), where('role', '==', 'client')));
    allClients = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderClients();
  } catch (e) { console.error('Clients:', e); }
}

async function loadProducts() {
  try {
    const snap = await getDocs(collection(db, 'products'));
    allProducts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCatalog();
  } catch (e) { console.error('Products:', e); }
}

async function loadStaff() {
  try {
    const snap = await getDocs(query(collection(db, 'users'), where('role', 'in', ['admin','support','moderator'])));
    allStaff   = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderStaff();
  } catch (e) { console.error('Staff:', e); }
}

// ══════════════════════════════════════════════════════════════
// KPI
// ══════════════════════════════════════════════════════════════

function renderKPI() {
  const total    = allOrders.length;
  const done     = allOrders.filter(o => o.status === 'delivered').length;
  const can      = allOrders.filter(o => o.status === 'cancelled').length;
  const active   = allOrders.filter(o => ['preparing','delivering'].includes(o.status)).length;
  const rev      = allOrders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + (o.total || 0), 0);
  const pend     = allOrders.filter(o => ['pending','confirmed'].includes(o.status)).length;
  const reserved = allOrders.filter(o => o.status === 'reserved').length;

  set('kv-ord',      total);
  set('kv-rev',      rev.toLocaleString('ru-RU') + ' смн.');
  set('kv-cli',      allClients.length);
  set('kv-can',      can);
  set('kv-pend',     pend);
  set('kv-done',     done);
  set('kv-active',   active);
  set('kv-reserved', reserved);
  set('kt-can',      total ? Math.round(can / total * 100) + '%' : '0%');

  renderSpark('sp-ord', genData(7));
  renderSpark('sp-rev', genData(7), 'g');
  updateOrdBadge();
}

function updateKPI() {
  const pend     = liveOrders.filter(o => ['pending','confirmed'].includes(o.status)).length;
  const active   = liveOrders.filter(o => ['preparing','delivering'].includes(o.status)).length;
  const reserved = liveOrders.filter(o => o.status === 'reserved').length;
  set('kv-pend',     pend);
  set('kv-active',   active);
  set('kv-reserved', reserved);
  updateOrdBadge();
}

function updateCurKPI() {
  const online = allCouriers.filter(c => c.isOnline).length;
  set('kv-cur',    online);
  set('kv-curtot', allCouriers.length);
  const b = document.getElementById('sb-cur-b');
  if (b) { b.style.display = online > 0 ? '' : 'none'; b.textContent = online; }
}

function updateOrdBadge() {
  const pend = liveOrders.filter(o => ['pending','confirmed'].includes(o.status)).length;
  const b    = document.getElementById('sb-ord-b');
  if (b) { b.style.display = pend > 0 ? '' : 'none'; b.textContent = pend; }
}

// ══════════════════════════════════════════════════════════════
// SPARKLINES
// ══════════════════════════════════════════════════════════════

function renderSpark(id, data, cls = '') {
  const el = document.getElementById(id); if (!el) return;
  const mx = Math.max(...data) || 1;
  el.innerHTML = data.map(v =>
    `<div class="bar${cls ? ' ' + cls : ''}" style="height:${Math.round(v / mx * 100)}%;flex:1" title="${v}"></div>`
  ).join('');
}

// ══════════════════════════════════════════════════════════════
// DONUT CHART
// ══════════════════════════════════════════════════════════════

function renderDonut() {
  const R = 33;
  const C = 2 * Math.PI * R;
  const cnt = { pending: 0, active: 0, done: 0, cancelled: 0 };

  liveOrders.forEach(o => {
    if (['pending','confirmed'].includes(o.status))  cnt.pending++;
    else if (['preparing','delivering'].includes(o.status)) cnt.active++;
  });
  cnt.done      = allOrders.filter(o => o.status === 'delivered').length;
  cnt.cancelled = allOrders.filter(o => o.status === 'cancelled').length;

  const total = cnt.pending + cnt.active + cnt.done + cnt.cancelled || 1;
  set('d-tot', total);

  const segs = [
    { id: 'd-acc', v: cnt.pending,   c: 'var(--acc)' },
    { id: 'd-grn', v: cnt.done,      c: 'var(--green)' },
    { id: 'd-yel', v: cnt.active,    c: 'var(--yellow)' },
    { id: 'd-red', v: cnt.cancelled, c: 'var(--red)' },
  ];
  let offset = 0;
  segs.forEach(s => {
    const dash = (s.v / total) * C;
    const el   = document.getElementById(s.id);
    if (el) { el.setAttribute('stroke-dasharray', `${dash} ${C - dash}`); el.setAttribute('stroke-dashoffset', -offset); }
    offset += dash;
  });

  const leg = document.getElementById('d-legend');
  if (leg) leg.innerHTML = [
    { l: 'Ожидают',   v: cnt.pending,   c: 'var(--acc)' },
    { l: 'В пути',    v: cnt.active,    c: 'var(--yellow)' },
    { l: 'Доставлено',v: cnt.done,      c: 'var(--green)' },
    { l: 'Отменено',  v: cnt.cancelled, c: 'var(--red)' },
  ].map(i =>
    `<div class="dl"><div class="dl-dot" style="background:${i.c}"></div><span style="color:var(--text2);flex:1">${i.l}</span><span style="font-family:var(--fm);font-size:.62rem;color:var(--text3)">${i.v}</span></div>`
  ).join('');
}

// ══════════════════════════════════════════════════════════════
// ACTIVITY FEED
// ══════════════════════════════════════════════════════════════

function pushAct(text, status) {
  actLog.unshift({
    text, status,
    time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
  });
  if (actLog.length > 25) actLog.pop();
  renderAct();
}

function renderAct() {
  const el = document.getElementById('act-feed'); if (!el) return;
  if (!actLog.length) {
    el.innerHTML = '<div style="padding:18px;text-align:center;font-size:.7rem;color:var(--text3)">Ожидаем активность…</div>';
    return;
  }
  const ico = {
    pending:   '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    confirmed: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
    preparing: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    delivering:'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 5v3h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
    delivered: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    cancelled: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  };
  const bc  = { pending:'var(--yellowd)', confirmed:'var(--accd)', preparing:'rgba(168,85,247,.1)', delivering:'var(--cyand)', delivered:'var(--greend)', cancelled:'var(--redd)' };
  el.innerHTML = actLog.slice(0, 8).map(a =>
    `<div class="af">
      <div class="af-ico" style="background:${bc[a.status] || 'var(--s2)'}">${ico[a.status] || '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 2H7a2 2 0 00-2 2v16a2 2 0 002 2h10a2 2 0 002-2V4a2 2 0 00-2-2h-2"/></svg>'}</div>
      <div><div class="af-txt">${a.text}</div><div class="af-time">${a.time}</div></div>
    </div>`
  ).join('');
}

// ══════════════════════════════════════════════════════════════
// LIVE ORDERS (обзор — активные заказы)
// ══════════════════════════════════════════════════════════════

function renderLiveOrders() {
  const body = document.getElementById('live-ob'); if (!body) return;
  const sorted = [...liveOrders].sort((a, b) =>
    (a.createdAt?.toDate?.().getTime() || 0) - (b.createdAt?.toDate?.().getTime() || 0)
  );
  if (!sorted.length) {
    body.innerHTML = '<tr><td colspan="6"><div class="er"><div class="er-ico"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg></div>Нет активных заказов</div></td></tr>';
    return;
  }
  body.innerHTML = sorted.map(o => oRow(o, true)).join('');
}

/** Строка таблицы заказа. live=true → без колонки «Курьер» */
function oRow(o, live = false) {
  const c   = SC[o.status] || '#888';
  const l   = SL[o.status] || o.status;
  const svcLabel = o._col === 'bookedOrders'   ? '<span style="font-size:.5rem;padding:1px 4px;background:#f0b44220;color:#f0b442;border:1px solid #f0b44230;border-radius:3px">Бронь</span>'
                 : o._col === 'mavsimiOrders'   ? '<span style="font-size:.5rem;padding:1px 4px;background:#3b82f620;color:#3b82f6;border:1px solid #3b82f630;border-radius:3px">МР</span>'
                 : o._col === 'retailerOrders'  ? '<span style="font-size:.5rem;padding:1px 4px;background:#10b98120;color:#10b981;border:1px solid #10b98130;border-radius:3px">Ритейлер</span>'
                 : '<span style="font-size:.5rem;padding:1px 4px;background:var(--acc)20;color:var(--acc);border:1px solid var(--acc)30;border-radius:3px">DD</span>';
  const canAssign = !o.courierId && ['pending','confirmed'].includes(o.status) && o._col === 'dastdarozOrders';
  const courierCol = live
    ? ''
    : `<td>${o.courierName || '<span style="color:var(--text3)">—</span>'}</td>`;
  return `<tr>
    <td><span class="mono">#${o.id.slice(-6).toUpperCase()}</span> ${svcLabel}</td>
    <td style="color:var(--text);font-weight:500">${o.clientName || '—'}</td>
    <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text2)">${o.address || '—'}</td>
    ${courierCol}
    <td><span class="ostatus" style="color:${c};border-color:${c}30;background:${c}10"><span class="osdot"></span>${l}</span></td>
    <td><span style="font-family:var(--fm)">${o.total || 0} смн.</span></td>
    <td><div class="oact">
      <button class="btn btn-secondary btn-sm" onclick="openOrderModal('${o.id}')">Детали</button>
      ${canAssign ? `<button class="btn btn-success btn-sm" onclick="openAssign('${o.id}','${o._col}')">Назначить</button>` : ''}
      ${['pending','confirmed'].includes(o.status) && o._col !== 'mavsimiOrders'
        ? `<button class="btn btn-danger btn-sm" onclick="cancelOrder('${o.id}','${o._col}')">✕</button>` : ''}
    </div></td>
  </tr>`;
}

// ══════════════════════════════════════════════════════════════
// ALL ORDERS (таблица заказов)
// ══════════════════════════════════════════════════════════════

function renderAllOrders() {
  const body = document.getElementById('all-ob'); if (!body) return;
  let list = [...allOrders];
  if (ordFilt !== 'all') list = list.filter(o => o.status === ordFilt);

  if (!list.length) {
    body.innerHTML = '<tr><td colspan="8"><div class="er"><div class="er-ico"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg></div>Нет заказов</div></td></tr>';
    return;
  }
  body.innerHTML = list.map(o => {
    const date = o.createdAt?.toDate
      ? o.createdAt.toDate().toLocaleDateString('ru-RU', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
      : '—';
    const c   = SC[o.status] || '#888';
    const l   = SL[o.status] || o.status;
    const svcLabel = o._col === 'bookedOrders'
      ? '<span style="font-size:.5rem;padding:1px 4px;background:#f0b44220;color:#f0b442;border:1px solid #f0b44230;border-radius:3px">Бронь</span>'
      : o._col === 'mavsimiOrders'
      ? '<span style="font-size:.5rem;padding:1px 4px;background:#3b82f620;color:#3b82f6;border:1px solid #3b82f630;border-radius:3px">МР</span>'
      : '<span style="font-size:.5rem;padding:1px 4px;background:var(--acc)20;color:var(--acc);border:1px solid var(--acc)30;border-radius:3px">DD</span>';
    const canAssign = !o.courierId && ['pending','confirmed'].includes(o.status) && o._col === 'dastdarozOrders';
    return `<tr>
      <td><span class="mono">#${o.id.slice(-6).toUpperCase()}</span> ${svcLabel}</td>
      <td style="color:var(--text);font-weight:500">${o.clientName || '—'}</td>
      <td style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${o.address || '—'}</td>
      <td style="color:var(--text2)">${o.courierName || '—'}</td>
      <td><span class="ostatus" style="color:${c};border-color:${c}30;background:${c}10"><span class="osdot"></span>${l}</span></td>
      <td><span style="font-family:var(--fm);color:var(--text2)">${o.total || 0} смн.</span></td>
      <td><span class="mono">${date}</span></td>
      <td><div class="oact">
        <button class="btn btn-secondary btn-sm" onclick="openOrderModal('${o.id}')">Детали</button>
        ${canAssign ? `<button class="btn btn-success btn-sm" onclick="openAssign('${o.id}','${o._col}')">+Курьер</button>` : ''}
      </div></td>
    </tr>`;
  }).join('');
}

window.fOrders = function (f, btn) {
  ordFilt = f;
  document.querySelectorAll('#page-orders .tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  renderAllOrders();
};

// ══════════════════════════════════════════════════════════════
// ORDER MODAL
// ══════════════════════════════════════════════════════════════

window.openOrderModal = async function (oid) {
  let o = allOrders.find(x => x.id === oid) || liveOrders.find(x => x.id === oid);
  if (!o) {
    // Ищем последовательно во всех коллекциях
    for (const col of ['bookedOrders', 'dastdarozOrders', 'mavsimiOrders', 'retailerOrders', 'orders']) {
      try {
        const snap = await getDoc(doc(db, col, oid));
        if (snap.exists()) { o = { id: snap.id, ...snap.data(), _col: col }; break; }
      } catch {}
    }
  }
  if (!o) { toast('Заказ не найден', 'err'); return; }

  const date = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString('ru-RU') : '—';
  const pay  = o.paymentMethod === 'cash' ? 'Наличными' : o.paymentMethod === 'card' ? 'Картой' : 'Онлайн';
  const c    = SC[o.status] || '#888';
  const l    = SL[o.status] || o.status;
  const svcName = o._col === 'retailerOrders' ? (o.retailerName || 'Ритейлер')
                : o._col === 'mavsimiOrders' ? 'Мавсими Расон'
                : o._col === 'bookedOrders'  ? 'Не подтверждён'
                : 'Dastdaroz Delivery';
  const canAssign = !o.courierId && ['pending','confirmed'].includes(o.status) && o._col === 'dastdarozOrders';

  document.getElementById('m-order-title').innerHTML =
    `Заказ <span style="font-family:var(--fm);color:var(--acc2)">#${o.id.slice(-6).toUpperCase()}</span>`;

  document.getElementById('m-order-body').innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <span class="ostatus" style="color:${c};border-color:${c}30;background:${c}10"><span class="osdot"></span>${l}</span>
      <span style="font-size:.55rem;color:var(--text3)">${escHtml(svcName)}</span>
      <span class="mono" style="font-size:.6rem;color:var(--text3)">${date}</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:14px">
      <div><div style="font-size:.44rem;letter-spacing:.2em;text-transform:uppercase;color:var(--muted2);margin-bottom:3px">Клиент</div><div style="font-size:.76rem;color:var(--text)">${escHtml(o.clientName || '—')}</div></div>
      <div><div style="font-size:.44rem;letter-spacing:.2em;text-transform:uppercase;color:var(--muted2);margin-bottom:3px">Курьер</div><div style="font-size:.76rem;color:var(--text)">${escHtml(o.courierName || 'Не назначен')}</div></div>
      <div style="grid-column:1/-1"><div style="font-size:.44rem;letter-spacing:.2em;text-transform:uppercase;color:var(--muted2);margin-bottom:3px">Адрес</div><div style="font-size:.76rem;color:var(--text)">${escHtml(o.address || '—')}</div></div>
      <div><div style="font-size:.44rem;letter-spacing:.2em;text-transform:uppercase;color:var(--muted2);margin-bottom:3px">Оплата</div><div style="font-size:.76rem;color:var(--text)">${escHtml(pay)}</div></div>
      <div><div style="font-size:.44rem;letter-spacing:.2em;text-transform:uppercase;color:var(--muted2);margin-bottom:3px">Комментарий</div><div style="font-size:.76rem;color:var(--text)">${escHtml(o.comment || 'Нет')}</div></div>
    </div>
    <div style="font-size:.48rem;letter-spacing:.2em;text-transform:uppercase;color:var(--muted2);margin-bottom:7px">Состав заказа</div>
    <div style="background:var(--s2);border:1px solid var(--b);border-radius:7px;overflow:hidden;margin-bottom:12px">
      ${(o.items || []).map(i =>
        `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 11px;border-bottom:1px solid var(--b);font-size:.72rem">
          <span style="color:var(--text)">${escHtml(i.name)}</span>
          <span style="color:var(--text3);font-family:var(--fm)">×${Number(i.quantity) || 0}</span>
          <span style="color:var(--green);font-family:var(--fm)">${(Number(i.price) || 0) * (Number(i.quantity) || 0)} смн.</span>
        </div>`
      ).join('')}
      <div style="display:flex;justify-content:space-between;padding:9px 11px;font-weight:600;font-size:.78rem">
        <span style="color:var(--text2)">Итого</span>
        <span style="font-family:var(--fm);color:var(--text)">${Number(o.total) || 0} смн.</span>
      </div>
    </div>
    ${o._col !== 'bookedOrders' ? `
    <div class="mf">
      <label class="ml">Изменить статус</label>
      <select class="mi" id="m-status-sel">
        ${['pending','confirmed','preparing','delivering','delivered','cancelled'].map(s =>
          `<option value="${s}"${o.status === s ? ' selected' : ''}>${SL[s]}</option>`
        ).join('')}
      </select>
    </div>` : `
    <div style="background:var(--s2);border:1px solid var(--b);border-radius:6px;padding:10px 12px;font-size:.65rem;color:var(--text3)">
      Ожидает подтверждения клиентом. Статус изменится после подтверждения.
    </div>`}`;

  document.getElementById('m-order-foot').innerHTML = `
    <button class="btn btn-secondary" onclick="closeMo('order-modal')">Закрыть</button>
    ${canAssign ? `<button class="btn btn-success" onclick="closeMo('order-modal');openAssign('${o.id}','${o._col}')">+ Курьер</button>` : ''}
    ${o._col !== 'bookedOrders' ? `<button class="btn btn-primary" onclick="saveOrderStatus('${o.id}','${o._col}')">Сохранить →</button>` : ''}`;

  openMo('order-modal');
};

window.saveOrderStatus = async function (oid, col) {
  const sel = document.getElementById('m-status-sel'); if (!sel) return;
  // Определяем коллекцию: приоритет параметру, затем ищем в памяти
  const targetCol = col
    || allOrders.find(x => x.id === oid)?._col
    || liveOrders.find(x => x.id === oid)?._col
    || 'dastdarozOrders';
  try {
    await updateDoc(doc(db, targetCol, oid), { status: sel.value, updatedAt: serverTimestamp() });
    toast('Статус: ' + SL[sel.value], 'ok');
    closeMo('order-modal');
    await loadOrders();
  } catch { toast('Ошибка', 'err'); }
};

window.cancelOrder = async function (oid, col) {
  if (!confirm('Отменить заказ #' + oid.slice(-6).toUpperCase() + '?')) return;
  const targetCol = col
    || allOrders.find(x => x.id === oid)?._col
    || liveOrders.find(x => x.id === oid)?._col
    || 'dastdarozOrders';
  try {
    await updateDoc(doc(db, targetCol, oid), { status: 'cancelled', updatedAt: serverTimestamp() });
    toast('Заказ отменён', 'ok');
  } catch { toast('Ошибка', 'err'); }
};

// ══════════════════════════════════════════════════════════════
// ASSIGN COURIER  (только для dastdarozOrders)
// ══════════════════════════════════════════════════════════════

window.openAssign = function (oid, col) {
  assignOid = oid;
  assignCol = col || 'dastdarozOrders';
  const sel  = document.getElementById('assign-sel');
  const free = allCouriers.filter(c => c.isOnline && !c.currentOrderId);
  sel.innerHTML = free.length
    ? `<option value="">— Выберите курьера —</option>` + free.map(c =>
        `<option value="${c.id}">${c.displayName || c.id} · ${c.totalDeliveries || 0} доставок</option>`
      ).join('')
    : '<option value="">Нет свободных курьеров</option>';
  document.getElementById('assign-comment').value = '';
  openMo('assign-modal');
};

window.doAssign = async function () {
  const cid = document.getElementById('assign-sel')?.value;
  if (!cid || !assignOid) { toast('Выберите курьера', 'warn'); return; }
  if (assignCol !== 'dastdarozOrders') {
    toast('Назначение курьера доступно только для Dastdaroz Delivery', 'warn');
    return;
  }
  const courier = allCouriers.find(c => c.id === cid);
  try {
    await updateDoc(doc(db, 'dastdarozOrders', assignOid), {
      courierId:   cid,
      courierName: courier?.displayName || '',
      status:      'delivering',
      updatedAt:   serverTimestamp(),
    });
    await setDoc(doc(db, 'couriers', cid), {
      currentOrderId: assignOid,
      isActive:       true,
      updatedAt:      serverTimestamp(),
    }, { merge: true });
    toast('Курьер назначен: ' + (courier?.displayName || cid), 'ok');
    closeMo('assign-modal');
  } catch { toast('Ошибка назначения', 'err'); }
};

// ══════════════════════════════════════════════════════════════
// COURIERS
// ══════════════════════════════════════════════════════════════

function renderCouriersPage() {
  const g = document.getElementById('couriers-grid'); if (!g) return;
  let list = [...allCouriers];
  if (curFilt   === 'online')  list = list.filter(c => c.isOnline);
  if (curFilt   === 'busy')    list = list.filter(c => c.currentOrderId);
  if (curFilt   === 'offline') list = list.filter(c => !c.isOnline);
  if (verifFilt !== 'all')     list = list.filter(c => (c.verificationStatus || 'pending') === verifFilt);

  if (!list.length) {
    g.innerHTML = '<div class="er" style="grid-column:1/-1"><div class="er-ico"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg></div>Нет курьеров</div>';
    return;
  }

  const VS = {
    verified: { label:'Верифицирован', color:'var(--green)',  bg:'var(--greend)',  border:'var(--greeng)' },
    pending:  { label:'На проверке',   color:'var(--yellow)', bg:'var(--yellowd)', border:'rgba(245,158,11,.25)' },
    blocked:  { label:'Заблокирован',  color:'var(--red)',    bg:'var(--redd)',    border:'rgba(244,63,94,.25)' },
  };

  g.innerHTML = list.map(c => {
    const init = (c.displayName || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const st   = c.currentOrderId ? 'В доставке' : c.isOnline ? 'Онлайн' : 'Офлайн';
    const sc   = c.currentOrderId ? 'var(--yellow)' : c.isOnline ? 'var(--green)' : 'var(--text3)';
    const vs   = VS[c.verificationStatus || 'pending'] || VS.pending;
    return `<div class="panel" style="overflow:hidden">
      <div style="padding:14px 16px;border-bottom:1px solid var(--b);display:flex;align-items:center;gap:10px">
        <div style="width:40px;height:40px;border-radius:50%;background:var(--accd);border:1.5px solid var(--accg);display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:700;color:var(--acc2);flex-shrink:0;overflow:hidden">
          ${c.avatarUrl ? `<img src="${c.avatarUrl}" style="width:100%;height:100%;object-fit:cover">` : `<span>${init}</span>`}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:.78rem;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.displayName || '—'}</div>
          <div style="font-size:.62rem;color:var(--text3);margin-top:2px">${c.phone || c.email || '—'}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
          <div style="display:flex;align-items:center;gap:4px;font-size:.58rem;font-weight:600;color:${sc}">
            <div style="width:5px;height:5px;border-radius:50%;background:${sc}"></div>${st}
          </div>
          <span style="font-size:.5rem;font-weight:700;padding:2px 7px;border-radius:99px;background:${vs.bg};color:${vs.color};border:1px solid ${vs.border};letter-spacing:.04em">${vs.label}</span>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:var(--b)">
        <div style="background:var(--s2);padding:9px;text-align:center"><div style="font-family:var(--fd);font-weight:800;font-size:.95rem;color:var(--acc2)">${c.totalDeliveries || 0}</div><div style="font-size:.42rem;color:var(--text3);text-transform:uppercase;letter-spacing:.1em;margin-top:2px">Доставок</div></div>
        <div style="background:var(--s2);padding:9px;text-align:center"><div style="font-family:var(--fd);font-weight:800;font-size:.95rem;color:var(--green)">${c.earnings || 0} смн.</div><div style="font-size:.42rem;color:var(--text3);text-transform:uppercase;letter-spacing:.1em;margin-top:2px">Заработок</div></div>
        <div style="background:var(--s2);padding:9px;text-align:center"><div style="font-size:.85rem">${{ bicycle:'bike', scooter:'scooter', car:'car', foot:'walk' }[c.vehicle || 'foot'] || 'bike'}</div><div style="font-size:.42rem;color:var(--text3);text-transform:uppercase;letter-spacing:.1em;margin-top:2px">Транспорт</div></div>
      </div>
      <div style="padding:9px 12px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        ${c.currentOrderId ? `<button class="btn btn-secondary btn-sm" onclick="openOrderModal('${c.currentOrderId}')">Заказ</button>` : ''}
        <button class="btn btn-${c.isOnline ? 'danger' : 'success'} btn-sm" onclick="toggleCOnline('${c.id}',${!c.isOnline})">${c.isOnline ? 'Офлайн' : 'Онлайн'}</button>
        <button class="btn btn-secondary btn-sm" style="margin-left:auto" onclick="openVerifModal('${c.id}','${c.verificationStatus || 'pending'}','${(c.displayName || '').replace(/'/g, '')}')">Статус ▾</button>
      </div>
    </div>`;
  }).join('');
}

function renderOnlineCouriers() {
  const el   = document.getElementById('online-clist'); if (!el) return;
  const list = allCouriers.filter(c => c.isOnline).slice(0, 5);
  if (!list.length) {
    el.innerHTML = '<div style="padding:14px;text-align:center;font-size:.7rem;color:var(--text3)">Нет курьеров онлайн</div>';
    return;
  }
  el.innerHTML = list.map(c => {
    const init = (c.displayName || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const st   = c.currentOrderId ? 'В доставке' : 'Свободен';
    const sc   = c.currentOrderId ? 'var(--yellow)' : 'var(--green)';
    return `<div class="cc">
      <div class="cav">${c.avatarUrl ? `<img src="${c.avatarUrl}" alt="">` : `<span>${init}</span>`}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:.72rem;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.displayName || '—'}</div>
        <div style="font-size:.6rem;color:var(--text3);margin-top:1px">${c.totalDeliveries || 0} доставок</div>
      </div>
      <div style="display:flex;align-items:center;gap:4px;font-size:.58rem;font-weight:600;color:${sc};flex-shrink:0">
        <div style="width:5px;height:5px;border-radius:50%;background:${sc}"></div>${st}
      </div>
    </div>`;
  }).join('');
}

window.fCouriers = function (f, btn) {
  curFilt = f;
  document.querySelectorAll('#page-couriers .tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  renderCouriersPage();
};

window.fCouriersVerif = function (f, btn) {
  verifFilt = f;
  document.querySelectorAll('#page-couriers .sh-actions .tabs:last-child .tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  renderCouriersPage();
};

window.toggleCOnline = async function (id, val) {
  try {
    await setDoc(doc(db, 'couriers', id), { isOnline: val, updatedAt: serverTimestamp() }, { merge: true });
    toast(val ? 'Курьер онлайн' : 'Курьер офлайн', 'ok');
  } catch { toast('Ошибка', 'err'); }
};

window.openVerifModal = function (id, current, name) {
  const vs = {
    verified: { label:'Верифицирован', color:'var(--green)',  bg:'var(--greend)',  border:'var(--greeng)',       dot:'var(--green)' },
    pending:  { label:'На проверке',   color:'var(--yellow)', bg:'var(--yellowd)', border:'rgba(245,158,11,.25)',dot:'var(--yellow)' },
    blocked:  { label:'Заблокирован',  color:'var(--red)',    bg:'var(--redd)',    border:'rgba(244,63,94,.25)', dot:'var(--red)' },
  };

  const optHtml = Object.entries(vs).map(([key, s]) => {
    const active = key === current;
    return `<label onclick="selectVerif('${key}')" id="vo-${key}" style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:8px;border:1px solid ${active ? s.border : 'var(--b)'};background:${active ? s.bg : 'var(--s2)'};cursor:pointer;transition:all .15s">
      <div style="width:16px;height:16px;border-radius:50%;border:2px solid ${active ? s.dot : 'var(--muted)'};display:flex;align-items:center;justify-content:center;flex-shrink:0">
        ${active ? `<div style="width:8px;height:8px;border-radius:50%;background:${s.dot}"></div>` : ''}
      </div>
      <div>
        <div style="font-size:.74rem;font-weight:600;color:${s.color}">${s.label}</div>
        <div style="font-size:.62rem;color:var(--text3);margin-top:1px">${
          key === 'verified' ? 'Курьер прошёл проверку, может принимать заказы' :
          key === 'pending'  ? 'Документы на рассмотрении, заказы недоступны' :
          'Аккаунт заблокирован, доступ запрещён'
        }</div>
      </div>
    </label>`;
  }).join('');

  document.getElementById('m-order-title').textContent = 'Статус верификации';
  document.getElementById('m-order-body').innerHTML = `
    <div style="font-size:.76rem;color:var(--text2);margin-bottom:16px">Курьер: <strong style="color:var(--text)">${name}</strong></div>
    <div style="display:flex;flex-direction:column;gap:8px">${optHtml}</div>
    <input type="hidden" id="verif-selected"  value="${current}"/>
    <input type="hidden" id="verif-courier-id" value="${id}"/>`;

  document.getElementById('m-order-foot').innerHTML = `
    <button class="btn btn-secondary" onclick="closeMo('order-modal')">Отмена</button>
    <button class="btn btn-primary"   onclick="saveVerifStatus()">Сохранить</button>`;
  openMo('order-modal');
};

window.selectVerif = function (val) {
  const colors = {
    verified: { border:'var(--greeng)',           bg:'var(--greend)',  dot:'var(--green)',  rb:'var(--green)' },
    pending:  { border:'rgba(245,158,11,.25)',    bg:'var(--yellowd)', dot:'var(--yellow)', rb:'var(--yellow)' },
    blocked:  { border:'rgba(244,63,94,.25)',     bg:'var(--redd)',    dot:'var(--red)',    rb:'var(--red)' },
  };
  ['verified','pending','blocked'].forEach(s => {
    const el = document.getElementById('vo-' + s); if (!el) return;
    const c  = colors[s];
    const on = s === val;
    el.style.borderColor = on ? c.border : 'var(--b)';
    el.style.background  = on ? c.bg     : 'var(--s2)';
    const rb = el.querySelector('div');
    rb.style.borderColor = on ? c.rb : 'var(--muted)';
    rb.innerHTML = on ? `<div style="width:8px;height:8px;border-radius:50%;background:${c.dot}"></div>` : '';
  });
  document.getElementById('verif-selected').value = val;
};

window.saveVerifStatus = async function () {
  const id     = document.getElementById('verif-courier-id')?.value;
  const status = document.getElementById('verif-selected')?.value;
  if (!id || !status) return;
  const labels = { verified:'Верифицирован', pending:'На проверке', blocked:'Заблокирован' };
  try {
    await setDoc(doc(db, 'couriers', id), { verificationStatus: status, updatedAt: serverTimestamp() }, { merge: true });
    toast('Статус: ' + labels[status], 'ok');
    closeMo('order-modal');
  } catch { toast('Ошибка сохранения', 'err'); }
};

// ══════════════════════════════════════════════════════════════
// CLIENTS
// ══════════════════════════════════════════════════════════════

function renderClients() {
  const body = document.getElementById('cli-ob'); if (!body) return;
  if (!allClients.length) {
    body.innerHTML = '<tr><td colspan="8"><div class="er"><div class="er-ico"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>Нет клиентов</div></td></tr>';
    return;
  }
  body.innerHTML = allClients.map(c => {
    const orders = allOrders.filter(o => o.clientId === c.uid);
    const spent  = orders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + (o.total || 0), 0);
    const date   = c.createdAt?.toDate ? c.createdAt.toDate().toLocaleDateString('ru-RU') : '—';
    return `<tr>
      <td style="color:var(--text);font-weight:500">${escHtml(c.displayName || '—')}</td>
      <td class="mono" style="font-size:.64rem">${escHtml(c.email || '—')}</td>
      <td>${escHtml(c.phone || '—')}</td>
      <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(c.address || '—')}</td>
      <td style="font-family:var(--fm)">${orders.length}</td>
      <td style="font-family:var(--fm);color:var(--green)">${spent.toLocaleString('ru-RU')} смн.</td>
      <td class="mono" style="font-size:.62rem">${date}</td>
      <td><button class="btn btn-secondary btn-sm" onclick="viewClient('${escHtml(c.uid)}')">Профиль</button></td>
    </tr>`;
  }).join('');
}

window.viewClient = function (uid) {
  const c = allClients.find(x => x.uid === uid); if (!c) return;
  const orders = allOrders.filter(o => o.clientId === uid);
  const spent  = orders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + (o.total || 0), 0);

  document.getElementById('m-order-title').textContent = c.displayName || c.email || 'Клиент';
  document.getElementById('m-order-body').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div class="mf"><label class="ml">Email</label><div style="font-size:.76rem;color:var(--text)">${escHtml(c.email || '—')}</div></div>
      <div class="mf"><label class="ml">Телефон</label><div style="font-size:.76rem;color:var(--text)">${escHtml(c.phone || '—')}</div></div>
      <div class="mf"><label class="ml">Адрес</label><div style="font-size:.76rem;color:var(--text)">${escHtml(c.address || '—')}</div></div>
      <div class="mf"><label class="ml">Заказов / Потрачено</label><div style="font-size:.76rem;color:var(--text)">${orders.length} / ${spent.toLocaleString('ru-RU')} смн.</div></div>
    </div>
    <div style="font-size:.48rem;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);margin-bottom:8px">Последние заказы</div>
    ${orders.slice(0, 6).map(o => {
      const col = SC[o.status] || '#888';
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--b);font-size:.72rem">
        <span class="mono">#${o.id.slice(-6).toUpperCase()}</span>
        <span style="color:var(--text2);max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(o.address || '—')}</span>
        <span class="ostatus" style="color:${col};border-color:${col}30;background:${col}10;font-size:.5rem">${SL[o.status] || o.status}</span>
        <span style="font-family:var(--fm);color:var(--green);font-size:.66rem">${Number(o.total) || 0} смн.</span>
      </div>`;
    }).join('') || '<div style="color:var(--text3);font-size:.72rem;text-align:center;padding:14px">Нет заказов</div>'}`;

  document.getElementById('m-order-foot').innerHTML =
    '<button class="btn btn-secondary" onclick="closeMo(\'order-modal\')">Закрыть</button>';
  openMo('order-modal');
};

window.exportClients = function () {
  const rows = allClients.map(c => {
    const ords  = allOrders.filter(o => o.clientId === c.uid);
    const spent = ords.filter(o => o.status !== 'cancelled').reduce((s, o) => s + (o.total || 0), 0);
    return `${c.displayName || ''},${c.email || ''},${c.phone || ''},${ords.length},${spent}`;
  });
  const csv = ['Имя,Email,Телефон,Заказов,Потрачено', ...rows].join('\n');
  const a   = document.createElement('a');
  a.href    = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csv);
  a.download = 'clients.csv';
  a.click();
  toast('CSV скачан', 'ok');
};

// ══════════════════════════════════════════════════════════════
// CATALOG
// ══════════════════════════════════════════════════════════════

function renderCatalog() {
  const body = document.getElementById('cat-ob'); if (!body) return;
  if (!allProducts.length) {
    body.innerHTML = '<tr><td colspan="6"><div class="er"><div class="er-ico"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg></div>Нет товаров</div></td></tr>';
    return;
  }
  body.innerHTML = allProducts.map(p => `<tr>
    <td style="display:flex;align-items:center;gap:9px;color:var(--text);font-weight:500">
      <div style="width:28px;height:28px;background:var(--s2);border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:.76rem;flex-shrink:0;overflow:hidden">
        ${p.imageUrl ? `<img src="${p.imageUrl}" style="width:100%;height:100%;object-fit:cover">` : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="opacity:.3"><path d="M18 8h1a4 4 0 010 8h-1"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>'}
      </div>
      ${p.name}
    </td>
    <td style="color:var(--text2)">${p.categoryId || '—'}</td>
    <td style="font-family:var(--fm);color:var(--green)">${p.price} смн.</td>
    <td>
      ${p.barcode
        ? `<span style="font-family:var(--fm);font-size:.62rem;color:var(--acc2);background:var(--accd);border:1px solid var(--accg);padding:2px 7px;border-radius:4px;letter-spacing:.06em">${p.barcode}</span>`
        : '<span style="font-size:.6rem;color:var(--text3)">—</span>'}
    </td>
    <td><span class="ostatus" style="color:${p.available !== false ? 'var(--green)' : 'var(--red)'};border-color:${p.available !== false ? 'var(--greeng)' : 'rgba(244,63,94,.2)'};background:${p.available !== false ? 'var(--greend)' : 'var(--redd)'}"><span class="osdot"></span>${p.available !== false ? 'Доступен' : 'Скрыт'}</span></td>
    <td><div class="oact">
      <button class="btn btn-secondary btn-sm" onclick="editProduct('${p.id}')">Изменить</button>
      <button class="btn btn-${p.available !== false ? 'danger' : 'success'} btn-sm" onclick="toggleProd('${p.id}',${!(p.available !== false)})">${p.available !== false ? 'Скрыть' : 'Показать'}</button>
    </div></td>
  </tr>`).join('');
}

const _barcodeFieldHtml = () => `
  <div class="mf">
    <label class="ml">Штрих-код (EAN-13, QR и др.)</label>
    <div style="display:flex;gap:7px">
      <input class="mi" id="p-bc" placeholder="4607086561315" inputmode="numeric" style="flex:1;letter-spacing:.06em"/>
      <button class="btn btn-secondary" onclick="scanBarcodeAdmin()" title="Сканировать" style="flex-shrink:0;padding:0 12px">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="3" height="16" rx="1"/><rect x="7" y="4" width="1.5" height="16" rx=".5"/><rect x="10" y="4" width="3" height="16" rx="1"/><rect x="15" y="4" width="1.5" height="16" rx=".5"/><rect x="18" y="4" width="3" height="16" rx="1"/></svg>
      </button>
    </div>
  </div>`;

window.openAddProduct = function () {
  document.getElementById('m-order-title').textContent = 'Добавить товар';
  document.getElementById('m-order-body').innerHTML = `
    <div class="mf"><label class="ml">Название *</label><input class="mi" id="p-nm" placeholder="Бургер Классик"/></div>
    <div class="mf"><label class="ml">Описание</label><input class="mi" id="p-ds" placeholder="Говядина, сыр, салат…"/></div>
    <div class="mr">
      <div class="mf"><label class="ml">Цена (смн.) *</label><input class="mi" type="number" id="p-pr" placeholder="350"/></div>
      <div class="mf"><label class="ml">Категория</label><input class="mi" id="p-ct" placeholder="burgers"/></div>
    </div>
    <div class="mf"><label class="ml">URL изображения</label><input class="mi" id="p-im" placeholder="https://…"/></div>
    ${_barcodeFieldHtml()}`;
  document.getElementById('m-order-foot').innerHTML = `
    <button class="btn btn-secondary" onclick="closeMo('order-modal')">Отмена</button>
    <button class="btn btn-primary"   onclick="saveNewProd()">Добавить</button>`;
  openMo('order-modal');
};

window.editProduct = function (id) {
  const p = allProducts.find(x => x.id === id); if (!p) return;
  document.getElementById('m-order-title').textContent = 'Редактировать: ' + p.name;
  document.getElementById('m-order-body').innerHTML = `
    <div class="mf"><label class="ml">Название</label><input class="mi" id="p-nm" value="${p.name || ''}"/></div>
    <div class="mf"><label class="ml">Описание</label><input class="mi" id="p-ds" value="${p.description || ''}"/></div>
    <div class="mr">
      <div class="mf"><label class="ml">Цена (смн.)</label><input class="mi" type="number" id="p-pr" value="${p.price || ''}"/></div>
      <div class="mf"><label class="ml">Категория</label><input class="mi" id="p-ct" value="${p.categoryId || ''}"/></div>
    </div>
    <div class="mf"><label class="ml">URL изображения</label><input class="mi" id="p-im" value="${p.imageUrl || ''}"/></div>
    ${_barcodeFieldHtml()}`;
  document.getElementById('p-bc').value = p.barcode || '';
  document.getElementById('m-order-foot').innerHTML = `
    <button class="btn btn-danger"    onclick="deleteProd('${id}')">Удалить</button>
    <button class="btn btn-secondary" onclick="closeMo('order-modal')">Отмена</button>
    <button class="btn btn-primary"   onclick="saveEditProd('${id}')">Сохранить</button>`;
  openMo('order-modal');
};

window.saveNewProd = async function () {
  const name  = document.getElementById('p-nm')?.value.trim();
  const price = parseFloat(document.getElementById('p-pr')?.value || '0');
  if (!name || !price) { toast('Заполните название и цену', 'warn'); return; }
  try {
    await addDoc(collection(db, 'products'), {
      name,
      description: document.getElementById('p-ds')?.value.trim() || '',
      price,
      categoryId:  document.getElementById('p-ct')?.value.trim() || '',
      imageUrl:    document.getElementById('p-im')?.value.trim() || '',
      barcode:     document.getElementById('p-bc')?.value.trim() || '',
      available:   true,
      createdAt:   serverTimestamp(),
      updatedAt:   serverTimestamp(),
    });
    toast('Товар добавлен', 'ok');
    closeMo('order-modal');
    await loadProducts();
  } catch { toast('Ошибка', 'err'); }
};

window.saveEditProd = async function (id) {
  try {
    await updateDoc(doc(db, 'products', id), {
      name:        document.getElementById('p-nm')?.value.trim() || '',
      description: document.getElementById('p-ds')?.value.trim() || '',
      price:       parseFloat(document.getElementById('p-pr')?.value || '0'),
      categoryId:  document.getElementById('p-ct')?.value.trim() || '',
      imageUrl:    document.getElementById('p-im')?.value.trim() || '',
      barcode:     document.getElementById('p-bc')?.value.trim() || '',
      updatedAt:   serverTimestamp(),
    });
    toast('Товар обновлён', 'ok');
    closeMo('order-modal');
    await loadProducts();
  } catch { toast('Ошибка', 'err'); }
};

window.toggleProd = async function (id, val) {
  try {
    await updateDoc(doc(db, 'products', id), { available: val, updatedAt: serverTimestamp() });
    toast(val ? 'Товар активирован' : 'Товар скрыт', 'ok');
    await loadProducts();
  } catch { toast('Ошибка', 'err'); }
};

window.deleteProd = async function (id) {
  if (!confirm('Удалить товар?')) return;
  try {
    await deleteDoc(doc(db, 'products', id));
    toast('Удалён', 'ok');
    closeMo('order-modal');
    await loadProducts();
  } catch { toast('Ошибка', 'err'); }
};

window.scanBarcodeAdmin = async function () {
  if (!('BarcodeDetector' in window)) {
    toast('BarcodeDetector не поддерживается. Введите вручную.', 'warn');
    return;
  }
  let div = document.getElementById('admin-scan-ov');
  if (!div) { div = document.createElement('div'); div.id = 'admin-scan-ov'; document.body.appendChild(div); }
  div.innerHTML = `
    <div style="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.92);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px">
      <div style="font-size:.86rem;color:#fff;font-weight:600">Наведите камеру на штрих-код</div>
      <div style="position:relative;width:min(300px,90vw);aspect-ratio:4/3;overflow:hidden;border-radius:12px">
        <video id="asv" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover"></video>
        <div style="position:absolute;left:10%;right:10%;height:2px;background:rgba(99,102,241,.9);animation:laserMove 2s ease-in-out infinite;top:50%"></div>
      </div>
      <div id="as-hint" style="font-size:.72rem;color:rgba(255,255,255,.6)">Ожидаем сканирования…</div>
      <button onclick="closeAdminScan()" style="padding:8px 22px;background:var(--accd);border:1px solid var(--accg);color:var(--acc2);border-radius:7px;cursor:pointer;font-size:.72rem">Отмена</button>
    </div>`;

  const detector = new BarcodeDetector({ formats: ['ean_13','ean_8','upc_a','code_128','code_39','qr_code'] });
  const stream   = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } }).catch(() => null);
  if (!stream) { toast('Камера недоступна', 'err'); div.innerHTML = ''; return; }

  const v = document.getElementById('asv');
  v.srcObject = stream;
  await v.play();

  let raf;
  const loop = async () => {
    try {
      const res = await detector.detect(v);
      if (res.length) {
        const code = res[0].rawValue;
        stream.getTracks().forEach(t => t.stop());
        cancelAnimationFrame(raf);
        div.innerHTML = '';
        const inp = document.getElementById('p-bc');
        if (inp) { inp.value = code; inp.focus(); }
        toast('Штрих-код: ' + code, 'ok');
        return;
      }
    } catch {}
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  window.closeAdminScan = () => {
    cancelAnimationFrame(raf);
    stream.getTracks().forEach(t => t.stop());
    div.innerHTML = '';
  };
};

// ══════════════════════════════════════════════════════════════
// NEWS
// ══════════════════════════════════════════════════════════════

async function loadNewsAdmin() {
  try {
    const q    = query(collection(db, 'news'), orderBy('createdAt', 'desc'), limit(100));
    const snap = await getDocs(q);
    allNews    = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const pub  = allNews.filter(a => a.status === 'published').length;
    const b    = document.getElementById('sb-news-b');
    if (b) { b.textContent = pub; b.style.display = pub ? '' : 'none'; }
    if (document.getElementById('page-news').classList.contains('active')) {
      renderNewsTable();
      renderNewsStats();
    }
  } catch (e) { console.error('News:', e); }
}

function renderNewsStats() {
  const el = document.getElementById('news-stats'); if (!el) return;
  const total = allNews.length;
  const pub   = allNews.filter(a => a.status === 'published').length;
  const draft = allNews.filter(a => a.status === 'draft').length;
  const views = allNews.reduce((s, a) => s + (a.views || 0), 0);
  const kpi   = (lbl, val, col) =>
    `<div style="background:var(--s1);border:1px solid var(--b);border-radius:9px;padding:10px 16px;min-width:110px">
      <div style="font-size:.44rem;letter-spacing:.2em;text-transform:uppercase;color:var(--text3);margin-bottom:3px">${lbl}</div>
      <div style="font-family:var(--fd);font-size:1.1rem;font-weight:800;color:${col}">${val}</div>
    </div>`;
  el.innerHTML =
    kpi('Всего',        total,                'var(--text)') +
    kpi('Опубликовано', pub,                  'var(--green)') +
    kpi('Черновики',    draft,                'var(--text3)') +
    kpi('Просмотры',    views.toLocaleString(),'var(--cyan)');
}

function renderNewsTable() {
  const ob = document.getElementById('news-ob'); if (!ob) return;
  renderNewsStats();
  const list = newsFilt === 'all' ? allNews : allNews.filter(a => a.status === newsFilt);
  if (!list.length) {
    ob.innerHTML = '<tr><td colspan="7"><div class="er"><div class="er-ico"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></div>Статей нет</div></td></tr>';
    return;
  }
  ob.innerHTML = list.map(a => {
    const date = a.createdAt?.toDate
      ? a.createdAt.toDate().toLocaleDateString('ru-RU', { day:'numeric', month:'short', year:'numeric' })
      : '—';
    const cov = a.coverUrl
      ? `<img class="news-cover-th" src="${escHtml(a.coverUrl)}" alt="" onerror="this.style.display='none'">`
      : `<div class="news-cover-ph"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>`;
    const st = a.status === 'published'
      ? '<span class="ostatus ns-pub"><span class="osdot"></span>Опубликована</span>'
      : '<span class="ostatus ns-drft"><span class="osdot"></span>Черновик</span>';
    return `<tr>
      <td><div style="display:flex;align-items:center;gap:10px">${cov}
        <div>
          <div style="font-weight:600;font-size:.72rem;color:var(--text);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(a.title || '—')}</div>
          ${a.subtitle ? `<div style="font-size:.6rem;color:var(--text3);margin-top:2px;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(a.subtitle)}</div>` : ''}
        </div>
      </div></td>
      <td><span style="font-size:.62rem">${newsCatEmoji(a.category)} ${escHtml(newsCatLabel(a.category))}</span></td>
      <td style="font-size:.68rem;color:var(--text2)">${escHtml(a.author || '—')}</td>
      <td>${st}</td>
      <td><span class="mono">${(a.views || 0).toLocaleString()}</span></td>
      <td><span class="mono" style="font-size:.6rem">${date}</span></td>
      <td><div class="oact">
        <button class="btn btn-secondary btn-sm" onclick="editNews('${a.id}')" style="display:inline-flex;align-items:center;gap:4px"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Изм.</button>
        <button class="btn ${a.status === 'published' ? 'btn-secondary' : 'btn-success'} btn-sm" onclick="toggleNewsPublish('${a.id}','${a.status}')" style="display:inline-flex;align-items:center;gap:4px">${a.status === 'published' ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' : '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>'}</button>
        <button class="btn btn-danger btn-sm" onclick="deleteNews('${a.id}')" style="display:inline-flex;align-items:center;gap:4px"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></button>
      </div></td>
    </tr>`;
  }).join('');
}

window.fNews = function (f, btn) {
  newsFilt = f;
  document.querySelectorAll('#page-news .tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderNewsTable();
};

window.openNewsModal = function () {
  editingNewsId = null;
  document.getElementById('news-modal-title').textContent = 'Новая статья';
  document.getElementById('ni-save-btn').textContent      = 'Опубликовать';
  ['ni-title','ni-subtitle','ni-cover','ni-content'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('ni-author').value  = AD?.displayName || 'Редакция';
  document.getElementById('ni-rtime').value   = '3';
  document.getElementById('ni-status').value  = 'published';
  document.getElementById('ni-cat').value     = 'актуали';
  const prev = document.getElementById('ni-cover-preview');
  if (prev) { prev.style.display = 'none'; prev.src = ''; }
  openMo('news-modal');
};

window.editNews = function (id) {
  const a = allNews.find(x => x.id === id); if (!a) return;
  editingNewsId = id;
  document.getElementById('news-modal-title').textContent = 'Редактировать статью';
  document.getElementById('ni-save-btn').textContent      = 'Сохранить';
  document.getElementById('ni-title').value    = a.title || '';
  document.getElementById('ni-subtitle').value = a.subtitle || '';
  document.getElementById('ni-author').value   = a.author || '';
  document.getElementById('ni-rtime').value    = a.readingTime || '3';
  document.getElementById('ni-cover').value    = a.coverUrl || '';
  document.getElementById('ni-content').value  = a.content || '';
  document.getElementById('ni-status').value   = a.status || 'draft';
  document.getElementById('ni-cat').value      = a.category || 'актуали';
  previewNewscover(a.coverUrl || '');
  openMo('news-modal');
};

window.previewNewscover = function (url) {
  const img = document.getElementById('ni-cover-preview'); if (!img) return;
  if (url && url.startsWith('http')) {
    img.src = url; img.style.display = 'block';
    img.onerror = () => { img.style.display = 'none'; };
  } else {
    img.style.display = 'none'; img.src = '';
  }
};

window.saveNews = async function () {
  const title   = document.getElementById('ni-title').value.trim();
  const content = document.getElementById('ni-content').value.trim();
  if (!title)   { toast('Заголовок обязателен', 'err'); return; }
  if (!content) { toast('Добавьте текст статьи', 'err'); return; }

  const btn = document.getElementById('ni-save-btn');
  btn.disabled = true; btn.textContent = 'Сохраняем…';

  const data = {
    title,
    subtitle:    document.getElementById('ni-subtitle').value.trim(),
    content,
    author:      document.getElementById('ni-author').value.trim() || 'Редакция',
    readingTime: parseInt(document.getElementById('ni-rtime').value) || 3,
    coverUrl:    document.getElementById('ni-cover').value.trim(),
    status:      document.getElementById('ni-status').value,
    category:    document.getElementById('ni-cat').value,
    authorId:    CU?.uid || '',
    updatedAt:   serverTimestamp(),
  };
  try {
    if (editingNewsId) {
      await updateDoc(doc(db, 'news', editingNewsId), data);
      toast('Статья обновлена ✓', 'ok');
    } else {
      data.createdAt = serverTimestamp();
      data.views     = 0;
      await addDoc(collection(db, 'news'), data);
      toast('Статья опубликована ✓', 'ok');
    }
    closeMo('news-modal');
    await loadNewsAdmin();
  } catch (e) { console.error(e); toast('Ошибка: ' + e.message, 'err'); }
  btn.disabled = false;
  btn.textContent = editingNewsId ? 'Сохранить' : 'Опубликовать';
};

window.toggleNewsPublish = async function (id, cur) {
  const ns = cur === 'published' ? 'draft' : 'published';
  try {
    await updateDoc(doc(db, 'news', id), { status: ns, updatedAt: serverTimestamp() });
    toast(ns === 'published' ? 'Статья опубликована ✓' : 'Убрана в черновики', 'ok');
    await loadNewsAdmin();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
};

window.deleteNews = async function (id) {
  const a = allNews.find(x => x.id === id);
  if (!confirm('Удалить статью «' + (a?.title || id) + '»?')) return;
  try {
    await deleteDoc(doc(db, 'news', id));
    toast('Статья удалена', 'ok');
    await loadNewsAdmin();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
};

// ══════════════════════════════════════════════════════════════
// ANALYTICS
// ══════════════════════════════════════════════════════════════

function renderAnalytics() {
  // Заказы по часам
  const hourly = Array(24).fill(0);
  allOrders.forEach(o => { if (o.createdAt?.toDate) hourly[o.createdAt.toDate().getHours()]++; });
  const mxH  = Math.max(...hourly) || 1;
  const chH  = document.getElementById('ch-hourly');
  if (chH) chH.innerHTML = hourly.map((v, i) =>
    `<div class="bar" style="height:${Math.round(v / mxH * 100)}%;flex:1" title="${i}:00 — ${v}"></div>`
  ).join('');

  // Заказы по дням (7 дней)
  const days = [], labels = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0);
    const cnt = allOrders.filter(o => {
      if (!o.createdAt?.toDate) return false;
      const od = new Date(o.createdAt.toDate()); od.setHours(0, 0, 0, 0);
      return od.getTime() === d.getTime();
    }).length;
    days.push(cnt);
    labels.push(d.toLocaleDateString('ru-RU', { weekday: 'short' }));
  }
  const mxD = Math.max(...days) || 1;
  const chD = document.getElementById('ch-daily');
  if (chD) chD.innerHTML = days.map((v, i) =>
    `<div class="bar g" style="height:${Math.round(v / mxD * 100)}%;flex:1" title="${labels[i]}: ${v}"></div>`
  ).join('');
  const lbD = document.getElementById('ch-dlbls');
  if (lbD) lbD.innerHTML = labels.map(l => `<span>${l}</span>`).join('');

  // Топ категорий
  const catCnt = {};
  allOrders.forEach(o => (o.items || []).forEach(i => {
    catCnt[i.categoryId || 'other'] = (catCnt[i.categoryId || 'other'] || 0) + i.quantity;
  }));
  const topCats = document.getElementById('top-cats');
  if (topCats) topCats.innerHTML = Object.entries(catCnt)
    .sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([cat, cnt]) =>
      `<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 14px;border-bottom:1px solid var(--b);font-size:.7rem">
        <span style="color:var(--text2)">${cat}</span>
        <span style="font-family:var(--fm);color:var(--acc2)">${cnt}</span>
      </div>`
    ).join('') || '<div style="padding:14px;text-align:center;color:var(--text3);font-size:.7rem">Нет данных</div>';

  // Топ курьеров
  const topC = document.getElementById('top-couriers');
  if (topC) topC.innerHTML = [...allCouriers]
    .sort((a, b) => (b.totalDeliveries || 0) - (a.totalDeliveries || 0)).slice(0, 6)
    .map((c, i) =>
      `<div style="display:flex;align-items:center;gap:10px;padding:9px 14px;border-bottom:1px solid var(--b)">
        <div style="font-family:var(--fm);font-size:.66rem;color:var(--text3);width:14px">#${i + 1}</div>
        <div style="flex:1;font-size:.72rem;font-weight:500;color:var(--text)">${c.displayName || '—'}</div>
        <div style="font-family:var(--fm);font-size:.66rem;color:var(--acc2)">${c.totalDeliveries || 0} дост.</div>
        <div style="font-family:var(--fm);font-size:.66rem;color:var(--green)">${c.earnings || 0} смн.</div>
      </div>`
    ).join('') || '<div style="padding:14px;text-align:center;color:var(--text3);font-size:.7rem">Нет данных</div>';

  // Сводка
  const ps = document.getElementById('period-sum');
  if (ps) {
    const rev = allOrders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + (o.total || 0), 0);
    const del = allOrders.filter(o => o.status === 'delivered').length;
    const can = allOrders.filter(o => o.status === 'cancelled').length;
    const row = (lbl, val, col = 'var(--text)') =>
      `<div style="display:flex;justify-content:space-between"><span style="color:var(--text3)">${lbl}</span><span style="font-family:var(--fm);color:${col}">${val}</span></div>`;
    ps.innerHTML = `<div style="display:flex;flex-direction:column;gap:11px;font-size:.76rem">
      ${row('Всего заказов',          allOrders.length)}
      ${row('Выручка',                rev.toLocaleString('ru-RU') + ' смн.', 'var(--green)')}
      ${row('Доставлено',             del, 'var(--acc2)')}
      ${row('Отменено',               can, 'var(--red)')}
      ${row('Клиентов',               allClients.length)}
      ${row('Статей опубликовано',    allNews.filter(a => a.status === 'published').length, 'var(--cyan)')}
      ${row('Курьеров',               allCouriers.length)}
    </div>`;
  }
}

// ══════════════════════════════════════════════════════════════
// STAFF
// ══════════════════════════════════════════════════════════════

function renderStaff() {
  const body = document.getElementById('staff-ob'); if (!body) return;
  if (!allStaff.length) {
    body.innerHTML = '<tr><td colspan="5"><div class="er"><div class="er-ico"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg></div>Нет сотрудников</div></td></tr>';
    return;
  }
  const rc = { admin:'var(--acc2)', support:'var(--green)', moderator:'var(--yellow)' };
  body.innerHTML = allStaff.map(s => {
    const date = s.lastLoginAt?.toDate
      ? s.lastLoginAt.toDate().toLocaleDateString('ru-RU', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
      : '—';
    return `<tr>
      <td style="color:var(--text);font-weight:500">${s.displayName || '—'}</td>
      <td class="mono" style="font-size:.64rem">${s.email || '—'}</td>
      <td><span style="font-size:.58rem;padding:2px 9px;border-radius:99px;background:var(--accd);color:${rc[s.role] || 'var(--text2)'};border:1px solid var(--accg)">${ROLES[s.role] || s.role || '—'}</span></td>
      <td class="mono" style="font-size:.62rem">${date}</td>
      <td>${s.uid !== CU.uid
        ? `<button class="btn btn-secondary btn-sm" onclick="editStaff('${s.uid}')">Роль</button>`
        : '<span style="font-size:.6rem;color:var(--text3)">Это вы</span>'}</td>
    </tr>`;
  }).join('');
}

window.openAddStaff = function () {
  document.getElementById('m-order-title').textContent = 'Добавить сотрудника';
  document.getElementById('m-order-body').innerHTML = `
    <div style="padding:9px 12px;background:var(--yellowd);border:1px solid rgba(245,158,11,.2);border-radius:7px;font-size:.7rem;color:var(--yellow);margin-bottom:14px">
      <div style="display:flex;align-items:flex-start;gap:8px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg><span>Сотрудник должен сначала зарегистрироваться через страницу входа. Здесь вы меняете роль по email.</span></div>
    </div>
    <div class="mf"><label class="ml">Email сотрудника</label><input class="mi" id="st-em" placeholder="admin@galelium.com"/></div>
    <div class="mf">
      <label class="ml">Роль</label>
      <select class="mi" id="st-rl">
        <option value="support">Поддержка</option>
        <option value="moderator">Модератор</option>
        <option value="admin">Администратор</option>
      </select>
    </div>`;
  document.getElementById('m-order-foot').innerHTML = `
    <button class="btn btn-secondary" onclick="closeMo('order-modal')">Отмена</button>
    <button class="btn btn-primary"   onclick="saveNewStaff()">Сохранить</button>`;
  openMo('order-modal');
};

window.saveNewStaff = async function () {
  const email = document.getElementById('st-em')?.value.trim();
  const role  = document.getElementById('st-rl')?.value;
  if (!email) { toast('Введите email', 'warn'); return; }
  try {
    const q    = query(collection(db, 'users'), where('email', '==', email));
    const snap = await getDocs(q);
    if (snap.empty) { toast('Пользователь не найден', 'err'); return; }
    await setDoc(doc(db, 'users', snap.docs[0].id), { role, updatedAt: serverTimestamp() }, { merge: true });
    toast('Роль обновлена: ' + ROLES[role], 'ok');
    closeMo('order-modal');
    await loadStaff();
  } catch { toast('Ошибка', 'err'); }
};

window.editStaff = function (uid) {
  const s = allStaff.find(x => x.uid === uid); if (!s) return;
  document.getElementById('m-order-title').textContent = 'Роль: ' + (s.displayName || s.email);
  document.getElementById('m-order-body').innerHTML = `
    <div class="mf">
      <label class="ml">Роль</label>
      <select class="mi" id="st-rl-ed">
        <option value="support"  ${s.role === 'support'   ? 'selected' : ''}>Поддержка</option>
        <option value="moderator"${s.role === 'moderator' ? 'selected' : ''}>Модератор</option>
        <option value="admin"    ${s.role === 'admin'     ? 'selected' : ''}>Администратор</option>
      </select>
    </div>`;
  document.getElementById('m-order-foot').innerHTML = `
    <button class="btn btn-secondary" onclick="closeMo('order-modal')">Отмена</button>
    <button class="btn btn-primary"   onclick="updateStaffRole('${uid}')">Сохранить</button>`;
  openMo('order-modal');
};

window.updateStaffRole = async function (uid) {
  // Нельзя изменить собственную роль
  if (uid === CU?.uid) { toast('Нельзя изменить собственную роль', 'err'); return; }
  const role = document.getElementById('st-rl-ed')?.value;
  if (!['admin','support','moderator'].includes(role)) { toast('Неверная роль', 'err'); return; }
  try {
    await setDoc(doc(db, 'users', uid), { role, updatedAt: serverTimestamp() }, { merge: true });
    toast('Роль обновлена', 'ok');
    closeMo('order-modal');
    await loadStaff();
  } catch { toast('Ошибка', 'err'); }
};

// ══════════════════════════════════════════════════════════════
// PARTNER STAFF — Сотрудники магазинов (users-partner)
// ══════════════════════════════════════════════════════════════

let partnerStaffList = [];

// Переключение вкладок
window.switchStaffTab = function (tab) {
  const isPartner = tab === 'partner';
  document.getElementById('staff-panel-admin').style.display   = isPartner ? 'none'  : 'block';
  document.getElementById('staff-panel-partner').style.display = isPartner ? 'block' : 'none';
  document.getElementById('staff-tab-admin').classList.toggle('active',   !isPartner);
  document.getElementById('staff-tab-partner').classList.toggle('active',  isPartner);
  document.getElementById('staff-sh-actions').innerHTML = isPartner
    ? '<button class="btn btn-primary" onclick="openAddPartnerStaff()">+ Сотрудник магазина</button>'
    : '<button class="btn btn-primary" onclick="openAddStaff()">+ Сотрудник</button>';
  if (isPartner) loadPartnerStaff();
};

// Загрузка списка
async function loadPartnerStaff() {
  const tbody = document.getElementById('partner-staff-ob');
  if (tbody) tbody.innerHTML = '<tr><td colspan="7"><div class="pload"><div class="spin"></div></div></td></tr>';
  try {
    const snap = await getDocs(collection(db, 'users-partner'));
    partnerStaffList = snap.docs.map(d => ({ phone: d.id, ...d.data() }));
    renderPartnerStaff();
  } catch (err) {
    console.error('loadPartnerStaff:', err);
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="color:var(--red);text-align:center">Ошибка загрузки</td></tr>';
  }
}

function renderPartnerStaff() {
  const tbody = document.getElementById('partner-staff-ob');
  if (!tbody) return;
  if (!partnerStaffList.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text3)">Сотрудников нет</td></tr>';
    return;
  }
  tbody.innerHTML = partnerStaffList.map(p => `
    <tr>
      <td><div style="font-weight:600">${escHtml(p.name || '—')}</div></td>
      <td><code style="font-size:.7rem">+${p.phone}</code></td>
      <td>${escHtml(p.retailerName || '—')} / ${escHtml(p.storeName || p.storeId || '—')}</td>
      <td>${p.role === 'manager' ? 'Менеджер' : 'Сотрудник'}</td>
      <td>${p.telegramId ? `<span style="color:var(--green)">✓ ${p.telegramId}</span>` : '<span style="color:var(--text3)">Не привязан</span>'}</td>
      <td>
        <label class="tog" style="margin:0">
          <input type="checkbox" ${p.active ? 'checked' : ''} onchange="togglePartnerActive('${p.phone}', this.checked)">
          <span class="tog-track"><span class="tog-thumb"></span></span>
        </label>
      </td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn btn-secondary btn-sm" onclick="editPartnerStaff('${p.phone}')">Изменить</button>
          <button class="btn btn-danger btn-sm"    onclick="deletePartnerStaff('${p.phone}')">Удалить</button>
        </div>
      </td>
    </tr>
  `).join('');
}

// Открытие модала создания
window.openAddPartnerStaff = async function () {
  document.getElementById('m-order-title').textContent = 'Новый сотрудник магазина';
  document.getElementById('m-order-body').innerHTML = `
    <div class="mf"><label class="ml">Имя *</label><input class="mi" id="ps-name" placeholder="Алишер Рахимов"/></div>
    <div class="mf"><label class="ml">Номер телефона *</label><input class="mi" id="ps-phone" placeholder="992977123456" maxlength="12"/></div>
    <div class="mf">
      <label class="ml">Ритейлер *</label>
      <select class="mi" id="ps-retailer" onchange="window.loadPartnerLocations()">
        <option value="">— Загрузка... —</option>
      </select>
    </div>
    <div class="mf">
      <label class="ml">Точка (магазин) *</label>
      <select class="mi" id="ps-location" disabled>
        <option value="">— Сначала выберите ритейлер —</option>
      </select>
    </div>
    <div class="mf">
      <label class="ml">Роль</label>
      <select class="mi" id="ps-role">
        <option value="staff">Сотрудник</option>
        <option value="manager">Менеджер</option>
      </select>
    </div>`;
  document.getElementById('m-order-foot').innerHTML = `
    <button class="btn btn-secondary" onclick="closeMo('order-modal')">Отмена</button>
    <button class="btn btn-primary"   onclick="saveNewPartnerStaff()">Создать</button>`;
  openMo('order-modal');

  // Загружаем ритейлеров
  try {
    const snap = await getDocs(collection(db, 'retailers'));
    const sel  = document.getElementById('ps-retailer');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Выберите ритейлер —</option>' +
      snap.docs.map(d => `<option value="${d.id}" data-name="${escHtml(d.data().name||'')}">${escHtml(d.data().name||d.id)}</option>`).join('');
  } catch (e) {
    const sel = document.getElementById('ps-retailer');
    if (sel) sel.innerHTML = '<option value="">Ошибка загрузки</option>';
  }
};

// Загружаем точки выбранного ритейлера
window.loadPartnerLocations = async function () {
  const retSel  = document.getElementById('ps-retailer');
  const locSel  = document.getElementById('ps-location');
  if (!retSel || !locSel) return;

  const rid = retSel.value;
  if (!rid) {
    locSel.innerHTML = '<option value="">— Сначала выберите ритейлер —</option>';
    locSel.disabled  = true;
    return;
  }

  locSel.innerHTML = '<option value="">Загрузка...</option>';
  locSel.disabled  = true;

  try {
    const snap = await getDocs(collection(db, 'retailers', rid, 'locations'));
    if (snap.empty) {
      locSel.innerHTML = '<option value="">Нет точек у этого ритейлера</option>';
      return;
    }
    locSel.innerHTML = '<option value="">— Выберите точку —</option>' +
      snap.docs.map(d => {
        const addr = d.data().address || d.id;
        return `<option value="${d.id}" data-addr="${escHtml(addr)}">${escHtml(addr)}</option>`;
      }).join('');
    locSel.disabled = false;
  } catch (e) {
    locSel.innerHTML = '<option value="">Ошибка загрузки</option>';
  }
};

// Сохранение
window.saveNewPartnerStaff = async function () {
  const name    = document.getElementById('ps-name')?.value.trim();
  const phone   = document.getElementById('ps-phone')?.value.replace(/\D/g, '');
  const role    = document.getElementById('ps-role')?.value;
  const retSel  = document.getElementById('ps-retailer');
  const locSel  = document.getElementById('ps-location');

  const retailerId   = retSel?.value || '';
  const retailerName = retSel?.options[retSel.selectedIndex]?.dataset?.name || '';
  const storeId      = locSel?.value || '';
  const storeName    = locSel?.options[locSel.selectedIndex]?.dataset?.addr || '';

  if (!name)       { toast('Введите имя', 'warn'); return; }
  if (!phone || phone.length < 9) { toast('Введите корректный номер', 'warn'); return; }
  if (!retailerId) { toast('Выберите ритейлера', 'warn'); return; }
  if (!storeId)    { toast('Выберите точку', 'warn'); return; }

  const normalizedPhone = phone.length === 9 ? '992' + phone : phone;
  if (normalizedPhone.length !== 12) { toast('Номер должен быть 12 цифр (992XXXXXXXXX)', 'warn'); return; }

  try {
    const existing = await getDoc(doc(db, 'users-partner', normalizedPhone));
    if (existing.exists()) { toast('Сотрудник с этим номером уже существует', 'err'); return; }

    await setDoc(doc(db, 'users-partner', normalizedPhone), {
      name, role,
      retailerId,
      retailerName,
      storeId,      // locationId точки
      storeName,    // адрес точки
      active:      true,
      telegramId:  null,
      createdAt:   serverTimestamp(),
      lastLoginAt: null,
    });

    toast(`Сотрудник ${name} создан → ${retailerName} / ${storeName}`, 'ok');
    closeMo('order-modal');
    await loadPartnerStaff();
  } catch (err) {
    console.error(err);
    toast('Ошибка создания: ' + err.message, 'err');
  }
};

// Редактирование
window.editPartnerStaff = function (phone) {
  const p = partnerStaffList.find(x => x.phone === phone);
  if (!p) return;
  document.getElementById('m-order-title').textContent = 'Изменить: ' + (p.name || phone);
  document.getElementById('m-order-body').innerHTML = `
    <div class="mf"><label class="ml">Имя</label><input class="mi" id="ps-e-name" value="${escHtml(p.name || '')}"/></div>
    <div class="mf">
      <label class="ml">Ритейлер</label>
      <input class="mi" value="${escHtml(p.retailerName || p.storeId || '—')}" disabled style="opacity:.6"/>
    </div>
    <div class="mf">
      <label class="ml">Точка</label>
      <input class="mi" value="${escHtml(p.storeName || p.storeId || '—')}" disabled style="opacity:.6"/>
      <div style="font-size:.6rem;color:var(--text3);margin-top:3px">ID: ${p.storeId || '—'} · Для смены точки удалите и создайте заново</div>
    </div>
    <div class="mf">
      <label class="ml">Роль</label>
      <select class="mi" id="ps-e-role">
        <option value="staff"   ${p.role === 'staff'   ? 'selected' : ''}>Сотрудник</option>
        <option value="manager" ${p.role === 'manager' ? 'selected' : ''}>Менеджер</option>
      </select>
    </div>`;
  document.getElementById('m-order-foot').innerHTML = `
    <button class="btn btn-secondary" onclick="closeMo('order-modal')">Отмена</button>
    <button class="btn btn-primary"   onclick="updatePartnerStaff('${phone}')">Сохранить</button>`;
  openMo('order-modal');
};

window.updatePartnerStaff = async function (phone) {
  const name = document.getElementById('ps-e-name')?.value.trim();
  const role = document.getElementById('ps-e-role')?.value;
  if (!name) { toast('Введите имя', 'warn'); return; }
  try {
    await setDoc(doc(db, 'users-partner', phone), { name, role, updatedAt: serverTimestamp() }, { merge: true });
    toast('Обновлено', 'ok');
    closeMo('order-modal');
    await loadPartnerStaff();
  } catch { toast('Ошибка', 'err'); }
};

// Переключение активности
window.togglePartnerActive = async function (phone, active) {
  try {
    await setDoc(doc(db, 'users-partner', phone), { active, updatedAt: serverTimestamp() }, { merge: true });
    const p = partnerStaffList.find(x => x.phone === phone);
    if (p) p.active = active;
    toast(active ? 'Активирован' : 'Деактивирован', 'ok');
  } catch { toast('Ошибка', 'err'); }
};

// Удаление
window.deletePartnerStaff = async function (phone) {
  const p = partnerStaffList.find(x => x.phone === phone);
  if (!confirm(`Удалить сотрудника ${p?.name || phone}?`)) return;
  try {
    await deleteDoc(doc(db, 'users-partner', phone));
    toast('Удалено', 'ok');
    await loadPartnerStaff();
  } catch { toast('Ошибка', 'err'); }
};

// ══════════════════════════════════════════════════════════════
// SUPPORT CHATS (admin side)
// ══════════════════════════════════════════════════════════════

function listenSupportChats() {
  if (unsubChats) unsubChats();
  const q = query(collection(db, 'supportChats'), orderBy('updatedAt', 'desc'));
  unsubChats = onSnapshot(q, (snap) => {
    CHATS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSupportChats();
  }, () => {});
}

function renderSupportChats() {
  const el = document.getElementById('chats-list'); if (!el) return;
  const list        = tktFilt === 'unread' ? CHATS.filter(c => (c.adminUnread || 0) > 0) : [...CHATS];
  const totalUnread = CHATS.filter(c => (c.adminUnread || 0) > 0).length;
  const b           = document.getElementById('sb-tkt-b');
  if (b) { b.style.display = totalUnread > 0 ? '' : 'none'; b.textContent = totalUnread; }

  el.innerHTML = list.map(c => {
    const init      = (c.userName || '?').trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
    const time      = c.updatedAt?.toDate
      ? c.updatedAt.toDate().toLocaleDateString('ru-RU', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
      : '—';
    const hasUnread = (c.adminUnread || 0) > 0;
    return `<div class="sc-item ${currentChatId === c.id ? 'active' : ''}" onclick="openSupportChat('${c.id}')">
      <div class="sc-item-av">${escHtml(init)}</div>
      <div class="sc-item-body">
        <div class="sc-item-head">
          <div class="sc-item-name">${escHtml(c.userName || 'Пользователь')}</div>
          <div class="sc-item-time">${time}</div>
        </div>
        <div class="sc-item-last">
          ${hasUnread ? '<span class="sc-item-dot"></span>' : ''}
          ${escHtml((c.lastMessage || '').slice(0, 55) || 'Нет сообщений')}
        </div>
        ${c.orderNumber ? `<div class="sc-item-order">Заказ #${escHtml(c.orderNumber)}</div>` : ''}
      </div>
      ${hasUnread ? `<div class="sc-item-badge">${c.adminUnread}</div>` : ''}
    </div>`;
  }).join('') || '<div class="er"><div class="er-ico"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg></div>Нет обращений</div>';
}

window.fChats = function (f, btn) {
  tktFilt = f;
  document.querySelectorAll('#page-support .fp').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  renderSupportChats();
};

window.openSupportChat = async function (id) {
  currentChatId = id;
  renderSupportChats();
  const c = CHATS.find(x => x.id === id); if (!c) return;
  const init    = (c.userName || '?').trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
  const orderHtml = c.orderId ? `
    <div class="sc-order-chip" onclick="openOrderModal('${c.orderId}')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
      <span>Заказ <strong>#${escHtml(c.orderNumber || '')}</strong></span>
      <svg style="margin-left:auto;color:var(--text3)" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
    </div>` : '';

  document.getElementById('chat-detail').innerHTML = `
    <div class="sc-detail-wrap">
      <div class="panel-head">
        <div class="sc-detail-user">
          <div class="sc-detail-av">${escHtml(init)}</div>
          <div>
            <div class="panel-title">${escHtml(c.userName || 'Пользователь')}</div>
            <div class="sc-detail-phone">${escHtml(c.userPhone || '—')}</div>
          </div>
        </div>
      </div>
      ${orderHtml}
      <div class="sc-msgs" id="sc-msgs"><div style="padding:28px;text-align:center;color:var(--text3);font-size:.7rem">Загрузка…</div></div>
      <div class="sc-reply-row">
        <textarea class="sc-reply-input" id="sc-reply-input" rows="1" placeholder="Ваш ответ…"
          oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,80)+'px'"
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendAdminReply('${id}');}"></textarea>
        <button class="sc-send-btn" id="sc-send-btn" onclick="sendAdminReply('${id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    </div>`;

  updateDoc(doc(db, 'supportChats', id), { adminUnread: 0 }).catch(() => {});
  _listenChatMessages(id);
};

function _listenChatMessages(chatId) {
  if (unsubChatMsgs) unsubChatMsgs();
  const q = query(collection(db, 'supportChats', chatId, 'messages'), orderBy('createdAt', 'asc'));
  unsubChatMsgs = onSnapshot(q, (snap) => {
    const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const el   = document.getElementById('sc-msgs'); if (!el) return;
    if (!msgs.length) {
      el.innerHTML = '<div style="padding:28px;text-align:center;color:var(--text3);font-size:.7rem">Нет сообщений</div>';
      return;
    }
    el.innerHTML = msgs.map(m => {
      const isAdmin  = m.senderRole === 'admin';
      const time     = m.createdAt?.toDate ? m.createdAt.toDate().toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' }) : '';
      const nameHtml = isAdmin && m.senderName ? `<span class="sc-msg-name">${escHtml(m.senderName)}</span>` : '';
      return `<div class="sc-msg ${isAdmin ? 'sc-msg-admin' : 'sc-msg-client'}">${nameHtml}${escHtml(m.text)}<span class="sc-msg-time">${time}</span></div>`;
    }).join('');
    el.scrollTop = el.scrollHeight;
  });
}

window.sendAdminReply = async function (chatId) {
  const inp = document.getElementById('sc-reply-input'); if (!inp) return;
  const text = inp.value.trim(); if (!text) return;
  inp.value = ''; inp.style.height = 'auto';
  const btn = document.getElementById('sc-send-btn'); if (btn) btn.disabled = true;
  try {
    await addDoc(collection(db, 'supportChats', chatId, 'messages'), {
      text,
      senderId:   CU.uid,
      senderRole: 'admin',
      senderName: AD?.displayName || CU.displayName || 'Поддержка',
      createdAt:  serverTimestamp(),
    });
    await updateDoc(doc(db, 'supportChats', chatId), {
      userUnread:           increment(1),
      lastMessage:          text.slice(0, 120),
      lastMessageAt:        serverTimestamp(),
      lastMessageSenderRole:'admin',
      updatedAt:            serverTimestamp(),
    });
  } catch { toast('Ошибка отправки', 'err'); }
  if (btn) btn.disabled = false;
  inp.focus();
};

// ══════════════════════════════════════════════════════════════
// TELEGRAM SUPPORT (tgChats)
// ══════════════════════════════════════════════════════════════

let TG_CHATS        = [];
let tgChatFilt      = 'all';
let currentTgChatId = null;
let unsubTgChats    = null;
let unsubTgMsgs     = null;

function listenTgChats() {
  if (unsubTgChats) unsubTgChats();
  const q = query(collection(db, 'tgChats'), orderBy('updatedAt', 'desc'));
  unsubTgChats = onSnapshot(q, (snap) => {
    TG_CHATS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTgChats();
    updateTgBadge();
  }, () => {});
}

function updateTgBadge() {
  const total = TG_CHATS.filter(c => (c.adminUnread || 0) > 0).length;
  const b = document.getElementById('sb-tg-b');
  if (b) { b.style.display = total > 0 ? '' : 'none'; b.textContent = total; }
}

function renderTgChats() {
  const el = document.getElementById('tg-chats-list'); if (!el) return;
  const list = tgChatFilt === 'unread'
    ? TG_CHATS.filter(c => (c.adminUnread || 0) > 0)
    : [...TG_CHATS];

  el.innerHTML = list.map(c => {
    const init      = (c.userName || '?').trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || 'TG';
    const time      = c.updatedAt?.toDate
      ? c.updatedAt.toDate().toLocaleDateString('ru-RU', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
      : '—';
    const hasUnread = (c.adminUnread || 0) > 0;
    return `<div class="sc-item ${currentTgChatId === c.id ? 'active' : ''}" onclick="openTgChat('${c.id}')">
      <div class="sc-item-av" style="background:linear-gradient(135deg,#2196f3,#1565c0)">${escHtml(init)}</div>
      <div class="sc-item-body">
        <div class="sc-item-head">
          <div class="sc-item-name">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="#2196f3" style="margin-right:3px;vertical-align:middle"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248l-2.01 9.47c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.873.751z"/></svg>
            ${escHtml(c.userName || 'Telegram пользователь')}
          </div>
          <div class="sc-item-time">${time}</div>
        </div>
        <div class="sc-item-last">
          ${hasUnread ? '<span class="sc-item-dot"></span>' : ''}
          ${escHtml((c.lastMessage || '').slice(0, 55) || 'Нет сообщений')}
        </div>
      </div>
      ${hasUnread ? `<div class="sc-item-badge">${c.adminUnread}</div>` : ''}
    </div>`;
  }).join('') || '<div class="er"><div class="er-ico"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg></div>Нет обращений из Telegram</div>';
}

window.fTgChats = function (f, btn) {
  tgChatFilt = f;
  document.querySelectorAll('#tg-chats-filter .fp').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  renderTgChats();
};

window.openTgChat = async function (id) {
  currentTgChatId = id;
  renderTgChats();
  const c = TG_CHATS.find(x => x.id === id); if (!c) return;
  const init = (c.userName || 'TG').trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || 'TG';

  document.getElementById('tg-chat-detail').innerHTML = `
    <div class="sc-detail-wrap">
      <div class="panel-head">
        <div class="sc-detail-user">
          <div class="sc-detail-av" style="background:linear-gradient(135deg,#2196f3,#1565c0)">${escHtml(init)}</div>
          <div>
            <div class="panel-title">${escHtml(c.userName || 'Telegram пользователь')}</div>
            <div class="sc-detail-phone" style="color:#2196f3;font-size:.7rem">Telegram · ID: ${escHtml(c.tgChatId || id)}</div>
          </div>
        </div>
      </div>
      <div class="sc-msgs" id="tg-msgs"><div style="padding:28px;text-align:center;color:var(--text3);font-size:.7rem">Загрузка…</div></div>
      <div class="sc-reply-row">
        <textarea class="sc-reply-input" id="tg-reply-input" rows="1" placeholder="Ответ в Telegram…"
          oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,80)+'px'"
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendTgReply('${id}');}"></textarea>
        <button class="sc-send-btn" id="tg-send-btn" onclick="sendTgReply('${id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    </div>`;

  updateDoc(doc(db, 'tgChats', id), { adminUnread: 0 }).catch(() => {});
  _listenTgMessages(id);
};

function _listenTgMessages(chatId) {
  if (unsubTgMsgs) unsubTgMsgs();
  const q = query(collection(db, 'tgChats', chatId, 'messages'), orderBy('createdAt', 'asc'));
  unsubTgMsgs = onSnapshot(q, (snap) => {
    const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const el   = document.getElementById('tg-msgs'); if (!el) return;
    if (!msgs.length) {
      el.innerHTML = '<div style="padding:28px;text-align:center;color:var(--text3);font-size:.7rem">Нет сообщений</div>';
      return;
    }
    el.innerHTML = msgs.map(m => {
      const isAdmin = m.sender === 'admin';
      const time    = m.createdAt?.toDate ? m.createdAt.toDate().toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' }) : '';
      const name    = isAdmin ? `<span class="sc-msg-name">Поддержка</span>` : '';
      return `<div class="sc-msg ${isAdmin ? 'sc-msg-admin' : 'sc-msg-client'}">${name}${escHtml(m.text)}<span class="sc-msg-time">${time}</span></div>`;
    }).join('');
    el.scrollTop = el.scrollHeight;
  });
}

window.sendTgReply = async function (chatId) {
  const inp = document.getElementById('tg-reply-input'); if (!inp) return;
  const text = inp.value.trim(); if (!text) return;
  inp.value = ''; inp.style.height = 'auto';
  const btn = document.getElementById('tg-send-btn'); if (btn) btn.disabled = true;
  try {
    await addDoc(collection(db, 'tgChats', chatId, 'messages'), {
      text,
      sender:    'admin',
      senderName: AD?.displayName || CU.displayName || 'Поддержка',
      createdAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'tgChats', chatId), {
      userUnread:  increment(1),
      lastMessage: text.slice(0, 120),
      updatedAt:   serverTimestamp(),
    });
  } catch { toast('Ошибка отправки', 'err'); }
  if (btn) btn.disabled = false;
  inp.focus();
};

window.switchSupportTab = function (tab) {
  const webTab = document.getElementById('support-tab-web');
  const tgTab  = document.getElementById('support-tab-tg');
  const webBtn = document.getElementById('tab-web-support');
  const tgBtn  = document.getElementById('tab-tg-support');
  if (tab === 'web') {
    webTab.style.display = '';
    tgTab.style.display  = 'none';
    webBtn.classList.add('active');
    tgBtn.classList.remove('active');
  } else {
    webTab.style.display = 'none';
    tgTab.style.display  = '';
    webBtn.classList.remove('active');
    tgBtn.classList.add('active');
    renderTgChats();
  }
};

// ══════════════════════════════════════════════════════════════
// HR / VACANCIES
// ══════════════════════════════════════════════════════════════

async function loadVacancies() {
  try {
    const snap   = await getDocs(query(collection(db, 'vacancies'), orderBy('createdAt', 'desc')));
    allVacancies = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateHrBadge();
    if (document.getElementById('page-hr').classList.contains('active')) renderHrPage();
  } catch (e) { console.error('Vacancies:', e); }
}

function updateHrBadge() {
  const open = allVacancies.filter(v => v.status === 'open').length;
  const b    = document.getElementById('sb-hr-b');
  if (b) { b.textContent = open; b.style.display = open > 0 ? '' : 'none'; }
}

function renderHrPage() {
  renderHrKPIs();
  renderHrTable();
}

function renderHrKPIs() {
  const open     = allVacancies.filter(v => v.status === 'open').length;
  const closed   = allVacancies.filter(v => v.status === 'closed').length;
  const totalApps= allVacancies.reduce((s, v) => s + (v.applications || 0), 0);
  const depts    = new Set(allVacancies.filter(v => v.status === 'open').map(v => v.department)).size;
  set('hr-kv-open',   open);
  set('hr-kv-apps',   totalApps);
  set('hr-kv-depts',  depts);
  set('hr-kv-closed', closed);
  updateHrBadge();
}

function renderHrTable() {
  const body = document.getElementById('hr-ob'); if (!body) return;
  const list = hrFilt === 'all' ? allVacancies : allVacancies.filter(v => v.status === hrFilt);
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="8"><div class="er"><div class="er-ico"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg></div>Вакансии не найдены</div></td></tr>';
    return;
  }
  const TYPE     = { 'full-time':'Полный день', 'part-time':'Частичная', internship:'Стажировка' };
  const DEPT_ICO = { 'Технологии':'','Операции':'','Маркетинг':'','Финансы':'','Дизайн':'','HR':'' };
  body.innerHTML = list.map(v => {
    const date   = v.createdAt?.toDate ? v.createdAt.toDate().toLocaleDateString('ru-RU', { day:'2-digit', month:'short', year:'2-digit' }) : '—';
    const isOpen = v.status === 'open';
    const sc     = isOpen ? 'var(--green)' : 'var(--text3)';
    const sb     = isOpen ? 'var(--greend)' : 'var(--muted2)';
    const sbr    = isOpen ? 'rgba(34,197,94,.2)' : 'var(--b)';
    return `<tr>
      <td style="min-width:150px">
        <div style="font-weight:700;color:var(--text);font-size:.76rem">${escHtml(v.title || '—')}</div>
        ${v.location ? `<div style="font-size:.6rem;color:var(--text3);margin-top:2px;display:flex;align-items:center;gap:3px"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg> ${escHtml(v.location)}</div>` : ''}
      </td>
      <td><span style="font-size:.6rem;background:var(--s2);border:1px solid var(--b);padding:2px 8px;border-radius:5px">${escHtml(v.department || '—')}</span></td>
      <td style="font-size:.66rem;color:var(--text2)">${TYPE[v.type] || v.type || '—'}</td>
      <td style="font-family:var(--fm);font-size:.66rem;color:var(--green);white-space:nowrap">${escHtml(v.salary || '—')}</td>
      <td style="text-align:center"><span style="font-family:var(--fm);font-size:.74rem;color:var(--text2);font-weight:600">${v.applications || 0}</span></td>
      <td><span class="ostatus" style="color:${sc};background:${sb};border-color:${sbr}"><span class="osdot"></span>${isOpen ? 'Открытая' : 'Закрытая'}</span></td>
      <td class="mono" style="font-size:.6rem">${date}</td>
      <td><div class="oact">
        <button class="btn btn-secondary btn-sm" onclick="viewApplications('${v.id}')">Заявки (${v.applications || 0})</button>
        <button class="btn btn-secondary btn-sm" onclick="openHrModal('${v.id}')" style="display:inline-flex;align-items:center;gap:4px"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Изменить</button>
      </div></td>
    </tr>`;
  }).join('');
}

window.fHr = function (filter, btn) {
  hrFilt = filter;
  document.querySelectorAll('#page-hr .tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderHrTable();
};

window.openHrModal = function (id) {
  editingVacId = id || null;
  const isEdit = !!id;
  document.getElementById('hr-modal-title').textContent = isEdit ? 'Редактировать вакансию' : 'Новая вакансия';
  const delBtn = document.getElementById('hv-del-btn');
  if (delBtn) delBtn.style.display = isEdit ? '' : 'none';

  if (isEdit) {
    const v = allVacancies.find(x => x.id === id);
    if (v) {
      document.getElementById('hv-title').value    = v.title || '';
      document.getElementById('hv-salary').value   = v.salary || '';
      document.getElementById('hv-dept').value     = v.department || 'Технологии';
      document.getElementById('hv-type').value     = v.type || 'full-time';
      document.getElementById('hv-location').value = v.location || '';
      document.getElementById('hv-desc').value     = v.description || '';
      document.getElementById('hv-req').value      = v.requirements || '';
      document.getElementById('hv-status').value   = v.status || 'open';
    }
  } else {
    ['hv-title','hv-salary','hv-location','hv-desc','hv-req'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('hv-dept').value   = 'Технологии';
    document.getElementById('hv-type').value   = 'full-time';
    document.getElementById('hv-status').value = 'open';
  }
  openMo('hr-modal');
};

window.saveVacancy = async function () {
  const title = document.getElementById('hv-title').value.trim();
  if (!title) { toast('Укажите должность', 'err'); return; }
  const data = {
    title,
    salary:      document.getElementById('hv-salary').value.trim(),
    department:  document.getElementById('hv-dept').value,
    type:        document.getElementById('hv-type').value,
    location:    document.getElementById('hv-location').value.trim(),
    description: document.getElementById('hv-desc').value.trim(),
    requirements:document.getElementById('hv-req').value.trim(),
    status:      document.getElementById('hv-status').value,
    updatedAt:   serverTimestamp(),
  };
  try {
    if (editingVacId) {
      await updateDoc(doc(db, 'vacancies', editingVacId), data);
      toast('Вакансия обновлена ✓', 'ok');
    } else {
      data.applications = 0;
      data.createdAt    = serverTimestamp();
      await addDoc(collection(db, 'vacancies'), data);
      toast('Вакансия создана ✓', 'ok');
    }
    closeMo('hr-modal');
    await loadVacancies();
    renderHrPage();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
};

window.deleteVacancy = async function () {
  if (!editingVacId) return;
  const v = allVacancies.find(x => x.id === editingVacId);
  if (!confirm('Удалить вакансию «' + (v?.title || editingVacId) + '»?')) return;
  try {
    await deleteDoc(doc(db, 'vacancies', editingVacId));
    toast('Вакансия удалена', 'ok');
    closeMo('hr-modal');
    await loadVacancies();
    renderHrPage();
  } catch (e) { toast('Ошибка удаления: ' + e.message, 'err'); }
};

window.viewApplications = async function (vacId) {
  const v = allVacancies.find(x => x.id === vacId);
  document.getElementById('hr-apps-title').textContent = (v?.title || 'Вакансия') + ' — заявки';
  const body = document.getElementById('hr-apps-body');
  body.innerHTML = '<div class="pload"><div class="spin"></div></div>';
  openMo('hr-apps-modal');
  try {
    const snap = await getDocs(query(collection(db, 'vacancies', vacId, 'applications'), orderBy('createdAt', 'desc')));
    const apps = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!apps.length) {
      body.innerHTML = '<div class="er" style="padding:36px"><div class="er-ico"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg></div>Заявок пока нет</div>';
      return;
    }
    body.innerHTML = apps.map(a => {
      const date = a.createdAt?.toDate
        ? a.createdAt.toDate().toLocaleDateString('ru-RU', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
        : '—';
      return `<div style="padding:13px 18px;border-bottom:1px solid var(--b)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;gap:10px;flex-wrap:wrap">
          <div style="font-weight:700;font-size:.78rem;color:var(--text)">${escHtml(a.name || '—')}</div>
          <span class="mono" style="font-size:.58rem;color:var(--text3)">${date}</span>
        </div>
        <div style="font-size:.68rem;color:var(--text3);display:flex;gap:14px;flex-wrap:wrap;margin-bottom:${a.message ? '7px' : '0'}">
          ${a.phone ? `<span style="display:inline-flex;align-items:center;gap:4px"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>${escHtml(a.phone)}</span>` : ''}
          ${a.link  ? `<a href="${escHtml(a.link)}" target="_blank" style="color:var(--acc2);text-decoration:underline;display:inline-flex;align-items:center;gap:4px"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>Резюме</a>` : ''}
        </div>
        ${a.message ? `<div style="font-size:.7rem;color:var(--text2);background:var(--s2);border-radius:7px;padding:8px 11px;line-height:1.5">${escHtml(a.message)}</div>` : ''}
      </div>`;
    }).join('');
  } catch { body.innerHTML = '<div class="er" style="padding:36px">Ошибка загрузки заявок</div>'; }
};

// ══════════════════════════════════════════════════════════════
// DELIVERY SERVICES (Firestore: deliveryServices/)
// Две дефолтные службы создаются автоматически при первом открытии.
// Добавление новых — только через Firestore Console.
// ══════════════════════════════════════════════════════════════

const DEFAULT_DELIVERY_SERVICES = [
  {
    id:               'mavsimi',
    name:             'Мавсими Расон',
    subtitle:         'Хидмати расонидан',
    logoUrl:          '/storage/delivery-service/mavsimi_rason_mini.png',
    targetCollection: 'mavsimiOrders',
    order:            1,
    active:           true,
  },
  {
    id:               'dastdaroz',
    name:             'Dastdaroz Delivery',
    subtitle:         'Бета · Собственная доставка',
    logoUrl:          '/storage/delivery-service/dastdaroz_delivery_mini.png',
    targetCollection: 'dastdarozOrders',
    order:            2,
    active:           true,
  },
];

async function loadDeliveryServices() {
  try {
    // Простой getDocs без orderBy — не фильтрует по наличию полей
    const sn = await getDocs(collection(db, 'deliveryServices'));

    if (sn.empty) {
      // Коллекция пуста — авто-создаём дефолтные службы
      const b = writeBatch(db);
      DEFAULT_DELIVERY_SERVICES.forEach(s => {
        const { id, ...data } = s;
        b.set(doc(db, 'deliveryServices', id), {
          ...data,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
      await b.commit();
      allDeliveryServices = DEFAULT_DELIVERY_SERVICES.map(s => ({ ...s }));
      toast('Службы доставки инициализированы в Firestore', 'ok');
    } else {
      allDeliveryServices = sn.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    }
  } catch (e) {
    console.error('loadDeliveryServices:', e);
    // Фоллбэк — показываем дефолты без записи
    allDeliveryServices = DEFAULT_DELIVERY_SERVICES.map(s => ({ ...s }));
  }
  renderDeliveryServices();
}

function renderDeliveryServices() {
  const el = document.getElementById('ds-list'); if (!el) return;

  const activeCnt = allDeliveryServices.filter(s => s.active).length;
  const totalCnt  = allDeliveryServices.length;
  const kva = document.getElementById('ds-kv-active');
  const kvt = document.getElementById('ds-kv-total');
  if (kva) kva.textContent = activeCnt;
  if (kvt) kvt.textContent = totalCnt;

  if (!totalCnt) {
    el.innerHTML = `<div class="er"><div class="er-ico"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 5v3h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg></div>Загрузка служб…</div>`;
    return;
  }

  el.innerHTML = allDeliveryServices.map(s => {
    const colBadge = s.targetCollection === 'mavsimiOrders'
      ? `<span style="font-size:.48rem;padding:1px 5px;background:#3b82f615;color:#3b82f6;border:1px solid #3b82f625;border-radius:3px">mavsimiOrders</span>`
      : `<span style="font-size:.48rem;padding:1px 5px;background:var(--acc-bg,#f0f4ff);color:var(--acc);border:1px solid var(--b);border-radius:3px">dastdarozOrders</span>`;

    const isActive = !!s.active;

    return `
      <div style="background:var(--s);border:1px solid var(--b);border-radius:10px;padding:16px 18px;
                  display:flex;align-items:center;gap:14px;opacity:${isActive ? 1 : .55}">
        <img src="${s.logoUrl || ''}" alt="${s.name}"
             style="width:48px;height:48px;border-radius:10px;object-fit:contain;background:var(--s2);border:1px solid var(--b);flex-shrink:0"
             onerror="this.style.opacity='.25'">
        <div style="flex:1;min-width:0">
          <div style="font-size:.84rem;font-weight:600;color:var(--text);display:flex;align-items:center;gap:6px">
            ${s.name}
            ${isActive
              ? `<span style="font-size:.48rem;padding:1px 5px;background:#10b98115;color:#10b981;border:1px solid #10b98125;border-radius:3px">● Активна</span>`
              : `<span style="font-size:.48rem;padding:1px 5px;background:var(--red)15;color:var(--red);border:1px solid var(--red)25;border-radius:3px">○ Скрыта</span>`}
          </div>
          <div style="font-size:.63rem;color:var(--text3);margin-top:2px">${s.subtitle || ''}</div>
          <div style="margin-top:6px;display:flex;align-items:center;flex-wrap:wrap;gap:5px">
            <span style="font-size:.48rem;padding:1px 5px;background:var(--s2);border:1px solid var(--b);border-radius:3px;color:var(--text3)">id: <strong>${s.id}</strong></span>
            ${colBadge}
          </div>
        </div>
        <div style="flex-shrink:0">
          <button class="btn ${isActive ? 'btn-danger' : 'btn-primary'} btn-sm"
                  style="min-width:110px"
                  onclick="toggleDSActive('${s.id}',${!isActive})">
            ${isActive ? '⊘ Скрыть' : '✓ Показать'}
          </button>
        </div>
      </div>`;
  }).join('');
}

window.toggleDSActive = async function (id, val) {
  try {
    await setDoc(doc(db, 'deliveryServices', id), {
      active:    val,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    toast(val ? '✓ Служба активирована' : '○ Служба скрыта в корзине', val ? 'ok' : 'warn');
    await loadDeliveryServices();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
};

// ══════════════════════════════════════════════════════════════
// STORES — Legacy (Firestore: stores/)
// Коллекция stores/ НЕ отображается в дашборде.
// Данные загружаются, т.к. могут использоваться в home.html.
// Функции openStoreModal/saveNewStore/etc. доступны через window.
// ══════════════════════════════════════════════════════════════

async function loadStores() {
  try {
    const snap = await getDocs(query(collection(db, 'stores'), orderBy('order', 'asc')));
    allStores  = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { console.error('Stores (legacy):', e); }
}

window.openStoreModal = function (id) {
  const s = id ? allStores.find(x => x.id === id) : null;
  document.getElementById('m-order-title').textContent = s ? 'Редактировать магазин' : 'Добавить магазин';
  document.getElementById('m-order-body').innerHTML = `
    <div class="mf"><label class="ml">Название (ID) *</label><input class="mi" id="st-name" placeholder="bi1" value="${escHtml(s?.name || '')}"/></div>
    <div class="mf"><label class="ml">Описание</label><input class="mi" id="st-desc" value="${escHtml(s?.description || '')}"/></div>
    <div class="mf"><label class="ml">URL изображения</label><input class="mi" id="st-img" value="${escHtml(s?.imageUrl || '')}"/></div>
    <div class="mf"><label class="ml">URL JSON-каталога</label><input class="mi" id="st-menu-url" value="${escHtml(s?.menuUrl || '')}"/></div>
    <div class="mr">
      <div class="mf"><label class="ml">Бейдж</label><input class="mi" id="st-badge" value="${escHtml(s?.badge || '')}"/></div>
      <div class="mf"><label class="ml">Порядок</label><input class="mi" type="number" id="st-order" value="${s?.order ?? 0}"/></div>
    </div>
    <div class="mf" style="display:flex;align-items:center;gap:10px;padding:10px 0">
      <input type="checkbox" id="st-active" style="width:16px;height:16px;accent-color:var(--green)" ${s?.active !== false ? 'checked' : ''}>
      <label for="st-active" style="font-size:.72rem;color:var(--text2)">Активен</label>
    </div>
    <div class="mf" style="display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--b)">
      <input type="checkbox" id="st-restricted" style="width:16px;height:16px;accent-color:var(--yellow)" ${s?.restricted ? 'checked' : ''}>
      <label for="st-restricted" style="font-size:.72rem;color:var(--text2)">Ограничен</label>
    </div>`;
  document.getElementById('m-order-foot').innerHTML = `
    <button class="btn btn-secondary" onclick="closeMo('order-modal')">Отмена</button>
    <button class="btn btn-primary"   onclick="${id ? `saveEditStore('${id}')` : 'saveNewStore()'}">${id ? 'Сохранить' : 'Добавить'}</button>`;
  openMo('order-modal');
};

window.saveNewStore = async function () {
  const name = document.getElementById('st-name')?.value.trim();
  if (!name) { toast('Введите название', 'warn'); return; }
  try {
    await addDoc(collection(db, 'stores'), {
      name,
      description: document.getElementById('st-desc')?.value.trim() || '',
      imageUrl:    document.getElementById('st-img')?.value.trim() || '',
      menuUrl:     document.getElementById('st-menu-url')?.value.trim() || '',
      badge:       document.getElementById('st-badge')?.value.trim() || '',
      order:       parseInt(document.getElementById('st-order')?.value || '0'),
      active:      document.getElementById('st-active')?.checked ?? true,
      restricted:  document.getElementById('st-restricted')?.checked ?? false,
      createdAt:   serverTimestamp(),
      updatedAt:   serverTimestamp(),
    });
    toast('Магазин добавлен', 'ok');
    closeMo('order-modal');
    await loadStores();
  } catch { toast('Ошибка', 'err'); }
};

window.saveEditStore = async function (id) {
  try {
    await updateDoc(doc(db, 'stores', id), {
      name:        document.getElementById('st-name')?.value.trim() || '',
      description: document.getElementById('st-desc')?.value.trim() || '',
      imageUrl:    document.getElementById('st-img')?.value.trim() || '',
      menuUrl:     document.getElementById('st-menu-url')?.value.trim() || '',
      badge:       document.getElementById('st-badge')?.value.trim() || '',
      order:       parseInt(document.getElementById('st-order')?.value || '0'),
      active:      document.getElementById('st-active')?.checked ?? true,
      restricted:  document.getElementById('st-restricted')?.checked ?? false,
      updatedAt:   serverTimestamp(),
    });
    toast('Магазин обновлён', 'ok');
    closeMo('order-modal');
    await loadStores();
  } catch { toast('Ошибка', 'err'); }
};

window.toggleStore = async function (id, val) {
  try { await updateDoc(doc(db, 'stores', id), { active: val, updatedAt: serverTimestamp() }); toast(val ? 'Активирован' : 'Скрыт', 'ok'); await loadStores(); }
  catch { toast('Ошибка', 'err'); }
};

window.toggleStoreRestrict = async function (id, val) {
  try { await updateDoc(doc(db, 'stores', id), { restricted: val, updatedAt: serverTimestamp() }); toast(val ? ' Ограничен' : 'Снято', val ? 'warn' : 'ok'); await loadStores(); }
  catch { toast('Ошибка', 'err'); }
};

window.deleteStore = async function (id) {
  const s = allStores.find(x => x.id === id);
  if (!confirm(`Удалить магазин «${s?.name || id}»?`)) return;
  try { await deleteDoc(doc(db, 'stores', id)); toast('Удалён', 'ok'); await loadStores(); }
  catch { toast('Ошибка', 'err'); }
};

// ══════════════════════════════════════════════════════════════
// RETAILERS (Firestore: retailers/)
// ══════════════════════════════════════════════════════════════

async function loadRetCities() {
  if (_retCities.length) return;
  try {
    const snap  = await getDocs(query(collection(db, 'cities'), orderBy('order')));
    _retCities  = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.active !== false);
  } catch {
    _retCities = [{ id: 'dushanbe', name: 'Душанбе' }];
  }
}

function fillRetCitySelect(selId, selVal = '') {
  const el = document.getElementById(selId); if (!el) return;
  el.innerHTML = _retCities.map(c =>
    `<option value="${c.id}"${c.id === selVal ? ' selected' : ''}>${escHtml(c.name)}${c.region ? ' · ' + escHtml(c.region) : ''}</option>`
  ).join('');
}

async function renderRetailersPage() {
  const list = document.getElementById('retailers-list'); if (!list) return;
  list.innerHTML = '<div class="pload"><div class="spin"></div> Загружаем…</div>';

  await loadRetCities();

  try {
    const snap = await getDocs(query(collection(db, 'retailers'), orderBy('order')));
    _retailers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch {
    try {
      const snap2 = await getDocs(collection(db, 'retailers'));
      _retailers  = snap2.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch { _retailers = []; }
  }

  // Считаем точки
  const locCounts = {};
  let totalLocs   = 0;
  await Promise.all(_retailers.map(async r => {
    try {
      const ls      = await getDocs(collection(db, 'retailers', r.id, 'locations'));
      locCounts[r.id] = ls.size;
      totalLocs      += ls.size;
    } catch { locCounts[r.id] = 0; }
  }));

  // KPI
  const kEl = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  kEl('ret-kv-active', _retailers.filter(r => r.active !== false).length);
  kEl('ret-kv-total',  _retailers.length);
  kEl('ret-kv-locs',   totalLocs);

  if (!_retailers.length) {
    list.innerHTML = '<div class="pload" style="flex-direction:column;gap:8px;padding:32px"><div style="opacity:.12;display:flex"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></div><div style="font-size:.76rem;color:var(--text3)">Ритейлеров пока нет — нажмите «Новый ритейлер»</div></div>';
    return;
  }

  list.innerHTML = _retailers.map(r => {
    const cnt      = locCounts[r.id] ?? 0;
    const cityName = _retCities.find(c => c.id === r.primaryCityId)?.name || r.primaryCityId || '—';
    const isActive = r.active !== false;
    const logo     = r.imageUrl
      ? `<img src="${escHtml(r.imageUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.style.display='none'">`
      : `<span style="font-size:.52rem;font-weight:700;color:var(--text3)">${escHtml((r.name || '').slice(0, 2).toUpperCase())}</span>`;
    return `<div class="ret-card" id="ret-card-${r.id}">
      <div class="ret-card-head" onclick="toggleRetCard('${r.id}')">
        <div class="ret-card-logo">${logo}</div>
        <div class="ret-card-info">
          <div class="ret-card-name">${escHtml(r.name || '—')}</div>
          <div class="ret-card-meta">
            <span class="ret-card-city" style="display:inline-flex;align-items:center;gap:3px"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg> ${escHtml(cityName)}</span>
            <span class="ret-card-locs-count" style="display:inline-flex;align-items:center;gap:3px"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> ${cnt} точ${cnt === 1 ? 'ка' : cnt < 5 ? 'ки' : 'ек'}</span>
            ${!isActive ? '<span style="font-size:.55rem;color:var(--text3);padding:2px 6px;background:var(--s2);border-radius:99px;border:1px solid var(--b)">скрыт</span>' : ''}
          </div>
        </div>
        <div class="ret-card-actions">
          <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();openRetailerModal('${r.id}')">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <svg class="ret-card-chevron" id="ret-chevron-${r.id}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
        </div>
      </div>
      <div class="ret-locs-panel" id="ret-locs-${r.id}">
        <div class="ret-locs-head">
          <div class="ret-locs-title" style="display:flex;align-items:center;gap:5px"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg> Точки магазина</div>
          <button class="btn btn-success btn-sm" onclick="openLocationModal('${r.id}','${escHtml(r.name || '')}')">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Добавить точку
          </button>
        </div>
        <div id="ret-locs-list-${r.id}"><div class="pload" style="padding:14px"><div class="spin"></div></div></div>
      </div>
    </div>`;
  }).join('');
}

window.toggleRetCard = async function (rid) {
  const panel = document.getElementById(`ret-locs-${rid}`);
  const chev  = document.getElementById(`ret-chevron-${rid}`);
  if (!panel) return;
  const isOpen = panel.classList.contains('open');
  panel.classList.toggle('open', !isOpen);
  chev?.classList.toggle('open', !isOpen);
  if (!isOpen) await loadLocationsPanel(rid);
};

async function loadLocationsPanel(rid) {
  const el = document.getElementById(`ret-locs-list-${rid}`); if (!el) return;
  el.innerHTML = '<div class="pload" style="padding:12px"><div class="spin"></div></div>';
  try {
    const snap = await getDocs(collection(db, 'retailers', rid, 'locations'));
    renderLocationsPanel(rid, snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (e) {
    el.innerHTML = `<div class="ret-loc-empty">Ошибка: ${e.message}</div>`;
  }
}

function renderLocationsPanel(rid, locs) {
  const el = document.getElementById(`ret-locs-list-${rid}`); if (!el) return;
  if (!locs.length) {
    el.innerHTML = '<div class="ret-loc-empty">Точек пока нет — нажмите «Добавить точку»</div>';
    return;
  }
  const rName = _retailers.find(r => r.id === rid)?.name || '';
  el.innerHTML = locs.map(loc => {
    const cName  = _retCities.find(c => c.id === loc.cityId)?.name || loc.cityId || '—';
    const coords = (loc.lat && loc.lng) ? `${(+loc.lat).toFixed(5)}, ${(+loc.lng).toFixed(5)}` : '';
    return `<div class="ret-loc-row" style="cursor:pointer" onclick="openRetCatalog('${rid}','${escHtml(rName)}','${loc.id}','${escHtml(loc.address||'')}')">
      <div class="ret-loc-ico">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
      </div>
      <div class="ret-loc-body">
        <div class="ret-loc-addr">${escHtml(loc.address || '—')}</div>
        <div class="ret-loc-meta">${escHtml(cName)}${coords ? ' · ' + coords : ''}</div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();openRetCatalog('${rid}','${escHtml(rName)}','${loc.id}','${escHtml(loc.address||'')}')" title="Каталог товаров">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
      </button>
      <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();openLocationModal('${rid}','${escHtml(rName)}','${loc.id}')" title="Редактировать точку">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
    </div>`;
  }).join('');
}

window.openRetailerModal = async function (rid = null) {
  _editRetId = rid;
  await loadRetCities();
  fillRetCitySelect('ret-city');

  const title   = document.getElementById('ret-modal-title');
  const delBtn  = document.getElementById('ret-del-btn');
  const preview = document.getElementById('ret-img-preview');
  if (title)   title.textContent       = rid ? 'Редактировать ритейлер' : 'Новый ритейлер';
  if (delBtn)  delBtn.style.display    = rid ? 'inline-flex' : 'none';
  if (preview) preview.style.display   = 'none';

  if (rid) {
    const r = _retailers.find(x => x.id === rid);
    if (r) {
      const v = (id, val) => { const e = document.getElementById(id); if (e) e.value = val; };
      v('ret-id', r.id); v('ret-name', r.name || ''); v('ret-desc', r.description || '');
      v('ret-image', r.imageUrl || ''); v('ret-order', r.order ?? 1);
      v('ret-active', String(r.active !== false));
      v('ret-extra-banner', r.extraBannerUrl || '');
      fillRetCitySelect('ret-city', r.primaryCityId || '');
      if (r.imageUrl) _showRetPreview(r.imageUrl);
      if (r.extraBannerUrl) _showRetExtraBannerPreview(r.extraBannerUrl); else _showRetExtraBannerPreview('');
    }
  } else {
    ['ret-id','ret-name','ret-desc','ret-image','ret-extra-banner'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
    _showRetExtraBannerPreview('');
    const ord = document.getElementById('ret-order'); if (ord) ord.value = _retailers.length + 1;
    const act = document.getElementById('ret-active'); if (act) act.value = 'true';
  }
  openMo('retailer-modal');
};

window.closeRetailerModal = () => closeMo('retailer-modal');

function _showRetPreview(url) {
  const w = document.getElementById('ret-img-preview');
  const i = document.getElementById('ret-img-preview-img');
  if (!w || !i) return;
  if (!url) { w.style.display = 'none'; return; }
  i.src = url; w.style.display = 'block';
}

function _showRetExtraBannerPreview(url) {
  const w = document.getElementById('ret-extra-banner-preview');
  const i = document.getElementById('ret-extra-banner-preview-img');
  if (!w || !i) return;
  if (!url) { w.style.display = 'none'; i.src = ''; return; }
  i.src = url; w.style.display = 'block';
}

document.getElementById('ret-image')?.addEventListener('input', e => _showRetPreview(e.target.value));
document.getElementById('ret-extra-banner')?.addEventListener('input', e => _showRetExtraBannerPreview(e.target.value));

window.saveRetailer = async function () {
  const name           = document.getElementById('ret-name')?.value.trim() || '';
  const cityId         = document.getElementById('ret-city')?.value || '';
  const imgUrl         = document.getElementById('ret-image')?.value.trim() || '';
  const extraBannerUrl = document.getElementById('ret-extra-banner')?.value.trim() || '';
  const desc           = document.getElementById('ret-desc')?.value.trim() || '';
  const order          = parseInt(document.getElementById('ret-order')?.value || '1');
  const active         = document.getElementById('ret-active')?.value === 'true';

  if (!name)   { toast('Введите название ритейлера', 'warn'); return; }
  if (!cityId) { toast('Выберите город', 'warn'); return; }

  const btn = document.querySelector('#retailer-modal .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Сохраняем…'; }

  try {
    const data = { name, primaryCityId: cityId, imageUrl: imgUrl, extraBannerUrl, description: desc, order: isNaN(order) ? 1 : order, active, updatedAt: serverTimestamp() };
    if (_editRetId) {
      await updateDoc(doc(db, 'retailers', _editRetId), data);
      toast(`Ритейлер «${name}» обновлён`, 'ok');
    } else {
      data.cityIds  = [];
      data.createdAt = serverTimestamp();
      await addDoc(collection(db, 'retailers'), data);
      toast(`Ритейлер «${name}» создан`, 'ok');
    }
    closeRetailerModal();
    _retCities = [];
    await renderRetailersPage();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = 'Сохранить'; } }
};

window.deleteRetailer = async function () {
  if (!_editRetId) return;
  const r = _retailers.find(x => x.id === _editRetId);
  if (!confirm(`Удалить ритейлер «${r?.name}» и все его точки?`)) return;
  try {
    const ls = await getDocs(collection(db, 'retailers', _editRetId, 'locations'));
    const b  = writeBatch(db);
    ls.docs.forEach(d => b.delete(d.ref));
    b.delete(doc(db, 'retailers', _editRetId));
    await b.commit();
    toast('Ритейлер удалён', 'ok');
    closeRetailerModal();
    await renderRetailersPage();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
};

window.openLocationModal = async function (rid, rName, locId = null) {
  _editLocRid = rid; _editLocId = locId;
  await loadRetCities();

  const title  = document.getElementById('loc-modal-title');
  const delBtn = document.getElementById('loc-del-btn');
  const rn     = document.getElementById('loc-retailer-name');
  const ridEl  = document.getElementById('loc-retailer-id');
  const lidEl  = document.getElementById('loc-id');

  if (title)  title.textContent      = locId ? 'Редактировать точку' : 'Новая точка';
  if (delBtn) delBtn.style.display   = locId ? 'inline-flex' : 'none';
  if (rn)     rn.textContent         = rName || '';
  if (ridEl)  ridEl.value            = rid;
  if (lidEl)  lidEl.value            = locId || '';

  if (locId) {
    try {
      const snap = await getDoc(doc(db, 'retailers', rid, 'locations', locId));
      if (snap.exists()) {
        const l = snap.data();
        fillRetCitySelect('loc-city', l.cityId || '');
        const v = (id, val) => { const e = document.getElementById(id); if (e) e.value = val; };
        v('loc-address', l.address || '');
        v('loc-lat',     l.lat ?? '');
        v('loc-lng',     l.lng ?? '');
      }
    } catch { toast('Ошибка загрузки точки', 'err'); }
  } else {
    const r = _retailers.find(x => x.id === rid);
    fillRetCitySelect('loc-city', r?.primaryCityId || '');
    ['loc-address','loc-lat','loc-lng'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
  }
  openMo('location-modal');
};

window.closeLocationModal = () => closeMo('location-modal');

window.saveLocation = async function () {
  const rid     = document.getElementById('loc-retailer-id')?.value || '';
  const locId   = document.getElementById('loc-id')?.value || '';
  const cityId  = document.getElementById('loc-city')?.value || '';
  const address = document.getElementById('loc-address')?.value.trim() || '';
  const latRaw  = document.getElementById('loc-lat')?.value || '';
  const lngRaw  = document.getElementById('loc-lng')?.value || '';

  if (!cityId)  { toast('Выберите город', 'warn'); return; }
  if (!address) { toast('Введите адрес', 'warn'); return; }

  const lat = latRaw ? parseFloat(latRaw) : null;
  const lng = lngRaw ? parseFloat(lngRaw) : null;
  if ((latRaw && isNaN(lat)) || (lngRaw && isNaN(lng))) { toast('Некорректные координаты', 'warn'); return; }

  const btn = document.querySelector('#location-modal .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Сохраняем…'; }

  try {
    const data = { cityId, address, updatedAt: serverTimestamp() };
    if (lat !== null) data.lat = lat;
    if (lng !== null) data.lng = lng;

    if (locId) {
      await updateDoc(doc(db, 'retailers', rid, 'locations', locId), data);
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(collection(db, 'retailers', rid, 'locations'), data);
    }
    await updateDoc(doc(db, 'retailers', rid), { cityIds: arrayUnion(cityId) });

    toast('Точка сохранена ✓', 'ok');
    closeLocationModal();
    await loadLocationsPanel(rid);
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = 'Сохранить'; } }
};

window.deleteLocation = async function () {
  const rid    = document.getElementById('loc-retailer-id')?.value || '';
  const locId  = document.getElementById('loc-id')?.value || '';
  const cityId = document.getElementById('loc-city')?.value || '';
  if (!rid || !locId) return;
  if (!confirm('Удалить эту точку?')) return;
  try {
    await deleteDoc(doc(db, 'retailers', rid, 'locations', locId));
    const rem = await getDocs(query(collection(db, 'retailers', rid, 'locations'), where('cityId', '==', cityId)));
    if (rem.empty) await updateDoc(doc(db, 'retailers', rid), { cityIds: arrayRemove(cityId) });
    toast('Точка удалена', 'ok');
    closeLocationModal();
    await loadLocationsPanel(rid);
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
};

// ══════════════════════════════════════════════════════════════
// ADS / PROMO
// ══════════════════════════════════════════════════════════════

window.renderAdsPage = async function () {
  try {
    const snap = await getDoc(doc(db, 'config', 'homePromo'));
    const d    = snap.exists() ? snap.data() : {};
    document.getElementById('ads-active').checked  = d.active !== false;
    document.getElementById('ads-img-url').value   = d.imageUrl || '';
    document.getElementById('ads-link-url').value  = d.linkUrl  || '';
    previewPromo();
  } catch { toast('Ошибка загрузки рекламы', 'err'); }
};

window.previewPromo = function () {
  const url   = document.getElementById('ads-img-url').value.trim();
  const wrap  = document.getElementById('ads-preview-wrap');
  const img   = document.getElementById('ads-preview-img');
  const empty = document.getElementById('ads-preview-empty');
  if (!url) { wrap.style.display = 'none'; return; }
  wrap.style.display  = 'block';
  img.style.display   = 'none';
  empty.style.display = 'none';
  img.src = url;
};

window.saveHomePromo = async function () {
  const imageUrl = document.getElementById('ads-img-url').value.trim();
  const linkUrl  = document.getElementById('ads-link-url').value.trim();
  const active   = document.getElementById('ads-active').checked;
  try {
    await setDoc(doc(db, 'config', 'homePromo'), { imageUrl, linkUrl, active, updatedAt: serverTimestamp() }, { merge: true });
    toast('Реклама сохранена ✓', 'ok');
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
};

// ══════════════════════════════════════════════════════════════
// PARTNER APPLICATIONS
// ══════════════════════════════════════════════════════════════

async function loadPartnerApps() {
  try {
    const snap     = await getDocs(query(collection(db, 'partnerApplications'), orderBy('createdAt', 'desc')));
    allPartnerApps = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updatePartnerBadge();
    if (document.getElementById('page-partners')?.classList.contains('active')) renderPartnerPage();
  } catch (e) { console.error('PartnerApps:', e); }
}

function updatePartnerBadge() {
  const n = allPartnerApps.filter(a => a.status === 'new').length;
  const b = document.getElementById('sb-partner-b');
  if (b) { b.textContent = n; b.style.display = n > 0 ? '' : 'none'; }
}

function renderPartnerPage() {
  const body = document.getElementById('partner-ob'); if (!body) return;
  const total     = allPartnerApps.length;
  const newC      = allPartnerApps.filter(a => a.status === 'new').length;
  const contacted = allPartnerApps.filter(a => a.status === 'contacted').length;
  set('partner-kv-new',       newC);
  set('partner-kv-contacted', contacted);
  set('partner-kv-total',     total);

  const list = partnerFilt === 'all' ? allPartnerApps : allPartnerApps.filter(a => a.status === partnerFilt);
  if (!list.length) {
    body.innerHTML = `<tr><td colspan="8"><div class="er"><div class="er-ico"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg></div>${partnerFilt === 'new' ? 'Нет новых заявок' : 'Заявок не найдено'}</div></td></tr>`;
    return;
  }
  body.innerHTML = list.map(a => {
    const raw  = a.createdAt;
    const date = raw?.toDate
      ? raw.toDate().toLocaleDateString('ru-RU', { day:'2-digit', month:'short', year:'2-digit', hour:'2-digit', minute:'2-digit' })
      : raw ? new Date(raw).toLocaleDateString('ru-RU') : '—';
    const isNew       = a.status === 'new';
    const isContacted = a.status === 'contacted';
    const sc  = isNew ? 'var(--yellow)' : isContacted ? 'var(--green)' : 'var(--text3)';
    const sb  = isNew ? 'var(--yellowd)' : isContacted ? 'var(--greend)' : 'var(--muted2)';
    const sbr = isNew ? 'rgba(245,158,11,.25)' : isContacted ? 'rgba(34,197,94,.2)' : 'var(--b)';
    const sl  = isNew ? 'Новая' : isContacted ? 'Связались' : 'Архив';
    return `<tr>
      <td style="min-width:140px">
        <div style="font-weight:700;color:var(--text);font-size:.76rem">${escHtml(a.company || '—')}</div>
        ${a.restaurant ? `<div style="font-size:.6rem;color:var(--text3);margin-top:2px;display:flex;align-items:center;gap:3px"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8h1a4 4 0 010 8h-1"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg> ${escHtml(a.restaurant)}</div>` : ''}
      </td>
      <td style="font-size:.7rem;color:var(--text2);max-width:160px"><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(a.address || '—')}</div></td>
      <td style="font-family:var(--fm);font-size:.68rem;color:var(--acc2);white-space:nowrap">${escHtml(a.phone || '—')}</td>
      <td style="font-family:var(--fm);font-size:.64rem;color:var(--text3);white-space:nowrap">${a.phone2 ? escHtml(a.phone2) : '—'}</td>
      <td style="max-width:200px;font-size:.68rem;color:var(--text2)">${a.comment ? `<span style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word">${escHtml(a.comment)}</span>` : '<span style="color:var(--text3)">—</span>'}</td>
      <td><span class="ostatus" style="color:${sc};background:${sb};border-color:${sbr}"><span class="osdot"></span>${sl}</span></td>
      <td class="mono" style="font-size:.58rem;white-space:nowrap">${date}</td>
      <td><div class="oact">
        ${isNew ? `<button class="btn btn-success btn-sm" onclick="markPartner('${a.id}','contacted')">✓ Связались</button>` : ''}
        ${a.status === 'contacted' ? `<button class="btn btn-secondary btn-sm" onclick="markPartner('${a.id}','archived')">Архив</button>` : ''}
        <button class="btn btn-danger btn-sm" onclick="deletePartnerApp('${a.id}')">✕</button>
      </div></td>
    </tr>`;
  }).join('');
}

window.fPartners = function (filter, btn) {
  partnerFilt = filter;
  document.querySelectorAll('#page-partners .tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderPartnerPage();
};

window.markPartner = async function (id, status) {
  try {
    await updateDoc(doc(db, 'partnerApplications', id), { status, updatedAt: serverTimestamp() });
    toast(status === 'contacted' ? 'Отмечено: связались ✓' : 'Перемещено в архив', 'ok');
    await loadPartnerApps();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
};

window.deletePartnerApp = async function (id) {
  const a = allPartnerApps.find(x => x.id === id);
  if (!confirm('Удалить заявку от «' + (a?.company || id) + '»?')) return;
  try {
    await deleteDoc(doc(db, 'partnerApplications', id));
    toast('Заявка удалена', 'ok');
    await loadPartnerApps();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
};

/** Вызывается из home.html — сохраняет заявку партнёра в Firestore */
window._submitPartnerApp = async function (data) {
  await addDoc(collection(db, 'partnerApplications'), { ...data, status: 'new', createdAt: serverTimestamp() });
  await loadPartnerApps();
};

// ══════════════════════════════════════════════════════════════
// DELIVERY ZONES (Города доставки)
// ══════════════════════════════════════════════════════════════

async function loadAZones() {
  document.getElementById('az-tbody').innerHTML = '<tr><td colspan="6"><div class="pload"><div class="spin"></div></div></td></tr>';
  try {
    const snap = await getDocs(query(collection(db, 'cities'), orderBy('order')));
    allCities  = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCities();
    const inactiveCount = allCities.filter(c => c.active === false).length;
    const sb = document.getElementById('sb-az-b');
    if (sb) { sb.style.display = inactiveCount ? '' : 'none'; sb.textContent = inactiveCount; }
  } catch (e) {
    document.getElementById('az-tbody').innerHTML =
      `<tr><td colspan="6" style="color:var(--red);text-align:center;padding:24px;font-size:.76rem">Ошибка загрузки: ${e.message}</td></tr>`;
  }
}

function renderCities() {
  const active   = allCities.filter(c => c.active !== false).length;
  const inactive = allCities.filter(c => c.active === false).length;
  set('az-kv-total',   allCities.length || '0');
  set('az-kv-avail',   active);
  set('az-kv-unavail', inactive);

  const list = _cityFilter === 'active'   ? allCities.filter(c => c.active !== false)
             : _cityFilter === 'inactive' ? allCities.filter(c => c.active === false)
             : allCities;

  if (!list.length) {
    document.getElementById('az-tbody').innerHTML = `<tr><td colspan="6" style="text-align:center;padding:28px;color:var(--muted2);font-size:.76rem">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" style="opacity:.25;display:block;margin:0 auto 8px"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
      Городов нет
    </td></tr>`;
    return;
  }

  document.getElementById('az-tbody').innerHTML = list.map(c => {
    const ok  = c.active !== false;
    const col = ok ? 'var(--green)' : 'var(--red)';
    const lbl = ok ? 'Активен' : 'Скоро';
    return `<tr>
      <td style="font-size:.68rem;color:var(--muted2);font-family:monospace;white-space:nowrap">${escHtml(c.id)}</td>
      <td style="font-weight:600;white-space:nowrap">${escHtml(c.name || '—')}</td>
      <td style="color:var(--text2);font-size:.72rem">${escHtml(c.region || '—')}</td>
      <td style="text-align:center;color:var(--muted2);font-size:.76rem;font-weight:600">${c.order ?? '—'}</td>
      <td><span class="ostatus" style="color:${col};border-color:${col}30;background:${col}10;font-size:.52rem">${lbl}</span></td>
      <td><div style="display:flex;gap:5px;align-items:center">
        <button class="btn btn-secondary btn-sm" onclick="toggleCity('${c.id}',${ok})" style="font-size:.6rem;padding:4px 9px">${ok ? 'Отключить' : 'Включить'}</button>
        <button class="btn btn-secondary btn-sm" onclick="openCityModal('${c.id}')" style="font-size:.6rem;padding:4px 9px" style="display:inline-flex;align-items:center;gap:4px"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        <button class="btn btn-sm" onclick="deleteCity('${c.id}','${escHtml((c.name || '').replace(/'/g, "\\'"))}')" style="font-size:.6rem;padding:4px 9px;background:rgba(239,68,68,.1);color:#ef4444;border:1px solid rgba(239,68,68,.25);display:inline-flex;align-items:center;gap:3px"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg></button>
      </div></td>
    </tr>`;
  }).join('');
}

window.cityFilter = function (f, btn) {
  _cityFilter = f;
  document.querySelectorAll('#az-tabs .tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderCities();
};

window.openCityModal = function (id = null) {
  _cityEditId = id;
  const c = id ? allCities.find(x => x.id === id) : null;
  document.getElementById('az-modal-title').textContent = c ? 'Редактировать город' : 'Новый город';
  const idField = document.getElementById('az-id-field');
  const idInput = document.getElementById('az-id');
  if (idField) idField.style.display = c ? 'none' : '';
  if (idInput) { idInput.value = ''; idInput.disabled = !!c; }
  document.getElementById('az-name').value            = c?.name   || '';
  document.getElementById('az-region').value          = c?.region || '';
  document.getElementById('az-order').value           = c?.order  ?? (allCities.length + 1);
  document.getElementById('az-avail-tog').checked     = c ? c.active !== false : true;
  document.getElementById('az-modal').classList.add('open');
  setTimeout(() => document.getElementById(c ? 'az-name' : 'az-id').focus(), 150);
};

window.closeCityModal = function () {
  document.getElementById('az-modal').classList.remove('open');
  _cityEditId = null;
};

window.saveCity = async function () {
  const name   = document.getElementById('az-name').value.trim();
  const region = document.getElementById('az-region').value.trim();
  const order  = parseInt(document.getElementById('az-order').value) || 1;
  const active = document.getElementById('az-avail-tog').checked;
  const rawId  = document.getElementById('az-id')?.value.trim();

  if (!name) { toast('Введите название города', 'warn'); return; }
  if (!_cityEditId && !rawId) { toast('Введите ID города (напр. dushanbe)', 'warn'); return; }
  if (!_cityEditId && !/^[a-z0-9_-]+$/.test(rawId)) {
    toast('ID может содержать только строчные буквы, цифры, - и _', 'warn'); return;
  }

  const btn = document.getElementById('az-save-btn');
  btn.disabled = true; btn.textContent = 'Сохраняем…';
  try {
    const data = { name, region, order, active };
    if (_cityEditId) {
      await updateDoc(doc(db, 'cities', _cityEditId), data);
      toast('Город обновлён ✓', 'ok');
    } else {
      await setDoc(doc(db, 'cities', rawId), data);
      toast('Город добавлен ✓', 'ok');
    }
    closeCityModal();
    await loadAZones();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
  finally { btn.disabled = false; btn.textContent = 'Сохранить'; }
};

window.toggleCity = async function (id, currentActive) {
  try {
    await updateDoc(doc(db, 'cities', id), { active: !currentActive });
    toast(currentActive ? 'Город скрыт' : 'Город активирован', 'ok');
    await loadAZones();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
};

window.deleteCity = async function (id, name) {
  if (!confirm(`Удалить город «${name}»?\nЭто действие необратимо.`)) return;
  try {
    await deleteDoc(doc(db, 'cities', id));
    toast('Город удалён', 'ok');
    await loadAZones();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
};

// ══════════════════════════════════════════════════════════════
// RETAILER CATALOG  (retailers/{rid}/catalog/{productId})
// ══════════════════════════════════════════════════════════════

let _retCatRid   = null;
let _retCatLocId = null;
let _retCatLocAddr = '';
let _retCatName  = '';
let _retCatProds = [];

window.openRetCatalog = async function (rid, rName, locId, locAddr) {
  _retCatRid     = rid;
  _retCatLocId   = locId;
  _retCatLocAddr = locAddr || '';
  _retCatName    = rName;
  _retCatProds   = [];

  const titleEl = document.getElementById('ret-cat-title');
  if (titleEl) titleEl.textContent = locAddr ? `${rName} — ${locAddr}` : rName;
  const search = document.getElementById('ret-cat-search');
  const filter = document.getElementById('ret-cat-filter');
  if (search) search.value = '';
  if (filter) filter.innerHTML = '<option value="">Все категории</option>';
  document.getElementById('ret-cat-body').innerHTML = _retCatSkeleton();
  openMo('ret-catalog-modal');

  try {
    const path = locId
      ? collection(db, 'retailers', rid, 'locations', locId, 'catalog')
      : collection(db, 'retailers', rid, 'catalog');
    const snap = await getDocs(path);
    _retCatProds = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _retCatProds.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
    _fillRetCatFilter();
    renderRetCatalog();
  } catch (e) {
    document.getElementById('ret-cat-body').innerHTML =
      `<div class="ret-loc-empty" style="padding:28px">Ошибка загрузки: ${e.message}</div>`;
  }
};

function _retCatSkeleton() {
  const row = () => `<div class="ret-cat-prod">
    <div class="ret-cat-prod-img" style="background:linear-gradient(90deg,var(--s2) 25%,var(--s3) 50%,var(--s2) 75%);background-size:200% 100%;animation:skl 1.4s ease-in-out infinite;border:none"></div>
    <div class="ret-cat-prod-body">
      <div class="skl-block" style="height:8px;width:58%;margin-bottom:6px"></div>
      <div class="skl-block" style="height:7px;width:36%"></div>
    </div>
    <div class="skl-block" style="height:9px;width:50px;border-radius:4px;flex-shrink:0"></div>
    <div style="display:flex;gap:5px;flex-shrink:0">
      <div class="skl-block" style="height:26px;width:28px;border-radius:7px"></div>
      <div class="skl-block" style="height:26px;width:28px;border-radius:7px"></div>
    </div>
  </div>`;
  return [1,2,3,4,5].map(row).join('');
}

function _fillRetCatFilter() {
  const sel = document.getElementById('ret-cat-filter'); if (!sel) return;
  const cats = [...new Set(_retCatProds.map(p => p.categoryId).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  sel.innerHTML = '<option value="">Все категории</option>' +
    cats.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
}

function renderRetCatalog() {
  const body   = document.getElementById('ret-cat-body'); if (!body) return;
  const search = (document.getElementById('ret-cat-search')?.value || '').toLowerCase().trim();
  const cat    = document.getElementById('ret-cat-filter')?.value || '';

  const list = _retCatProds.filter(p => {
    if (cat && p.categoryId !== cat) return false;
    if (search && !(p.name || '').toLowerCase().includes(search)) return false;
    return true;
  });

  if (!list.length) {
    body.innerHTML = _retCatProds.length
      ? '<div class="ret-loc-empty">Ничего не найдено по фильтру</div>'
      : '<div class="ret-loc-empty" style="padding:32px">Каталог пуст — нажмите «+ Товар»</div>';
    return;
  }

  body.innerHTML = list.map(p => {
    const avail = p.available !== false;
    const img = p.imageUrl
      ? `<img src="${escHtml(p.imageUrl)}" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display='none'">`
      : `<span style="display:flex;align-items:center;justify-content:center;color:var(--text3)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg></span>`;
    return `<div class="ret-cat-prod${avail ? '' : ' ret-cat-prod-hidden'}">
      <div class="ret-cat-prod-img">${img}</div>
      <div class="ret-cat-prod-body">
        <div class="ret-cat-prod-name">${escHtml(p.name || '—')}</div>
        <div class="ret-cat-prod-meta">
          ${p.categoryId ? `<span class="ret-cat-badge-cat">${escHtml(p.categoryId)}</span>` : ''}
          ${!avail ? '<span class="ret-cat-badge-hid">скрыт</span>' : ''}
        </div>
      </div>
      <div class="ret-cat-prod-price">${p.price != null ? p.price + '\u00a0см' : '—'}</div>
      <div class="ret-cat-prod-acts">
        <button class="btn btn-secondary btn-sm" onclick="openRetProdModal('${p.id}')" title="Изменить">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn btn-${avail ? 'warn' : 'success'} btn-sm"
          onclick="toggleRetProd('${p.id}',${!avail})"
          title="${avail ? 'Скрыть товар' : 'Показать товар'}">
          ${avail
            ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22"/></svg>`
            : `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`}
        </button>
      </div>
    </div>`;
  }).join('');
}

window.filterRetCatalog = function () { renderRetCatalog(); };

window.openRetProdModal = function (id = null) {
  const p = id ? _retCatProds.find(x => x.id === id) : null;
  document.getElementById('m-order-title').textContent =
    p ? 'Изменить: ' + (p.name || '—') : 'Новый товар';
  document.getElementById('m-order-body').innerHTML = `
    <div style="padding:8px 10px;background:var(--s2);border:1px solid var(--b);border-radius:8px;font-size:.62rem;color:var(--text2);margin-bottom:4px;display:flex;align-items:center;gap:6px">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
      <strong style="color:var(--text)">${escHtml(_retCatName)}</strong>
      <code style="color:var(--text3);font-size:.58rem">retailers/${_retCatRid}/locations/${_retCatLocId}/catalog/</code>
    </div>
    <div class="mf">
      <label class="ml">Название *</label>
      <input class="mi" id="rp-nm" value="${escHtml(p?.name || '')}" placeholder="Молоко 1л"/>
    </div>
    <div class="mf">
      <label class="ml">Описание</label>
      <input class="mi" id="rp-ds" value="${escHtml(p?.description || '')}" placeholder="Краткое описание…"/>
    </div>
    <div class="mr">
      <div class="mf">
        <label class="ml">Цена (смн) *</label>
        <input class="mi" type="number" min="0" id="rp-pr" value="${p?.price ?? ''}" placeholder="10"/>
      </div>
      <div class="mf">
        <label class="ml">Категория</label>
        <input class="mi" id="rp-ct" value="${escHtml(p?.categoryId || '')}" placeholder="молочное"/>
      </div>
    </div>
    <div class="mf">
      <label class="ml">URL изображения</label>
      <input class="mi" id="rp-im" value="${escHtml(p?.imageUrl || '')}" placeholder="https://…"/>
    </div>`;
  document.getElementById('m-order-foot').innerHTML = `
    ${p ? `<button class="btn btn-danger" style="margin-right:auto" onclick="deleteRetProd('${id}')">Удалить</button>` : ''}
    <button class="btn btn-secondary" onclick="closeMo('order-modal')">Отмена</button>
    <button class="btn btn-primary" onclick="${p ? `saveRetEditProd('${id}')` : 'saveRetNewProd()'}">
      ${p ? 'Сохранить' : 'Добавить'}
    </button>`;
  openMo('order-modal');
};

window.saveRetNewProd = async function () {
  const name  = document.getElementById('rp-nm')?.value.trim();
  const price = parseFloat(document.getElementById('rp-pr')?.value || '0');
  if (!name)  { toast('Укажите название', 'warn'); return; }
  if (!price) { toast('Укажите цену', 'warn'); return; }
  try {
    const catCol = _retCatLocId
      ? collection(db, 'retailers', _retCatRid, 'locations', _retCatLocId, 'catalog')
      : collection(db, 'retailers', _retCatRid, 'catalog');
    await addDoc(catCol, {
      name,
      description: document.getElementById('rp-ds')?.value.trim() || '',
      price,
      categoryId:  document.getElementById('rp-ct')?.value.trim() || '',
      imageUrl:    document.getElementById('rp-im')?.value.trim() || '',
      available:   true,
      createdAt:   serverTimestamp(),
      updatedAt:   serverTimestamp(),
    });
    toast('Товар добавлен', 'ok');
    closeMo('order-modal');
    await openRetCatalog(_retCatRid, _retCatName, _retCatLocId, _retCatLocAddr);
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
};

window.saveRetEditProd = async function (id) {
  try {
    const catPath = _retCatLocId
      ? doc(db, 'retailers', _retCatRid, 'locations', _retCatLocId, 'catalog', id)
      : doc(db, 'retailers', _retCatRid, 'catalog', id);
    await updateDoc(catPath, {
      name:        document.getElementById('rp-nm')?.value.trim() || '',
      description: document.getElementById('rp-ds')?.value.trim() || '',
      price:       parseFloat(document.getElementById('rp-pr')?.value || '0'),
      categoryId:  document.getElementById('rp-ct')?.value.trim() || '',
      imageUrl:    document.getElementById('rp-im')?.value.trim() || '',
      updatedAt:   serverTimestamp(),
    });
    toast('Товар обновлён', 'ok');
    closeMo('order-modal');
    await openRetCatalog(_retCatRid, _retCatName, _retCatLocId, _retCatLocAddr);
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
};

window.toggleRetProd = async function (id, val) {
  try {
    const tPath = _retCatLocId
      ? doc(db, 'retailers', _retCatRid, 'locations', _retCatLocId, 'catalog', id)
      : doc(db, 'retailers', _retCatRid, 'catalog', id);
    await updateDoc(tPath, { available: val, updatedAt: serverTimestamp() });
    toast(val ? 'Товар показан' : 'Товар скрыт', 'ok');
    await openRetCatalog(_retCatRid, _retCatName, _retCatLocId, _retCatLocAddr);
  } catch (e) { toast('Ошибка', 'err'); }
};

window.deleteRetProd = async function (id) {
  if (!confirm('Удалить товар из каталога?')) return;
  try {
    const dPath = _retCatLocId
      ? doc(db, 'retailers', _retCatRid, 'locations', _retCatLocId, 'catalog', id)
      : doc(db, 'retailers', _retCatRid, 'catalog', id);
    await deleteDoc(dPath);
    toast('Удалён', 'ok');
    closeMo('order-modal');
    await openRetCatalog(_retCatRid, _retCatName, _retCatLocId, _retCatLocAddr);
  } catch (e) { toast('Ошибка', 'err'); }
};

// ══════════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════════

const PAGE_TITLES = {
  overview:             'Обзор',
  orders:               'Заказы',
  couriers:             'Курьеры',
  clients:              'Клиенты',
  support:              'Поддержка',
  catalog:              'Каталог',
  'delivery-services':  'Курьерские службы',
  stores:               'Ритейлеры',
  addresses:            'Адреса доставки',
  news:                 'Новости',
  analytics:            'Аналитика',
  staff:                'Сотрудники',
  settings:             'Настройки',
  hr:                   'HR / Вакансии',
  ads:                  'Реклама',
  partners:             'Партнерство',
};

window.goPage = function (page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.ni').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page)?.classList.add('active');
  document.querySelector(`.ni[data-page="${page}"]`)?.classList.add('active');

  const el = document.getElementById('tb-title');
  if (el) el.textContent = PAGE_TITLES[page] || page;

  if (page === 'couriers')          renderCouriersPage();
  if (page === 'support')           { renderSupportChats(); listenTgChats(); }
  if (page === 'analytics')         renderAnalytics();
  if (page === 'staff')             renderStaff();
  if (page === 'overview')          { renderDonut(); renderLiveOrders(); renderAct(); }
  if (page === 'news')              renderNewsTable();
  if (page === 'hr')                renderHrPage();
  if (page === 'stores')            renderRetailersPage();
  if (page === 'ads')               renderAdsPage();
  if (page === 'partners')          renderPartnerPage();
  if (page === 'tg-bot')            renderTgBotPage();
  if (page === 'addresses')         loadAZones();
  if (page === 'delivery-services') loadDeliveryServices();

  closeSB();
  document.getElementById('pages')?.scrollTo(0, 0);
};

window.toggleSB = function () {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sb-overlay').classList.toggle('open');
};

window.closeSB = function () {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sb-overlay').classList.remove('open');
};

document.getElementById('sb-overlay').addEventListener('click', closeSB);

// ══════════════════════════════════════════════════════════════
// MODALS
// ══════════════════════════════════════════════════════════════

window.openMo = function (id) { document.getElementById(id)?.classList.add('open'); };
window.closeMo = function (id) { document.getElementById(id)?.classList.remove('open'); };

// Закрытие по клику на бэкдроп
document.querySelectorAll('.mo').forEach(m =>
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); })
);

// Закрытие по Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.mo.open').forEach(m => m.classList.remove('open'));
});

// ══════════════════════════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════════════════════════

window.toast = function (msg, type = '') {
  const w  = document.getElementById('toast-wrap');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = `<div class="tdot"></div><span>${msg}</span>`;
  w.appendChild(el);
  setTimeout(() => el.remove(), 3500);
};

// ══════════════════════════════════════════════════════════════
// SEARCH
// ══════════════════════════════════════════════════════════════

window.onSearch = function (v) {
  if (!v) return;
  const q = v.toLowerCase();

  const fo = allOrders.find(o =>
    o.id.slice(-6).toLowerCase().includes(q) ||
    o.clientName?.toLowerCase().includes(q) ||
    o.address?.toLowerCase().includes(q)
  );
  if (fo) { openOrderModal(fo.id); return; }

  const fc = allClients.find(c => c.displayName?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q));
  if (fc) { goPage('clients'); toast('Клиент найден: ' + fc.displayName, 'info'); return; }

  const fr = allCouriers.find(c => c.displayName?.toLowerCase().includes(q));
  if (fr) { goPage('couriers'); toast('Курьер найден: ' + fr.displayName, 'info'); return; }

  const fn = allNews.find(a => a.title?.toLowerCase().includes(q));
  if (fn) { goPage('news'); toast('Статья: ' + fn.title, 'info'); return; }

  toast('Ничего не найдено по «' + v + '»', 'info');
};

// ══════════════════════════════════════════════════════════════
// REFRESH
// ══════════════════════════════════════════════════════════════

window.refreshAll = async function () {
  toast('Обновляем…', 'info');
  await loadAll();
  toast('Обновлено ✓', 'ok');
};

// ══════════════════════════════════════════════════════════════
// EXPORT
// ══════════════════════════════════════════════════════════════

window.exportOrders = function () {
  const rows = allOrders.map(o =>
    `${o.id.slice(-6)},${o.clientName || ''},${(o.address || '').replace(/,/g, ' ')},${o.courierName || ''},${o.status},${o.total || 0},${o.createdAt?.toDate ? o.createdAt.toDate().toLocaleDateString('ru-RU') : ''}`
  );
  const csv = ['ID,Клиент,Адрес,Курьер,Статус,Сумма,Дата', ...rows].join('\n');
  const a   = document.createElement('a');
  a.href    = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csv);
  a.download = 'orders.csv';
  a.click();
  toast('CSV скачан', 'ok');
};

// ══════════════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════════════

// TODO: реализовать сохранение настроек в Firestore (config/delivery)
window.saveSettings = function () {
  toast('Настройки сохранены', 'ok');
};

// ══════════════════════════════════════════════════════════════
// LOGOUT
// ══════════════════════════════════════════════════════════════

window.doLogout = async function () {
  // Отписываем ВСЕ onSnapshot слушатели перед выходом
  if (unsubOrders)   { unsubOrders();   unsubOrders   = null; }
  if (unsubDast)     { unsubDast();     unsubDast     = null; }
  if (unsubMav)      { unsubMav();      unsubMav      = null; }
  if (unsubCouriers) { unsubCouriers(); unsubCouriers = null; }
  if (unsubChats)    { unsubChats();    unsubChats    = null; }
  if (unsubChatMsgs) { unsubChatMsgs(); unsubChatMsgs = null; }
  await signOut(auth);
  location.href = 'admin-login.html';
};

// ══════════════════════════════════════════════════════════════
// TELEGRAM BOT — рассылка и управление
// ══════════════════════════════════════════════════════════════

async function renderTgBotPage() {
  // Загружаем пользователей бота
  try {
    const [usersSnap, chatsSnap, broadcastsSnap] = await Promise.all([
      getDocs(query(collection(db, 'tgUsers'), orderBy('createdAt', 'desc'))),
      getDocs(collection(db, 'tgChats')),
      getDocs(query(collection(db, 'tgBroadcasts'), orderBy('createdAt', 'desc'), limit(1))),
    ]);

    const users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // KPI
    document.getElementById('tg-kpi-users').textContent  = users.length;
    document.getElementById('tg-kpi-chats').textContent  = chatsSnap.size;
    document.getElementById('sb-tg-users-b').textContent = users.length;
    document.getElementById('sb-tg-users-b').style.display = users.length > 0 ? '' : 'none';

    // Последняя рассылка
    if (!broadcastsSnap.empty) {
      const last = broadcastsSnap.docs[0].data();
      document.getElementById('tg-kpi-last-broadcast').textContent = `${last.sent || 0} чел.`;
      const d = last.createdAt?.toDate?.();
      document.getElementById('tg-kpi-last-broadcast-date').textContent = d
        ? d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
        : '—';
    }

    // Список пользователей
    const el = document.getElementById('tg-users-list');
    if (!users.length) {
      el.innerHTML = '<div class="er"><div class="er-ico">💬</div>Ещё никто не запустил бота</div>';
      return;
    }
    el.innerHTML = users.map(u => {
      const time = u.createdAt?.toDate?.()
        ? u.createdAt.toDate().toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })
        : '—';
      const init = (u.userName || 'TG').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
      return `<div style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border)">
        <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#2196f3,#1565c0);display:flex;align-items:center;justify-content:center;color:#fff;font-size:.65rem;font-weight:700;flex-shrink:0">${escHtml(init)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:.78rem;font-weight:600;color:var(--text1)">${escHtml(u.userName || 'Пользователь')}</div>
          <div style="font-size:.68rem;color:var(--text3)">ID: ${escHtml(String(u.tgChatId || u.id))}</div>
        </div>
        <div style="font-size:.68rem;color:var(--text3);flex-shrink:0">${time}</div>
      </div>`;
    }).join('');

  } catch (err) {
    console.error('renderTgBotPage error:', err);
  }
}

// Предпросмотр сообщения
window.previewBroadcast = function () {
  const text = document.getElementById('broadcast-text').value.trim();
  if (!text) return;
  const prev = document.getElementById('broadcast-preview');
  document.getElementById('broadcast-preview-text').textContent = text;
  prev.style.display = '';
};

// Рассылка всем пользователям
window.sendBroadcast = async function () {
  const text = document.getElementById('broadcast-text').value.trim();
  if (!text) { toast('Введи текст рассылки', 'err'); return; }

  const btn = document.getElementById('broadcast-btn');
  const res = document.getElementById('broadcast-result');
  btn.disabled = true;
  btn.textContent = '⏳ Отправляем…';
  res.style.display = '';
  res.innerHTML = '<div style="color:var(--text2)">⏳ Рассылка выполняется, подожди…</div>';

  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 60_000); // 60 секунд

    const response = await fetch('https://api.dastdaroz.shop/api/broadcast', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text }),
      signal:  controller.signal,
    });

    clearTimeout(timeout);

    const data = await response.json();

    if (!response.ok) throw new Error(data.error || 'Ошибка сервера');

    res.innerHTML = `<div style="color:var(--green)">✅ Рассылка завершена!<br>Отправлено: <b>${data.sent}</b> чел. / Ошибок: ${data.failed}</div>`;
    document.getElementById('broadcast-text').value = '';
    document.getElementById('broadcast-preview').style.display = 'none';
    toast(`Отправлено ${data.sent} пользователям`, 'ok');
    renderTgBotPage();

  } catch (err) {
    console.error('broadcast error:', err);
    const msg = err.name === 'AbortError' ? 'Превышено время ожидания (60 сек)' : err.message;
    res.innerHTML = `<div style="color:var(--red)">❌ Ошибка: ${msg}</div>`;
    toast('Ошибка рассылки', 'err');
  }

  btn.disabled = false;
  btn.innerHTML = '📢 Отправить всем';
};
