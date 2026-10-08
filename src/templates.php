<?php
declare(strict_types=1);

/** Готовые наборы слайдов. Каждый слайд: [тип, текст, варианты, настройки, таймер]. */
function builtin_templates(): array
{
    $o = fn(array $texts, int $correct = -1) => array_map(
        fn($t, $i) => ['text' => $t, 'correct' => $i === $correct],
        $texts,
        array_keys($texts)
    );
    return [
        'intro' => [
            'title' => 'Знакомство с аудиторией',
            'about' => 'Разогрев в начале встречи: кто в зале и с каким настроением.',
            'slides' => [
                ['cloud', 'Одним словом: с каким настроением вы пришли?', [], [], 0],
                ['poll', 'Насколько вам знакома тема?', $o(['Слышу впервые', 'Что-то читал', 'Применяю в работе', 'Могу сам рассказать']), [], 0],
                ['open', 'Что вы хотите унести с этой встречи?', [], ['max_answers' => 2], 0],
                ['qa', 'Вопросы спикеру', [], [], 0],
            ],
        ],
        'quiz' => [
            'title' => 'Викторина',
            'about' => 'Пять вопросов с таймером и таблицей лидеров. Замените вопросы своими.',
            'slides' => [
                ['info', 'Викторина начинается', [], ['body' => 'Отвечайте быстро: за скорость дают до 500 очков сверху.'], 0],
                ['quiz', 'Сколько минут в сутках?', $o(['1240', '1440', '1640', '2400'], 1), [], 20],
                ['quiz', 'Какая планета ближе всех к Солнцу?', $o(['Венера', 'Марс', 'Меркурий', 'Земля'], 2), [], 20],
                ['quiz', 'Сколько струн у классической скрипки?', $o(['Четыре', 'Пять', 'Шесть', 'Семь'], 0), [], 20],
                ['number', 'Сколько костей в теле взрослого человека?', [], ['correct' => 206], 30],
            ],
        ],
        'retro' => [
            'title' => 'Ретроспектива',
            'about' => 'Разбор проекта или спринта с командой.',
            'slides' => [
                ['scale', 'Как прошёл этот период?', [], ['min' => 1, 'max' => 5, 'label_min' => 'Тяжело', 'label_max' => 'Отлично'], 0],
                ['open', 'Что получилось хорошо?', [], ['max_answers' => 3], 0],
                ['open', 'Что мешало?', [], ['max_answers' => 3], 0],
                ['rank', 'Что исправляем в первую очередь?', $o(['Процессы', 'Коммуникация', 'Инструменты', 'Сроки']), [], 0],
            ],
        ],
        'feedback' => [
            'title' => 'Обратная связь',
            'about' => 'Короткий опрос в конце выступления.',
            'slides' => [
                ['nps', 'Посоветуете ли вы эту встречу коллегам?', [], [], 0],
                ['poll', 'Что было самым полезным?', $o(['Теория', 'Примеры', 'Практика', 'Ответы на вопросы']), ['multi' => true], 0],
                ['open', 'Что стоит изменить в следующий раз?', [], ['max_answers' => 1], 0],
            ],
        ],
    ];
}

function add_slides(int $sessionId, array $slides): void
{
    $pos = (int) val('SELECT COALESCE(MAX(position), 0) FROM questions WHERE session_id = ?', [$sessionId]);
    foreach ($slides as $s) {
        [$type, $text, $options, $settings, $time] = $s;
        q(
            'INSERT INTO questions (session_id, position, type, text, options, settings, time_limit) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$sessionId, ++$pos, $type, $text, json_encode($options, JSON_UNESCAPED_UNICODE), json_encode((object) $settings, JSON_UNESCAPED_UNICODE), $time]
        );
    }
}

/**
 * Разбор вставленного текста или CSV. Строка: тип; вопрос; вариант; вариант…
 * Верный вариант викторины помечается звёздочкой в начале. Строка без типа — открытый вопрос.
 */
function parse_import(string $text): array
{
    $alias = [];
    foreach (TYPE_NAMES as $key => $name) {
        $alias[mb_strtolower($name)] = $key;
        $alias[$key] = $key;
    }
    $alias += ['открытый' => 'open', 'облако' => 'cloud', 'число' => 'number', 'вопросы' => 'qa', 'инфо' => 'info', 'текст' => 'info', 'оценка' => 'scale', 'рейтинг' => 'scale'];
    $slides = [];
    foreach (preg_split('/\R/u', $text) as $line) {
        $line = trim($line);
        if ($line === '') {
            continue;
        }
        $sep = strpos($line, "\t") !== false ? "\t" : ';';
        $cells = array_values(array_filter(array_map('trim', str_getcsv($line, $sep, '"', '')), fn($c) => $c !== ''));
        if (!$cells) {
            continue;
        }
        $type = $alias[mb_strtolower($cells[0])] ?? null;
        if ($type === null) {
            $slides[] = ['open', str_clean($cells[0], 300), [], [], 0];
            continue;
        }
        $question = str_clean($cells[1] ?? '', 300);
        $options = [];
        $settings = [];
        foreach (array_slice($cells, 2, 10) as $c) {
            $correct = mb_substr($c, 0, 1) === '*';
            $options[] = ['text' => str_clean(ltrim($c, '* '), 120), 'correct' => $correct];
        }
        if ($type === 'number') {
            if ($options && is_numeric(str_replace(',', '.', $options[0]['text']))) {
                $settings['correct'] = (float) str_replace(',', '.', $options[0]['text']);
            }
            $options = [];
        }
        if (!in_array($type, ['poll', 'quiz', 'rank'], true)) {
            $options = [];
        }
        $slides[] = [$type, $question, $options, $settings, $type === 'quiz' ? 20 : 0];
    }
    return array_slice($slides, 0, 100);
}
