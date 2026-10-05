// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
type SlideCheckboxProps = {
  onClick: () => void;
  checked?: boolean;
  'aria-label'?: string;
};

/** Seerr's slide checkbox, now the Shufflerr switch (button with aria-pressed). */
const SlideCheckbox = ({
  onClick,
  checked = false,
  ...props
}: SlideCheckboxProps) => {
  return (
    <button
      type="button"
      className="sh-switch"
      aria-pressed={checked}
      aria-label={props['aria-label']}
      onClick={() => onClick()}
    >
      <span />
    </button>
  );
};

export default SlideCheckbox;
