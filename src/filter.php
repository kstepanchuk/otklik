<?php
declare(strict_types=1);

/** Основы, с которых начинается скрываемое слово. Администратор дополняет список в настройках. */
function default_stopwords(): array
{
    return ['хуй', 'хуе', 'хуё', 'хуя', 'хуи', 'ебат', 'ебан', 'ёбан', 'ебал', 'ебуч', 'ебла', 'сука', 'суки', 'сучк', 'мудак', 'мудил', 'гандон', 'пидор', 'пидар', 'залуп', 'fuck', 'shit', 'bitch'];
}

/** Основы, которые скрывают слово, где бы в нём ни стояли. */
function stopwords_anywhere(): array
{
    return ['пизд', 'бляд', 'блят', 'долбоёб', 'долбоеб', 'заеб', 'заёб', 'наеб', 'наёб', 'уеб', 'уёб', 'выеб', 'охуе', 'охуи', 'нахуй', 'похуй'];
}

/**
 * Полный список основ: встроенные, из настроек админки и из файла storage/stopwords.txt.
 * В файле одна основа на строку; строки с # в начале — комментарии.
 */
function stopwords(): array
{
    static $cache = null;
    if ($cache !== null) {
        return $cache;
    }
    $custom = preg_split('/[\s,;]+/u', mb_strtolower((string) setting('stopwords', '')), -1, PREG_SPLIT_NO_EMPTY) ?: [];
    $file = ROOT . '/storage/stopwords.txt';
    if (is_file($file)) {
        foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
            $line = mb_strtolower(trim($line));
            if ($line !== '' && $line[0] !== '#') {
                $custom[] = $line;
            }
        }
    }
    // Основы короче трёх букв скрывали бы обычные слова.
    $custom = array_filter($custom, fn($w) => mb_strlen($w) >= 3);
    return $cache = array_values(array_unique(array_merge(default_stopwords(), $custom)));
}

function has_stopword(string $text): bool
{
    $t = mb_strtolower($text);
    // Типичные замены: цифры и латиница вместо кириллицы. Чисто латинские слова проверяются отдельно.
    $cyr = strtr($t, ['@' => 'а', '0' => 'о', '3' => 'з', 'x' => 'х', 'y' => 'у', 'e' => 'е', 'a' => 'а', 'o' => 'о', 'p' => 'р', 'c' => 'с', 'k' => 'к', 'b' => 'б']);
    static $starts = null;
    $starts ??= array_flip(stopwords());
    $anywhere = stopwords_anywhere();
    foreach ([$t, $cyr] as $variant) {
        $words = preg_split('/[^\p{L}]+/u', $variant, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        foreach ($words as $word) {
            // Список может быть на десятки тысяч основ, поэтому ищем начала слова в наборе, а не перебором.
            for ($len = min(mb_strlen($word), 24); $len >= 3; $len--) {
                if (isset($starts[mb_substr($word, 0, $len)])) {
                    return true;
                }
            }
            foreach ($anywhere as $s) {
                if (mb_strpos($word, $s) !== false) {
                    return true;
                }
            }
        }
    }
    return false;
}
