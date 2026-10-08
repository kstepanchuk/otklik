<?php
declare(strict_types=1);

function registration_mode(): string
{
    return (string) setting('registration', 'open');
}

function login_as(array $user): array
{
    start_session();
    session_regenerate_id(true);
    $_SESSION['uid'] = (int) $user['id'];
    $_SESSION['pw'] = password_mark($user);
    $_SESSION['csrf'] = bin2hex(random_bytes(16));
    return ['user' => public_user($user), 'csrf' => $_SESSION['csrf']];
}

function valid_password($p): string
{
    $p = (string) $p;
    if (mb_strlen($p) < 8) {
        fail('Пароль должен быть не короче 8 символов');
    }
    // Алгоритм хеширования учитывает только первые 72 байта.
    if (strlen($p) > 72) {
        fail('Пароль слишком длинный: не больше 72 латинских или 36 русских букв');
    }
    return $p;
}

function api_whoami(array $in): array
{
    $u = current_user();
    return [
        'user' => $u ? public_user($u) : null,
        'csrf' => $u ? $_SESSION['csrf'] : null,
        'app_name' => cfg('app_name'),
        'registration' => registration_mode(),
    ];
}

function api_register(array $in): array
{
    throttle_login('', 'register');
    $email = mb_strtolower(str_clean($in['email'] ?? '', 190));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        fail('Проверьте адрес почты');
    }
    $password = valid_password($in['password'] ?? '');
    $name = str_clean($in['name'] ?? '', 80);
    $hash = password_hash($password, PASSWORD_DEFAULT);
    // Проверка «первый ли это аккаунт», приглашение и запись — в одной транзакции:
    // две одновременные регистрации не станут администраторами обе и не потратят одно приглашение дважды.
    db()->exec('BEGIN IMMEDIATE');
    $first = !val('SELECT 1 FROM users LIMIT 1');
    $mode = registration_mode();
    $invite = null;
    if (!$first) {
        if ($mode === 'closed') {
            fail('Регистрация закрыта. Обратитесь к администратору', 403);
        }
        if ($mode === 'invite') {
            $invite = use_token('invite', (string) ($in['invite'] ?? ''), false);
            if (!$invite || ($invite['email'] !== '' && $invite['email'] !== $email)) {
                fail('Регистрация только по приглашению. Откройте ссылку из письма', 403);
            }
        }
    }
    if (val('SELECT 1 FROM users WHERE email = ?', [$email])) {
        db()->exec('ROLLBACK');
        note_failed_login('', 'register');
        fail('Аккаунт с такой почтой уже есть. Войдите или восстановите пароль');
    }
    $verified = $first || $invite || !cfg('require_email_verification');
    q(
        'INSERT INTO users (email, password_hash, name, role, email_verified, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [$email, $hash, $name, $first ? 'admin' : 'user', $verified ? 1 : 0, time()]
    );
    $id = last_id();
    if ($invite) {
        q('UPDATE tokens SET used_at = ? WHERE id = ?', [time(), $invite['id']]);
    }
    db()->exec('COMMIT');
    // Успешная регистрация тоже считается: с одного адреса нельзя создать сотни аккаунтов и разослать сотни писем.
    note_failed_login('', 'register');
    if (!$verified) {
        $token = make_token('verify', $id, $email, 86400 * 3);
        send_mail($email, 'Подтвердите почту', "Здравствуйте!\n\nЧтобы завершить регистрацию в сервисе «" . cfg('app_name') . "», откройте ссылку:\n" . app_url() . "/reset.html?verify=$token\n\nЕсли вы не регистрировались, просто не отвечайте на это письмо.");
        return ['verify' => true];
    }
    return login_as(row('SELECT * FROM users WHERE id = ?', [$id]));
}

function api_login(array $in): array
{
    $email = mb_strtolower(str_clean($in['email'] ?? '', 190));
    throttle_login($email);
    $u = row('SELECT * FROM users WHERE email = ?', [$email]);
    // Для несуществующей почты проверяем пароль по фиктивному хешу: время ответа не выдаёт, есть ли аккаунт.
    $hash = $u ? $u['password_hash'] : '$2y$10$abcdefghijklmnopqrstuuJ8l7p3mQ0m0m0m0m0m0m0m0m0m0m0mO';
    $ok = password_verify((string) ($in['password'] ?? ''), $hash);
    if (!$u || !$ok) {
        note_failed_login($email);
        fail('Неверная почта или пароль', 401);
    }
    if ($u['status'] !== 'active') {
        fail('Аккаунт заблокирован. Обратитесь к администратору', 403);
    }
    if (!$u['email_verified'] && cfg('require_email_verification')) {
        fail('Почта не подтверждена. Откройте ссылку из письма или запросите сброс пароля', 403);
    }
    return login_as($u);
}

function api_logout(array $in): array
{
    start_session();
    $_SESSION = [];
    session_destroy();
    return ['ok' => true];
}

function api_verify(array $in): array
{
    $t = use_token('verify', (string) ($in['token'] ?? ''));
    if (!$t) {
        fail('Ссылка устарела или уже использована');
    }
    q('UPDATE users SET email_verified = 1 WHERE id = ?', [$t['user_id']]);
    return login_as(row('SELECT * FROM users WHERE id = ?', [$t['user_id']]));
}

function api_forgot(array $in): array
{
    $email = mb_strtolower(str_clean($in['email'] ?? '', 190));
    throttle_login($email, 'forgot');
    note_failed_login($email, 'forgot');
    $u = row("SELECT * FROM users WHERE email = ? AND status = 'active'", [$email]);
    if ($u) {
        $token = make_token('reset', (int) $u['id'], $email, 3600 * 2);
        send_mail($email, 'Сброс пароля', "Чтобы задать новый пароль в сервисе «" . cfg('app_name') . "», откройте ссылку (действует 2 часа):\n" . app_url() . "/reset.html?reset=$token\n\nЕсли вы не запрашивали сброс, ничего делать не нужно.");
    }
    // Ответ одинаков для существующих и несуществующих адресов.
    return ['ok' => true];
}

function api_reset(array $in): array
{
    $password = valid_password($in['password'] ?? '');
    $t = use_token('reset', (string) ($in['token'] ?? ''));
    if (!$t) {
        fail('Ссылка устарела или уже использована. Запросите сброс ещё раз');
    }
    // Переход по ссылке из письма подтверждает и почту.
    q('UPDATE users SET password_hash = ?, email_verified = 1 WHERE id = ?', [password_hash($password, PASSWORD_DEFAULT), $t['user_id']]);
    // Остальные ссылки для сброса этого аккаунта больше не действуют.
    q("UPDATE tokens SET used_at = ? WHERE user_id = ? AND kind = 'reset' AND used_at IS NULL", [time(), $t['user_id']]);
    return login_as(row('SELECT * FROM users WHERE id = ?', [$t['user_id']]));
}

function api_profile_update(array $in): array
{
    $u = require_user();
    $settings = json_decode($u['settings'] ?: '{}', true) ?: [];
    if (isset($in['theme'])) {
        $settings['theme'] = clean_theme($in['theme']);
    }
    q('UPDATE users SET name = ?, settings = ? WHERE id = ?', [str_clean($in['name'] ?? $u['name'], 80), json_encode((object) $settings, JSON_UNESCAPED_UNICODE), $u['id']]);
    return ['user' => public_user(row('SELECT * FROM users WHERE id = ?', [$u['id']]))];
}

function api_password_change(array $in): array
{
    $u = require_user();
    if (!password_verify((string) ($in['old'] ?? ''), $u['password_hash'])) {
        fail('Текущий пароль введён неверно');
    }
    q('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash(valid_password($in['new'] ?? ''), PASSWORD_DEFAULT), $u['id']]);
    // Текущий вход остаётся, остальные завершаются: их отметка пароля перестаёт совпадать.
    $_SESSION['pw'] = password_mark(row('SELECT * FROM users WHERE id = ?', [$u['id']]));
    return ['ok' => true];
}
