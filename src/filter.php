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

function stopwords(): array
{
    $custom = preg_split('/[\s,;]+/u', mb_strtolower((string) setting('stopwords', '')), -1, PREG_SPLIT_NO_EMPTY) ?: [];
    return array_values(array_unique(array_merge(default_stopwords(), $custom)));
}

function has_stopword(string $text): bool
{
    $t = mb_strtolower($text);
    // Типичные замены: цифры и латиница вместо кириллицы. Чисто латинские слова проверяются отдельно.
    $cyr = strtr($t, ['@' => 'а', '0' => 'о', '3' => 'з', 'x' => 'х', 'y' => 'у', 'e' => 'е', 'a' => 'а', 'o' => 'о', 'p' => 'р', 'c' => 'с', 'k' => 'к', 'b' => 'б']);
    $starts = stopwords();
    $anywhere = stopwords_anywhere();
    foreach ([$t, $cyr] as $variant) {
        $words = preg_split('/[^\p{L}]+/u', $variant, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        foreach ($words as $word) {
            foreach ($starts as $s) {
                if (mb_strpos($word, $s) === 0) {
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
