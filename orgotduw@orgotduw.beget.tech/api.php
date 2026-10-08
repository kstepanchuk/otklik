<?php
declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';
require ROOT . '/src/api_auth.php';
require ROOT . '/src/api_sessions.php';
require ROOT . '/src/api_live.php';
require ROOT . '/src/api_admin.php';

// Действия участника и входа: без аккаунта и без CSRF-токена (cookie в них не участвует).
const ANONYMOUS = ['whoami', 'register', 'login', 'verify', 'forgot', 'reset', 'join', 'ping', 'answer', 'vote', 'react', 'me', 'results'];
// Действия, которые только читают: их можно вызывать через GET.
const READ_ONLY = ['whoami', 'results', 'me', 'sessions_list', 'templates_list', 'session_get', 'report', 'export', 'admin_stats', 'admin_users', 'admin_sessions', 'admin_settings'];

$action = preg_replace('/[^a-z_]/', '', (string) ($_GET['a'] ?? ''));
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    $fn = 'api_' . $action;
    if ($action === '' || !function_exists($fn)) {
        fail('Неизвестное действие', 404);
    }
    if ($method === 'POST') {
        $in = json_decode((string) file_get_contents('php://input'), true);
        $in = is_array($in) ? $in : $_POST;
    } else {
        if (!in_array($action, READ_ONLY, true)) {
            fail('Это действие вызывается методом POST', 405);
        }
        $in = $_GET;
    }
    if (!in_array($action, ANONYMOUS, true)) {
        require_user();
        if ($method === 'POST') {
            check_csrf();
        }
    }
    if ($method !== 'POST') {
        // Чтение не меняет сессию: отпускаем блокировку, чтобы экран и пульт не ждали друг друга.
        current_user();
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_write_close();
        }
    }
    $result = $fn($in);
    if ($result !== null) {
        out($result);
    }
} catch (ApiError $e) {
    try {
        db()->exec('ROLLBACK');
    } catch (Throwable $ignored) {
    }
    http_response_code($e->getCode() ?: 400);
    out(['error' => $e->getMessage()]);
} catch (Throwable $e) {
    try {
        db()->exec('ROLLBACK');
    } catch (Throwable $ignored) {
    }
    error_log('otklik: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    http_response_code(500);
    out(['error' => 'Ошибка сервера. Повторите через минуту']);
}
