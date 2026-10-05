import { hasPermission, Permission } from '@server/lib/permissions';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('hasPermission', () => {
  it('passes Permission.NONE for anyone', () => {
    assert.equal(hasPermission(Permission.NONE, 0), true);
    assert.equal(hasPermission(0, Permission.REQUEST), true);
  });

  it('lets ADMIN pass every check', () => {
    assert.equal(
      hasPermission(Permission.MANAGE_SETTINGS, Permission.ADMIN),
      true
    );
    assert.equal(
      hasPermission(
        [Permission.MANAGE_USERS, Permission.MANAGE_REQUESTS],
        Permission.ADMIN,
        { type: 'and' }
      ),
      true
    );
    assert.equal(
      hasPermission([Permission.REQUEST_HIRES], Permission.ADMIN, {
        type: 'or',
      }),
      true
    );
  });

  it('checks a single permission bit', () => {
    assert.equal(hasPermission(Permission.REQUEST, Permission.REQUEST), true);
    assert.equal(
      hasPermission(Permission.REQUEST, Permission.REQUEST_ALBUM),
      false
    );
    assert.equal(
      hasPermission(Permission.MANAGE_USERS, Permission.MANAGE_REQUESTS),
      false
    );
  });

  it("requires every permission with 'and' (the default)", () => {
    const value = Permission.REQUEST | Permission.AUTO_APPROVE_TRACK;
    assert.equal(
      hasPermission([Permission.REQUEST, Permission.AUTO_APPROVE_TRACK], value),
      true
    );
    assert.equal(
      hasPermission([Permission.REQUEST, Permission.AUTO_APPROVE_ALBUM], value),
      false
    );
  });

  it("requires any permission with 'or'", () => {
    const value = Permission.REQUEST_ALBUM;
    assert.equal(
      hasPermission([Permission.REQUEST, Permission.REQUEST_ALBUM], value, {
        type: 'or',
      }),
      true
    );
    assert.equal(
      hasPermission([Permission.REQUEST, Permission.REQUEST_TRACK], value, {
        type: 'or',
      }),
      false
    );
  });

  it('keeps the music request bits distinct', () => {
    const bits = [
      Permission.REQUEST,
      Permission.REQUEST_ALBUM,
      Permission.REQUEST_TRACK,
      Permission.REQUEST_DISCOGRAPHY,
      Permission.AUTO_APPROVE,
      Permission.AUTO_APPROVE_ALBUM,
      Permission.AUTO_APPROVE_TRACK,
      Permission.AUTO_APPROVE_DISCOGRAPHY,
      Permission.REQUEST_ADVANCED,
      Permission.REQUEST_VIEW,
      Permission.RECENT_VIEW,
      Permission.AUTO_REQUEST,
    ];
    // every bit is a single power of two and none collide
    assert.equal(new Set(bits).size, bits.length);
    for (const bit of bits) {
      assert.equal(bit & (bit - 1), 0);
    }
    // discography permission does not imply album permission
    assert.equal(
      hasPermission(Permission.REQUEST_ALBUM, Permission.REQUEST_DISCOGRAPHY),
      false
    );
  });

  it('default permissions (544) are REQUEST + AUTO_APPROVE_TRACK', () => {
    const value = 544;
    assert.equal(hasPermission(Permission.REQUEST, value), true);
    assert.equal(hasPermission(Permission.AUTO_APPROVE_TRACK, value), true);
    assert.equal(hasPermission(Permission.AUTO_APPROVE_ALBUM, value), false);
    assert.equal(hasPermission(Permission.MANAGE_REQUESTS, value), false);
  });

  it('stays inside 32-bit signed integer range', () => {
    const all = Object.values(Permission)
      .filter((v): v is number => typeof v === 'number')
      .reduce((a, v) => a | v, 0);
    assert.ok(all > 0);
    assert.ok(all <= 0x7fffffff);
  });
});
