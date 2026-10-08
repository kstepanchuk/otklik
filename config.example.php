<?php
// Скопируйте этот файл в config.php и измените нужные значения.
// config.php не попадает в git.
return [
    // Публичный адрес сайта без слэша в конце, например https://opros.example.ru
    // Пустая строка — определить автоматически по запросу.
    'app_url' => '',

    // Название сервиса в интерфейсе и письмах.
    'app_name' => 'Отклик',

    // Путь к файлу базы. По умолчанию storage/app.sqlite рядом с кодом.
    'db_path' => __DIR__ . '/storage/app.sqlite',

    // Адрес отправителя писем (подтверждение почты, сброс пароля).
    'mail_from' => 'noreply@example.ru',

    // true — письма не отправляются, а пишутся в storage/logs/mail.log.
    'mail_to_log' => true,

    // Требовать подтверждение почты перед входом.
    'require_email_verification' => true,
];
