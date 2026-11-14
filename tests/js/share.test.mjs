import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, cardCaption } from '../../frontend/js/share-text.js';

test('file names', () => {
  assert.equal(slugify("Barnard's Star"), 'barnards-star');
  assert.equal(slugify(''), 'skyblink');
  assert.equal(slugify('x'.repeat(100)).length, 40);
  assert.equal(slugify('Épsilon Índi B ★'), 'epsilon-indi-b');
});

test('captions', () => {
  assert.equal(cardCaption({ title: "Barnard's Star", kind: 'motion' }), "I watched Barnard's Star move across the sky!");
  assert.equal(cardCaption({ title: 'R Draconis', kind: 'variable' }), 'I watched R Draconis change brightness!');
  assert.equal(cardCaption({ title: 'M101' }), 'I explored M101 with NASA SPHEREx.');
});
