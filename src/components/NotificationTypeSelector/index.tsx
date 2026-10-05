// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import defineMessages from '@app/utils/defineMessages';
import type { NotificationTypeKey } from '@server/lib/notifications/types';
import { useId } from 'react';
import type { IntlShape } from 'react-intl';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.NotificationTypeSelector', {
  legend: 'What to send',
  pending: 'A request is waiting for approval',
  autoApproved: 'A request was approved automatically',
  approved: 'Your request was approved',
  declined: 'Your request was declined',
  available: 'Your music is available',
  failed: 'A request failed to download',
  managerHint: 'For people who manage requests',
});

/** The six types the UI offers, in display order (mirrors the server list). */
export const NOTIFICATION_TYPES: NotificationTypeKey[] = [
  'pending',
  'autoApproved',
  'approved',
  'declined',
  'available',
  'failed',
];

/** Types only offered to people with MANAGE_REQUESTS. */
export const MANAGER_NOTIFICATION_TYPES: NotificationTypeKey[] = [
  'pending',
  'autoApproved',
];

const labels: Partial<
  Record<NotificationTypeKey, (typeof messages)[keyof typeof messages]>
> = {
  pending: messages.pending,
  autoApproved: messages.autoApproved,
  approved: messages.approved,
  declined: messages.declined,
  available: messages.available,
  failed: messages.failed,
};

export const notificationTypeLabel = (
  intl: IntlShape,
  key: NotificationTypeKey
): string => {
  const message = labels[key];
  return message ? intl.formatMessage(message) : key;
};

interface NotificationTypeSelectorProps {
  currentTypes: NotificationTypeKey[];
  onUpdate: (types: NotificationTypeKey[]) => void;
  /** Offer the manager-only types (pending, autoApproved). Default true. */
  managerOnly?: boolean;
  /** Restrict the checklist to these types (the server's `availableTypes`). */
  availableTypes?: NotificationTypeKey[];
  legend?: string;
  error?: string;
}

const NotificationTypeSelector = ({
  currentTypes,
  onUpdate,
  managerOnly = true,
  availableTypes,
  legend,
  error,
}: NotificationTypeSelectorProps) => {
  const intl = useIntl();
  const baseId = useId();

  const offered = NOTIFICATION_TYPES.filter(
    (key) =>
      (managerOnly || !MANAGER_NOTIFICATION_TYPES.includes(key)) &&
      (!availableTypes || availableTypes.includes(key))
  );

  const toggle = (key: NotificationTypeKey, checked: boolean) => {
    const next = checked
      ? [...currentTypes.filter((k) => k !== key), key]
      : currentTypes.filter((k) => k !== key);
    // Keep display order stable so saved values diff cleanly.
    onUpdate([
      ...NOTIFICATION_TYPES.filter((k) => next.includes(k)),
      ...next.filter((k) => !NOTIFICATION_TYPES.includes(k)),
    ]);
  };

  return (
    <fieldset aria-describedby={error ? `${baseId}-err` : undefined}>
      <legend className="mb-2 text-sm font-medium text-muted">
        {legend ?? intl.formatMessage(messages.legend)}
      </legend>
      <div className="sh-checks">
        {offered.map((key) => (
          <label key={key} htmlFor={`${baseId}-${key}`}>
            <input
              id={`${baseId}-${key}`}
              type="checkbox"
              checked={currentTypes.includes(key)}
              onChange={(e) => toggle(key, e.target.checked)}
            />
            <span>
              {notificationTypeLabel(intl, key)}
              {MANAGER_NOTIFICATION_TYPES.includes(key) && (
                <small>{intl.formatMessage(messages.managerHint)}</small>
              )}
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p
          id={`${baseId}-err`}
          role="alert"
          className="mt-2 text-sm text-st-declined"
        >
          {error}
        </p>
      )}
    </fieldset>
  );
};

export default NotificationTypeSelector;
