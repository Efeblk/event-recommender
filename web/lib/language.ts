export type SupportedLanguage = 'tr' | 'en';

const TURKISH_WORDS = new Set([
  'ama',
  'altinda',
  'bana',
  'benim',
  'bir',
  'bu',
  'bugun',
  'bul',
  'cocuk',
  'cumartesi',
  'etkinlik',
  'evet',
  'cuma',
  'daha',
  'hafta',
  'icin',
  'ile',
  'konser',
  'olsun',
  'kaydet',
  'sadece',
  'pazar',
  'sonu',
  'tiyatro',
  'ucretsiz',
  'ucuz',
  'var',
  've',
  'veya',
  'yarin',
  'yasinda',
]);

const ENGLISH_WORDS = new Set([
  'a',
  'an',
  'any',
  'concert',
  'cheaper',
  'could',
  'event',
  'events',
  'find',
  'friday',
  'for',
  'in',
  'jazz',
  'looking',
  'my',
  'me',
  'next',
  'on',
  'only',
  'or',
  'please',
  'saturday',
  'show',
  'save',
  'something',
  'sunday',
  'the',
  'theatre',
  'then',
  'this',
  'today',
  'tomorrow',
  'under',
  'want',
  'would',
  'weekend',
  'with',
  'without',
  'yes',
]);

const fold = (value: string) =>
  value
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/** Detect the language of one user turn. Ties use Turkish, the UI default. */
export function detectMessageLanguage(message: string): SupportedLanguage {
  const words = fold(message).match(/[a-z]+/g) ?? [];
  let turkish = /[çğıöşüİ]/u.test(message) ? 2 : 0;
  let english = 0;
  for (const word of words) {
    if (TURKISH_WORDS.has(word)) turkish++;
    if (ENGLISH_WORDS.has(word)) english++;
  }
  return english > turkish ? 'en' : 'tr';
}
