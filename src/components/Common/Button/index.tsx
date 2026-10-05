// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import type { ForwardedRef, JSX } from 'react';
import React from 'react';

export type ButtonType =
  | 'default'
  | 'primary'
  | 'danger'
  | 'warning'
  | 'success'
  | 'ghost'
  | 'accent';

// Helper type to override types (overrides onClick)
type MergeElementProps<
  T extends React.ElementType,
  P extends Record<string, unknown>,
> = Omit<React.ComponentProps<T>, keyof P> & P;

type ElementTypes = 'button' | 'a';

type Element<P extends ElementTypes = 'button'> = P extends 'a'
  ? HTMLAnchorElement
  : HTMLButtonElement;

type BaseProps<P> = {
  buttonType?: ButtonType;
  buttonSize?: 'default' | 'lg' | 'md' | 'sm';
  // Had to do declare this manually as typescript would assume e was of type any otherwise
  onClick?: (
    e: React.MouseEvent<P extends 'a' ? HTMLAnchorElement : HTMLButtonElement>
  ) => void;
};

type ButtonProps<P extends React.ElementType> = {
  as?: P;
} & MergeElementProps<P, BaseProps<P>>;

function Button<P extends ElementTypes = 'button'>(
  {
    buttonType = 'default',
    buttonSize = 'default',
    as,
    children,
    className,
    ...props
  }: ButtonProps<P>,
  ref?: React.Ref<Element<P>>
): JSX.Element {
  const buttonStyle = ['sh-btn whitespace-nowrap'];
  switch (buttonType) {
    case 'primary':
      buttonStyle.push('primary');
      break;
    case 'danger':
      buttonStyle.push('danger');
      break;
    case 'warning':
      buttonStyle.push('border-st-pending text-st-pending');
      break;
    case 'success':
      buttonStyle.push('ok');
      break;
    case 'accent':
      buttonStyle.push('ghost-accent');
      break;
    case 'ghost':
    default:
      break;
  }

  switch (buttonSize) {
    case 'sm':
      buttonStyle.push('small button-sm');
      break;
    case 'lg':
      buttonStyle.push('min-h-[52px] text-[15px] button-lg');
      break;
    case 'md':
    default:
      buttonStyle.push('button-md');
  }

  buttonStyle.push(className ?? '');

  if (as === 'a') {
    return (
      <a
        className={buttonStyle.join(' ')}
        {...(props as React.ComponentProps<'a'>)}
        ref={ref as ForwardedRef<HTMLAnchorElement>}
      >
        <span className="flex items-center gap-2">{children}</span>
      </a>
    );
  } else {
    return (
      <button
        className={buttonStyle.join(' ')}
        {...(props as React.ComponentProps<'button'>)}
        ref={ref as ForwardedRef<HTMLButtonElement>}
      >
        <span className="flex items-center gap-2">{children}</span>
      </button>
    );
  }
}

export default React.forwardRef(Button) as typeof Button;
