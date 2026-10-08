// Общие помощники для всех страниц.
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Создаёт элемент. Текст всегда попадает в DOM как текст, а не как разметка. */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') {
      // Переменные CSS (--c) задаются только через setProperty.
      for (const [p, val] of Object.entries(v)) { if (p.startsWith('--')) el.style.setProperty(p, val); else el.style[p] = val; }
    }
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

const App = { csrf: null, user: null, info: {} };

async function request(method, action, data) {
  let url = 'api.php?a=' + action;
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (method === 'GET') {
    for (const [k, v] of Object.entries(data || {})) {
      if (v !== undefined && v !== null) url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(v);
    }
  } else if (data instanceof FormData) {
    opts.body = data;
  } else {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(data || {});
  }
  if (App.csrf) opts.headers['X-CSRF'] = App.csrf;
  let res;
  try {
    res = await fetch(url, opts);
  } catch (e) {
    throw Object.assign(new Error('Нет связи с сервером. Проверьте интернет'), { status: 0 });
  }
  let body = null;
  try { body = await res.json(); } catch (e) { /* пустой или не-JSON ответ */ }
  if (!res.ok || !body) {
    throw Object.assign(new Error((body && body.error) || 'Ошибка сервера (' + res.status + ')'), { status: res.status });
  }
  return body;
}
const apiGet = (action, params) => request('GET', action, params);
const apiPost = (action, data) => request('POST', action, data);

function toast(message, bad) {
  let box = $('.toast-box');
  if (!box) document.body.append(box = h('div', { class: 'toast-box', role: 'status', 'aria-live': 'polite' }));
  const t = h('div', { class: 'toast' + (bad ? ' bad' : ''), text: message });
  box.append(t);
  setTimeout(() => t.remove(), bad ? 5000 : 2600);
}
const oops = (e) => toast(e.message || String(e), true);

/** Загружает текущего пользователя; без входа отправляет на страницу входа. */
async function requireUser(adminOnly) {
  const me = await apiGet('whoami');
  App.info = me;
  if (!me.user) {
    location.href = 'login.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.search);
    return new Promise(() => {});
  }
  if (adminOnly && me.user.role !== 'admin') {
    location.href = 'dashboard.html';
    return new Promise(() => {});
  }
  App.user = me.user;
  App.csrf = me.csrf;
  return me.user;
}

function topbar(active) {
  const links = [['dashboard.html', 'Сессии']];
  if (App.user && App.user.role === 'admin') links.push(['admin.html', 'Админка']);
  return h('header', { class: 'topbar' },
    h('a', { class: 'brand', href: 'dashboard.html', text: App.info.app_name || 'Отклик' }),
    h('nav', {}, links.map(([href, name]) => h('a', { href, class: href === active ? 'on' : '', text: name }))),
    h('div', { class: 'spacer' }),
    h('span', { class: 'hint', text: App.user ? (App.user.name || App.user.email) : '' }),
    h('button', { class: 'btn ghost small', text: 'Выйти', onclick: async () => { await apiPost('logout').catch(() => {}); location.href = 'index.html'; } }),
  );
}

function modal(title, body, actions) {
  const back = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) close(); } });
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.append(h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('h2', { text: title }), body,
    h('div', { class: 'modal-actions' }, h('button', { class: 'btn ghost', text: 'Отмена', onclick: close }), ...(actions || []).map((a) => a(close))),
  ));
  document.body.append(back);
  const first = $('input, textarea, select, button.choice', back);
  if (first) first.focus();
  return close;
}

function confirmBox(title, text, okLabel, onOk, danger) {
  modal(title, h('p', { text }), [(close) => h('button', {
    class: 'btn' + (danger ? ' danger' : ''), text: okLabel,
    onclick: async () => { try { await onOk(); close(); } catch (e) { oops(e); } },
  })]);
}

function switchField(title, note, checked, onChange) {
  const input = h('input', { type: 'checkbox', checked, onchange: () => onChange(input.checked) });
  return h('label', { class: 'switch' }, input, h('i'), h('span', {}, h('b', { text: title }), note ? h('small', { text: note }) : null));
}

async function uploadImage(file) {
  const fd = new FormData();
  fd.append('file', file);
  return (await request('POST', 'upload', fd)).url;
}

function pickImage(onUrl) {
  const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif' });
  input.onchange = async () => {
    if (!input.files[0]) return;
    try { onUrl(await uploadImage(input.files[0])); } catch (e) { oops(e); }
  };
  input.click();
}

function formatCode(code) {
  return String(code).replace(/(\d{3})(\d{3})/, '$1 $2');
}

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const box = h('div', { class: 'qr' });
  const svg = new DOMParser().parseFromString(qr.createSvgTag({ scalable: true, margin: 0 }), 'image/svg+xml');
  box.append(document.importNode(svg.documentElement, true));
  return box;
}

function applyTheme(el, theme) {
  theme = theme || {};
  el.classList.toggle('light', theme.mode === 'light');
  el.style.setProperty('--accent', theme.accent || '#ffc83d');
  el.classList.toggle('has-bg', !!theme.bg);
  el.style.backgroundImage = theme.bg ? 'url("' + theme.bg + '")' : '';
}

const TYPE_NAMES = {
  open: 'Открытый ответ', cloud: 'Облако слов', poll: 'Опрос', quiz: 'Викторина', scale: 'Шкала', rank: 'Ранжирование',
  number: 'Угадай число', pin: 'Точка на картинке', qa: 'Вопросы спикеру', info: 'Информационный слайд', nps: 'Обратная связь',
};
const TYPE_ABOUT = {
  open: 'Люди пишут текст, ответы появляются карточками',
  cloud: 'Короткие ответы собираются в облако',
  poll: 'Выбор из вариантов, один или несколько',
  quiz: 'Верный ответ, таймер, очки за скорость',
  scale: 'Оценка по шкале, среднее значение',
  rank: 'Расставить варианты по важности',
  number: 'Ближе всех к верному числу',
  pin: 'Отметить место на изображении',
  qa: 'Вопросы из зала с лайками',
  info: 'Текст или картинка между вопросами',
  nps: 'Оценка встречи от 0 до 10 и комментарий',
};
const COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)', 'var(--c9)', 'var(--c10)'];
