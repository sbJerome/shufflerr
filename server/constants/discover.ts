// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import type DiscoverSlider from '@server/entity/DiscoverSlider';

export enum DiscoverSliderType {
  RECENTLY_ADDED = 1,
  RECENT_REQUESTS,
  TRENDING_LISTENBRAINZ,
  POPULAR_ARTISTS,
  ITUNES_CHART,
  NEW_FROM_FOLLOWED,
  CONCERTS,
  GENRE,
  LABEL,
}

export const defaultSliders: Partial<DiscoverSlider>[] = [
  {
    type: DiscoverSliderType.RECENTLY_ADDED,
    enabled: true,
    isBuiltIn: true,
    order: 0,
  },
  {
    type: DiscoverSliderType.TRENDING_LISTENBRAINZ,
    enabled: true,
    isBuiltIn: true,
    order: 1,
  },
  {
    type: DiscoverSliderType.POPULAR_ARTISTS,
    enabled: true,
    isBuiltIn: true,
    order: 2,
  },
  {
    type: DiscoverSliderType.CONCERTS,
    enabled: true,
    isBuiltIn: true,
    order: 3,
  },
  {
    type: DiscoverSliderType.RECENT_REQUESTS,
    enabled: true,
    isBuiltIn: true,
    order: 4,
  },
  {
    type: DiscoverSliderType.ITUNES_CHART,
    enabled: false,
    isBuiltIn: true,
    order: 5,
  },
  {
    type: DiscoverSliderType.NEW_FROM_FOLLOWED,
    enabled: false,
    isBuiltIn: true,
    order: 6,
  },
];
