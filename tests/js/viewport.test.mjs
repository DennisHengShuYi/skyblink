import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fitViewport, zoomAt, panBy, gridToScreen, screenToGrid, MAX_ZOOM,
} from '../../frontend/js/viewport.js';

const P = 59;
const SIZE = 708;

test('fit viewport maps the grid edge-to-edge onto the canvas', () => {
  const vp = fitViewport(P);
  assert.deepEqual(gridToScreen(vp, P, SIZE, 0, 0), { x: 0, y: 0 });
  assert.deepEqual(gridToScreen(vp, P, SIZE, P, P), { x: SIZE, y: SIZE });
});

test('screen and grid coordinates round-trip at any zoom', () => {
  const vp = zoomAt(fitViewport(P), 3, 10, 40, P);
  const s = gridToScreen(vp, P, SIZE, 12.25, 33.5);
  const g = screenToGrid(vp, P, SIZE, s.x, s.y);
  assert.ok(Math.abs(g.x - 12.25) < 1e-9 && Math.abs(g.y - 33.5) < 1e-9);
});

test('zooming keeps the point under the cursor fixed (away from the edges)', () => {
  const vp0 = fitViewport(P);
  const vp = zoomAt(vp0, 2, 25, 30, P);
  const before = gridToScreen(vp0, P, SIZE, 25, 30);
  const after = gridToScreen(vp, P, SIZE, 25, 30);
  assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9);
});

test('zoom is clamped between fit and the maximum, and never shows outside the grid', () => {
  assert.equal(zoomAt(fitViewport(P), 0.1, 5, 5, P).z, 1);
  assert.equal(zoomAt(fitViewport(P), 1000, 5, 5, P).z, MAX_ZOOM);
  const vp = zoomAt(fitViewport(P), 4, 0, 0, P); // zoom on the corner
  const tl = screenToGrid(vp, P, SIZE, 0, 0);
  assert.ok(tl.x >= -1e-9 && tl.y >= -1e-9);
  const moved = panBy(vp, -100, -100, P);
  const tl2 = screenToGrid(moved, P, SIZE, 0, 0);
  assert.ok(tl2.x >= -1e-9 && tl2.y >= -1e-9);
});
