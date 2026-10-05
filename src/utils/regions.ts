import { countries } from 'country-flag-icons';

export interface RegionOption {
  code: string;
  name: string;
}

/**
 * Name of an ISO 3166-1 alpha-2 region in the given locale, or undefined when
 * the runtime has no name for it. `Intl.DisplayNames.of` throws on the few
 * codes in the flag list that are not valid region subtags, so it is guarded.
 */
export const regionName = (
  code: string,
  locale: string
): string | undefined => {
  try {
    const name = new Intl.DisplayNames([locale], {
      type: 'region',
      fallback: 'none',
    }).of(code);
    return name || undefined;
  } catch {
    return undefined;
  }
};

/** Every region the runtime can name, sorted by name. */
export const regionOptions = (locale: string): RegionOption[] => {
  let display: Intl.DisplayNames | undefined;
  try {
    display = new Intl.DisplayNames([locale], {
      type: 'region',
      fallback: 'none',
    });
  } catch {
    return [];
  }
  const options: RegionOption[] = [];
  for (const code of countries) {
    try {
      const name = display.of(code);
      if (name) {
        options.push({ code, name });
      }
    } catch {
      // not a region this runtime knows
    }
  }
  return options.sort((a, b) => a.name.localeCompare(b.name, locale));
};
