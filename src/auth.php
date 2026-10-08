<?php
declare(strict_types=1);

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https'
        || stripos((string) cfg('app_url', ''), 'https://') === 0;
    ini_set('session.use_strict_mode', '1');
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
    // Смена или сброс пароля завершает все остальные входы в этот аккаунт.
    if ($u && !hash_equals(password_mark($u), (string) ($_SESSION['pw'] ?? ''))) {
        $u = null;
    }
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
    q('DELETE FROM tokens WHERE expires_at < ?', [time() - 86400 * 30]);
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
        // Ссылка одноразовая даже при двух одновременных запросах: засчитывается только первый.
        if (q('UPDATE tokens SET used_at = ? WHERE id = ? AND used_at IS NULL', [time(), $t['id']])->rowCount() !== 1) {
            return null;
        }
    }
    return $t;
}

function password_mark(array $user): string
{
    return substr(hash('sha256', (string) $user['password_hash']), 0, 24);
}

/**
 * Ограничение попыток: отдельные счётчики на адрес клиента и на почту.
 * Счётчик по адресу высокий, потому что за одним адресом может сидеть целый зал;
 * подбор пароля к одному аккаунту с разных адресов останавливает счётчик по почте.
 */
function throttle_login(string $email = '', string $kind = 'login'): void
{
    q('DELETE FROM login_attempts WHERE at < ?', [time() - 600]);
    $limits = [$kind . ':ip:' . client_ip() => $kind === 'login' ? 30 : 8];
    if ($email !== '') {
        $limits[$kind . ':mail:' . hash('sha256', $email)] = $kind === 'login' ? 8 : 3;
    }
    foreach ($limits as $key => $max) {
        if ((int) val('SELECT COUNT(*) FROM login_attempts WHERE ip = ?', [$key]) >= $max) {
            fail('Слишком много попыток. Повторите через 10 минут', 429);
        }
    }
}

function note_failed_login(string $email = '', string $kind = 'login'): void
{
    q('INSERT INTO login_attempts (ip, at) VALUES (?, ?)', [$kind . ':ip:' . client_ip(), time()]);
    if ($email !== '') {
        q('INSERT INTO login_attempts (ip, at) VALUES (?, ?)', [$kind . ':mail:' . hash('sha256', $email), time()]);
    }
}
