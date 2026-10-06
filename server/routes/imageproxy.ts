// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import { getImageSource, isInternalSource } from '@server/lib/imageSources';
import logger from '@server/logger';
import { Router } from 'express';

const router = Router();

router.get<{
  type: string;
  path: string[];
}>('/:type/*path', async (req, res, next) => {
  const imagePath = '/' + req.params.path.join('/');

  // Reject absolute URLs, scheme smuggling, and any `..` path component. The
  // last is the important one: without it a path could escape a source's base
  // path and reach the rest of an internal host's API (e.g. Lidarr) with that
  // host's credentials attached.
  const hasTraversal = imagePath.split('/').some((part) => part === '..');
  if (imagePath.startsWith('//') || imagePath.includes('://') || hasTraversal) {
    logger.warn('Rejected image proxy path', { imagePath });
    return next({ status: 400, message: 'Invalid URL for image proxy.' });
  }

  const source = getImageSource(req.params.type);
  if (!source) {
    return next({ status: 400, message: 'Unsupported image type.' });
  }

  // Credentialed/internal sources are never served to anonymous callers; the
  // public cover-art CDNs stay open so the login slideshow can load art before
  // sign-in.
  if (isInternalSource(req.params.type) && !req.session?.userId) {
    return next({ status: 401, message: 'Authentication required.' });
  }

  try {
    const query = req.originalUrl.includes('?')
      ? req.originalUrl.slice(req.originalUrl.indexOf('?'))
      : '';
    const imageData = await source.getImage(imagePath + query);

    res.writeHead(200, {
      'Content-Type': `image/${imageData.meta.extension}`,
      'Content-Length': imageData.imageBuffer.length,
      'Cache-Control': `public, max-age=${imageData.meta.curRevalidate}`,
      'OS-Cache-Key': imageData.meta.cacheKey,
      'OS-Cache-Status': imageData.meta.cacheMiss ? 'MISS' : 'HIT',
    });

    res.end(imageData.imageBuffer);
  } catch (e) {
    // Missing art is normal (not every release group has a cover): 404 so the
    // UI falls back to its placeholder.
    logger.debug('Failed to proxy image', {
      imagePath,
      type: req.params.type,
      errorMessage: e.message,
    });
    if (!res.headersSent) {
      return next({ status: 404, message: 'Image not found.' });
    }
    next(e);
  }
});

export default router;
