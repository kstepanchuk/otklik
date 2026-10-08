<?php
// Создаёт или обновляет таблицы базы. Запуск: php bin/migrate.php
// Делать это вручную необязательно: сервис сам обновляет базу при первом запросе.
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

$pdo = db();
echo 'База: ', cfg('db_path'), "\n";
echo 'Версия схемы: ', $pdo->query('PRAGMA user_version')->fetchColumn(), "\n";
foreach (['storage', 'public/state', 'public/uploads'] as $dir) {
    echo str_pad($dir, 16), is_writable(ROOT . '/' . $dir) ? 'запись разрешена' : 'НЕТ ПРАВ НА ЗАПИСЬ', "\n";
}
foreach (['pdo_sqlite', 'mbstring', 'fileinfo', 'gd'] as $ext) {
    echo str_pad($ext, 16), extension_loaded($ext) ? 'есть' : 'НЕ УСТАНОВЛЕНО', "\n";
}
