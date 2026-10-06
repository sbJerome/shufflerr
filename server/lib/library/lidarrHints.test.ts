import { withLidarrHint } from '@server/lib/library/lidarrHints';
import type { ScannedAlbum } from '@server/lib/library/types';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const scanned: ScannedAlbum = {
  source: 'local',
  sourceAlbumId: 'local:/music/Artist/Album (2020)',
  artistName: 'Artist',
  albumTitle: 'Album (Regional Edition)',
  localPath: '/music/Artist/Album (2020)',
  tracks: [
    {
      sourceId: '/music/Artist/Album (2020)/01 - One.flac',
      title: 'One',
      trackNumber: 1,
    },
    {
      sourceId: '/music/Artist/Album (2020)/02 - Two.flac',
      title: 'Two',
      trackNumber: 2,
      recordingMbid: 'keep-this-id',
    },
    {
      sourceId: '/music/Artist/Album (2020)/03 - Three.flac',
      title: 'Three',
      trackNumber: 3,
    },
  ],
};

describe('withLidarrHint', () => {
  it('fills the release group, edition and per-file recording ids', () => {
    const result = withLidarrHint(scanned, {
      releaseGroupMbid: 'rg-1',
      releaseMbid: 'rel-1',
      recordings: new Map([
        ['01 - one.flac', 'rec-1'],
        ['02 - two.flac', 'rec-2'],
      ]),
    });
    assert.equal(result.releaseGroupMbid, 'rg-1');
    assert.equal(result.releaseMbid, 'rel-1');
    assert.equal(result.tracks[0].recordingMbid, 'rec-1');
    // ids the tags already carry win over the hint
    assert.equal(result.tracks[1].recordingMbid, 'keep-this-id');
    // files Lidarr does not know stay unmatched rather than guessed
    assert.equal(result.tracks[2].recordingMbid, null);
  });

  it('does not change the scanned album it was given', () => {
    withLidarrHint(scanned, {
      releaseGroupMbid: 'rg-1',
      recordings: new Map(),
    });
    assert.equal(scanned.releaseGroupMbid, undefined);
    assert.equal(scanned.tracks[0].recordingMbid, undefined);
  });
});
