<?php
declare(strict_types=1);

define('ROOT', dirname(__DIR__));
// На хостинге корень сайта обычно называется public_html и лежит рядом с src.
define('PUBLIC_DIR', is_dir(ROOT . '/public') ? ROOT . '/public' : ROOT . '/public_html');

$CONFIG = require ROOT . '/config.example.php';
if (is_file(ROOT . '/config.php')) {
    $CONFIG = array_merge($CONFIG, require ROOT . '/config.php');
}

function cfg(string $key, $default = null)
{
    global $CONFIG;
    return $CONFIG[$key] ?? $default;
}

// Подробности ошибок — только в журнал сервера, не в ответ.
ini_set('display_errors', '0');

require __DIR__ . '/db.php';
require __DIR__ . '/auth.php';
require __DIR__ . '/mail.php';
require __DIR__ . '/filter.php';
require __DIR__ . '/types.php';
require __DIR__ . '/state.php';
require __DIR__ . '/templates.php';

/** Журнал ошибок сервера: читается в админке, хранит последние записи. */
function log_error(string $message): void
{
    $dir = ROOT . '/storage/logs';
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    $file = $dir . '/error.log';
    if (is_file($file) && filesize($file) > 512 * 1024) {
        @rename($file, $file . '.1');
    }
    $where = ($_SERVER['REQUEST_METHOD'] ?? 'cli') . ' ' . preg_replace('/[^a-z_]/', '', (string) ($_GET['a'] ?? ''));
    @file_put_contents($file, date('Y-m-d H:i:s') . "\t" . $where . "\t" . str_replace(["\r", "\n", "\t"], ' ', $message) . "\n", FILE_APPEND | LOCK_EX);
}

// Фатальные ошибки (нехватка памяти, ошибка в коде) до обработчика исключений не доходят — ловим их здесь.
register_shutdown_function(function () {
    $e = error_get_last();
    if ($e && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        log_error($e['message'] . ' @ ' . basename($e['file']) . ':' . $e['line']);
    }
});

class ApiError extends Exception
{
}

function fail(string $message, int $status = 400): void
{
    throw new ApiError($message, $status);
}

function out($data): void
{
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: same-origin');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

function now_ms(): int
{
    return (int) round(microtime(true) * 1000);
}

function app_url(): string
{
    $url = (string) cfg('app_url', '');
    if ($url !== '') {
        return rtrim($url, '/');
    }
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    // Заголовок Host присылает клиент. Без app_url в config.php он попадает в ссылки из писем,
    // поэтому на боевом сайте app_url должен быть задан; здесь отсекаем хотя бы явный мусор.
    $host = (string) ($_SERVER['HTTP_HOST'] ?? 'localhost');
    if (!preg_match('/^[a-z0-9.-]+(:\d{1,5})?$/i', $host)) {
        $host = 'localhost';
    }
    $dir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
    return ($https ? 'https' : 'http') . '://' . $host . $dir;
}

function setting(string $key, $default = null)
{
    static $cache = null;
    if ($cache === null) {
        $cache = [];
        foreach (rows('SELECT key, value FROM app_settings') as $r) {
            $cache[$r['key']] = $r['value'];
        }
    }
    return $cache[$key] ?? $default;
}

function client_ip(): string
{
    return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
}

function str_clean($value, int $max): string
{
    $s = trim((string) ($value ?? ''));
    $s = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/u', '', $s) ?? '';
    return mb_substr($s, 0, $max);
}
