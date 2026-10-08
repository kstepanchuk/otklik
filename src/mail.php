<?php
declare(strict_types=1);

function send_mail(string $to, string $subject, string $text): void
{
    if (cfg('mail_to_log')) {
        $dir = ROOT . '/storage/logs';
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        file_put_contents(
            $dir . '/mail.log',
            date('c') . "\nКому: $to\nТема: $subject\n$text\n\n",
            FILE_APPEND | LOCK_EX
        );
        return;
    }
    $from = (string) cfg('mail_from');
    $name = (string) cfg('app_name');
    $headers = [
        'From: =?UTF-8?B?' . base64_encode($name) . '?= <' . $from . '>',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
    ];
    @mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', $text, implode("\r\n", $headers), '-f' . $from);
}
