import assert from 'node:assert/strict';
import test from 'node:test';
import { enableMapPlacement } from '../public/map-placement.js';

function evented() {
  const listeners = new Map();
  return {
    on(names, callback) {
      for (const name of names.split(' ')) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(callback);
      }
    },
    off(names, callback) {
      for (const name of names.split(' ')) listeners.get(name)?.delete(callback);
    },
    fire(name, event = {}) { for (const callback of listeners.get(name) || []) callback(event); }
  };
}

function setup() {
  const container = new EventTarget();
  const map = Object.assign(evented(), { getContainer: () => container });
  const marker = evented();
  const selected = [];
  let intents = 0, enabled = true;
  const placement = enableMapPlacement(map, marker, {
    onSelect: latlng => selected.push(latlng),
    onIntent: () => { intents++; },
    canSelect: () => enabled
  });
  const click = (latlng = { lat: 1, lng: 2 }, originalEvent = {}) => map.fire('click', { latlng, originalEvent });
  const touch = (name, count) => {
    const event = new Event(name);
    Object.defineProperty(event, 'touches', { value: Array(count).fill({}) });
    container.dispatchEvent(event);
  };
  return { map, marker, container, selected, placement, click, touch, intents: () => intents, setEnabled: value => { enabled = value; } };
}

test('a single click places the pin after the double-click interval and can be flushed before saving', async () => {
  const fixture = setup();
  fixture.click();
  assert.equal(fixture.intents(), 1);
  assert.deepEqual(fixture.selected, []);
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.deepEqual(fixture.selected, [{ lat: 1, lng: 2 }]);
  fixture.click({ lat: 3, lng: 4 });
  fixture.placement.flush();
  assert.deepEqual(fixture.selected.at(-1), { lat: 3, lng: 4 });
  fixture.placement.dispose();
});

test('map gestures, multi-touch, marker dragging and teardown cancel placement', () => {
  const fixture = setup();
  for (const gesture of ['dragstart', 'zoomstart', 'dblclick']) {
    fixture.click();
    fixture.map.fire(gesture);
    fixture.placement.flush();
  }
  fixture.click();
  fixture.marker.fire('dragstart');
  fixture.placement.flush();
  fixture.click();
  fixture.click({ lat: 3, lng: 4 }, { detail: 2 });
  fixture.placement.flush();
  fixture.touch('touchstart', 1);
  fixture.click();
  fixture.touch('touchstart', 2);
  fixture.click();
  fixture.placement.flush();
  assert.deepEqual(fixture.selected, []);

  // A subsequent single touch is a new gesture and can place a pin.
  fixture.touch('touchstart', 1);
  fixture.click({ lat: 5, lng: 6 });
  fixture.placement.flush();
  assert.deepEqual(fixture.selected, [{ lat: 5, lng: 6 }]);
  fixture.click();
  fixture.setEnabled(false);
  fixture.placement.flush();
  fixture.placement.dispose();
  fixture.setEnabled(true);
  fixture.click();
  fixture.placement.flush();
  assert.deepEqual(fixture.selected, [{ lat: 5, lng: 6 }]);
});
