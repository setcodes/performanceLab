import type {DatasetRequest, GeneratedDataset} from './types';

const MOSCOW_CENTER = {longitude: 37.62, latitude: 55.75};
const KM_PER_LATITUDE_DEGREE = 111.32;

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function point(random: () => number, spreadKm: number): [number, number] {
  const distanceKm = Math.sqrt(random()) * spreadKm;
  const angle = random() * Math.PI * 2;
  const latitudeOffset = (Math.sin(angle) * distanceKm) / KM_PER_LATITUDE_DEGREE;
  const longitudeKmPerDegree = KM_PER_LATITUDE_DEGREE * Math.cos(MOSCOW_CENTER.latitude * Math.PI / 180);
  const longitudeOffset = (Math.cos(angle) * distanceKm) / longitudeKmPerDegree;
  return [
    MOSCOW_CENTER.longitude + longitudeOffset,
    MOSCOW_CENTER.latitude + latitudeOffset,
  ];
}

function makeDataset(config: DatasetRequest): GeneratedDataset {
  const random = mulberry32(config.seed);
  const features: GeneratedDataset['features'] = new Array(config.featureCount);

  for (let id = 0; id < config.featureCount; id += 1) {
    const origin = point(random, config.spreadKm);
    let geometry: GeneratedDataset['features'][number]['geometry'];

    if (config.geometry === 'points') {
      geometry = {type: 'Point', coordinates: origin};
    } else if (config.geometry === 'lines') {
      const coordinates: [number, number][] = [];
      const vertices = Math.max(2, config.verticesPerFeature);
      for (let vertex = 0; vertex < vertices; vertex += 1) {
        const phase = vertex / Math.max(1, vertices - 1);
        coordinates.push([
          origin[0] + (phase - 0.5) * 0.025,
          origin[1] + Math.sin(phase * Math.PI * 2 + id) * 0.004,
        ]);
      }
      geometry = {type: 'LineString', coordinates};
    } else {
      const ring: [number, number][] = [];
      const vertices = Math.max(4, config.verticesPerFeature);
      const radius = 0.001 + random() * 0.003;
      for (let vertex = 0; vertex < vertices; vertex += 1) {
        const angle = (vertex / vertices) * Math.PI * 2;
        ring.push([
          origin[0] + Math.cos(angle) * radius,
          origin[1] + Math.sin(angle) * radius,
        ]);
      }
      ring.push(ring[0]);
      geometry = {type: 'Polygon', coordinates: [ring]};
    }

    features[id] = {
      type: 'Feature',
      id,
      properties: {
        id,
        category: id % 8,
        weight: random(),
        label: `Объект ${id}`,
        layerBucket: id % Math.max(1, config.bucketCount),
      },
      geometry,
    };
  }

  return {type: 'FeatureCollection', features};
}

self.onmessage = (event: MessageEvent<DatasetRequest>) => {
  const started = performance.now();
  const dataset = makeDataset(event.data);
  self.postMessage({dataset, generationMs: performance.now() - started});
};
