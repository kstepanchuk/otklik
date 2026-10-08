<?php
// Создаёт или обновляет таблицы базы. Запуск: php bin/migrate.php
// Делать это вручную необязательно: сервис сам обновляет базу при первом запросе.
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

$pdo = db();
echo 'База: ', cfg('db_path'), "\n";
echo 'Версия схемы: ', $pdo->query('PRAGMA user_version')->fetchColumn(), "\n";
foreach (['storage' => ROOT . '/storage', 'state' => PUBLIC_DIR . '/state', 'uploads' => PUBLIC_DIR . '/uploads'] as $name => $dir) {
    echo str_pad($name, 16), is_writable($dir) ? 'запись разрешена' : 'НЕТ ПРАВ НА ЗАПИСЬ', "\n";
}
foreach (['pdo_sqlite', 'mbstring', 'fileinfo', 'gd'] as $ext) {
    echo str_pad($ext, 16), extension_loaded($ext) ? 'есть' : 'НЕ УСТАНОВЛЕНО', "\n";
}
