// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import { availableLanguages } from '@app/context/LanguageContext';
import defineMessages from '@app/utils/defineMessages';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.LanguageSelector', {
  languageServerDefault: 'Server default ({language})',
});

interface LanguageSelectorProps {
  value?: string;
  /** Called with the field name and the chosen locale code. */
  setFieldValue: (property: string, value: string) => void;
  /** Locale the server uses when a user picks the default. */
  serverValue?: string;
  /** Adds a "Server default" choice (empty value). */
  isUserSettings?: boolean;
  isDisabled?: boolean;
  fieldName?: string;
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

/** Display language select, from the locales the app ships. */
const LanguageSelector = ({
  value,
  setFieldValue,
  serverValue,
  isUserSettings = false,
  isDisabled,
  fieldName = 'locale',
  ...control
}: LanguageSelectorProps) => {
  const intl = useIntl();
  const languages = Object.values(availableLanguages).sort((a, b) =>
    a.display.localeCompare(b.display)
  );

  return (
    <select
      {...control}
      name={fieldName}
      disabled={isDisabled}
      value={value ?? ''}
      onChange={(e) => setFieldValue(fieldName, e.target.value)}
    >
      {isUserSettings && (
        <option value="">
          {intl.formatMessage(messages.languageServerDefault, {
            language:
              availableLanguages[serverValue ?? 'en']?.display ?? 'English',
          })}
        </option>
      )}
      {languages.map((language) => (
        <option key={language.code} value={language.code} lang={language.code}>
          {language.display}
        </option>
      ))}
    </select>
  );
};

export default LanguageSelector;
