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

require __DIR__ . '/db.php';
require __DIR__ . '/auth.php';
require __DIR__ . '/mail.php';
require __DIR__ . '/filter.php';
require __DIR__ . '/types.php';
require __DIR__ . '/state.php';
require __DIR__ . '/templates.php';

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
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
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
