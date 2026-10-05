import { initials } from '@app/utils/format';
import { avatarUrl } from '@app/utils/images';
import { useEffect, useState } from 'react';

interface AvatarProps {
  /** Display name — used for the initials fallback. */
  name?: string | null;
  /** `user.avatar` as returned by the API. */
  src?: string | null;
  /** `sm` 32px (top bar, tables), `lg` 96px (profile header). */
  size?: 'sm' | 'lg';
  className?: string;
}

/** User avatar with initials fallback. Decorative: always pair with the name. */
const Avatar = ({ name, src, size = 'sm', className }: AvatarProps) => {
  const [failed, setFailed] = useState(false);
  const url = avatarUrl(src);
  useEffect(() => setFailed(false), [url]);

  return (
    <span
      className={`${size === 'lg' ? 'sh-avatar-lg' : 'sh-avatar'} ${className ?? ''}`}
      aria-hidden="true"
    >
      {url && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" onError={() => setFailed(true)} />
      ) : (
        initials(name)
      )}
    </span>
  );
};

export default Avatar;
