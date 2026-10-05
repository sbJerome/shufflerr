// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import type { ButtonType } from '@app/components/Common/Button';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import { useLockBodyScroll } from '@app/hooks/useLockBodyScroll';
import globalMessages from '@app/i18n/globalMessages';
import { XMarkIcon } from '@heroicons/react/24/outline';
import type { MouseEvent } from 'react';
import React, { useEffect, useId, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useIntl } from 'react-intl';

interface ModalProps {
  title?: string;
  subTitle?: string;
  onCancel?: (e?: MouseEvent<HTMLElement>) => void;
  onOk?: (e?: MouseEvent<HTMLButtonElement>) => void;
  onSecondary?: (e?: MouseEvent<HTMLButtonElement>) => void;
  onTertiary?: (e?: MouseEvent<HTMLButtonElement>) => void;
  cancelText?: string;
  okText?: string;
  secondaryText?: string;
  tertiaryText?: string;
  okDisabled?: boolean;
  cancelButtonType?: ButtonType;
  okButtonType?: ButtonType;
  secondaryButtonType?: ButtonType;
  secondaryDisabled?: boolean;
  tertiaryDisabled?: boolean;
  tertiaryButtonType?: ButtonType;
  okButtonProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
  cancelButtonProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
  secondaryButtonProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
  tertiaryButtonProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
  disableScrollLock?: boolean;
  backgroundClickable?: boolean;
  loading?: boolean;
  /** Kept for API compatibility with Seerr; Shufflerr dialogs have no backdrop image. */
  backdrop?: string;
  children?: React.ReactNode;
  dialogClass?: string;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

const Modal = React.forwardRef<HTMLDivElement, ModalProps>(
  (
    {
      title,
      subTitle,
      onCancel,
      onOk,
      cancelText,
      okText,
      okDisabled = false,
      cancelButtonType = 'default',
      okButtonType = 'primary',
      children,
      disableScrollLock,
      backgroundClickable = true,
      secondaryButtonType = 'default',
      secondaryDisabled = false,
      onSecondary,
      secondaryText,
      tertiaryButtonType = 'default',
      tertiaryDisabled = false,
      tertiaryText,
      loading = false,
      onTertiary,
      dialogClass,
      okButtonProps,
      cancelButtonProps,
      secondaryButtonProps,
      tertiaryButtonProps,
    },
    parentRef
  ) => {
    const intl = useIntl();
    const headingId = useId();
    const dialogRef = useRef<HTMLDivElement>(null);
    const cancelRef = useRef(onCancel);
    useEffect(() => {
      cancelRef.current = onCancel;
    }, [onCancel]);
    useLockBodyScroll(true, disableScrollLock);

    // Focus the dialog on open, restore focus on close, trap Tab, close on Esc.
    useEffect(() => {
      const previous = document.activeElement as HTMLElement | null;
      const dialog = dialogRef.current;
      const first = dialog?.querySelector<HTMLElement>(
        'input:not([disabled]):not([type="hidden"]),select,textarea'
      );
      (first ?? dialog)?.focus({ preventScroll: true });

      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && cancelRef.current) {
          e.stopPropagation();
          cancelRef.current();
          return;
        }
        if (e.key !== 'Tab' || !dialog) return;
        const items = Array.from(
          dialog.querySelectorAll<HTMLElement>(FOCUSABLE)
        ).filter((el) => el.offsetParent !== null);
        if (!items.length) return;
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      };
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('keydown', onKey);
        previous?.focus?.({ preventScroll: true });
      };
    }, []);

    const hasFooter = onCancel || onOk || onSecondary || onTertiary;

    return ReactDOM.createPortal(
      // Backdrop click closes; Esc and the close button are the keyboard paths.
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions
      <div
        className="sh-overlay"
        ref={parentRef}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && onCancel && backgroundClickable) {
            onCancel();
          }
        }}
      >
        {loading ? (
          <div className="self-center">
            <LoadingSpinner />
          </div>
        ) : (
          <div
            className={`sh-dialog ${dialogClass ?? ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title || subTitle ? headingId : undefined}
            tabIndex={-1}
            ref={dialogRef}
          >
            {(title || subTitle || onCancel) && (
              <header>
                <div className="min-w-0">
                  <h2 id={headingId} data-testid="modal-title">
                    {title ?? subTitle}
                  </h2>
                  {title && subTitle && <p className="sh-sub">{subTitle}</p>}
                </div>
                {typeof onCancel === 'function' && (
                  <button
                    type="button"
                    className="sh-icon-btn"
                    aria-label={intl.formatMessage(globalMessages.close)}
                    onClick={onCancel}
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                )}
              </header>
            )}
            {children && <div className="body">{children}</div>}
            {hasFooter && (
              <footer>
                {typeof onCancel === 'function' && (
                  <Button
                    buttonType={cancelButtonType}
                    onClick={onCancel}
                    data-testid="modal-cancel-button"
                    {...cancelButtonProps}
                  >
                    {cancelText
                      ? cancelText
                      : intl.formatMessage(globalMessages.cancel)}
                  </Button>
                )}
                {typeof onTertiary === 'function' && tertiaryText && (
                  <Button
                    buttonType={tertiaryButtonType}
                    onClick={onTertiary}
                    disabled={tertiaryDisabled}
                    {...tertiaryButtonProps}
                  >
                    {tertiaryText}
                  </Button>
                )}
                {typeof onSecondary === 'function' && secondaryText && (
                  <Button
                    buttonType={secondaryButtonType}
                    onClick={onSecondary}
                    disabled={secondaryDisabled}
                    data-testid="modal-secondary-button"
                    {...secondaryButtonProps}
                  >
                    {secondaryText}
                  </Button>
                )}
                {typeof onOk === 'function' && (
                  <Button
                    buttonType={okButtonType}
                    onClick={onOk}
                    disabled={okDisabled}
                    data-testid="modal-ok-button"
                    {...okButtonProps}
                  >
                    {okText ? okText : 'OK'}
                  </Button>
                )}
              </footer>
            )}
          </div>
        )}
      </div>,
      document.body
    );
  }
);

Modal.displayName = 'Modal';

export default Modal;
