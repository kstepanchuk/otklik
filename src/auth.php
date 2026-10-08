<?php
declare(strict_types=1);

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    session_name('otklik');
    session_set_cookie_params([
        'lifetime' => 60 * 60 * 24 * 30,
        'path' => '/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(16));
    }
}

/** Текущий пользователь или null. Сессию открываем, только если есть cookie. */
function current_user(bool $forceStart = false): ?array
{
    static $user = false;
    if ($user !== false) {
        return $user;
    }
    if (!$forceStart && empty($_COOKIE['otklik'])) {
        return $user = null;
    }
    start_session();
    $id = (int) ($_SESSION['uid'] ?? 0);
    if (!$id) {
        return $user = null;
    }
    $u = row('SELECT * FROM users WHERE id = ?', [$id]);
    if (!$u || $u['status'] !== 'active') {
        unset($_SESSION['uid']);
        return $user = null;
    }
    return $user = $u;
}

function require_user(): array
{
    $u = current_user();
    if (!$u) {
        fail('Войдите в аккаунт', 401);
    }
    return $u;
}

function require_admin(): array
{
    $u = require_user();
    if ($u['role'] !== 'admin') {
        fail('Нужны права администратора', 403);
    }
    return $u;
}

function check_csrf(): void
{
    start_session();
    $sent = $_SERVER['HTTP_X_CSRF'] ?? '';
    if (!is_string($sent) || !hash_equals($_SESSION['csrf'] ?? '', $sent)) {
        fail('Сессия устарела, обновите страницу', 419);
    }
}

function public_user(array $u): array
{
    return [
        'id' => (int) $u['id'],
        'email' => $u['email'],
        'name' => $u['name'],
        'role' => $u['role'],
        'settings' => json_decode($u['settings'] ?: '{}', true) ?: new stdClass(),
    ];
}

function make_token(string $kind, ?int $userId, string $email, int $ttl): string
{
    $token = bin2hex(random_bytes(24));
    q(
        'INSERT INTO tokens (user_id, email, kind, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)',
        [$userId, $email, $kind, hash('sha256', $token), time() + $ttl]
    );
    return $token;
}

function use_token(string $kind, string $token, bool $consume = true): ?array
{
    $t = row(
        'SELECT * FROM tokens WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ?',
        [hash('sha256', $token), $kind, time()]
    );
    if ($t && $consume) {
        q('UPDATE tokens SET used_at = ? WHERE id = ?', [time(), $t['id']]);
    }
    return $t;
}

function throttle_login(): void
{
    $since = time() - 600;
    q('DELETE FROM login_attempts WHERE at < ?', [$since]);
    if ((int) val('SELECT COUNT(*) FROM login_attempts WHERE ip = ?', [client_ip()]) >= 10) {
        fail('Слишком много попыток. Повторите через 10 минут', 429);
    }
}

function note_failed_login(): void
{
    q('INSERT INTO login_attempts (ip, at) VALUES (?, ?)', [client_ip(), time()]);
}
