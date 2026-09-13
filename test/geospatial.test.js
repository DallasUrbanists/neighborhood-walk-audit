import assert from 'node:assert/strict';
import test from 'node:test';
import { networkFromOverpass, validateStudyArea } from '../src/geospatial.js';
import { createStudyThumbnail } from '../src/thumbnail.js';

const area = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [-96.81, 32.77],
      [-96.79, 32.77],
      [-96.79, 32.79],
      [-96.81, 32.79],
      [-96.81, 32.77]
    ]]
  }
};

const overpass = {
  elements: [
    { type: 'node', id: 1, lat: 32.78, lon: -96.808 },
    { type: 'node', id: 2, lat: 32.78, lon: -96.80 },
    { type: 'node', id: 3, lat: 32.78, lon: -96.792 },
    { type: 'node', id: 4, lat: 32.772, lon: -96.80 },
    { type: 'node', id: 5, lat: 32.788, lon: -96.80 },
    { type: 'way', id: 100, nodes: [1, 2, 3], tags: { highway: 'residential', name: 'Main Street' } },
    { type: 'way', id: 200, nodes: [4, 2, 5], tags: { highway: 'residential', name: 'Oak Avenue' } }
  ]
};

test('validates and closes an open study polygon', () => {
  const openArea = structuredClone(area);
  openArea.geometry.coordinates[0].pop();
  const result = validateStudyArea(openArea);
  assert.deepEqual(result.geometry.coordinates[0][0], result.geometry.coordinates[0].at(-1));
});

test('turns Overpass ways into intersections and split segments', () => {
  const network = networkFromOverpass(overpass, area);
  assert.equal(network.intersections.features.length, 1);
  assert.equal(network.intersections.features[0].properties.description, 'Intersection of Main Street and Oak Avenue');
  assert.equal(network.segments.features.length, 4);
  assert.ok(network.segments.features.every((feature) => feature.geometry.type === 'LineString'));
});

test('creates a valid PNG study thumbnail', () => {
  const network = networkFromOverpass(overpass, area);
  const png = createStudyThumbnail(area, network.segments);
  assert.ok(Buffer.isBuffer(png));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.length > 1000);
});
