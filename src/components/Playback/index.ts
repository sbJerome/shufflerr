/**
 * Glue between browse pages and the player: turn API tracks into
 * `PlayableTrack`s, play a whole album from its MBID, and fall back to
 * YouTube's own player for tracks that have no file yet.
 */
import usePlayer from '@app/hooks/usePlayer';
import type { PlayableTrack } from '@app/hooks/usePlayer';
import useSettings from '@app/hooks/useSettings';
import { useToasts } from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import type { YoutubeTrackResponse } from '@server/interfaces/api/playbackInterfaces';
import type { AlbumDetails, AlbumTrack } from '@server/models/music';
import axios from 'axios';
import { useCallback } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Playback', {
  nothingplayable:
    'None of these tracks are in the library yet. Request the album to hear it.',
  playfailed: 'That couldn’t be played. Try again in a moment.',
  noyoutube: 'YouTube has no match for this track.',
});

interface AlbumContext {
  mbid: string;
  title: string;
  artistMbid?: string;
}

/** A library track from an album page as the player wants it. */
export const toPlayable = (
  track: AlbumTrack,
  album: AlbumContext
): PlayableTrack | null => {
  if (!track.playable || !track.id) {
    return null;
  }
  return {
    id: track.id,
    title: track.title,
    artist: track.artistCredit,
    album: album.title,
    albumMbid: album.mbid,
    artistMbid: album.artistMbid,
    recordingMbid: track.recordingMbid ?? undefined,
    durationMs: track.lengthMs ?? undefined,
    source: track.sources?.[0],
  };
};

export const playableTracks = (album: AlbumDetails): PlayableTrack[] =>
  album.tracks
    .map((track) => toPlayable(track, album))
    .filter((track): track is PlayableTrack => track !== null);

export interface YoutubeLookup {
  recordingMbid: string;
  title: string;
  artist: string;
  album?: string;
  albumMbid?: string;
  artistMbid?: string;
  durationMs?: number | null;
}

/**
 * Playback actions for pages. Everything plays real library audio; the
 * YouTube path only hands a video id to YouTube's own IFrame player.
 */
export const usePlayback = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const player = usePlayer();
  const { currentSettings } = useSettings();
  const youtubeEnabled = !!currentSettings.integrations?.youtube;

  /** Play every library track of an album, optionally starting at one Track id. */
  const playAlbum = useCallback(
    async (mbid: string, startTrackId?: number) => {
      try {
        const { data } = await axios.get<AlbumDetails>(`/api/v1/album/${mbid}`);
        const tracks = playableTracks(data);
        if (!tracks.length) {
          addToast(intl.formatMessage(messages.nothingplayable), {
            appearance: 'error',
          });
          return;
        }
        const start = startTrackId
          ? Math.max(
              0,
              tracks.findIndex((t) => t.id === startTrackId)
            )
          : 0;
        player.playTracks(tracks, start);
      } catch {
        addToast(intl.formatMessage(messages.playfailed), {
          appearance: 'error',
        });
      }
    },
    [addToast, intl, player]
  );

  /** Play a track that has no file through YouTube's player (when the integration is on). */
  const playOnYoutube = useCallback(
    async (lookup: YoutubeLookup) => {
      try {
        const { data } = await axios.get<YoutubeTrackResponse>(
          `/api/v1/youtube/track/${lookup.recordingMbid}`,
          { params: { artist: lookup.artist, title: lookup.title } }
        );
        if (!data.enabled || !data.videoId) {
          addToast(intl.formatMessage(messages.noyoutube), {
            appearance: 'error',
          });
          return;
        }
        player.playTracks(
          [
            {
              id: 0,
              title: lookup.title,
              artist: lookup.artist,
              album: lookup.album,
              albumMbid: lookup.albumMbid,
              artistMbid: lookup.artistMbid,
              recordingMbid: lookup.recordingMbid,
              durationMs: lookup.durationMs ?? undefined,
              source: 'youtube',
              youtubeVideoId: data.videoId,
            },
          ],
          0
        );
      } catch {
        addToast(intl.formatMessage(messages.noyoutube), {
          appearance: 'error',
        });
      }
    },
    [addToast, intl, player]
  );

  return {
    playAlbum,
    playOnYoutube,
    playTracks: player.playTracks,
    youtubeEnabled,
  };
};

export default usePlayback;
