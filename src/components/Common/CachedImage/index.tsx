// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import { avatarUrl, proxied } from '@app/utils/images';
import type { ImageLoader, ImageProps } from 'next/image';
import Image from 'next/image';

const imageLoader: ImageLoader = ({ src }) => src;

export type CachedImageProps = ImageProps & {
  src: string;
  /**
   * `cover` / `artist`: any image URL the API returned (rewritten to the image
   * proxy when it is an absolute third-party URL). `avatar`: a user avatar.
   */
  type: 'cover' | 'artist' | 'avatar';
};

/**
 * next/image wrapper that only ever loads same-origin (proxied) images.
 * For album and artist art prefer `CoverArt`, which adds the tinted
 * placeholder and status badge.
 **/
const CachedImage = ({ src, type, alt, ...props }: CachedImageProps) => {
  const imageUrl = type === 'avatar' ? avatarUrl(src) : proxied(src);

  if (!imageUrl) {
    return null;
  }

  return (
    <Image
      unoptimized
      loader={imageLoader}
      src={imageUrl}
      alt={alt}
      {...props}
    />
  );
};

export default CachedImage;
