export interface FilterChip<T extends string> {
  value: T;
  label: React.ReactNode;
  /** Count shown after the label in mono. */
  count?: number;
}

interface FilterChipsProps<T extends string> {
  chips: FilterChip<T>[];
  value: T;
  onChange: (value: T) => void;
  'aria-label': string;
}

/** Single-select filter chips with optional counts. */
function FilterChips<T extends string>({
  chips,
  value,
  onChange,
  ...props
}: FilterChipsProps<T>) {
  return (
    <div className="sh-chips" role="group" aria-label={props['aria-label']}>
      {chips.map((chip) => (
        <button
          key={chip.value}
          type="button"
          className="sh-chip"
          aria-pressed={chip.value === value}
          onClick={() => onChange(chip.value)}
        >
          {chip.label}
          {chip.count != null && <span className="n">{chip.count}</span>}
        </button>
      ))}
    </div>
  );
}

export default FilterChips;
