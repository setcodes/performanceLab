import http from 'k6/http';
import {check, sleep} from 'k6';
import {Rate, Trend} from 'k6/metrics';

const profile = __ENV.K6_PROFILE || 'load';
const baseUrl = __ENV.BASE_URL || 'http://localhost:3000';
const resultPath = __ENV.RESULT_PATH || 'results/raw/k6-summary.json';
const errorRate = new Rate('tile_errors');
const oversizedRate = new Rate('tile_oversized');
const tileBytes = new Trend('tile_bytes', true);

const profiles = {
  smoke: {
    executor: 'constant-vus',
    vus: 2,
    duration: '20s',
  },
  load: {
    executor: 'ramping-arrival-rate',
    startRate: 10,
    timeUnit: '1s',
    preAllocatedVUs: 30,
    maxVUs: 150,
    stages: [
      {target: 25, duration: '30s'},
      {target: 75, duration: '1m'},
      {target: 150, duration: '1m'},
      {target: 0, duration: '20s'},
    ],
  },
  stress: {
    executor: 'ramping-arrival-rate',
    startRate: 50,
    timeUnit: '1s',
    preAllocatedVUs: 100,
    maxVUs: 500,
    stages: [
      {target: 200, duration: '1m'},
      {target: 500, duration: '2m'},
      {target: 800, duration: '2m'},
      {target: 0, duration: '30s'},
    ],
  },
};

export const options = {
  scenarios: {tiles: profiles[profile] || profiles.load},
  thresholds: {
    http_req_failed: [`rate<${__ENV.MAX_ERROR_RATE || '0.01'}`],
    http_req_duration: [`p(95)<${__ENV.MAX_P95_MS || '500'}`],
    tile_errors: [`rate<${__ENV.MAX_ERROR_RATE || '0.01'}`],
    tile_oversized: [`rate<${__ENV.MAX_OVERSIZED_RATE || '0.05'}`],
  },
  discardResponseBodies: false,
  summaryTrendStats: ['min', 'med', 'avg', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const sources = ['points', 'lines', 'polygons'];
const centers = [
  [37.42, 55.68],
  [37.62, 55.75],
  [37.82, 55.84],
  [37.57, 55.92],
];

function lngLatToTile(lng, lat, zoom) {
  const scale = 2 ** zoom;
  const x = Math.floor(((lng + 180) / 360) * scale);
  const radians = (lat * Math.PI) / 180;
  const y = Math.floor((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * scale);
  return {x, y};
}

export default function () {
  const source = sources[Math.floor(Math.random() * sources.length)];
  const center = centers[Math.floor(Math.random() * centers.length)];
  const zoom = 9 + Math.floor(Math.random() * 6);
  const tile = lngLatToTile(center[0], center[1], zoom);
  const x = tile.x + Math.floor(Math.random() * 3) - 1;
  const y = tile.y + Math.floor(Math.random() * 3) - 1;
  const response = http.get(`${baseUrl}/${source}/${zoom}/${x}/${y}`, {
    tags: {source, zoom: String(zoom)},
    responseType: 'binary',
  });
  const statusOk = response.status === 200 || response.status === 204;
  const contentLength = Number(response.headers['Content-Length'] || 0);
  const sizeOk = contentLength < 5_000_000;
  check(response, {
    'tile status is 200 or 204': (value) => value.status === 200 || value.status === 204,
    'tile response is bounded': (value) => Number(value.headers['Content-Length'] || 0) < 5_000_000,
  });
  errorRate.add(!statusOk);
  oversizedRate.add(!sizeOk);
  tileBytes.add(response.body ? response.body.byteLength : 0, {source});
  sleep(Math.random() * 0.15);
}

export function handleSummary(data) {
  return {
    [resultPath]: JSON.stringify({schemaVersion: 1, profile, baseUrl, generatedAt: new Date().toISOString(), ...data}, null, 2),
    stdout: textSummary(data),
  };
}

function textSummary(data) {
  const duration = data.metrics.http_req_duration?.values || {};
  const failed = data.metrics.http_req_failed?.values || {};
  return [
    '',
    `Profile: ${profile}`,
    `Requests: ${data.metrics.http_reqs?.values?.count || 0}`,
    `HTTP p95: ${(duration['p(95)'] || 0).toFixed(2)} ms`,
    `HTTP p99: ${(duration['p(99)'] || 0).toFixed(2)} ms`,
    `Failures: ${((failed.rate || 0) * 100).toFixed(2)}%`,
    '',
  ].join('\n');
}
