import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderFrames, timePositions, nextIndex, windowStarts } from '../../frontend/js/frames.js';
import { frameTitle } from '../../frontend/js/ui.js';

const visits = [
  { i: 0, mjd: 30, um: 4.6, window: 1, date: '2025-11-01T00:00:00' },
  { i: 1, mjd: 10, um: 4.9, window: 0, date: '2025-05-01T00:00:00' },
  { i: 2, mjd: 20, um: 4.5, window: 0, date: '2025-05-02T00:00:00' },
];

test('frames sort by time or by wavelength without mutating the input', () => {
  const copy = visits.slice();
  assert.deepEqual(orderFrames(visits, 'time').map((f) => f.i), [1, 2, 0]);
  assert.deepEqual(orderFrames(visits, 'wavelength').map((f) => f.i), [2, 0, 1]);
  assert.deepEqual(visits, copy);
});

test('time positions are proportional to MJD', () => {
  assert.deepEqual(timePositions([{ mjd: 0 }, { mjd: 5 }, { mjd: 10 }]), [0, 0.5, 1]);
  assert.deepEqual(timePositions([{ mjd: 3 }]), [0.5]);
});

test('next index: loop wraps, bounce reverses, once stops at the end', () => {
  assert.deepEqual(nextIndex(2, 3, 'loop', 1), { index: 0, dir: 1, stop: false });
  assert.deepEqual(nextIndex(2, 3, 'bounce', 1), { index: 1, dir: -1, stop: false });
  assert.deepEqual(nextIndex(0, 3, 'bounce', -1), { index: 1, dir: 1, stop: false });
  assert.deepEqual(nextIndex(2, 3, 'once', 1), { index: 2, dir: 1, stop: true });
  assert.deepEqual(nextIndex(0, 3, 'once', 1), { index: 1, dir: 1, stop: false });
});

test('window starts mark the first frame of each survey window', () => {
  const view = { windows: [{ id: 0, label: '2025-05' }, { id: 1, label: '2025-11' }] };
  const sorted = orderFrames(visits, 'time');
  assert.deepEqual(windowStarts(sorted, view), [{ index: 0, label: '2025-05' }, { index: 2, label: '2025-11' }]);
});

test('every-image frame titles include the wavelength', () => {
  const t = frameTitle(visits[0], 'visits', {}, 0, 3);
  assert.match(t, /4\.600 µm/);
});
