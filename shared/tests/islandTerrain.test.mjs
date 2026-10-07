import test from 'node:test';
import assert from 'node:assert/strict';
import { ISLAND_BASE, ISLAND_HILL_POSTS, ISLAND_HELIPAD, ISLAND_RADIUS_X, ISLAND_RADIUS_Z, ISLAND_HARBOR, islandHeight, islandShoreRadius } from '../dist/world/islandTerrain.js';

test('the reference landform has a deep bay, a low headland and two broad eastern summits', () => {
  assert.ok(ISLAND_RADIUS_X / ISLAND_RADIUS_Z > 2, 'the island must have an elongated footprint');
  assert.ok(islandShoreRadius(-Math.PI / 2) < .4, 'the lagoon must cut deeply into the southern coast');
  assert.ok(islandHeight(0, -180) < 0, 'lagoon water must be below sea level');
  const lowHeadland = islandHeight(-435, -45);
  for (const [x, z] of [[245, 137], [438, 34]]) {
    const summit = islandHeight(x, z);
    assert.ok(summit > lowHeadland + 100 && summit < 300);
    assert.ok(Math.abs(summit - islandHeight(x + 15, z)) < 20, 'summit crowns should be broad, not pointed spikes');
  }
  assert.ok(Number.isFinite(ISLAND_HARBOR.shoreZ));
  assert.ok(islandHeight(ISLAND_HARBOR.x, ISLAND_HARBOR.shoreZ) > 0, 'the pier must join dry land');
  const base = islandHeight(ISLAND_BASE.x, ISLAND_BASE.z);
  assert.equal(islandHeight(ISLAND_BASE.x + 65, ISLAND_BASE.z + 45), base);
});

test('coastal shaping remains continuous at the island origin', () => {
  const center = islandHeight(0, 0);
  for (let index = 0; index < 64; index++) {
    const angle = index / 64 * Math.PI * 2;
    assert.ok(Math.abs(islandHeight(Math.cos(angle) * .001, Math.sin(angle) * .001) - center) < .01);
  }
});

test('both summit posts and the separate helipad have level ground with continuous terrace edges', () => {
  for (const site of [...ISLAND_HILL_POSTS, ISLAND_HELIPAD]) {
    const ground = islandHeight(site.x, site.z);
    assert.ok(ground > (site === ISLAND_HELIPAD ? 20 : 180));
    for (const dx of [-site.halfX, 0, site.halfX]) {
      for (const dz of [-site.halfZ, 0, site.halfZ]) {
        assert.ok(Math.abs(islandHeight(site.x + dx, site.z + dz) - ground) < 1e-8,
          'buildings and landing surfaces need level foundations');
      }
    }
    for (const direction of [-1, 1]) {
      const edgeX = site.x + direction * site.halfX;
      assert.ok(Math.abs(islandHeight(edgeX - .001, site.z) - islandHeight(edgeX + .001, site.z)) < .01);
    }
  }
  assert.ok(ISLAND_HELIPAD.x - ISLAND_HELIPAD.halfX > ISLAND_BASE.x + 78 + 20,
    'the aviation clearing must have separation from the lower compound');
});
