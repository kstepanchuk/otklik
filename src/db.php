<?php
declare(strict_types=1);

function db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }
    $path = (string) cfg('db_path');
    if (!is_dir(dirname($path))) {
        mkdir(dirname($path), 0775, true);
    }
    $pdo = new PDO('sqlite:' . $path, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA busy_timeout = 8000');
    $pdo->exec('PRAGMA journal_mode = WAL');
    $pdo->exec('PRAGMA synchronous = NORMAL');
    $pdo->exec('PRAGMA foreign_keys = ON');
    migrate($pdo);
    return $pdo;
}

function q(string $sql, array $params = []): PDOStatement
{
    $st = db()->prepare($sql);
    $st->execute($params);
    return $st;
}

function row(string $sql, array $params = []): ?array
{
    $r = q($sql, $params)->fetch();
    return $r === false ? null : $r;
}

function rows(string $sql, array $params = []): array
{
    return q($sql, $params)->fetchAll();
}

function val(string $sql, array $params = [])
{
    $v = q($sql, $params)->fetchColumn();
    return $v === false ? null : $v;
}

function last_id(): int
{
    return (int) db()->lastInsertId();
}

/** Версии схемы: каждая запись выполняется один раз, по порядку. */
function migrations(): array
{
    return [
        1 => "
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            name TEXT NOT NULL DEFAULT '',
            role TEXT NOT NULL DEFAULT 'user',
            status TEXT NOT NULL DEFAULT 'active',
            email_verified INTEGER NOT NULL DEFAULT 0,
            settings TEXT NOT NULL DEFAULT '{}',
            created_at INTEGER NOT NULL
        );
        CREATE TABLE tokens (
            id INTEGER PRIMARY KEY,
            user_id INTEGER,
            email TEXT NOT NULL DEFAULT '',
            kind TEXT NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            expires_at INTEGER NOT NULL,
            used_at INTEGER
        );
        CREATE TABLE login_attempts (
            ip TEXT NOT NULL,
            at INTEGER NOT NULL
        );
        CREATE INDEX login_attempts_ip ON login_attempts (ip, at);
        CREATE TABLE sessions (
            id INTEGER PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            code TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL DEFAULT '',
            mode TEXT NOT NULL DEFAULT 'live',
            ask_names INTEGER NOT NULL DEFAULT 0,
            premoderation INTEGER NOT NULL DEFAULT 0,
            filter_on INTEGER NOT NULL DEFAULT 1,
            reactions_on INTEGER NOT NULL DEFAULT 1,
            theme TEXT NOT NULL DEFAULT '{}',
            current_question_id INTEGER,
            phase TEXT NOT NULL DEFAULT 'lobby',
            hide_results INTEGER NOT NULL DEFAULT 0,
            spotlight_answer_id INTEGER,
            version INTEGER NOT NULL DEFAULT 1,
            archived INTEGER NOT NULL DEFAULT 0,
            is_template INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX sessions_user ON sessions (user_id);
        CREATE TABLE questions (
            id INTEGER PRIMARY KEY,
            session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            position INTEGER NOT NULL DEFAULT 0,
            type TEXT NOT NULL,
            text TEXT NOT NULL DEFAULT '',
            options TEXT NOT NULL DEFAULT '[]',
            settings TEXT NOT NULL DEFAULT '{}',
            time_limit INTEGER NOT NULL DEFAULT 0,
            opened_at INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX questions_session ON questions (session_id, position);
        CREATE TABLE participants (
            id INTEGER PRIMARY KEY,
            session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            token TEXT NOT NULL,
            name TEXT NOT NULL DEFAULT '',
            score INTEGER NOT NULL DEFAULT 0,
            last_seen INTEGER NOT NULL DEFAULT 0,
            last_react INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            UNIQUE (session_id, token)
        );
        CREATE TABLE answers (
            id INTEGER PRIMARY KEY,
            question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
            session_id INTEGER NOT NULL,
            participant_id INTEGER NOT NULL,
            value TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'visible',
            is_correct INTEGER,
            points INTEGER NOT NULL DEFAULT 0,
            answered INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX answers_question ON answers (question_id);
        CREATE INDEX answers_participant ON answers (participant_id, question_id);
        CREATE TABLE votes (
            answer_id INTEGER NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
            participant_id INTEGER NOT NULL,
            PRIMARY KEY (answer_id, participant_id)
        );
        CREATE TABLE reactions (
            session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            emoji TEXT NOT NULL,
            count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (session_id, emoji)
        );
        CREATE TABLE app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        ",
        2 => "ALTER TABLE sessions ADD COLUMN hide_join INTEGER NOT NULL DEFAULT 0;",
    ];
}

function migrate(PDO $pdo): void
{
    $all = migrations();
    if ((int) $pdo->query('PRAGMA user_version')->fetchColumn() >= max(array_keys($all))) {
        return;
    }
    // Блокировка на запись: два одновременных первых запроса не создадут таблицы дважды.
    $pdo->exec('BEGIN IMMEDIATE');
    $current = (int) $pdo->query('PRAGMA user_version')->fetchColumn();
    foreach ($all as $version => $sql) {
        if ($version > $current) {
            $pdo->exec($sql);
            $pdo->exec('PRAGMA user_version = ' . (int) $version);
        }
    }
    $pdo->exec('COMMIT');
}
