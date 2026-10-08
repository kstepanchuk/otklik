<?php
declare(strict_types=1);

const TYPES = ['open', 'cloud', 'poll', 'quiz', 'scale', 'rank', 'number', 'pin', 'qa', 'info', 'nps'];
const SINGLE_ANSWER_TYPES = ['poll', 'quiz', 'scale', 'rank', 'number', 'pin', 'nps'];
const TEXT_TYPES = ['open', 'cloud', 'qa'];
const TYPE_NAMES = [
    'open' => 'Открытый ответ', 'cloud' => 'Облако слов', 'poll' => 'Опрос', 'quiz' => 'Викторина',
    'scale' => 'Шкала', 'rank' => 'Ранжирование', 'number' => 'Угадай число', 'pin' => 'Точка на картинке',
    'qa' => 'Вопросы спикеру', 'info' => 'Информационный слайд', 'nps' => 'Обратная связь',
];

function q_settings(array $q): array
{
    return json_decode($q['settings'] ?: '{}', true) ?: [];
}

function q_options(array $q): array
{
    return json_decode($q['options'] ?: '[]', true) ?: [];
}

function max_answers(array $q): int
{
    switch ($q['type']) {
        case 'open':
            return max(1, min(10, (int) (q_settings($q)['max_answers'] ?? 3)));
        case 'cloud':
            return 3;
        case 'qa':
            return 10;
        default:
            return 1;
    }
}

function scale_bounds(array $q): array
{
    $s = q_settings($q);
    $min = (int) ($s['min'] ?? 1);
    $max = (int) ($s['max'] ?? 5);
    if ($max <= $min || $max - $min > 10) {
        return [1, 5];
    }
    return [$min, $max];
}

/**
 * Проверяет ответ участника и приводит его к виду для хранения.
 * Возвращает [value, is_correct|null, points, text|null]; text — то, что проходит модерацию и фильтр.
 */
function validate_answer(array $q, $input, bool $timed): array
{
    $s = q_settings($q);
    $opts = q_options($q);
    $n = count($opts);
    $maxLen = max(20, min(1000, (int) setting('max_answer_len', 300)));

    switch ($q['type']) {
        case 'open':
        case 'qa':
            $text = str_clean($input, $maxLen);
            if ($text === '') {
                fail('Напишите ответ');
            }
            return [$text, null, 0, $text];

        case 'cloud':
            $text = str_clean(preg_replace('/\s+/u', ' ', (string) $input), 30);
            if ($text === '') {
                fail('Напишите слово');
            }
            return [$text, null, 0, $text];

        case 'poll':
            $picked = array_values(array_unique(array_map('intval', is_array($input) ? $input : [$input])));
            $limit = !empty($s['multi']) ? max(1, min($n, (int) ($s['max_choices'] ?? $n) ?: $n)) : 1;
            if (!$picked || count($picked) > $limit) {
                fail($limit > 1 ? "Выберите от 1 до $limit вариантов" : 'Выберите один вариант');
            }
            foreach ($picked as $i) {
                if ($i < 0 || $i >= $n) {
                    fail('Такого варианта нет');
                }
            }
            sort($picked);
            return [$picked, null, 0, null];

        case 'quiz':
            $i = (int) (is_array($input) ? ($input[0] ?? -1) : $input);
            if ($i < 0 || $i >= $n) {
                fail('Такого варианта нет');
            }
            $correct = !empty($opts[$i]['correct']);
            $points = 0;
            if ($correct) {
                $points = 1000;
                $limit = (int) $q['time_limit'] * 1000;
                if ($timed && $limit > 0 && (int) $q['opened_at'] > 0) {
                    $speed = max(0.0, 1 - (now_ms() - (int) $q['opened_at']) / $limit);
                    $points = 500 + (int) round(500 * $speed);
                }
            }
            return [$i, $correct ? 1 : 0, $points, null];

        case 'scale':
            [$min, $max] = scale_bounds($q);
            $v = (int) $input;
            if (!is_numeric($input) || $v < $min || $v > $max) {
                fail("Оценка должна быть от $min до $max");
            }
            return [$v, null, 0, null];

        case 'rank':
            $order = array_map('intval', is_array($input) ? array_values($input) : []);
            $sorted = $order;
            sort($sorted);
            if ($n < 2 || $sorted !== range(0, $n - 1)) {
                fail('Расставьте все варианты');
            }
            return [$order, null, 0, null];

        case 'number':
            $raw = str_replace([' ', ','], ['', '.'], (string) (is_scalar($input) ? $input : ''));
            if (!is_numeric($raw) || abs((float) $raw) > 1e12) {
                fail('Введите число');
            }
            $v = (float) $raw;
            $points = 0;
            $correct = null;
            if (isset($s['correct']) && is_numeric($s['correct'])) {
                $c = (float) $s['correct'];
                $diff = abs($v - $c);
                $points = (int) max(0, round(1000 * (1 - $diff / max(abs($c), 1))));
                $correct = $diff < 1e-9 ? 1 : 0;
            }
            return [$v, $correct, $points, null];

        case 'pin':
            $x = is_array($input) ? (float) ($input['x'] ?? -1) : -1;
            $y = is_array($input) ? (float) ($input['y'] ?? -1) : -1;
            if ($x < 0 || $x > 1 || $y < 0 || $y > 1) {
                fail('Коснитесь изображения');
            }
            return [['x' => round($x, 4), 'y' => round($y, 4)], null, 0, null];

        case 'nps':
            $score = is_array($input) ? ($input['score'] ?? null) : null;
            if (!is_numeric($score) || (int) $score < 0 || (int) $score > 10) {
                fail('Поставьте оценку от 0 до 10');
            }
            $comment = str_clean(is_array($input) ? ($input['comment'] ?? '') : '', $maxLen);
            return [['score' => (int) $score, 'comment' => $comment], null, 0, $comment !== '' ? $comment : null];
    }
    fail('На этот слайд не отвечают');
    return [];
}

function leaderboard(int $sessionId, int $limit = 5): array
{
    $out = [];
    foreach (rows('SELECT name, score FROM participants WHERE session_id = ? AND score > 0 ORDER BY score DESC, id LIMIT ' . $limit, [$sessionId]) as $r) {
        $out[] = ['name' => $r['name'] !== '' ? $r['name'] : 'Без имени', 'score' => (int) $r['score']];
    }
    return $out;
}

/**
 * Сводка ответов на слайд.
 * $host — показывать скрытые и ожидающие ответы; $reveal — можно ли отдавать правильный ответ.
 */
function aggregate(array $q, bool $host, bool $reveal, bool $withExtras = true): array
{
    $s = q_settings($q);
    $opts = q_options($q);
    $n = count($opts);
    $type = $q['type'];
    $answers = rows(
        'SELECT a.id, a.participant_id, a.value, a.status, a.is_correct, a.points, a.answered, a.created_at, p.name
         FROM answers a LEFT JOIN participants p ON p.id = a.participant_id
         WHERE a.question_id = ? ORDER BY a.id',
        [$q['id']]
    );
    $people = [];
    foreach ($answers as &$a) {
        $a['value'] = json_decode($a['value'], true);
        $people[$a['participant_id']] = true;
    }
    unset($a);
    $data = ['answered' => count($people)];

    $item = function (array $a, string $text) {
        return [
            'id' => (int) $a['id'], 'text' => $text, 'name' => (string) $a['name'],
            'status' => $a['status'], 'answered' => (int) $a['answered'], 'likes' => 0,
        ];
    };

    switch ($type) {
        case 'open':
        case 'qa':
        case 'cloud':
            $items = [];
            foreach ($answers as $a) {
                if ($host || $a['status'] === 'visible') {
                    $items[(int) $a['id']] = $item($a, (string) $a['value']);
                }
            }
            if ($type === 'qa' && $items) {
                foreach (rows('SELECT v.answer_id, COUNT(*) c FROM votes v JOIN answers a ON a.id = v.answer_id WHERE a.question_id = ? GROUP BY v.answer_id', [$q['id']]) as $v) {
                    if (isset($items[(int) $v['answer_id']])) {
                        $items[(int) $v['answer_id']]['likes'] = (int) $v['c'];
                    }
                }
            }
            if ($type === 'cloud') {
                $words = [];
                foreach ($answers as $a) {
                    if ($a['status'] !== 'visible') {
                        continue;
                    }
                    $key = mb_strtolower(trim((string) $a['value']));
                    $words[$key] = ($words[$key] ?? 0) + 1;
                }
                arsort($words);
                $data['words'] = [];
                foreach (array_slice($words, 0, 70, true) as $w => $c) {
                    $data['words'][] = ['w' => (string) $w, 'n' => $c];
                }
                if ($host) {
                    $data['items'] = array_values($items);
                }
            } else {
                $data['items'] = array_values($items);
            }
            break;

        case 'poll':
        case 'quiz':
            $counts = array_fill(0, $n, 0);
            foreach ($answers as $a) {
                foreach ((array) $a['value'] as $i) {
                    if (isset($counts[$i])) {
                        $counts[$i]++;
                    }
                }
            }
            $data['counts'] = $counts;
            if ($type === 'quiz') {
                if ($reveal || $host) {
                    $data['correct'] = array_keys(array_filter($opts, fn($o) => !empty($o['correct'])));
                }
                if ($reveal) {
                    $data['leaders'] = leaderboard((int) $q['session_id']);
                }
            }
            break;

        case 'scale':
            [$min, $max] = scale_bounds($q);
            $dist = array_fill_keys(range($min, $max), 0);
            $sum = 0;
            foreach ($answers as $a) {
                if (isset($dist[$a['value']])) {
                    $dist[$a['value']]++;
                    $sum += $a['value'];
                }
            }
            $data['min'] = $min;
            $data['dist'] = array_values($dist);
            $data['avg'] = $answers ? round($sum / count($answers), 2) : null;
            break;

        case 'rank':
            $sums = array_fill(0, $n, 0);
            foreach ($answers as $a) {
                foreach ((array) $a['value'] as $place => $i) {
                    if (isset($sums[$i])) {
                        $sums[$i] += $place + 1;
                    }
                }
            }
            $data['avg'] = array_map(fn($x) => $answers ? round($x / count($answers), 2) : null, $sums);
            break;

        case 'number':
            $values = array_map(fn($a) => (float) $a['value'], $answers);
            sort($values);
            $data['values'] = array_slice($values, 0, 1000);
            if (($reveal || $host) && isset($s['correct']) && is_numeric($s['correct'])) {
                $c = (float) $s['correct'];
                $data['correct'] = $c;
                $near = $answers;
                usort($near, fn($a, $b) => abs($a['value'] - $c) <=> abs($b['value'] - $c));
                $data['closest'] = array_map(
                    fn($a) => ['name' => $a['name'] !== '' && $a['name'] !== null ? $a['name'] : 'Без имени', 'value' => (float) $a['value']],
                    array_slice($near, 0, 3)
                );
            }
            break;

        case 'pin':
            $data['points'] = array_map(fn($a) => [$a['value']['x'], $a['value']['y']], $answers);
            break;

        case 'nps':
            $dist = array_fill(0, 11, 0);
            $items = [];
            foreach ($answers as $a) {
                $dist[(int) $a['value']['score']]++;
                $c = (string) ($a['value']['comment'] ?? '');
                if ($c !== '' && ($host || $a['status'] === 'visible')) {
                    $items[] = $item($a, $c);
                }
            }
            $total = array_sum($dist);
            $data['dist'] = $dist;
            $data['nps'] = $total ? (int) round((array_sum(array_slice($dist, 9)) - array_sum(array_slice($dist, 0, 7))) * 100 / $total) : null;
            $data['items'] = $items;
            break;
    }

    if ($withExtras) {
        // Сравнение «до и после»: сводка другого слайда того же типа.
        $cmp = (int) ($s['compare_with'] ?? 0);
        if ($cmp && ($other = row('SELECT * FROM questions WHERE id = ? AND session_id = ?', [$cmp, $q['session_id']])) && $other['type'] === $type) {
            $data['compare'] = aggregate($other, false, false, false);
        }
        // Срез: голоса этого опроса в разбивке по ответу на другой опрос.
        $seg = (int) ($s['segment_by'] ?? 0);
        if ($type === 'poll' && $seg && ($other = row('SELECT * FROM questions WHERE id = ? AND session_id = ?', [$seg, $q['session_id']])) && $other['type'] === 'poll') {
            $group = [];
            foreach (rows('SELECT participant_id, value FROM answers WHERE question_id = ?', [$seg]) as $r) {
                $v = json_decode($r['value'], true);
                $group[$r['participant_id']] = (int) ($v[0] ?? -1);
            }
            $segments = [];
            foreach (q_options($other) as $gi => $go) {
                $segments[$gi] = ['label' => (string) ($go['text'] ?? ''), 'counts' => array_fill(0, $n, 0), 'n' => 0];
            }
            foreach ($answers as $a) {
                $g = $group[$a['participant_id']] ?? -1;
                if (!isset($segments[$g])) {
                    continue;
                }
                $segments[$g]['n']++;
                foreach ((array) $a['value'] as $i) {
                    if (isset($segments[$g]['counts'][$i])) {
                        $segments[$g]['counts'][$i]++;
                    }
                }
            }
            $data['segments'] = array_values($segments);
            $data['segment_title'] = $other['text'];
        }
    }
    return $data;
}

/** Ответ в виде строки — для таблицы экспорта. */
function answer_text(array $q, $value): string
{
    $opts = q_options($q);
    $name = fn($i) => (string) ($opts[$i]['text'] ?? ('Вариант ' . ($i + 1)));
    switch ($q['type']) {
        case 'poll':
            return implode('; ', array_map($name, (array) $value));
        case 'quiz':
            return $name((int) $value);
        case 'rank':
            return implode(' > ', array_map($name, (array) $value));
        case 'pin':
            return round($value['x'] * 100) . '%, ' . round($value['y'] * 100) . '%';
        case 'nps':
            return $value['score'] . (($value['comment'] ?? '') !== '' ? ' — ' . $value['comment'] : '');
        default:
            return is_scalar($value) ? (string) $value : json_encode($value, JSON_UNESCAPED_UNICODE);
    }
}
