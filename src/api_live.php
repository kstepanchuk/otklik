<?php
declare(strict_types=1);

const REACTIONS = ['👍', '❤️', '😂', '👏', '🔥', '🤔'];

// ---------- Ведущий ----------

function open_question(array $s, array $qq): void
{
    q('UPDATE questions SET opened_at = ? WHERE id = ?', [now_ms(), $qq['id']]);
    q(
        "UPDATE sessions SET current_question_id = ?, phase = 'open', hide_results = ?, spotlight_answer_id = NULL, raffle = '' WHERE id = ?",
        [$qq['id'], !empty(q_settings($qq)['hide_results']) ? 1 : 0, $s['id']]
    );
    if (has_feed($qq)) {
        write_qa_state($qq, $s['code']);
    }
}

function api_goto(array $in): array
{
    $s = own_session($in['session_id'] ?? 0);
    $questions = session_questions((int) $s['id']);
    $ids = array_map(fn($x) => (int) $x['id'], $questions);
    $cur = array_search((int) $s['current_question_id'], $ids, true);
    $dir = (string) ($in['dir'] ?? '');
    $target = null;
    if (!empty($in['question_id'])) {
        $target = array_search((int) $in['question_id'], $ids, true);
        if ($target === false) {
            fail('Слайд не найден', 404);
        }
    } elseif ($dir === 'next') {
        $target = $s['phase'] === 'finished' ? null : ($cur === false ? 0 : $cur + 1);
        if ($target !== null && $target >= count($ids)) {
            $dir = 'finish';
            $target = null;
        }
    } elseif ($dir === 'prev') {
        if ($s['phase'] === 'finished') {
            $target = count($ids) - 1;
        } else {
            $target = $cur === false ? null : $cur - 1;
        }
        if ($target === null || $target < 0) {
            $dir = 'lobby';
            $target = null;
        }
    }
    if ($target !== null) {
        open_question($s, $questions[$target]);
    } elseif ($dir === 'finish') {
        q("UPDATE sessions SET phase = 'finished', current_question_id = NULL, hide_results = 0, spotlight_answer_id = NULL WHERE id = ?", [$s['id']]);
    } elseif ($dir === 'lobby') {
        q("UPDATE sessions SET phase = 'lobby', current_question_id = NULL, hide_results = 0, spotlight_answer_id = NULL WHERE id = ?", [$s['id']]);
    }
    write_state((int) $s['id']);
    return ['ok' => true];
}

function api_phase(array $in): array
{
    $s = own_session($in['session_id'] ?? 0);
    $phase = (string) ($in['phase'] ?? '');
    if (!$s['current_question_id'] || !in_array($phase, ['open', 'closed', 'reveal'], true)) {
        fail('Сначала выберите слайд');
    }
    if ($phase === 'open') {
        open_question($s, row('SELECT * FROM questions WHERE id = ?', [$s['current_question_id']]));
    } else {
        q('UPDATE sessions SET phase = ?, hide_results = 0 WHERE id = ?', [$phase, $s['id']]);
    }
    write_state((int) $s['id']);
    return ['ok' => true];
}

function api_toggle(array $in): array
{
    $s = own_session($in['session_id'] ?? 0);
    if (isset($in['hide_results'])) {
        q('UPDATE sessions SET hide_results = ? WHERE id = ?', [(int) !empty($in['hide_results']), $s['id']]);
    }
    if (isset($in['hide_join'])) {
        q('UPDATE sessions SET hide_join = ? WHERE id = ?', [(int) !empty($in['hide_join']), $s['id']]);
    }
    if (array_key_exists('spotlight', $in)) {
        $aid = (int) $in['spotlight'];
        if ($aid && !val('SELECT 1 FROM answers WHERE id = ? AND session_id = ?', [$aid, $s['id']])) {
            fail('Ответ не найден', 404);
        }
        q('UPDATE sessions SET spotlight_answer_id = ? WHERE id = ?', [$aid ?: null, $s['id']]);
    }
    if (!empty($in['raffle_clear'])) {
        q("UPDATE sessions SET raffle = '' WHERE id = ?", [$s['id']]);
        write_state((int) $s['id']);
        return ['ok' => true];
    }
    q('UPDATE sessions SET version = version + 1 WHERE id = ?', [$s['id']]);
    return ['ok' => true];
}

/** Розыгрыш: случайный участник из тех, кто хотя бы раз ответил (или, если таких нет, из всех вошедших). */
function api_raffle(array $in): array
{
    $s = own_session($in['session_id'] ?? 0);
    $pool = rows('SELECT p.id, p.name FROM participants p WHERE p.session_id = ? AND EXISTS (SELECT 1 FROM answers a WHERE a.participant_id = p.id)', [$s['id']]);
    if (!$pool) {
        $pool = rows('SELECT id, name FROM participants WHERE session_id = ?', [$s['id']]);
    }
    if (!$pool) {
        fail('В сессии пока нет участников');
    }
    $label = fn($p) => $p['name'] !== '' ? $p['name'] : 'Участник № ' . $p['id'];
    $winner = $pool[random_int(0, count($pool) - 1)];
    shuffle($pool);
    $raffle = [
        'pid' => (int) $winner['id'], 'name' => $label($winner), 'at' => now_ms(), 'pool' => count($pool),
        'names' => array_map($label, array_slice($pool, 0, 24)),
    ];
    q('UPDATE sessions SET raffle = ? WHERE id = ?', [json_encode($raffle, JSON_UNESCAPED_UNICODE), $s['id']]);
    write_state((int) $s['id']);
    return ['ok' => true, 'name' => $raffle['name']];
}

function api_moderate(array $in): array
{
    $a = row('SELECT * FROM answers WHERE id = ?', [(int) ($in['answer_id'] ?? 0)]);
    if (!$a) {
        fail('Ответ не найден', 404);
    }
    $s = own_session($a['session_id']);
    if (!empty($in['delete'])) {
        q('DELETE FROM answers WHERE id = ?', [$a['id']]);
        q('UPDATE sessions SET spotlight_answer_id = NULL WHERE id = ? AND spotlight_answer_id = ?', [$s['id'], $a['id']]);
    } elseif (isset($in['status']) && in_array($in['status'], ['visible', 'hidden'], true)) {
        q('UPDATE answers SET status = ? WHERE id = ?', [$in['status'], $a['id']]);
        if ($in['status'] === 'hidden') {
            q('UPDATE sessions SET spotlight_answer_id = NULL WHERE id = ? AND spotlight_answer_id = ?', [$s['id'], $a['id']]);
        }
    } elseif (isset($in['answered'])) {
        q('UPDATE answers SET answered = ? WHERE id = ?', [(int) !empty($in['answered']), $a['id']]);
    } elseif (isset($in['pinned'])) {
        q('UPDATE answers SET pinned = ? WHERE id = ?', [(int) !empty($in['pinned']), $a['id']]);
    }
    $qq = row('SELECT * FROM questions WHERE id = ?', [$a['question_id']]);
    if ($qq && has_feed($qq)) {
        write_qa_state($qq, $s['code']);
    }
    q('UPDATE sessions SET version = version + 1 WHERE id = ?', [$s['id']]);
    return ['ok' => true];
}

// ---------- Экран и пульт: сводка ----------

function api_results(array $in): array
{
    $s = row('SELECT * FROM sessions WHERE code = ? AND is_template = 0', [preg_replace('/\D/', '', (string) ($in['code'] ?? ''))]);
    if (!$s) {
        fail('Сессия с таким кодом не найдена', 404);
    }
    $u = current_user();
    $owner = $u && ((int) $u['id'] === (int) $s['user_id'] || $u['role'] === 'admin'
        || (bool) val('SELECT 1 FROM session_members WHERE session_id = ? AND user_id = ?', [$s['id'], $u['id']]));
    $host = $owner && !empty($in['host']);

    $qid = (int) $s['current_question_id'];
    // Просмотр произвольного слайда: в самостоятельном режиме и с пульта.
    if (!empty($in['qid']) && ($s['mode'] === 'self' || $owner)) {
        $qid = (int) $in['qid'];
    }
    $qq = $qid ? row('SELECT * FROM questions WHERE id = ? AND session_id = ?', [$qid, $s['id']]) : null;

    // Время вышло — приём закрывается сам, без действия ведущего.
    if ($qq && $s['mode'] === 'live' && $s['phase'] === 'open' && (int) $qq['id'] === (int) $s['current_question_id']
        && (int) $qq['time_limit'] > 0 && now_ms() > (int) $qq['opened_at'] + (int) $qq['time_limit'] * 1000) {
        q("UPDATE sessions SET phase = 'closed', hide_results = 0 WHERE id = ? AND phase = 'open'", [$s['id']]);
        write_state((int) $s['id']);
        $s = row('SELECT * FROM sessions WHERE id = ?', [$s['id']]);
    }

    $reveal = in_array($s['phase'], ['reveal', 'finished'], true);
    $out = [
        'v' => (int) $s['version'],
        'id' => $owner ? (int) $s['id'] : null,
        'owner' => $owner,
        'code' => $s['code'],
        'title' => $s['title'],
        'mode' => $s['mode'],
        'phase' => $s['phase'],
        'hide_results' => (int) $s['hide_results'],
        'hide_join' => (int) $s['hide_join'],
        'theme' => clean_theme(json_decode($s['theme'] ?: '{}', true)),
        'now' => now_ms(),
        'online' => (int) val('SELECT COUNT(*) FROM participants WHERE session_id = ? AND last_seen > ?', [$s['id'], time() - 75]),
        'joined' => (int) val('SELECT COUNT(*) FROM participants WHERE session_id = ?', [$s['id']]),
        'q' => null,
        'data' => null,
        'spotlight' => null,
        'raffle' => json_decode((string) $s['raffle'], true) ?: null,
        'reactions' => new stdClass(),
    ];
    $all = session_questions((int) $s['id']);
    $out['total'] = count($all);
    $out['index'] = 0;
    foreach ($all as $i => $x) {
        if ((int) $x['id'] === $qid) {
            $out['index'] = $i + 1;
        }
    }
    if ($host || $s['mode'] === 'self') {
        $out['slides'] = array_map(fn($x) => ['id' => (int) $x['id'], 'type' => $x['type'], 'text' => $x['text']], $all);
    }
    if ($qq) {
        $out['q'] = public_question($qq, $reveal || $host);
        $out['data'] = aggregate($qq, $host, $reveal);
        // Скрытые результаты не отдаются никому, кроме владельца: остаётся только число ответивших.
        if ($s['hide_results'] && $s['phase'] === 'open' && !$owner && $qq['type'] !== 'info' && !has_feed($qq)) {
            $out['data'] = ['answered' => $out['data']['answered']];
        }
    }
    if ($s['phase'] === 'finished') {
        $out['leaders'] = leaderboard((int) $s['id'], 10);
        $out['teams'] = team_board((int) $s['id']);
    }
    if ($s['spotlight_answer_id']) {
        $a = row("SELECT a.id, a.value, p.name FROM answers a LEFT JOIN participants p ON p.id = a.participant_id WHERE a.id = ? AND a.status = 'visible'", [$s['spotlight_answer_id']]);
        if ($a) {
            $v = json_decode($a['value'], true);
            $out['spotlight'] = ['id' => (int) $a['id'], 'text' => is_array($v) ? (string) ($v['comment'] ?? '') : (string) $v, 'name' => (string) $a['name']];
        }
    }
    if ($s['reactions_on']) {
        $r = [];
        foreach (rows('SELECT emoji, count FROM reactions WHERE session_id = ?', [$s['id']]) as $x) {
            $r[$x['emoji']] = (int) $x['count'];
        }
        $out['reactions'] = (object) $r;
    }
    return $out;
}

function api_report(array $in): array
{
    $s = own_session($in['id'] ?? 0);
    $slides = [];
    foreach (session_questions((int) $s['id']) as $qq) {
        $slides[] = ['q' => public_question($qq, true), 'data' => aggregate($qq, false, true)];
    }
    return [
        'session' => session_view($s),
        'slides' => $slides,
        'joined' => (int) val('SELECT COUNT(*) FROM participants WHERE session_id = ?', [$s['id']]),
        'answers' => (int) val('SELECT COUNT(*) FROM answers WHERE session_id = ?', [$s['id']]),
        'leaders' => leaderboard((int) $s['id'], 10),
        'teams' => team_board((int) $s['id']),
    ];
}

function api_export(array $in): ?array
{
    $s = own_session($in['id'] ?? 0);
    $questions = [];
    foreach (session_questions((int) $s['id']) as $i => $qq) {
        $questions[(int) $qq['id']] = $qq + ['n' => $i + 1];
    }
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="otklik-' . $s['code'] . '.csv"');
    $f = fopen('php://output', 'w');
    fwrite($f, "\xEF\xBB\xBF");
    // Защита от формул в Excel: текст, начинающийся со знака формулы, записывается как обычная строка.
    // Касается всех ячеек, потому что имя участника тоже вводит посторонний человек.
    $safe = function ($v) {
        $v = (string) $v;
        return $v !== '' && strpbrk($v[0], "=+-@\t\r") !== false && !is_numeric($v) ? "'" . $v : $v;
    };
    $put = fn(array $r) => fputcsv($f, array_map($safe, $r), ';', '"', '');
    $put(['Слайд', 'Тип', 'Вопрос', 'Участник', 'Ответ', 'Статус', 'Верно', 'Очки', 'Время']);
    $status = ['visible' => 'показан', 'hidden' => 'скрыт', 'pending' => 'на модерации'];
    $st = q('SELECT a.*, p.name FROM answers a LEFT JOIN participants p ON p.id = a.participant_id WHERE a.session_id = ? ORDER BY a.question_id, a.id', [$s['id']]);
    while ($a = $st->fetch()) {
        $qq = $questions[(int) $a['question_id']] ?? null;
        if (!$qq) {
            continue;
        }
        $text = answer_text($qq, json_decode($a['value'], true));
        $put([
            $qq['n'], TYPE_NAMES[$qq['type']], $qq['text'], (string) $a['name'], $text, $status[$a['status']] ?? $a['status'],
            $a['is_correct'] === null ? '' : ((int) $a['is_correct'] ? 'да' : 'нет'), (int) $a['points'], date('Y-m-d H:i:s', (int) $a['created_at']),
        ]);
    }
    fclose($f);
    return null;
}

// ---------- Участник ----------

function live_session(string $code): array
{
    $s = row('SELECT * FROM sessions WHERE code = ? AND is_template = 0', [preg_replace('/\D/', '', $code)]);
    if (!$s) {
        fail('Сессия с таким кодом не найдена. Проверьте код на экране', 404);
    }
    return $s;
}

function participant(array $s, $token): array
{
    $p = is_string($token) && $token !== '' ? row('SELECT * FROM participants WHERE session_id = ? AND token = ?', [$s['id'], $token]) : null;
    if (!$p) {
        fail('Подключитесь к сессии заново', 401);
    }
    return $p;
}

function api_join(array $in): array
{
    $s = live_session((string) ($in['code'] ?? ''));
    $name = str_clean($in['name'] ?? '', 40);
    if ($name !== '' && has_stopword($name)) {
        fail('Выберите другое имя');
    }
    $token = (string) ($in['token'] ?? '');
    $p = $token !== '' ? row('SELECT * FROM participants WHERE session_id = ? AND token = ?', [$s['id'], $token]) : null;
    if ($p) {
        q('UPDATE participants SET last_seen = ?, name = ? WHERE id = ?', [time(), $name !== '' ? $name : $p['name'], $p['id']]);
    } else {
        if ($s['archived']) {
            fail('Сессия завершена и убрана в архив');
        }
        // Защита от накрутки: с одного адреса в одну сессию — не больше 400 новых участников за 10 минут
        // (в зале все телефоны часто выходят в сеть с одного адреса), всего в сессии — не больше 2000.
        $key = 'join:' . $s['id'] . ':' . client_ip();
        q('DELETE FROM login_attempts WHERE at < ?', [time() - 600]);
        if ((int) val('SELECT COUNT(*) FROM login_attempts WHERE ip = ?', [$key]) >= 400
            || (int) val('SELECT COUNT(*) FROM participants WHERE session_id = ?', [$s['id']]) >= 2000) {
            fail('Сейчас подключается слишком много участников. Повторите через несколько минут', 429);
        }
        q('INSERT INTO login_attempts (ip, at) VALUES (?, ?)', [$key, time()]);
        $token = bin2hex(random_bytes(16));
        q('INSERT INTO participants (session_id, token, name, last_seen, created_at) VALUES (?, ?, ?, ?, ?)', [$s['id'], $token, $name, time(), time()]);
        $p = ['id' => last_id(), 'name' => $name, 'score' => 0, 'team' => null];
    }
    $teams = session_teams($s);
    if (isset($in['team']) && is_numeric($in['team']) && isset($teams[(int) $in['team']]) && ($p['team'] ?? null) === null) {
        // Команда выбирается один раз: иначе после вопроса можно было бы перейти к лидерам.
        q('UPDATE participants SET team = ? WHERE id = ?', [(int) $in['team'], $p['id']]);
        $p['team'] = (int) $in['team'];
    }
    $mine = [];
    foreach (rows('SELECT question_id, value, is_correct, points FROM answers WHERE participant_id = ? ORDER BY id', [$p['id']]) as $a) {
        $mine[(int) $a['question_id']][] = json_decode($a['value'], true);
    }
    $likes = array_map('intval', array_column(rows('SELECT answer_id FROM votes WHERE participant_id = ?', [$p['id']]), 'answer_id'));
    return [
        'token' => $token,
        'name' => $name !== '' ? $name : (string) $p['name'],
        'score' => shown_score($s, $p + ['id' => 0]),
        'now' => now_ms(),
        'answers' => (object) $mine,
        'likes' => $likes,
        'pid' => (int) $p['id'],
        'team' => isset($p['team']) && $p['team'] !== null ? (int) $p['team'] : null,
    ];
}

function api_ping(array $in): array
{
    $s = live_session((string) ($in['code'] ?? ''));
    q('UPDATE participants SET last_seen = ? WHERE session_id = ? AND token = ?', [time(), $s['id'], (string) ($in['token'] ?? '')]);
    return ['now' => now_ms()];
}

function api_answer(array $in): array
{
    $s = live_session((string) ($in['code'] ?? ''));
    $p = participant($s, $in['token'] ?? null);
    $qq = row('SELECT * FROM questions WHERE id = ? AND session_id = ?', [(int) ($in['qid'] ?? 0), $s['id']]);
    if (!$qq) {
        fail('Слайд уже сменился');
    }
    $live = $s['mode'] === 'live';
    if ($live) {
        if ((int) $s['current_question_id'] !== (int) $qq['id'] || $s['phase'] !== 'open') {
            fail('Приём ответов закрыт');
        }
        if ((int) $qq['time_limit'] > 0 && now_ms() > (int) $qq['opened_at'] + (int) $qq['time_limit'] * 1000 + 1500) {
            fail('Время вышло');
        }
    }
    if ($s['ask_names'] && $p['name'] === '') {
        fail('Сначала представьтесь');
    }
    // Проверка лимита и запись — в одной транзакции, чтобы двойное нажатие не дало два ответа.
    db()->exec('BEGIN IMMEDIATE');
    $max = max_answers($qq);
    $given = (int) val('SELECT COUNT(*) FROM answers WHERE question_id = ? AND participant_id = ?', [$qq['id'], $p['id']]);
    if ($given >= $max) {
        fail($max === 1 ? 'Вы уже ответили' : "Можно отправить не больше $max ответов");
    }
    // Общий предел на слайд: сводка пересчитывается каждую секунду и не должна разрастаться без границ.
    if ((int) val('SELECT COUNT(*) FROM answers WHERE question_id = ?', [$qq['id']]) >= 6000) {
        fail('На этот слайд пришло слишком много ответов');
    }
    [$value, $correct, $points, $text] = validate_answer($qq, $in['value'] ?? null, $live);

    $status = 'visible';
    if ($text !== null) {
        if ($s['filter_on'] && has_stopword($text)) {
            $status = 'hidden';
        } elseif ($s['premoderation']) {
            $status = 'pending';
        }
    }
    q(
        'INSERT INTO answers (question_id, session_id, participant_id, value, status, is_correct, points, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [$qq['id'], $s['id'], $p['id'], json_encode($value, JSON_UNESCAPED_UNICODE), $status, $correct, $points, time()]
    );
    $id = last_id();
    q('UPDATE participants SET score = score + ?, last_seen = ? WHERE id = ?', [$points, time(), $p['id']]);
    db()->exec('COMMIT');
    if (has_feed($qq) && $status === 'visible') {
        write_qa_state($qq, $s['code']);
    }
    $out = ['ok' => true, 'id' => $id, 'left' => $max - $given - 1, 'status' => $status === 'pending' ? 'pending' : 'ok'];
    if (!$live && $correct !== null) {
        // В самостоятельном режиме результат виден сразу: ведущего, который покажет ответ, нет.
        $out['is_correct'] = (int) $correct;
        $out['points'] = $points;
        if ($qq['type'] === 'quiz') {
            $out['correct'] = array_keys(array_filter(q_options($qq), fn($o) => !empty($o['correct'])));
        } else {
            $out['correct'] = q_settings($qq)['correct'] ?? null;
        }
    }
    return $out;
}

function api_vote(array $in): array
{
    $s = live_session((string) ($in['code'] ?? ''));
    $p = participant($s, $in['token'] ?? null);
    $a = row(
        "SELECT a.id, a.question_id FROM answers a JOIN questions q ON q.id = a.question_id
         WHERE a.id = ? AND a.session_id = ? AND a.status = 'visible' AND q.type IN ('qa', 'open')",
        [(int) ($in['answer_id'] ?? 0), $s['id']]
    );
    if ($a && !has_feed(row('SELECT * FROM questions WHERE id = ?', [$a['question_id']]))) {
        $a = null;
    }
    if (!$a) {
        fail('Вопрос не найден', 404);
    }
    if (now_ms() - (int) $p['last_react'] < 300) {
        fail('Слишком часто. Повторите через секунду', 429);
    }
    q('UPDATE participants SET last_react = ? WHERE id = ?', [now_ms(), $p['id']]);
    $liked = (bool) val('SELECT 1 FROM votes WHERE answer_id = ? AND participant_id = ?', [$a['id'], $p['id']]);
    if ($liked) {
        q('DELETE FROM votes WHERE answer_id = ? AND participant_id = ?', [$a['id'], $p['id']]);
    } else {
        q('INSERT OR IGNORE INTO votes (answer_id, participant_id) VALUES (?, ?)', [$a['id'], $p['id']]);
    }
    write_qa_state(row('SELECT * FROM questions WHERE id = ?', [$a['question_id']]), $s['code']);
    return ['liked' => !$liked];
}

function api_react(array $in): array
{
    $s = live_session((string) ($in['code'] ?? ''));
    $p = participant($s, $in['token'] ?? null);
    $emoji = (string) ($in['emoji'] ?? '');
    if (!$s['reactions_on'] || !in_array($emoji, REACTIONS, true)) {
        fail('Реакции выключены');
    }
    if (now_ms() - (int) $p['last_react'] < 900) {
        return ['ok' => false];
    }
    q('UPDATE participants SET last_react = ?, last_seen = ? WHERE id = ?', [now_ms(), time(), $p['id']]);
    q('INSERT INTO reactions (session_id, emoji, count) VALUES (?, ?, 1) ON CONFLICT (session_id, emoji) DO UPDATE SET count = count + 1', [$s['id'], $emoji]);
    return ['ok' => true];
}

/**
 * Очки участника, какими их можно показать сейчас. Пока ведущий не показал верный ответ,
 * очки за текущий слайд не учитываются: иначе по ним можно узнать ответ заранее.
 */
function shown_score(array $s, array $p): int
{
    $score = (int) $p['score'];
    if ($s['mode'] === 'live' && in_array($s['phase'], ['open', 'closed'], true) && $s['current_question_id']) {
        $score -= (int) val('SELECT COALESCE(SUM(points), 0) FROM answers WHERE question_id = ? AND participant_id = ?', [$s['current_question_id'], $p['id']]);
    }
    return $score;
}

function api_me(array $in): array
{
    $s = live_session((string) ($in['code'] ?? ''));
    $p = participant($s, $in['token'] ?? null);
    $revealed = $s['mode'] === 'self' || in_array($s['phase'], ['reveal', 'finished'], true);
    $p['score'] = shown_score($s, $p);
    $out = [
        'score' => (int) $p['score'],
        'place' => 1 + (int) val('SELECT COUNT(*) FROM participants WHERE session_id = ? AND score > ?', [$s['id'], $p['score']]),
        'players' => (int) val('SELECT COUNT(*) FROM participants WHERE session_id = ? AND score > 0', [$s['id']]),
        'last' => null,
    ];
    if (!empty($in['qid']) && ($revealed || (int) $in['qid'] !== (int) $s['current_question_id'])) {
        $a = row('SELECT is_correct, points FROM answers WHERE question_id = ? AND participant_id = ? ORDER BY id DESC LIMIT 1', [(int) $in['qid'], $p['id']]);
        if ($a) {
            $out['last'] = ['is_correct' => $a['is_correct'] === null ? null : (int) $a['is_correct'], 'points' => (int) $a['points']];
        }
    }
    return $out;
}
