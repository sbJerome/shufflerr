/** Title/artist normalisation used to match scanned items to MusicBrainz tracklists. */

const stripDiacritics = (input: string): string =>
  input.normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** Lowercase, no diacritics, `&` → and, punctuation removed, whitespace collapsed. */
export const normalizeText = (input: string | null | undefined): string =>
  stripDiacritics(input ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9Ѐ-ӿ぀-ヿ一-鿿]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

/**
 * Looser form: also drops bracketed qualifiers and trailing " - Remastered"-style
 * suffixes ("Song (feat. X)", "Song [2011 Remaster]", "Song - Radio Edit").
 */
export const normalizeLoose = (input: string | null | undefined): string => {
  const stripped = (input ?? '')
    .replace(/\s*[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(/\s+(feat\.?|ft\.?|featuring)\s+.*$/i, ' ')
    .replace(
      /\s+-\s+(\d{4}\s+)?(remaster(ed)?|mono|stereo|single|album|radio)(\s+(version|edit|mix))?(\s+\d{4})?\s*$/i,
      ' '
    );
  const normalized = normalizeText(stripped);
  // A title that is only a qualifier ("(Intro)") must not collapse to nothing
  return normalized || normalizeText(input);
};

/**
 * Loosest form: additionally drops a trailing guest credit written into the
 * title without brackets ("Heaven Takes You Home with Connie Constance").
 * Only used together with a known, matching duration.
 */
export const normalizeLoosest = (input: string | null | undefined): string => {
  const stripped = (input ?? '').replace(/\s+(with|w\/|x)\s+\S.*$/, ' ');
  return normalizeLoose(stripped) || normalizeLoose(input);
};

export const sameText = (a?: string | null, b?: string | null): boolean => {
  const na = normalizeText(a);
  return na !== '' && na === normalizeText(b);
};

export const sameTextLoose = (
  a?: string | null,
  b?: string | null
): boolean => {
  const na = normalizeLoose(a);
  return na !== '' && na === normalizeLoose(b);
};

/** Durations match within a tolerance; unknown durations never disqualify. */
export const durationClose = (
  a: number | null | undefined,
  b: number | null | undefined,
  toleranceMs = 3000
): boolean => {
  if (!a || !b) {
    return true;
  }
  return Math.abs(a - b) <= toleranceMs;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns the lowercase MBID when the value is one, else undefined. */
export const asMbid = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  return UUID_RE.test(trimmed) ? trimmed : undefined;
};

/** "01", or "2-07" for discs after the first when the release has several. */
export const formatPosition = (
  discNumber: number,
  trackNumber: number,
  multiDisc: boolean
): string => {
  const track = String(trackNumber).padStart(2, '0');
  return multiDisc ? `${discNumber}-${track}` : track;
};

/**
 * A title as a human would search for it: bracketed qualifiers at the end and
 * trailing format/packaging words removed ("Gin & Juice (Maxi CD)" → "Gin &
 * Juice", "Proxy WEB" → "Proxy", "Migraine EP" → "Migraine"). Keeps case and
 * punctuation, unlike the normalisers above.
 */
export const stripQualifiers = (title: string): string => {
  let out = title;
  for (let i = 0; i < 4; i++) {
    const next = out
      .replace(/\s*[([{][^)\]}]*[)\]}]\s*$/, '')
      .replace(
        /[\s-]+(web|cd|cds|cdm|ep|vls|flac|mp3|promo|vinyl single|maxi cd|single)\s*$/i,
        ''
      )
      .trim();
    if (next === out || next === '') {
      break;
    }
    out = next;
  }
  return out;
};

/** First credited artist of a joined credit ("A, B & C", "A X B", "A feat. B", "A vs. B"). */
export const primaryArtist = (credit: string): string =>
  credit
    .split(
      /\s*(?:,|;|&|\bx\b|\bvs\.?|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b)\s*/i
    )[0]
    .trim();
