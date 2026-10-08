<?php
declare(strict_types=1);

const PUBLIC_SETTINGS = ['multi', 'max_choices', 'min', 'max', 'label_min', 'label_max', 'image', 'body', 'max_answers', 'unit', 'hide_results', 'with_images'];

function session_questions(int $sessionId): array
{
    return rows('SELECT * FROM questions WHERE session_id = ? ORDER BY position, id', [$sessionId]);
}

/** Слайд в виде, безопасном для участника: без правильных ответов, пока их не показали. */
function public_question(array $q, bool $reveal): array
{
    $s = q_settings($q);
    $opts = q_options($q);
    $pub = [
        'id' => (int) $q['id'],
        'type' => $q['type'],
        'text' => $q['text'],
        'options' => array_map(fn($o) => ['text' => (string) ($o['text'] ?? ''), 'img' => $o['img'] ?? null], $opts),
        'time_limit' => (int) $q['time_limit'],
        'opened_at' => (int) $q['opened_at'],
        's' => (object) array_intersect_key($s, array_flip(PUBLIC_SETTINGS)),
    ];
    if ($q['type'] === 'scale') {
        [$pub['min'], $pub['max']] = scale_bounds($q);
    }
    if ($reveal) {
        if ($q['type'] === 'quiz') {
            $pub['correct'] = array_keys(array_filter($opts, fn($o) => !empty($o['correct'])));
        }
        if ($q['type'] === 'number' && isset($s['correct']) && is_numeric($s['correct'])) {
            $pub['correct'] = (float) $s['correct'];
        }
    }
    return $pub;
}

function state_path(string $code, string $suffix = ''): string
{
    return PUBLIC_DIR . '/state/' . preg_replace('/\D/', '', $code) . $suffix . '.json';
}

function write_json_atomic(string $path, array $data): void
{
    if (!is_dir(dirname($path))) {
        mkdir(dirname($path), 0775, true);
    }
    $tmp = $path . '.' . bin2hex(random_bytes(4)) . '.tmp';
    file_put_contents($tmp, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    rename($tmp, $path);
}

/** Увеличивает версию сессии и переписывает публичный файл, который опрашивают телефоны. */
function write_state(int $sessionId): void
{
    q('UPDATE sessions SET version = version + 1 WHERE id = ?', [$sessionId]);
    $s = row('SELECT * FROM sessions WHERE id = ?', [$sessionId]);
    if (!$s || $s['is_template']) {
        return;
    }
    $questions = session_questions($sessionId);
    $reveal = in_array($s['phase'], ['reveal', 'finished'], true);
    $state = [
        'v' => (int) $s['version'],
        'title' => $s['title'],
        'mode' => $s['mode'],
        'phase' => $s['phase'],
        'ask_names' => (int) $s['ask_names'],
        'reactions' => (int) $s['reactions_on'],
        'theme' => json_decode($s['theme'] ?: '{}', true) ?: new stdClass(),
        'total' => count($questions),
        'index' => 0,
        'q' => null,
    ];
    foreach ($questions as $i => $qq) {
        if ((int) $qq['id'] === (int) $s['current_question_id']) {
            $state['index'] = $i + 1;
            $state['q'] = public_question($qq, $reveal);
        }
        if ($qq['type'] === 'quiz') {
            $state['has_quiz'] = 1;
        }
    }
    if ($s['mode'] === 'self') {
        $state['questions'] = array_map(fn($qq) => public_question($qq, false), $questions);
    }
    write_json_atomic(state_path($s['code']), $state);
}

/** Список вопросов спикеру для телефонов: отдельный файл, чтобы лайки не дёргали PHP у всех участников. */
function write_qa_state(array $question, string $code): void
{
    $data = aggregate($question, false, false, false);
    $items = array_map(
        fn($i) => ['id' => $i['id'], 'text' => $i['text'], 'likes' => $i['likes'], 'answered' => $i['answered']],
        $data['items'] ?? []
    );
    write_json_atomic(state_path($code, '-qa'), ['q' => (int) $question['id'], 'items' => $items]);
}

function remove_state(string $code): void
{
    foreach (['', '-qa'] as $suffix) {
        $p = state_path($code, $suffix);
        if (is_file($p)) {
            unlink($p);
        }
    }
}

function new_code(): string
{
    do {
        $code = (string) random_int(100000, 999999);
    } while (val('SELECT 1 FROM sessions WHERE code = ?', [$code]));
    return $code;
}
