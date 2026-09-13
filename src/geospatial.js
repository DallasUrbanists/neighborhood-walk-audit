import {
  area as turfArea,
  booleanPointInPolygon,
  centroid,
  featureCollection,
  lineString,
  point,
  polygon
} from '@turf/turf';

const WALK_AUDIT_HIGHWAYS = [
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link',
  'unclassified',
  'residential',
  'living_street',
  'service',
  'pedestrian'
];

export function validateStudyArea(input) {
  if (input?.type !== 'Feature' || input?.geometry?.type !== 'Polygon') {
    throw new Error('Study area must be a GeoJSON Polygon feature.');
  }
  const ring = input.geometry.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length < 4 || ring.length > 251) {
    throw new Error('Draw a boundary with at least 3 and no more than 250 corners.');
  }
  for (const coordinate of ring) {
    if (!Array.isArray(coordinate) || coordinate.length < 2 || !coordinate.every(Number.isFinite)) {
      throw new Error('Study area contains an invalid coordinate.');
    }
    if (coordinate[0] < -180 || coordinate[0] > 180 || coordinate[1] < -90 || coordinate[1] > 90) {
      throw new Error('Study area contains a coordinate outside the map.');
    }
  }
  const closed = ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1];
  const normalizedRing = closed ? ring : [...ring, ring[0]];
  const normalized = polygon([normalizedRing], input.properties || {});
  const squareMeters = turfArea(normalized);
  if (squareMeters < 2_500) throw new Error('Draw a larger study area.');
  if (squareMeters > 75_000_000) throw new Error('This area is too large for a neighborhood study. Draw an area under 75 km².');
  return normalized;
}

export function describeStudyArea(neighborhood, areaFeature) {
  const [longitude, latitude] = centroid(areaFeature).geometry.coordinates;
  return {
    locationGps: { latitude, longitude },
    locationDescription: `${neighborhood} study area centered near ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
  };
}

function polygonQuery(areaFeature) {
  return areaFeature.geometry.coordinates[0]
    .slice(0, -1)
    .map(([longitude, latitude]) => `${latitude} ${longitude}`)
    .join(' ');
}

export function buildOverpassQuery(areaFeature) {
  const highwayPattern = WALK_AUDIT_HIGHWAYS.join('|');
  return `[out:json][timeout:45];
    way["highway"~"^(${highwayPattern})$"](poly:"${polygonQuery(areaFeature)}");
    (._;>;);
    out body;`;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function queryStreetNetwork(areaFeature, configuredUrl = process.env.OVERPASS_URL) {
  const urls = [...new Set([
    configuredUrl || 'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ])];
  const query = buildOverpassQuery(areaFeature);
  let lastError;

  for (const url of urls) {
    try {
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'user-agent': 'NeighborhoodWalkAudit/1.0'
        },
        body: new URLSearchParams({ data: query })
      }, 55_000);
      if (!response.ok) throw new Error(`OpenStreetMap query returned ${response.status}.`);
      const payload = await response.json();
      return networkFromOverpass(payload, areaFeature);
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError?.name === 'AbortError') {
    throw new Error('The OpenStreetMap query timed out. Try a smaller boundary or try again shortly.');
  }
  throw new Error(`Could not load streets from OpenStreetMap. ${lastError?.message || ''}`.trim());
}

function insideArea(node, areaFeature) {
  return booleanPointInPolygon(point([node.lon, node.lat]), areaFeature, { ignoreBoundary: false });
}

function naturalJoin(names) {
  if (!names.length) return 'unnamed streets';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
}

export function networkFromOverpass(payload, areaInput) {
  const areaFeature = validateStudyArea(areaInput);
  const elements = Array.isArray(payload?.elements) ? payload.elements : [];
  const nodeById = new Map(
    elements
      .filter((element) => element.type === 'node' && Number.isFinite(element.lat) && Number.isFinite(element.lon))
      .map((node) => [node.id, node])
  );
  const ways = elements.filter((element) =>
    element.type === 'way'
    && Array.isArray(element.nodes)
    && element.nodes.length >= 2
    && WALK_AUDIT_HIGHWAYS.includes(element.tags?.highway)
  );

  const streetNamesAtNode = new Map();
  const neighborsAtNode = new Map();
  for (const way of ways) {
    for (let index = 0; index < way.nodes.length; index += 1) {
      const nodeId = way.nodes[index];
      const node = nodeById.get(nodeId);
      if (!node || !insideArea(node, areaFeature)) continue;
      if (!neighborsAtNode.has(nodeId)) neighborsAtNode.set(nodeId, new Set());
      for (const neighborId of [way.nodes[index - 1], way.nodes[index + 1]]) {
        const neighbor = nodeById.get(neighborId);
        if (neighbor && insideArea(neighbor, areaFeature)) neighborsAtNode.get(nodeId).add(neighborId);
      }
      if (way.tags?.name) {
        if (!streetNamesAtNode.has(nodeId)) streetNamesAtNode.set(nodeId, new Set());
        streetNamesAtNode.get(nodeId).add(way.tags.name);
      }
    }
  }

  const intersectionNodeIds = new Set(
    [...neighborsAtNode.entries()]
      .filter(([, neighbors]) => neighbors.size >= 3)
      .map(([nodeId]) => nodeId)
  );
  const intersectionFeatures = [];
  for (const nodeId of intersectionNodeIds) {
    const node = nodeById.get(nodeId);
    const streetNames = [...(streetNamesAtNode.get(nodeId) || [])].sort();
    intersectionFeatures.push(point([node.lon, node.lat], {
      id: `intersection-${nodeId}`,
      osmNodeId: nodeId,
      streetNames,
      description: `Intersection of ${naturalJoin(streetNames)}`
    }));
  }

  const segmentFeatures = [];
  for (const way of ways) {
    const runs = [];
    let currentRun = [];
    for (const nodeId of way.nodes) {
      const node = nodeById.get(nodeId);
      if (node && insideArea(node, areaFeature)) {
        currentRun.push(nodeId);
      } else if (currentRun.length) {
        if (currentRun.length >= 2) runs.push(currentRun);
        currentRun = [];
      }
    }
    if (currentRun.length >= 2) runs.push(currentRun);

    for (const run of runs) {
      const breakIndexes = new Set([0, run.length - 1]);
      run.forEach((nodeId, index) => {
        if (intersectionNodeIds.has(nodeId)) breakIndexes.add(index);
      });
      const sortedBreaks = [...breakIndexes].sort((a, b) => a - b);
      for (let index = 1; index < sortedBreaks.length; index += 1) {
        const startIndex = sortedBreaks[index - 1];
        const endIndex = sortedBreaks[index];
        if (endIndex <= startIndex) continue;
        const nodeIds = run.slice(startIndex, endIndex + 1);
        const coordinates = nodeIds.map((nodeId) => {
          const node = nodeById.get(nodeId);
          return [node.lon, node.lat];
        });
        const startNames = [...(streetNamesAtNode.get(nodeIds[0]) || [])].filter((name) => name !== way.tags?.name);
        const endNames = [...(streetNamesAtNode.get(nodeIds.at(-1)) || [])].filter((name) => name !== way.tags?.name);
        const streetName = way.tags?.name || 'Unnamed street';
        const between = startNames.length || endNames.length
          ? ` between ${startNames[0] || 'the study boundary'} and ${endNames[0] || 'the study boundary'}`
          : ' within the study area';
        segmentFeatures.push(lineString(coordinates, {
          id: `segment-${way.id}-${nodeIds[0]}-${nodeIds.at(-1)}`,
          osmWayId: way.id,
          highway: way.tags?.highway,
          name: streetName,
          startIntersection: startNames[0] || null,
          endIntersection: endNames[0] || null,
          description: `Segment of ${streetName}${between}`
        }));
      }
    }
  }

  if (!segmentFeatures.length) {
    throw new Error('No walk-auditable streets were found inside this boundary. Adjust the boundary and try again.');
  }

  return {
    intersections: featureCollection(intersectionFeatures),
    segments: featureCollection(segmentFeatures)
  };
}
