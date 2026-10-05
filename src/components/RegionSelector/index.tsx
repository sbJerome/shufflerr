// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import defineMessages from '@app/utils/defineMessages';
import { countries } from 'country-flag-icons';
import { useMemo } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.RegionSelector', {
  regionDefault: 'All regions',
  regionServerDefault: 'Server default ({region})',
});

interface RegionSelectorProps {
  value: string;
  name: string;
  /** Adds a "Server default" choice (empty value) for per-user settings. */
  isUserSetting?: boolean;
  /** Region the server uses when the user picks the default. */
  serverValue?: string;
  /** Leave out the "All regions" choice. */
  disableAll?: boolean;
  onChange?: (fieldName: string, region: string) => void;
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

/** Country select (ISO 3166-1 alpha-2). Drives trending, charts and concerts. */
const RegionSelector = ({
  name,
  value,
  isUserSetting = false,
  serverValue,
  disableAll = false,
  onChange,
  ...control
}: RegionSelectorProps) => {
  const intl = useIntl();

  const options = useMemo(
    () =>
      countries
        .map((code) => ({
          code,
          label:
            intl.formatDisplayName(code, {
              type: 'region',
              fallback: 'none',
            }) ?? code,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, intl.locale)),
    [intl]
  );

  const regionName = (code?: string) =>
    code
      ? (intl.formatDisplayName(code, { type: 'region', fallback: 'none' }) ??
        code)
      : intl.formatMessage(messages.regionDefault);

  return (
    <select
      {...control}
      name={name}
      value={value ?? ''}
      onChange={(e) => onChange?.(name, e.target.value)}
    >
      {isUserSetting && (
        <option value="">
          {intl.formatMessage(messages.regionServerDefault, {
            region: regionName(serverValue),
          })}
        </option>
      )}
      {!disableAll && !isUserSetting && (
        <option value="">{intl.formatMessage(messages.regionDefault)}</option>
      )}
      {options.map((option) => (
        <option key={option.code} value={option.code}>
          {option.label}
        </option>
      ))}
    </select>
  );
};

export default RegionSelector;
