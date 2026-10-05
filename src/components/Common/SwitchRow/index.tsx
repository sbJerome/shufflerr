import { useId } from 'react';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Accessible name when the switch is used without a visible label. */
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  id?: string;
}

/** Bare switch: a real button with `aria-pressed`, 52×44px hit area. */
export const Switch = ({
  checked,
  onChange,
  disabled,
  ...aria
}: SwitchProps) => (
  <button
    type="button"
    className="sh-switch"
    aria-pressed={checked}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    {...aria}
  >
    <span />
  </button>
);

interface SwitchRowProps {
  label: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/** Label + description on the left, switch on the right. Put several inside `<div className="sh-box">`. */
const SwitchRow = ({
  label,
  description,
  checked,
  onChange,
  disabled,
}: SwitchRowProps) => {
  const id = useId();
  return (
    <div className="sh-setting">
      <div className="grow">
        <b id={`${id}-l`}>{label}</b>
        {description && (
          <span className="d" id={`${id}-d`}>
            {description}
          </span>
        )}
      </div>
      <Switch
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        aria-labelledby={`${id}-l`}
        aria-describedby={description ? `${id}-d` : undefined}
      />
    </div>
  );
};

export default SwitchRow;
