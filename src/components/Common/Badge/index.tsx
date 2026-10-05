// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import Link from 'next/link';
import React from 'react';

interface BadgeProps {
  badgeType?:
    | 'default'
    | 'primary'
    | 'danger'
    | 'warning'
    | 'success'
    | 'dark'
    | 'light';
  className?: string;
  href?: string;
  children: React.ReactNode;
}

const Badge = (
  { badgeType = 'default', className, href, children }: BadgeProps,
  ref?: React.Ref<HTMLElement>
) => {
  const badgeStyle = [
    'px-2.5 py-0.5 inline-flex items-center text-xs leading-5 font-semibold rounded-pill whitespace-nowrap',
  ];

  if (href) {
    badgeStyle.push('transition cursor-pointer !no-underline');
  } else {
    badgeStyle.push('cursor-default');
  }

  switch (badgeType) {
    case 'danger':
      badgeStyle.push('bg-hover !text-st-declined');
      break;
    case 'warning':
      badgeStyle.push('bg-hover !text-st-pending');
      break;
    case 'success':
      badgeStyle.push('bg-hover !text-st-available');
      break;
    case 'dark':
      badgeStyle.push('bg-bg !text-muted');
      break;
    case 'light':
      badgeStyle.push('bg-hover !text-muted');
      break;
    default:
      badgeStyle.push('bg-hover !text-accent');
  }
  if (href) {
    badgeStyle.push('hover:brightness-110');
  }

  if (className) {
    badgeStyle.push(className);
  }

  if (href?.includes('://')) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={badgeStyle.join(' ')}
        ref={ref as React.Ref<HTMLAnchorElement>}
      >
        {children}
      </a>
    );
  } else if (href) {
    return (
      <Link
        href={href}
        className={badgeStyle.join(' ')}
        ref={ref as React.Ref<HTMLAnchorElement>}
      >
        {children}
      </Link>
    );
  } else {
    return (
      <span
        className={badgeStyle.join(' ')}
        ref={ref as React.Ref<HTMLSpanElement>}
      >
        {children}
      </span>
    );
  }
};

export default React.forwardRef(Badge) as typeof Badge;
