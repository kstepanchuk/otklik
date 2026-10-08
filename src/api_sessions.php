<?php
declare(strict_types=1);

function valid_upload($path): ?string
{
    return is_string($path) && preg_match('~^uploads/[a-f0-9]{24}\.(jpg|png|webp|gif)$~', $path) ? $path : null;
}

function clean_theme($t): array
{
    $t = is_array($t) ? $t : [];
    return [
        'mode' => ($t['mode'] ?? 'dark') === 'light' ? 'light' : 'dark',
        'accent' => preg_match('/^#[0-9a-fA-F]{6}$/', (string) ($t['accent'] ?? '')) ? strtolower($t['accent']) : '#ffc83d',
        'bg' => valid_upload($t['bg'] ?? null),
        'logo' => valid_upload($t['logo'] ?? null),
    ];
}

function own_session($id): array
{
    $u = require_user();
    $s = row('SELECT * FROM sessions WHERE id = ?', [(int) $id]);
    if (!$s || ((int) $s['user_id'] !== (int) $u['id'] && $u['role'] !== 'admin')) {
        fail('Сессия не найдена', 404);
    }
    return $s;
}

function own_question($id): array
{
    $qq = row('SELECT * FROM questions WHERE id = ?', [(int) $id]);
    if (!$qq) {
        fail('Слайд не найден', 404);
    }
    own_session($qq['session_id']);
    return $qq;
}

function session_view(array $s): array
{
    return [
        'id' => (int) $s['id'], 'code' => $s['code'], 'title' => $s['title'], 'mode' => $s['mode'],
        'ask_names' => (int) $s['ask_names'], 'premoderation' => (int) $s['premoderation'],
        'filter_on' => (int) $s['filter_on'], 'reactions_on' => (int) $s['reactions_on'],
        'theme' => clean_theme(json_decode($s['theme'] ?: '{}', true)),
        'phase' => $s['phase'], 'current_question_id' => $s['current_question_id'] ? (int) $s['current_question_id'] : null,
        'archived' => (int) $s['archived'], 'is_template' => (int) $s['is_template'], 'created_at' => (int) $s['created_at'],
    ];
}

function question_view(array $qq): array
{
    return [
        'id' => (int) $qq['id'], 'type' => $qq['type'], 'text' => $qq['text'],
        'options' => q_options($qq), 'settings' => (object) q_settings($qq), 'time_limit' => (int) $qq['time_limit'],
    ];
}

function clean_question(array $in): array
{
    $type = (string) ($in['type'] ?? '');
    if (!in_array($type, TYPES, true)) {
        fail('Неизвестный тип слайда');
    }
    $options = [];
    if (in_array($type, ['poll', 'quiz', 'rank'], true)) {
        foreach (array_slice((array) ($in['options'] ?? []), 0, 10) as $o) {
            $o = is_array($o) ? $o : ['text' => $o];
            $options[] = [
                'text' => str_clean($o['text'] ?? '', 120),
                'img' => $type === 'poll' ? valid_upload($o['img'] ?? null) : null,
                'correct' => $type === 'quiz' && !empty($o['correct']),
            ];
        }
    }
    $raw = (array) ($in['settings'] ?? []);
    $s = [];
    foreach (['multi', 'hide_results'] as $k) {
        if (!empty($raw[$k])) {
            $s[$k] = true;
        }
    }
    foreach (['max_choices', 'min', 'max', 'max_answers', 'compare_with', 'segment_by'] as $k) {
        if (isset($raw[$k]) && is_numeric($raw[$k])) {
            $s[$k] = (int) $raw[$k];
        }
    }
    foreach (['label_min' => 40, 'label_max' => 40, 'body' => 1000] as $k => $len) {
        if (isset($raw[$k]) && str_clean($raw[$k], $len) !== '') {
            $s[$k] = str_clean($raw[$k], $len);
        }
    }
    if (isset($raw['correct']) && is_numeric(str_replace(',', '.', (string) $raw['correct']))) {
        $s['correct'] = (float) str_replace(',', '.', (string) $raw['correct']);
    }
    if ($img = valid_upload($raw['image'] ?? null)) {
        $s['image'] = $img;
    }
    return [
        'type' => $type,
        'text' => str_clean($in['text'] ?? '', 300),
        'options' => json_encode($options, JSON_UNESCAPED_UNICODE),
        'settings' => json_encode((object) $s, JSON_UNESCAPED_UNICODE),
        'time_limit' => max(0, min(600, (int) ($in['time_limit'] ?? 0))),
    ];
}

function api_sessions_list(array $in): array
{
    $u = require_user();
    $list = rows(
        'SELECT s.*,
            (SELECT COUNT(*) FROM questions WHERE session_id = s.id) AS slides,
            (SELECT COUNT(*) FROM participants WHERE session_id = s.id) AS people,
            (SELECT COUNT(*) FROM answers WHERE session_id = s.id) AS answers
         FROM sessions s WHERE s.user_id = ? ORDER BY s.id DESC',
        [$u['id']]
    );
    return ['sessions' => array_map(fn($s) => session_view($s) + ['slides' => (int) $s['slides'], 'people' => (int) $s['people'], 'answers' => (int) $s['answers']], $list)];
}

function api_templates_list(array $in): array
{
    require_user();
    $out = [];
    foreach (builtin_templates() as $key => $t) {
        $out[] = ['key' => $key, 'title' => $t['title'], 'about' => $t['about'], 'slides' => count($t['slides'])];
    }
    return ['templates' => $out];
}

function copy_slides(int $from, int $to): void
{
    $map = [];
    foreach (session_questions($from) as $qq) {
        q(
            'INSERT INTO questions (session_id, position, type, text, options, settings, time_limit) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$to, $qq['position'], $qq['type'], $qq['text'], $qq['options'], $qq['settings'], $qq['time_limit']]
        );
        $map[(int) $qq['id']] = last_id();
    }
    // Ссылки «сравнить с» и «срез по» должны указывать на копии, а не на исходные слайды.
    foreach ($map as $newId) {
        $qq = row('SELECT * FROM questions WHERE id = ?', [$newId]);
        $s = q_settings($qq);
        $changed = false;
        foreach (['compare_with', 'segment_by'] as $k) {
            if (!empty($s[$k])) {
                $s[$k] = $map[(int) $s[$k]] ?? 0;
                $changed = true;
            }
        }
        if ($changed) {
            q('UPDATE questions SET settings = ? WHERE id = ?', [json_encode((object) array_filter($s), JSON_UNESCAPED_UNICODE), $newId]);
        }
    }
}

function create_session(array $u, string $title, array $extra = []): int
{
    $settings = json_decode($u['settings'] ?: '{}', true) ?: [];
    $row = array_merge([
        'mode' => 'live', 'ask_names' => 0, 'premoderation' => 0, 'filter_on' => 1, 'reactions_on' => 1,
        'theme' => json_encode(clean_theme($settings['theme'] ?? [])), 'is_template' => 0,
    ], $extra);
    q(
        'INSERT INTO sessions (user_id, code, title, mode, ask_names, premoderation, filter_on, reactions_on, theme, is_template, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [$u['id'], new_code(), $title, $row['mode'], $row['ask_names'], $row['premoderation'], $row['filter_on'], $row['reactions_on'], $row['theme'], $row['is_template'], time()]
    );
    return last_id();
}

function api_session_create(array $in): array
{
    $u = require_user();
    $title = str_clean($in['title'] ?? '', 120);
    $tpl = (string) ($in['template'] ?? '');
    $builtin = builtin_templates();
    if ($tpl !== '' && isset($builtin[$tpl])) {
        $id = create_session($u, $title !== '' ? $title : $builtin[$tpl]['title']);
        add_slides($id, $builtin[$tpl]['slides']);
    } elseif (ctype_digit($tpl)) {
        $src = own_session($tpl);
        $id = create_session($u, $title !== '' ? $title : $src['title'], array_intersect_key($src, array_flip(['mode', 'ask_names', 'premoderation', 'filter_on', 'reactions_on', 'theme'])));
        copy_slides((int) $src['id'], $id);
    } else {
        $id = create_session($u, $title !== '' ? $title : 'Новая сессия');
        if (trim((string) ($in['import'] ?? '')) !== '') {
            add_slides($id, parse_import((string) $in['import']));
        }
    }
    write_state($id);
    return ['id' => $id];
}

function api_session_get(array $in): array
{
    $s = own_session($in['id'] ?? 0);
    return [
        'session' => session_view($s),
        'questions' => array_map('question_view', session_questions((int) $s['id'])),
        'join_url' => app_url() . '/play.html?c=' . $s['code'],
    ];
}

function api_session_update(array $in): array
{
    $s = own_session($in['id'] ?? 0);
    $bool = fn($k) => isset($in[$k]) ? (int) !empty($in[$k]) : (int) $s[$k];
    q(
        'UPDATE sessions SET title = ?, mode = ?, ask_names = ?, premoderation = ?, filter_on = ?, reactions_on = ?, theme = ? WHERE id = ?',
        [
            isset($in['title']) ? str_clean($in['title'], 120) : $s['title'],
            isset($in['mode']) ? ($in['mode'] === 'self' ? 'self' : 'live') : $s['mode'],
            $bool('ask_names'), $bool('premoderation'), $bool('filter_on'), $bool('reactions_on'),
            isset($in['theme']) ? json_encode(clean_theme($in['theme'])) : $s['theme'],
            $s['id'],
        ]
    );
    write_state((int) $s['id']);
    return ['session' => session_view(row('SELECT * FROM sessions WHERE id = ?', [$s['id']]))];
}

function api_session_delete(array $in): array
{
    $s = own_session($in['id'] ?? 0);
    q('DELETE FROM sessions WHERE id = ?', [$s['id']]);
    q('DELETE FROM answers WHERE session_id = ?', [$s['id']]);
    remove_state($s['code']);
    return ['ok' => true];
}

function api_session_duplicate(array $in): array
{
    $u = require_user();
    $s = own_session($in['id'] ?? 0);
    $asTemplate = !empty($in['as_template']);
    $id = create_session($u, $asTemplate ? $s['title'] : $s['title'] . ' (копия)', array_merge(
        array_intersect_key($s, array_flip(['mode', 'ask_names', 'premoderation', 'filter_on', 'reactions_on', 'theme'])),
        ['is_template' => $asTemplate ? 1 : 0]
    ));
    copy_slides((int) $s['id'], $id);
    write_state($id);
    return ['id' => $id];
}

function api_session_archive(array $in): array
{
    $s = own_session($in['id'] ?? 0);
    q('UPDATE sessions SET archived = ? WHERE id = ?', [(int) !empty($in['archived']), $s['id']]);
    return ['ok' => true];
}

function api_session_reset(array $in): array
{
    $s = own_session($in['id'] ?? 0);
    q('DELETE FROM answers WHERE session_id = ?', [$s['id']]);
    q('DELETE FROM participants WHERE session_id = ?', [$s['id']]);
    q('DELETE FROM reactions WHERE session_id = ?', [$s['id']]);
    q('UPDATE questions SET opened_at = 0 WHERE session_id = ?', [$s['id']]);
    q("UPDATE sessions SET phase = 'lobby', current_question_id = NULL, hide_results = 0, spotlight_answer_id = NULL, archived = 0 WHERE id = ?", [$s['id']]);
    remove_state($s['code']);
    write_state((int) $s['id']);
    return ['ok' => true];
}

function api_question_save(array $in): array
{
    $c = clean_question($in);
    if (!empty($in['id'])) {
        $qq = own_question($in['id']);
        $sid = (int) $qq['session_id'];
        if ($qq['type'] !== $c['type'] && val('SELECT 1 FROM answers WHERE question_id = ? LIMIT 1', [$qq['id']])) {
            fail('На слайд уже ответили — тип менять нельзя. Создайте новый слайд');
        }
        q('UPDATE questions SET type = ?, text = ?, options = ?, settings = ?, time_limit = ? WHERE id = ?', [$c['type'], $c['text'], $c['options'], $c['settings'], $c['time_limit'], $qq['id']]);
        $id = (int) $qq['id'];
    } else {
        $s = own_session($in['session_id'] ?? 0);
        $sid = (int) $s['id'];
        if ((int) val('SELECT COUNT(*) FROM questions WHERE session_id = ?', [$sid]) >= 200) {
            fail('В сессии может быть не больше 200 слайдов');
        }
        $pos = (int) val('SELECT COALESCE(MAX(position), 0) + 1 FROM questions WHERE session_id = ?', [$sid]);
        q('INSERT INTO questions (session_id, position, type, text, options, settings, time_limit) VALUES (?, ?, ?, ?, ?, ?, ?)', [$sid, $pos, $c['type'], $c['text'], $c['options'], $c['settings'], $c['time_limit']]);
        $id = last_id();
    }
    write_state($sid);
    return ['question' => question_view(row('SELECT * FROM questions WHERE id = ?', [$id]))];
}

function api_question_duplicate(array $in): array
{
    $qq = own_question($in['id'] ?? 0);
    $s = q_settings($qq);
    if (!empty($in['compare'])) {
        $s['compare_with'] = (int) $qq['id'];
    }
    q('UPDATE questions SET position = position + 1 WHERE session_id = ? AND position > ?', [$qq['session_id'], $qq['position']]);
    q(
        'INSERT INTO questions (session_id, position, type, text, options, settings, time_limit) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [$qq['session_id'], $qq['position'] + 1, $qq['type'], $qq['text'], $qq['options'], json_encode((object) $s, JSON_UNESCAPED_UNICODE), $qq['time_limit']]
    );
    $id = last_id();
    write_state((int) $qq['session_id']);
    return ['question' => question_view(row('SELECT * FROM questions WHERE id = ?', [$id]))];
}

function api_question_delete(array $in): array
{
    $qq = own_question($in['id'] ?? 0);
    $s = row('SELECT * FROM sessions WHERE id = ?', [$qq['session_id']]);
    q('DELETE FROM questions WHERE id = ?', [$qq['id']]);
    q('DELETE FROM answers WHERE question_id = ?', [$qq['id']]);
    if ((int) $s['current_question_id'] === (int) $qq['id']) {
        q("UPDATE sessions SET current_question_id = NULL, phase = 'lobby' WHERE id = ?", [$s['id']]);
    }
    write_state((int) $s['id']);
    return ['ok' => true];
}

function api_questions_reorder(array $in): array
{
    $s = own_session($in['session_id'] ?? 0);
    $pos = 0;
    foreach ((array) ($in['ids'] ?? []) as $id) {
        q('UPDATE questions SET position = ? WHERE id = ? AND session_id = ?', [++$pos, (int) $id, $s['id']]);
    }
    write_state((int) $s['id']);
    return ['ok' => true];
}

function api_questions_import(array $in): array
{
    $s = own_session($in['session_id'] ?? 0);
    $slides = parse_import((string) ($in['text'] ?? ''));
    if (!$slides) {
        fail('Не нашлось ни одной строки с вопросом');
    }
    add_slides((int) $s['id'], $slides);
    write_state((int) $s['id']);
    return ['added' => count($slides), 'questions' => array_map('question_view', session_questions((int) $s['id']))];
}

function api_upload(array $in): array
{
    require_user();
    $f = $_FILES['file'] ?? null;
    $maxMb = max(1, min(10, (int) setting('max_upload_mb', 3)));
    if (!$f || $f['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'])) {
        fail("Файл не загрузился. Допустимый размер — до $maxMb МБ");
    }
    if ($f['size'] > $maxMb * 1024 * 1024) {
        fail("Картинка больше $maxMb МБ. Уменьшите её и загрузите снова");
    }
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']);
    $ext = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/gif' => 'gif'][$mime] ?? null;
    if (!$ext || !@getimagesize($f['tmp_name'])) {
        fail('Подходят только картинки JPG, PNG, WebP и GIF');
    }
    $dir = PUBLIC_DIR . '/uploads';
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
    $name = bin2hex(random_bytes(12)) . '.' . $ext;
    if (!move_uploaded_file($f['tmp_name'], "$dir/$name")) {
        fail('Не удалось сохранить файл. Проверьте права на папку uploads', 500);
    }
    return ['url' => 'uploads/' . $name];
}
