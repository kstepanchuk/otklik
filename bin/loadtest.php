<?php
// Нагрузочная проверка: N участников одновременно входят в сессию и отвечают на текущий слайд.
// Запуск: php bin/loadtest.php https://ваш-сайт.ru 123456 300
// Перед запуском откройте на пульте слайд с опросом, викториной, шкалой, облаком слов или открытым вопросом.
declare(strict_types=1);

[$base, $code, $n] = [rtrim($argv[1] ?? 'http://localhost:8765', '/'), $argv[2] ?? '', (int) ($argv[3] ?? 300)];
if (!preg_match('/^\d{6}$/', $code)) {
    exit("Укажите адрес сайта, код сессии и число участников:\n  php bin/loadtest.php http://localhost:8765 123456 300\n");
}

/** Отправляет все запросы параллельно, возвращает [ответы, секунды]. */
function burst(array $requests, int $parallel = 100): array
{
    $mh = curl_multi_init();
    curl_multi_setopt($mh, CURLMOPT_MAX_TOTAL_CONNECTIONS, $parallel);
    $handles = [];
    foreach ($requests as $i => [$url, $body]) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30]);
        if ($body !== null) {
            curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($body), CURLOPT_HTTPHEADER => ['Content-Type: application/json']]);
        }
        curl_multi_add_handle($mh, $ch);
        $handles[$i] = $ch;
    }
    $t = microtime(true);
    do {
        curl_multi_exec($mh, $running);
        curl_multi_select($mh, 0.2);
    } while ($running);
    $time = microtime(true) - $t;
    $out = [];
    foreach ($handles as $i => $ch) {
        $out[$i] = ['status' => curl_getinfo($ch, CURLINFO_HTTP_CODE), 'body' => json_decode((string) curl_multi_getcontent($ch), true)];
        curl_multi_remove_handle($mh, $ch);
    }
    return [$out, $time];
}

function report(string $title, array $res, float $time): void
{
    $ok = count(array_filter($res, fn($r) => $r['status'] === 200));
    $errors = [];
    foreach ($res as $r) {
        if ($r['status'] !== 200) {
            $key = $r['status'] . ' ' . ($r['body']['error'] ?? '');
            $errors[$key] = ($errors[$key] ?? 0) + 1;
        }
    }
    printf("%s: успешно %d из %d за %.1f с\n", $title, $ok, count($res), $time);
    foreach ($errors as $e => $c) {
        echo "  $c × $e\n";
    }
}

[$res] = burst([["$base/state/$code.json", null]]);
$state = $res[0]['body'];
if (!$state) {
    exit("Сессия $code не найдена по адресу $base\n");
}
$q = $state['q'] ?? null;
if (!$q || $state['phase'] !== 'open') {
    exit("Сначала откройте на пульте слайд для ответов\n");
}

[$joins, $t] = burst(array_map(fn($i) => ["$base/api.php?a=join", ['code' => $code, 'name' => "Тест $i"]], range(1, $n)));
report('Вход', $joins, $t);

$value = function () use ($q) {
    $opts = max(1, count($q['options']));
    switch ($q['type']) {
        case 'poll': return [random_int(0, $opts - 1)];
        case 'quiz': return random_int(0, $opts - 1);
        case 'scale': return random_int($q['min'], $q['max']);
        case 'number': return random_int(1, 500);
        case 'cloud': return ['тест', 'нагрузка', 'проверка', 'скорость', 'ответ'][random_int(0, 4)];
        case 'nps': return ['score' => random_int(0, 10), 'comment' => ''];
        case 'rank': $o = range(0, $opts - 1); shuffle($o); return $o;
        case 'pin': return ['x' => random_int(0, 100) / 100, 'y' => random_int(0, 100) / 100];
        default: return 'Проверочный ответ ' . random_int(1, 9999);
    }
};
$requests = [];
foreach ($joins as $j) {
    if (!empty($j['body']['token'])) {
        $requests[] = ["$base/api.php?a=answer", ['code' => $code, 'token' => $j['body']['token'], 'qid' => $q['id'], 'value' => $value()]];
    }
}
[$answers, $t] = burst($requests);
report('Ответы', $answers, $t);

[$res] = burst([["$base/api.php?a=results&code=$code", null]]);
printf("На экране учтено ответивших: %d\n", $res[0]['body']['data']['answered'] ?? 0);
