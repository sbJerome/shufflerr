import { useId } from 'react';

interface FieldProps {
  label: React.ReactNode;
  /** Help text under the control. */
  hint?: React.ReactNode;
  /** Validation message; says what happened and how to fix it. */
  error?: React.ReactNode;
  /** Span every column of the surrounding `sh-fields` grid. */
  full?: boolean;
  required?: boolean;
  className?: string;
  /**
   * The control. Either a node, or a render function that receives the ids to
   * wire up: `(p) => <input {...p} />`.
   */
  children:
    | React.ReactNode
    | ((props: {
        id: string;
        'aria-describedby'?: string;
        'aria-invalid'?: boolean;
      }) => React.ReactNode);
}

/** Labelled form control. Place several inside `<div className="sh-fields">`. */
const Field = ({
  label,
  hint,
  error,
  full,
  required,
  className,
  children,
}: FieldProps) => {
  const id = useId();
  const describedBy =
    [hint ? `${id}-h` : '', error ? `${id}-e` : ''].filter(Boolean).join(' ') ||
    undefined;

  return (
    <div className={`sh-field ${full ? 'full' : ''} ${className ?? ''}`}>
      <label htmlFor={id}>
        {label}
        {required && <span className="label-required">*</span>}
      </label>
      {typeof children === 'function'
        ? children({
            id,
            'aria-describedby': describedBy,
            'aria-invalid': error ? true : undefined,
          })
        : children}
      {hint && (
        <span className="hint" id={`${id}-h`}>
          {hint}
        </span>
      )}
      {error && (
        <p className="err" id={`${id}-e`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
};

export default Field;
