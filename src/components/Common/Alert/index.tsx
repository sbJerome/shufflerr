// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import {
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/solid';

interface AlertProps {
  title?: React.ReactNode;
  type?: 'warning' | 'info' | 'error';
  children?: React.ReactNode;
}

const Alert = ({ title, children, type }: AlertProps) => {
  let design = {
    bgColor: 'border border-st-pending bg-st-pending/10',
    titleColor: 'text-st-pending',
    textColor: 'text-ink',
    svg: <ExclamationTriangleIcon className="h-5 w-5" />,
  };

  switch (type) {
    case 'info':
      design = {
        bgColor: 'border border-line-2 bg-hover',
        titleColor: 'text-ink',
        textColor: 'text-muted',
        svg: <InformationCircleIcon className="h-5 w-5" />,
      };
      break;
    case 'error':
      design = {
        bgColor: 'border border-st-declined bg-st-declined/10',
        titleColor: 'text-st-declined',
        textColor: 'text-ink',
        svg: <XCircleIcon className="h-5 w-5" />,
      };
      break;
  }

  return (
    <div
      className={`mb-4 rounded-pill p-4 ${design.bgColor}`}
      role={type === 'error' ? 'alert' : 'status'}
    >
      <div className="flex">
        <div className={`flex-shrink-0 ${design.titleColor}`}>{design.svg}</div>
        <div className="ml-3">
          {title && (
            <div className={`text-sm font-medium ${design.titleColor}`}>
              {title}
            </div>
          )}
          {children && (
            <div className={`mt-2 text-sm first:mt-0 ${design.textColor}`}>
              {children}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Alert;
