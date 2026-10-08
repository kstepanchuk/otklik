<?php
declare(strict_types=1);

function api_admin_stats(array $in): array
{
    require_admin();
    $days = [];
    for ($i = 13; $i >= 0; $i--) {
        $days[date('Y-m-d', strtotime("-$i day"))] = ['users' => 0, 'sessions' => 0, 'answers' => 0];
    }
    $since = strtotime('-13 day midnight');
    foreach (['users', 'sessions', 'answers'] as $table) {
        $where = $table === 'sessions' ? ' AND is_template = 0' : '';
        foreach (rows("SELECT date(created_at, 'unixepoch', 'localtime') d, COUNT(*) c FROM $table WHERE created_at >= ?$where GROUP BY d", [$since]) as $r) {
            if (isset($days[$r['d']])) {
                $days[$r['d']][$table] = (int) $r['c'];
            }
        }
    }
    return [
        'totals' => [
            'users' => (int) val('SELECT COUNT(*) FROM users'),
            'sessions' => (int) val('SELECT COUNT(*) FROM sessions WHERE is_template = 0'),
            'participants' => (int) val('SELECT COUNT(*) FROM participants'),
            'answers' => (int) val('SELECT COUNT(*) FROM answers'),
        ],
        'days' => $days,
    ];
}

function api_admin_users(array $in): array
{
    require_admin();
    $search = '%' . str_clean($in['q'] ?? '', 80) . '%';
    $list = rows(
        'SELECT u.id, u.email, u.name, u.role, u.status, u.email_verified, u.created_at,
            (SELECT COUNT(*) FROM sessions WHERE user_id = u.id AND is_template = 0) AS sessions
         FROM users u WHERE u.email LIKE ? OR u.name LIKE ? ORDER BY u.id DESC LIMIT 300',
        [$search, $search]
    );
    foreach ($list as &$u) {
        foreach (['id', 'email_verified', 'created_at', 'sessions'] as $k) {
            $u[$k] = (int) $u[$k];
        }
    }
    return ['users' => $list];
}

function api_admin_user_update(array $in): array
{
    $me = require_admin();
    $u = row('SELECT * FROM users WHERE id = ?', [(int) ($in['id'] ?? 0)]);
    if (!$u) {
        fail('Пользователь не найден', 404);
    }
    $self = (int) $u['id'] === (int) $me['id'];
    if (isset($in['role']) && in_array($in['role'], ['user', 'admin'], true)) {
        if ($self && $in['role'] !== 'admin') {
            fail('Нельзя снять права администратора с себя');
        }
        q('UPDATE users SET role = ? WHERE id = ?', [$in['role'], $u['id']]);
    }
    if (isset($in['status']) && in_array($in['status'], ['active', 'blocked'], true)) {
        if ($self) {
            fail('Нельзя заблокировать себя');
        }
        q('UPDATE users SET status = ? WHERE id = ?', [$in['status'], $u['id']]);
    }
    if (!empty($in['verify'])) {
        q('UPDATE users SET email_verified = 1 WHERE id = ?', [$u['id']]);
    }
    return ['ok' => true];
}

function api_admin_user_delete(array $in): array
{
    $me = require_admin();
    $id = (int) ($in['id'] ?? 0);
    if ($id === (int) $me['id']) {
        fail('Нельзя удалить себя');
    }
    foreach (rows('SELECT id, code FROM sessions WHERE user_id = ?', [$id]) as $s) {
        q('DELETE FROM answers WHERE session_id = ?', [$s['id']]);
        remove_state($s['code']);
    }
    q('DELETE FROM users WHERE id = ?', [$id]);
    return ['ok' => true];
}

function api_admin_sessions(array $in): array
{
    require_admin();
    $list = rows(
        'SELECT s.id, s.code, s.title, s.phase, s.mode, s.created_at, u.email,
            (SELECT COUNT(*) FROM questions WHERE session_id = s.id) AS slides,
            (SELECT COUNT(*) FROM participants WHERE session_id = s.id) AS people,
            (SELECT COUNT(*) FROM answers WHERE session_id = s.id) AS answers
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.is_template = 0 ORDER BY s.id DESC LIMIT 300'
    );
    foreach ($list as &$s) {
        foreach (['id', 'created_at', 'slides', 'people', 'answers'] as $k) {
            $s[$k] = (int) $s[$k];
        }
    }
    return ['sessions' => $list];
}

function api_admin_settings(array $in): array
{
    require_admin();
    return [
        'registration' => registration_mode(),
        'max_answer_len' => (int) setting('max_answer_len', 300),
        'max_upload_mb' => (int) setting('max_upload_mb', 3),
        'stopwords' => (string) setting('stopwords', ''),
        'builtin_stopwords' => count(default_stopwords()) + count(stopwords_anywhere()),
        'file_stopwords' => is_file(ROOT . '/storage/stopwords.txt'),
    ];
}

function api_admin_settings_save(array $in): array
{
    require_admin();
    $values = [
        'registration' => in_array($in['registration'] ?? '', ['open', 'invite', 'closed'], true) ? $in['registration'] : 'open',
        'max_answer_len' => (string) max(20, min(1000, (int) ($in['max_answer_len'] ?? 300))),
        'max_upload_mb' => (string) max(1, min(10, (int) ($in['max_upload_mb'] ?? 3))),
        'stopwords' => str_clean($in['stopwords'] ?? '', 300000),
    ];
    foreach ($values as $k => $v) {
        q('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [$k, $v]);
    }
    return ['ok' => true];
}

function api_admin_invite(array $in): array
{
    require_admin();
    $email = mb_strtolower(str_clean($in['email'] ?? '', 190));
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        fail('Проверьте адрес почты');
    }
    $token = make_token('invite', null, $email, 86400 * 14);
    $link = app_url() . '/register.html?invite=' . $token;
    if ($email !== '') {
        send_mail($email, 'Приглашение в сервис «' . cfg('app_name') . '»', "Вас пригласили проводить опросы в сервисе «" . cfg('app_name') . "».\n\nЗарегистрируйтесь по ссылке (действует 14 дней):\n$link");
    }
    return ['link' => $link];
}
