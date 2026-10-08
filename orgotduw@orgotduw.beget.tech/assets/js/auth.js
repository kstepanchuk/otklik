// Вход, регистрация, подтверждение почты и сброс пароля.
'use strict';

(async () => {
  const card = $('#card');
  const params = new URLSearchParams(location.search);
  const mode = document.body.dataset.mode;
  const next = (() => {
    const n = params.get('next') || '';
    // Переход после входа — только на страницы этого же сайта.
    return /^[a-z]+\.html(\?[\w=&%-]*)?$/.test(n) ? n : 'dashboard.html';
  })();
  const brand = () => h('a', { class: 'brand', href: 'index.html', text: 'Отклик' });
  const field = (label, attrs) => {
    const input = h('input', { class: 'input', required: true, ...attrs });
    return { input, node: h('label', { class: 'field' }, h('span', { text: label }), input) };
  };
  const done = (r) => { App.csrf = r.csrf; location.href = next; };

  function form(title, fields, button, onSubmit, extra) {
    const err = h('p', { class: 'error-text', role: 'alert', hidden: true });
    const btn = h('button', { class: 'btn big block', type: 'submit', text: button });
    card.replaceChildren(brand(), h('h1', { text: title }), h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      err.hidden = true;
      btn.disabled = true;
      try { await onSubmit(); } catch (ex) { err.textContent = ex.message; err.hidden = false; }
      btn.disabled = false;
    } }, fields.map((f) => f.node), err, btn), extra || '');
    fields[0].input.focus();
  }

  const message = (title, text, link) => card.replaceChildren(brand(), h('h1', { text: title }), h('p', { text }), link || '');

  let info = {};
  try { info = await apiGet('whoami'); } catch (e) { /* форма покажется и без этого */ }
  if (info.user && mode !== 'reset') { location.href = next; return; }

  if (mode === 'login') {
    const email = field('Почта', { type: 'email', autocomplete: 'email' });
    const pass = field('Пароль', { type: 'password', autocomplete: 'current-password' });
    form('Вход для спикеров', [email, pass], 'Войти', async () => done(await apiPost('login', { email: email.input.value, password: pass.input.value })),
      h('div', { class: 'auth-links' }, h('a', { href: 'reset.html', text: 'Забыли пароль?' }), info.registration !== 'closed' ? h('a', { href: 'register.html', text: 'Создать аккаунт' }) : ''));
  }

  if (mode === 'register') {
    const invite = params.get('invite') || '';
    if (info.registration === 'closed') {
      message('Регистрация закрыта', 'Новые аккаунты создаёт администратор сервиса.', h('a', { class: 'btn', href: 'login.html', text: 'Войти' }));
    } else if (info.registration === 'invite' && !invite) {
      message('Регистрация по приглашению', 'Откройте ссылку из письма-приглашения или попросите её у администратора.', h('a', { class: 'btn', href: 'login.html', text: 'Войти' }));
    } else {
      const name = field('Имя', { autocomplete: 'name', maxlength: 80 });
      const email = field('Почта', { type: 'email', autocomplete: 'email' });
      const pass = field('Пароль, не короче 8 символов', { type: 'password', autocomplete: 'new-password', minlength: 8 });
      form('Аккаунт спикера', [name, email, pass], 'Создать аккаунт', async () => {
        const r = await apiPost('register', { name: name.input.value, email: email.input.value, password: pass.input.value, invite });
        if (r.verify) message('Проверьте почту', 'Мы отправили письмо на ' + email.input.value + '. Откройте ссылку из него, чтобы завершить регистрацию.');
        else done(r);
      }, h('div', { class: 'auth-links' }, h('a', { href: 'login.html', text: 'Уже есть аккаунт' })));
    }
  }

  if (mode === 'reset') {
    if (params.get('verify')) {
      message('Подтверждаем почту…', '');
      try { done(await apiPost('verify', { token: params.get('verify') })); } catch (e) { message('Ссылка не сработала', e.message, h('a', { class: 'btn', href: 'reset.html', text: 'Восстановить доступ' })); }
    } else if (params.get('reset')) {
      const pass = field('Новый пароль, не короче 8 символов', { type: 'password', autocomplete: 'new-password', minlength: 8 });
      form('Новый пароль', [pass], 'Сохранить пароль', async () => done(await apiPost('reset', { token: params.get('reset'), password: pass.input.value })));
    } else {
      const email = field('Почта', { type: 'email', autocomplete: 'email' });
      form('Сброс пароля', [email], 'Прислать ссылку', async () => {
        await apiPost('forgot', { email: email.input.value });
        message('Проверьте почту', 'Если аккаунт с адресом ' + email.input.value + ' существует, на него отправлена ссылка для смены пароля. Она действует 2 часа.', h('a', { class: 'btn ghost', href: 'login.html', text: 'Вернуться ко входу' }));
      }, h('div', { class: 'auth-links' }, h('a', { href: 'login.html', text: 'Вернуться ко входу' })));
    }
  }
})();
