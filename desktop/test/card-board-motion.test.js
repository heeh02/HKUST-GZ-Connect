'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const motion = require('../renderer/components/card-board/card-board-motion');

function fixture({ reduced = false } = {}) {
  const animations = [];
  const card = {
    dataset: { cardPlacementId: 'placement-a' },
    getBoundingClientRect: () => ({ left: 80, top: 120, width: 200, height: 44 }),
    animate: (frames, options) => animations.push({ frames, options }),
  };
  const ownerWindow = {
    innerHeight: 900,
    matchMedia: () => ({ matches: reduced }),
    requestAnimationFrame: (callback) => { callback(); return 1; },
  };
  const container = {
    ownerDocument: { defaultView: ownerWindow },
    getBoundingClientRect: () => ({ top: 180 }),
    querySelectorAll: () => [card],
  };
  return { animations, card, container };
}

test('available card-board height is measured below the board instead of from its content height', () => {
  const { container } = fixture();
  assert.equal(motion.availableHeight(container), 692);
});

test('FLIP draws an existing card from its prior position with the approved timing', () => {
  const { animations, container } = fixture();
  const previous = new Map([['placement-a', { left: 20, top: 40, width: 200, height: 44 }]]);
  assert.equal(motion.animateFrom(container, previous), true);
  assert.equal(animations.length, 1);
  assert.deepEqual(animations[0].frames[0], {
    transform: 'translate(-60px, -80px)', opacity: .82,
  });
  assert.equal(animations[0].options.duration, 250);
});

test('Reduced Motion skips positional card animation', () => {
  const { animations, container } = fixture({ reduced: true });
  const previous = new Map([['placement-a', { left: 20, top: 40 }]]);
  assert.equal(motion.animateFrom(container, previous), false);
  assert.equal(animations.length, 0);
});

test('a drawn card scrolls into the nearest visible area and respects Reduced Motion', () => {
  const { card, container } = fixture({ reduced: true });
  let options = null;
  card.scrollIntoView = (value) => { options = value; };
  assert.equal(motion.scrollPlacementIntoView(container, 'placement-a'), true);
  assert.deepEqual(options, { block: 'nearest', behavior: 'auto' });
  assert.equal(motion.scrollPlacementIntoView(container, 'missing'), false);
});
