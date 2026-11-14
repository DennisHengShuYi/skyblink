import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOURS, ACTIONS, validateTour } from '../../frontend/js/tours.js';

const SLUGS = ['wise0855', 'barnard', 'epsindib', 'rwaur', 'rdra'];

test('every featured target has a valid 4-6 step tour', () => {
  SLUGS.forEach((slug) => {
    const steps = TOURS[slug];
    assert.ok(Array.isArray(steps), slug);
    assert.ok(steps.length >= 4 && steps.length <= 6, `${slug}: ${steps.length}`);
    assert.deepEqual(validateTour(steps), [], slug);
  });
});

test('every step has text and a known action', () => {
  Object.values(TOURS).flat().forEach((s) => {
    assert.ok(s.text && s.text.length > 0);
    if (s.action) assert.ok(ACTIONS.includes(s.action.type), s.action.type);
  });
});

test('validateTour reports an unknown action and an empty text as two problems', () => {
  assert.equal(validateTour([{ text: '', action: { type: 'fly' } }]).length, 2);
});

test('frame steps must use whole-number positions', () => {
  assert.equal(validateTour([{ text: 'x', action: { type: 'frame', index: 1.5 } }]).length, 1);
  assert.equal(validateTour([{ text: 'x', action: { type: 'frame', index: 2 } }]).length, 0);
});
