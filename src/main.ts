import maplibregl, {
  type GeoJSONSourceSpecification,
  type ExpressionSpecification,
  type FilterSpecification,
  type LayerSpecification,
  type MapStyleImageMissingEvent,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import {getRenderer, sampleFrames} from './metrics';
import type {
  BenchmarkConfig,
  BenchmarkProfile,
  BenchmarkResult,
  BenchmarkScreenshot,
  BenchmarkScore,
  GeneratedDataset,
  GeometryKind,
} from './types';

const OSM_SOURCE_ID = 'osm-basemap';
const OSM_LAYER_ID = 'osm-basemap-layer';
const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const SETTINGS_STORAGE_KEY = 'maplibre-performance-lab.settings.v1';
const RESULT_PANEL_STORAGE_KEY = 'maplibre-performance-lab.result-panel-collapsed';
const SCORE_HISTORY_STORAGE_KEY = 'maplibre-performance-lab.score-history.v1';
const CONFIGURED_MVT_BASE_URL = import.meta.env.VITE_MVT_BASE_URL?.replace(/\/$/, '') ?? '';
const IS_LOCAL_HOST = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const MVT_BASE_URL = CONFIGURED_MVT_BASE_URL || (IS_LOCAL_HOST ? '/tiles' : '');

const defaults: BenchmarkConfig = {
  labMode: 'benchmark',
  profile: 'custom',
  styleMode: 'simple',
  mode: 'geojson',
  geometries: ['points'],
  basemap: 'osm',
  layerDataMode: 'shared',
  objectsPerLayer: 1_000,
  featureCount: 50_000,
  verticesPerFeature: 8,
  sourceCount: 1,
  layerCount: 10,
  pixelRatio: window.devicePixelRatio,
  spreadKm: 30,
  collisionLayer: false,
  interactionMs: 4_000,
  seed: 42,
};

const profilePresets: Record<Exclude<BenchmarkProfile, 'custom'>, Partial<BenchmarkConfig>> = {
  'gost-optimized': {
    profile: 'gost-optimized',
    styleMode: 'gost',
    geometries: ['points', 'lines', 'polygons'],
    sourceCount: 3,
    layerCount: 30,
    featureCount: 10_000,
    verticesPerFeature: 12,
    collisionLayer: true,
  },
  'gost-working': {
    profile: 'gost-working',
    styleMode: 'gost',
    geometries: ['points', 'lines', 'polygons'],
    sourceCount: 4,
    layerCount: 48,
    featureCount: 10_000,
    verticesPerFeature: 16,
    collisionLayer: true,
  },
  'gost-literal': {
    profile: 'gost-literal',
    styleMode: 'gost',
    geometries: ['points', 'lines', 'polygons'],
    sourceCount: 59,
    layerCount: 84,
    featureCount: 2_000,
    verticesPerFeature: 16,
    collisionLayer: true,
  },
};

function loadSavedSettings(): Partial<BenchmarkConfig> {
  try {
    const value = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}') as Partial<BenchmarkConfig>;
    return typeof value === 'object' && value !== null ? value : {};
  } catch {
    return {};
  }
}

const savedSettings = loadSavedSettings();
const urlBasemap = new URLSearchParams(window.location.search).get('basemap');
const initialConfig: BenchmarkConfig = {
  ...defaults,
  ...savedSettings,
  geometries: Array.isArray(savedSettings.geometries) && savedSettings.geometries.length > 0
    ? savedSettings.geometries
    : defaults.geometries,
  basemap: urlBasemap === 'none' || urlBasemap === 'osm'
    ? urlBasemap
    : savedSettings.basemap ?? defaults.basemap,
  mode: savedSettings.mode === 'mvt' && !MVT_BASE_URL
    ? 'geojson'
    : savedSettings.mode ?? defaults.mode,
  spreadKm: savedSettings.spreadKm === 3 || savedSettings.spreadKm === 30 || savedSettings.spreadKm === 150
    ? savedSettings.spreadKm
    : defaults.spreadKm,
};

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Не найден контейнер приложения');

root.innerHTML = `
  <aside class="panel settings-panel">
    <header>
      <p class="eyebrow">ЦП ЕИТП · GIS PoC</p>
      <h1>MapLibre Performance Lab</h1>
      <p>Изолированный стенд браузерной и тайловой производительности.</p>
    </header>
    <form id="benchmark-form">
      <div class="mode-switch">
        <span class="field-label">Режим стенда</span>
        <input name="labMode" id="lab-mode" type="hidden" value="benchmark" />
        <div class="mode-tabs" role="tablist" aria-label="Режим стенда">
          <button class="mode-tab" type="button" role="tab" data-lab-mode="benchmark" aria-selected="true">Benchmark</button>
          <button class="mode-tab" type="button" role="tab" data-lab-mode="realtime" aria-selected="false">Realtime</button>
        </div>
        <span class="field-hint" id="lab-mode-hint">Один воспроизводимый прогон с итоговым отчётом.</span>
      </div>
      <label>Профиль нагрузки
        <select name="profile" id="benchmark-profile">
          <option value="custom">Пользовательский</option>
          <option value="gost-optimized">ГОСТ · оптимизированный (3 / 30)</option>
          <option value="gost-working">ГОСТ · рабочий (4 / 48)</option>
          <option value="gost-literal">ГОСТ · слои буквально (59 / 84)</option>
        </select>
        <span class="field-hint" id="profile-hint">Простой стиль без составных обозначений.</span>
      </label>
      <div class="settings-pair">
        <label>Доставка
          <select name="mode">
            <option value="geojson">GeoJSON в браузере</option>
            <option value="mvt" ${MVT_BASE_URL ? '' : 'disabled'}>MVT через Martin${MVT_BASE_URL ? '' : ' · нужен сервер'}</option>
          </select>
        </label>
        <label>Подложка
          <select name="basemap">
            <option value="osm">OpenStreetMap</option>
            <option value="none">Без подложки</option>
          </select>
        </label>
      </div>
      <fieldset>
        <legend>Геометрия</legend>
        <div class="geometry-checks">
          <label class="check"><input name="geometries" type="checkbox" value="points" checked /><span>Точки</span></label>
          <label class="check"><input name="geometries" type="checkbox" value="lines" /><span>Линии</span></label>
          <label class="check"><input name="geometries" type="checkbox" value="polygons" /><span>Полигоны</span></label>
        </div>
      </fieldset>
      <div class="settings-pair">
        <label>Распределение
          <select name="layerDataMode" id="layer-data-mode">
            <option value="shared">Общий набор</option>
            <option value="partitioned">По группам слоёв</option>
          </select>
        </label>
        <label>Стилизация
          <select name="styleMode" id="style-mode">
            <option value="simple">Примитивы</option>
            <option value="gost">ГОСТ proxy</option>
          </select>
        </label>
      </div>
      <div class="grid-two">
        <label>Объектов на тип
          <input name="featureCount" type="number" min="100" max="1000000" step="100" value="50000" />
        </label>
        <label>Объектов в слое
          <input name="objectsPerLayer" id="objects-per-layer" type="number" min="1" max="100000" step="100" value="1000" disabled />
        </label>
        <label>Вершин/объект
          <input name="verticesPerFeature" type="number" min="1" max="1000" value="8" />
        </label>
        <label>Источники всего
          <input name="sourceCount" type="number" min="1" max="100" value="1" />
        </label>
        <label>Style layers
          <input name="layerCount" type="number" min="1" max="500" value="10" />
        </label>
        <label>DPR рендера
          <input name="pixelRatio" type="number" min="0.5" max="4" step="0.25" value="1" />
        </label>
      </div>
      <label class="check">
        <input name="collisionLayer" type="checkbox" />
        <span>Слой столкновений подписей (icon proxy)</span>
      </label>
      <div class="settings-triple benchmark-timing-row">
        <label>Разброс
          <select name="spreadKm">
            <option value="3">Плотно · 3 км</option>
            <option value="30" selected>Город · 30 км</option>
            <option value="150">Регион · 150 км</option>
          </select>
        </label>
        <label>Pan/zoom, мс
          <input name="interactionMs" type="number" min="1000" max="30000" step="500" value="4000" />
        </label>
        <label>Seed
          <input name="seed" type="number" value="42" />
        </label>
      </div>
      <div class="form-actions">
        <button id="run-button" type="submit">Запустить измерение</button>
        <button class="secondary" id="reset-settings-button" type="button">Сбросить настройки</button>
      </div>
      <section class="live-controls" id="live-controls" hidden>
        <h2>Изменение живой сцены</h2>
        <div class="live-action-grid">
          <button class="secondary compact" type="button" data-live-field="featureCount" data-live-delta="1000">+1 000 объектов</button>
          <button class="secondary compact" type="button" data-live-field="featureCount" data-live-delta="-1000">−1 000 объектов</button>
          <button class="secondary compact" type="button" data-live-field="layerCount" data-live-delta="10">+10 layers</button>
          <button class="secondary compact" type="button" data-live-field="layerCount" data-live-delta="-10">−10 layers</button>
          <button class="secondary compact" type="button" data-live-field="sourceCount" data-live-delta="1">+1 source</button>
          <button class="secondary compact" type="button" data-live-field="sourceCount" data-live-delta="-1">−1 source</button>
        </div>
        <div class="live-footer-actions">
          <button class="secondary compact" id="toggle-live-style-button" type="button">Сложность стиля</button>
          <button class="secondary compact" id="stop-live-button" type="button" disabled>Остановить</button>
        </div>
      </section>
    </form>
  </aside>
  <main class="map-wrap">
    <div id="map"></div>
    <div class="map-badge" id="map-badge">baseline · idle</div>
  </main>
  <aside class="result-panel" id="result-panel" aria-expanded="true">
    <div class="result-header">
      <div class="result-heading">
        <p class="eyebrow">Результат</p>
        <h2>Итог нагрузки</h2>
      </div>
      <button class="panel-toggle" id="result-panel-toggle" type="button" aria-label="Свернуть результаты" title="Свернуть результаты">
        <span aria-hidden="true">›</span>
      </button>
    </div>
    <div class="result-content">
      <div class="status" id="status" role="status">Карта готова к запуску.</div>
      <section class="metrics" id="metrics" aria-live="polite">
        <div class="empty-result">
          <strong>Результатов пока нет</strong>
          <span>Настройте сценарий слева и запустите измерение.</span>
        </div>
      </section>
      <div class="report-actions">
        <button class="secondary report-primary-action" id="view-report-button" type="button" disabled>Открыть накопительный отчёт</button>
        <button class="secondary" id="scoreboard-button" type="button" disabled>История запусков</button>
        <button class="secondary" id="download-html-button" type="button" disabled>Скачать отчёт HTML</button>
        <button class="secondary" id="download-button" type="button" disabled>Скачать данные JSON</button>
      </div>
    </div>
  </aside>
  <dialog class="report-dialog" id="report-dialog">
    <div class="report-dialog-header">
      <div>
        <p class="eyebrow">Cumulative benchmark report</p>
        <h2>Накопительный отчёт</h2>
      </div>
      <button class="secondary compact" id="close-report-button" type="button">Закрыть</button>
    </div>
    <div class="report-dialog-content" id="report-dialog-content"></div>
  </dialog>
  <dialog class="report-dialog scoreboard-dialog" id="scoreboard-dialog">
    <div class="report-dialog-header">
      <div>
        <p class="eyebrow">Performance score</p>
        <h2>Рейтинг запусков</h2>
      </div>
      <button class="secondary compact" id="close-scoreboard-button" type="button">Закрыть</button>
    </div>
    <div class="report-dialog-content" id="scoreboard-content"></div>
    <div class="scoreboard-footer">
      <button class="secondary compact" id="clear-scoreboard-button" type="button">Очистить историю</button>
    </div>
  </dialog>
`;

const initialBasemap = initialConfig.basemap;
const initialStyle: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{id: 'background', type: 'background', paint: {'background-color': '#071018'}}],
};
if (initialBasemap === 'osm') {
  initialStyle.sources[OSM_SOURCE_ID] = {
    type: 'raster',
    tiles: [OSM_TILES],
    tileSize: 256,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  };
  initialStyle.layers.push({id: OSM_LAYER_ID, type: 'raster', source: OSM_SOURCE_ID});
}

const map = new maplibregl.Map({
  container: 'map',
  style: initialStyle,
  center: [37.62, 55.75],
  zoom: 9.5,
  pixelRatio: initialConfig.pixelRatio,
  attributionControl: false,
  fadeDuration: 0,
});
map.addControl(new maplibregl.NavigationControl({showCompass: false}), 'top-right');
map.addControl(new maplibregl.AttributionControl({compact: true}), 'bottom-right');

let lastResult: BenchmarkResult | null = null;
let scoreHistory: BenchmarkResult[] = [];
let activeLayerIds: string[] = [];
let activeSourceIds: string[] = [];

const statusElement = document.querySelector<HTMLDivElement>('#status')!;
const metricsElement = document.querySelector<HTMLElement>('#metrics')!;
const runButton = document.querySelector<HTMLButtonElement>('#run-button')!;
const downloadButton = document.querySelector<HTMLButtonElement>('#download-button')!;
const downloadHtmlButton = document.querySelector<HTMLButtonElement>('#download-html-button')!;
const viewReportButton = document.querySelector<HTMLButtonElement>('#view-report-button')!;
const scoreboardButton = document.querySelector<HTMLButtonElement>('#scoreboard-button')!;
const mapBadge = document.querySelector<HTMLDivElement>('#map-badge')!;
const resetSettingsButton = document.querySelector<HTMLButtonElement>('#reset-settings-button')!;
const resultPanel = document.querySelector<HTMLElement>('#result-panel')!;
const resultPanelToggle = document.querySelector<HTMLButtonElement>('#result-panel-toggle')!;
const liveControls = document.querySelector<HTMLElement>('#live-controls')!;
const stopLiveButton = document.querySelector<HTMLButtonElement>('#stop-live-button')!;
const toggleLiveStyleButton = document.querySelector<HTMLButtonElement>('#toggle-live-style-button')!;
const reportDialog = document.querySelector<HTMLDialogElement>('#report-dialog')!;
const reportDialogContent = document.querySelector<HTMLDivElement>('#report-dialog-content')!;
const closeReportButton = document.querySelector<HTMLButtonElement>('#close-report-button')!;
const scoreboardDialog = document.querySelector<HTMLDialogElement>('#scoreboard-dialog')!;
const scoreboardContent = document.querySelector<HTMLDivElement>('#scoreboard-content')!;
const closeScoreboardButton = document.querySelector<HTMLButtonElement>('#close-scoreboard-button')!;
const clearScoreboardButton = document.querySelector<HTMLButtonElement>('#clear-scoreboard-button')!;

interface RealtimeMonitorState {
  active: boolean;
  config: BenchmarkConfig | null;
  animationFrame: number | null;
  interval: number | null;
  observer: PerformanceObserver | null;
  frameDurations: number[];
  lastFrameAt: number | null;
  longTasks: number[];
  resourceBefore: {requests: number; transferredBytes: number; decodedBytes: number};
  startedAt: number;
}

const realtimeMonitor: RealtimeMonitorState = {
  active: false,
  config: null,
  animationFrame: null,
  interval: null,
  observer: null,
  frameDurations: [],
  lastFrameAt: null,
  longTasks: [],
  resourceBefore: {requests: 0, transferredBytes: 0, decodedBytes: 0},
  startedAt: 0,
};

function setResultPanelCollapsed(collapsed: boolean, persist = true): void {
  root!.classList.toggle('results-collapsed', collapsed);
  resultPanel.setAttribute('aria-expanded', String(!collapsed));
  resultPanelToggle.setAttribute('aria-label', collapsed ? 'Развернуть результаты' : 'Свернуть результаты');
  resultPanelToggle.title = collapsed ? 'Развернуть результаты' : 'Свернуть результаты';
  resultPanelToggle.querySelector('span')!.textContent = collapsed ? '‹' : '›';
  if (persist) localStorage.setItem(RESULT_PANEL_STORAGE_KEY, String(collapsed));
  window.setTimeout(() => map.resize(), 180);
}

function setStatus(message: string, running = false): void {
  statusElement.textContent = message;
  mapBadge.textContent = running ? 'benchmark · running' : 'baseline · idle';
  runButton.disabled = running;
}

function waitForMapEvent(event: 'render' | 'idle', timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      map.off(event, done);
      reject(new Error(`Тайм-аут ожидания события MapLibre: ${event}`));
    }, timeoutMs);
    const done = () => {
      window.clearTimeout(timer);
      resolve();
    };
    map.once(event, done);
  });
}

async function waitForMapReady(): Promise<void> {
  if (map.isStyleLoaded()) return;
  await new Promise<void>((resolve) => map.once('load', () => resolve()));
}

async function generateDataset(config: BenchmarkConfig, geometry: GeometryKind): Promise<{dataset: GeneratedDataset; generationMs: number}> {
  const bucketCount = countLayersForGeometry(config, geometry);
  const featureCount = config.layerDataMode === 'partitioned'
    ? config.objectsPerLayer * bucketCount
    : config.featureCount;
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./dataset.worker.ts', import.meta.url), {type: 'module'});
    worker.onmessage = (event: MessageEvent<{dataset: GeneratedDataset; generationMs: number}>) => {
      resolve(event.data);
      worker.terminate();
    };
    worker.onerror = (event) => {
      reject(new Error(event.message));
      worker.terminate();
    };
    worker.postMessage({
      geometry,
      featureCount,
      verticesPerFeature: config.verticesPerFeature,
      seed: config.seed + config.geometries.indexOf(geometry) * 10_000,
      bucketCount,
      spreadKm: config.spreadKm,
    });
  });
}

function countLayersForGeometry(config: BenchmarkConfig, geometry: GeometryKind): number {
  let count = 0;
  for (let index = 0; index < config.layerCount; index += 1) {
    if (config.geometries[index % config.geometries.length] === geometry) count += 1;
  }
  return count;
}

function sourceCountsByGeometry(config: BenchmarkConfig): Map<GeometryKind, number> {
  const counts = new Map(config.geometries.map((geometry) => [geometry, 0]));
  const total = Math.max(config.sourceCount, config.geometries.length);
  for (let index = 0; index < total; index += 1) {
    const geometry = config.geometries[index % config.geometries.length];
    counts.set(geometry, (counts.get(geometry) ?? 0) + 1);
  }
  return counts;
}

async function generateDatasets(config: BenchmarkConfig): Promise<{datasets: Map<GeometryKind, GeneratedDataset>; generationMs: number}> {
  const started = performance.now();
  const generated = await Promise.all(
    config.geometries.map(async (geometry) => ({geometry, ...(await generateDataset(config, geometry))})),
  );
  return {
    datasets: new Map(generated.map(({geometry, dataset}) => [geometry, dataset])),
    generationMs: performance.now() - started,
  };
}

function applyBasemap(mode: BenchmarkConfig['basemap']): void {
  if (mode === 'none') {
    if (map.getLayer(OSM_LAYER_ID)) map.removeLayer(OSM_LAYER_ID);
    if (map.getSource(OSM_SOURCE_ID)) map.removeSource(OSM_SOURCE_ID);
    return;
  }
  if (!map.getSource(OSM_SOURCE_ID)) {
    map.addSource(OSM_SOURCE_ID, {
      type: 'raster',
      tiles: [OSM_TILES],
      tileSize: 256,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    });
  }
  if (!map.getLayer(OSM_LAYER_ID)) {
    map.addLayer({id: OSM_LAYER_ID, type: 'raster', source: OSM_SOURCE_ID}, activeLayerIds[0]);
  }
}

function removeActiveScenario(): void {
  for (const id of [...activeLayerIds].reverse()) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of [...activeSourceIds].reverse()) {
    if (map.getSource(id)) map.removeSource(id);
  }
  activeLayerIds = [];
  activeSourceIds = [];
}

function ensureCollisionImage(): void {
  if (map.hasImage('collision-proxy')) return;
  const width = 56;
  const height = 14;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const border = x < 1 || y < 1 || x >= width - 1 || y >= height - 1;
      data[offset] = border ? 109 : 20;
      data[offset + 1] = border ? 245 : 184;
      data[offset + 2] = border ? 202 : 166;
      data[offset + 3] = border ? 180 : 135;
    }
  }
  map.addImage('collision-proxy', {width, height, data});
}

function makeRasterIcon(size: number, draw: (set: (x: number, y: number, rgba: [number, number, number, number]) => void) => void) {
  const data = new Uint8Array(size * size * 4);
  const set = (x: number, y: number, rgba: [number, number, number, number]) => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= size || py >= size) return;
    const offset = (py * size + px) * 4;
    data.set(rgba, offset);
  };
  draw(set);
  return {width: size, height: size, data};
}

function ensureGostImages(): void {
  const colors: Array<[number, number, number, number]> = [
    [39, 174, 96, 255], [241, 196, 15, 255], [230, 126, 34, 255], [192, 57, 43, 255],
    [41, 128, 185, 255], [142, 68, 173, 255], [44, 62, 80, 255], [22, 160, 133, 255],
  ];
  const line = (
    set: (x: number, y: number, rgba: [number, number, number, number]) => void,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: [number, number, number, number],
    width = 2,
  ) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let step = 0; step <= steps; step += 1) {
      const x = x0 + ((x1 - x0) * step) / Math.max(1, steps);
      const y = y0 + ((y1 - y0) * step) / Math.max(1, steps);
      for (let dx = -width; dx <= width; dx += 1) {
        for (let dy = -width; dy <= width; dy += 1) set(x + dx, y + dy, color);
      }
    }
  };

  for (let category = 0; category < 8; category += 1) {
    const id = `gost-symbol-${category}`;
    if (map.hasImage(id)) continue;
    const color = colors[category];
    const image = makeRasterIcon(32, (set) => {
      if (category % 4 === 0) {
        line(set, 5, 8, 16, 16, color); line(set, 16, 16, 5, 24, color);
        line(set, 27, 8, 16, 16, color); line(set, 16, 16, 27, 24, color);
      } else if (category % 4 === 1) {
        for (let x = 6; x <= 26; x += 1) { set(x, 6, color); set(x, 26, color); }
        for (let y = 6; y <= 26; y += 1) { set(6, y, color); set(26, y, color); }
        line(set, 9, 23, 23, 9, color, 1);
      } else if (category % 4 === 2) {
        for (let angle = 0; angle < 360; angle += 2) {
          const radians = angle * Math.PI / 180;
          set(16 + Math.cos(radians) * 10, 16 + Math.sin(radians) * 10, color);
        }
        line(set, 9, 16, 23, 16, color, 1); line(set, 16, 9, 16, 23, color, 1);
      } else {
        line(set, 16, 4, 28, 25, color); line(set, 28, 25, 4, 25, color); line(set, 4, 25, 16, 4, color);
        line(set, 11, 19, 21, 19, color, 1);
      }
    });
    map.addImage(id, image, {pixelRatio: 2});
  }

  if (!map.hasImage('gost-arrow')) {
    map.addImage('gost-arrow', makeRasterIcon(20, (set) => {
      const color: [number, number, number, number] = [52, 73, 94, 255];
      line(set, 3, 10, 16, 10, color, 1);
      line(set, 11, 5, 17, 10, color, 1);
      line(set, 17, 10, 11, 15, color, 1);
    }), {pixelRatio: 2});
  }

  if (!map.hasImage('gost-hatch')) {
    map.addImage('gost-hatch', makeRasterIcon(12, (set) => {
      const color: [number, number, number, number] = [41, 128, 185, 150];
      for (let offset = -12; offset < 24; offset += 6) {
        for (let point = 0; point < 12; point += 1) set(point, offset + point, color);
      }
    }), {pixelRatio: 1});
  }
}

function visualLayer(id: string, source: string, geometry: GeometryKind, index: number): LayerSpecification {
  const opacity = Math.max(0.06, 0.75 / Math.max(1, Math.ceil((index + 1) / 5)));
  if (geometry === 'points') {
    return {
      id,
      source,
      type: 'circle',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 1, 14, 5],
        'circle-color': ['match', ['get', 'category'], 0, '#6df5ca', 1, '#51a8ff', 2, '#ffcb6b', '#c792ea'],
        'circle-opacity': opacity,
      },
    };
  }
  if (geometry === 'lines') {
    return {
      id,
      source,
      type: 'line',
      paint: {
        'line-color': index % 2 ? '#51a8ff' : '#6df5ca',
        'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.4, 14, 2.5],
        'line-opacity': opacity,
      },
    };
  }
  return {
    id,
    source,
    type: 'fill',
    paint: {
      'fill-color': index % 2 ? '#51a8ff' : '#6df5ca',
      'fill-opacity': opacity * 0.7,
      'fill-outline-color': '#d6fff2',
    },
  };
}

function gostVisualLayer(
  id: string,
  source: string,
  geometry: GeometryKind,
  index: number,
  collisionLayer: boolean,
): LayerSpecification {
  const pressureColor: ExpressionSpecification = ['match', ['get', 'category'],
    0, '#20a464', 1, '#e2b714', 2, '#dc7628', 3, '#b8332d',
    4, '#287cb5', 5, '#8741a3', 6, '#26394b', '#15927c',
  ];

  if (geometry === 'points') {
    const variant = Math.floor(index / 8) % 4;
    if (variant === 0 || variant === 3) {
      return {
        id,
        source,
        type: 'symbol',
        layout: {
          'icon-image': ['match', ['get', 'category'],
            0, 'gost-symbol-0', 1, 'gost-symbol-1', 2, 'gost-symbol-2', 3, 'gost-symbol-3',
            4, 'gost-symbol-4', 5, 'gost-symbol-5', 6, 'gost-symbol-6', 'gost-symbol-7',
          ],
          'icon-size': variant === 0
            ? ['interpolate', ['linear'], ['zoom'], 7, 0.55, 14, 1.25]
            : ['interpolate', ['linear'], ['get', 'weight'], 0, 0.45, 1, 1.05],
          'icon-rotate': ['*', ['get', 'category'], 45],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': !collisionLayer,
          'icon-padding': 3,
        },
      } as LayerSpecification;
    }
    if (variant === 1) {
      return {
        id,
        source,
        type: 'symbol',
        layout: {
          'text-field': ['concat', ['get', 'label'], ' · DN ', ['to-string', ['+', 50, ['*', ['get', 'category'], 50]]]],
          'text-size': ['interpolate', ['linear'], ['zoom'], 8, 9, 14, 12],
          'text-offset': [0, 1.35],
          'text-allow-overlap': !collisionLayer,
          'text-optional': true,
          'text-padding': 3,
        },
        paint: {
          'text-color': '#17232d',
          'text-halo-color': '#f5f1df',
          'text-halo-width': 1.5,
        },
      } as LayerSpecification;
    }
    return {
      id,
      source,
      type: 'circle',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 3, 14, 9],
        'circle-color': 'rgba(255,255,255,0)',
        'circle-stroke-color': pressureColor,
        'circle-stroke-width': 2,
        'circle-opacity': 0.85,
      },
    } as LayerSpecification;
  }

  if (geometry === 'lines') {
    const variant = index % 6;
    if (variant === 3) {
      return {
        id,
        source,
        type: 'symbol',
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 80,
          'icon-image': 'gost-arrow',
          'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 14, 1.1],
          'icon-allow-overlap': !collisionLayer,
          'icon-rotation-alignment': 'map',
        },
      } as LayerSpecification;
    }
    if (variant === 4) {
      return {
        id,
        source,
        type: 'symbol',
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 220,
          'text-field': ['concat', 'L ', ['to-string', ['get', 'id']], ' · DN ', ['to-string', ['+', 100, ['*', ['get', 'category'], 100]]]],
          'text-size': 10,
          'text-allow-overlap': !collisionLayer,
          'text-padding': 4,
        },
        paint: {
          'text-color': '#17232d',
          'text-halo-color': '#f5f1df',
          'text-halo-width': 1.5,
        },
      } as LayerSpecification;
    }
    return {
      id,
      source,
      type: 'line',
      paint: {
        'line-color': variant === 2 ? '#f5f1df' : pressureColor,
        'line-width': variant === 2
          ? ['interpolate', ['linear'], ['zoom'], 7, 2.5, 14, 7]
          : ['interpolate', ['linear'], ['zoom'], 7, 0.8, 14, variant === 5 ? 2.2 : 4.2],
        'line-opacity': variant === 2 ? 0.5 : 0.82,
        ...(variant === 1 ? {'line-dasharray': [4, 3]} : {}),
        ...(variant === 5 ? {'line-dasharray': [1, 2]} : {}),
      },
    } as LayerSpecification;
  }

  const variant = index % 5;
  if (variant === 0) {
    return {
      id,
      source,
      type: 'fill',
      paint: {'fill-color': pressureColor, 'fill-opacity': 0.18},
    } as LayerSpecification;
  }
  if (variant === 2) {
    return {
      id,
      source,
      type: 'fill',
      paint: {'fill-pattern': 'gost-hatch', 'fill-opacity': 0.55},
    } as LayerSpecification;
  }
  if (variant === 3) {
    return {
      id,
      source,
      type: 'symbol',
      layout: {
        'text-field': ['concat', 'Зона ', ['to-string', ['get', 'id']]],
        'text-size': 10,
        'text-allow-overlap': !collisionLayer,
        'text-padding': 4,
      },
      paint: {'text-color': '#17232d', 'text-halo-color': '#f5f1df', 'text-halo-width': 1.5},
    } as LayerSpecification;
  }
  return {
    id,
    source,
    type: 'line',
    paint: {
      'line-color': pressureColor,
      'line-width': variant === 4 ? 2.5 : 1.4,
      ...(variant === 4 ? {'line-dasharray': [3, 2]} : {}),
    },
  } as LayerSpecification;
}

async function addScenario(config: BenchmarkConfig, datasets: Map<GeometryKind, GeneratedDataset>): Promise<void> {
  removeActiveScenario();
  ensureCollisionImage();
  if (config.styleMode === 'gost') ensureGostImages();

  const tileManifests = new Map<GeometryKind, {tiles: string[]; vectorLayerId: string}>();
  if (config.mode === 'mvt') {
    if (!MVT_BASE_URL) throw new Error('MVT недоступен: для публичной версии не настроен адрес Martin');
    await Promise.all(config.geometries.map(async (geometry) => {
      const url = `${MVT_BASE_URL}/${geometry}_r${config.spreadKm}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Martin TileJSON вернул ${response.status}: ${url}`);
      const manifest = (await response.json()) as {
        tiles?: string[];
        vector_layers?: Array<{id: string}>;
      };
      const vectorLayerId = manifest.vector_layers?.[0]?.id;
      if (!vectorLayerId) throw new Error(`Martin TileJSON ${url} не содержит vector_layers[0].id`);
      if (!manifest.tiles?.length) throw new Error(`Martin TileJSON ${url} не содержит tiles`);

      const tiles = manifest.tiles.map((rawTileUrl) => {
        const tileUrl = new URL(rawTileUrl, window.location.href);
        const preserveTemplate = (value: string) => value.replace(/%7B([^%]+)%7D/gi, '{$1}');

        if (MVT_BASE_URL.startsWith('/')) {
          return preserveTemplate(
            new URL(`${tileUrl.pathname}${tileUrl.search}${tileUrl.hash}`, window.location.origin).toString(),
          );
        }

        if (window.location.protocol === 'https:' && tileUrl.protocol === 'http:') {
          tileUrl.protocol = 'https:';
        }
        return preserveTemplate(tileUrl.toString());
      });

      tileManifests.set(geometry, {tiles, vectorLayerId});
    }));
  }

  const sources: Array<{id: string; geometry: GeometryKind; vectorLayerId?: string}> = [];
  const sourceCounts = sourceCountsByGeometry(config);
  for (const geometry of config.geometries) {
    for (let index = 0; index < (sourceCounts.get(geometry) ?? 1); index += 1) {
      const id = `benchmark-source-${geometry}-${index}`;
      if (config.mode === 'geojson') {
        map.addSource(id, {
          type: 'geojson',
          data: datasets.get(geometry) as GeoJSONSourceSpecification['data'],
          generateId: false,
        });
      } else {
        const tileManifest = tileManifests.get(geometry)!;
        map.addSource(id, {type: 'vector', tiles: tileManifest.tiles});
      }
      activeSourceIds.push(id);
      sources.push({id, geometry, vectorLayerId: tileManifests.get(geometry)?.vectorLayerId});
    }
  }

  for (let index = 0; index < config.layerCount; index += 1) {
    const id = `benchmark-layer-${index}`;
    const geometry = config.geometries[index % config.geometries.length];
    const localBucket = Math.floor(index / config.geometries.length);
    const replica = localBucket % (sourceCounts.get(geometry) ?? 1);
    const source = sources.find((item) => item.geometry === geometry && item.id === `benchmark-source-${geometry}-${replica}`)!;
    const useCollision = config.collisionLayer && index >= Math.floor(config.layerCount * 0.8);
    const layer = (config.styleMode === 'gost'
      ? gostVisualLayer(id, source.id, source.geometry, localBucket, config.collisionLayer)
      : useCollision
      ? {
          id,
          source: source.id,
          type: 'symbol',
          layout: {
            'icon-image': 'collision-proxy',
            'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.25, 14, 0.7],
            'icon-allow-overlap': false,
            'icon-padding': 2,
          },
        }
      : visualLayer(id, source.id, source.geometry, index)) as LayerSpecification & {
        'source-layer'?: string;
        filter?: FilterSpecification;
      };
    if (source.vectorLayerId) layer['source-layer'] = source.vectorLayerId;
    if (config.layerDataMode === 'partitioned') {
      const bucketCount = countLayersForGeometry(config, geometry);
      const filter: FilterSpecification = config.mode === 'geojson'
        ? ['==', ['get', 'layerBucket'], localBucket]
        : ['all',
            ['<=', ['get', 'id'], config.objectsPerLayer * bucketCount],
            ['==', ['%', ['-', ['get', 'id'], 1], bucketCount], localBucket],
          ];
      layer.filter = filter;
    } else if (config.styleMode === 'gost') {
      layer.filter = ['==', ['get', 'category'], localBucket % 8];
    }
    map.addLayer(layer);
    activeLayerIds.push(id);
  }
}

async function animateCamera(durationMs: number, onMidpoint?: () => Promise<void>): Promise<void> {
  const legs = 4;
  const legMs = durationMs / legs;
  const targets: Array<{center: [number, number]; zoom: number}> = [
    {center: [37.42, 55.68], zoom: 10.8},
    {center: [37.82, 55.84], zoom: 12.1},
    {center: [37.57, 55.92], zoom: 9.8},
    {center: [37.62, 55.75], zoom: 9.5},
  ];
  for (const [index, target] of targets.entries()) {
    map.easeTo({...target, duration: legMs, easing: (value) => value});
    await new Promise((resolve) => window.setTimeout(resolve, legMs));
    if (index === 1 && onMidpoint) await onMidpoint();
  }
}

function resourceSnapshot(): {requests: number; transferredBytes: number; decodedBytes: number} {
  const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  return {
    requests: entries.length,
    transferredBytes: entries.reduce((sum, entry) => sum + entry.transferSize, 0),
    decodedBytes: entries.reduce((sum, entry) => sum + entry.decodedBodySize, 0),
  };
}

function calculateWorkload(config: BenchmarkConfig): BenchmarkResult['workload'] {
  const requestedUniqueFeatures = config.layerDataMode === 'partitioned'
    ? config.objectsPerLayer * config.layerCount
    : config.featureCount * config.geometries.length;
  let featureLayerPairs: number;
  if (config.layerDataMode === 'partitioned') {
    featureLayerPairs = config.objectsPerLayer * config.layerCount;
  } else if (config.styleMode === 'gost') {
    featureLayerPairs = 0;
    for (let index = 0; index < config.layerCount; index += 1) {
      const geometry = config.geometries[index % config.geometries.length];
      const localBucket = Math.floor(index / config.geometries.length);
      const category = localBucket % 8;
      const categoryFeatures = category < config.featureCount
        ? Math.floor((config.featureCount - 1 - category) / 8) + 1
        : 0;
      if (config.geometries.includes(geometry)) featureLayerPairs += categoryFeatures;
    }
  } else {
    featureLayerPairs = config.featureCount * config.layerCount;
  }
  const rendered = activeLayerIds.length > 0
    ? map.queryRenderedFeatures({layers: activeLayerIds})
    : [];
  const uniqueFeatures = new Set<string>();
  const featureLayerHits = new Set<string>();

  for (const feature of rendered) {
    const geometry = /^benchmark-source-(points|lines|polygons)-/.exec(feature.source)?.[1]
      ?? feature.sourceLayer
      ?? feature.source;
    const featureId = feature.id ?? feature.properties?.id ?? JSON.stringify(feature.geometry);
    const featureKey = `${geometry}:${String(featureId)}`;
    uniqueFeatures.add(featureKey);
    featureLayerHits.add(`${feature.layer.id}:${featureKey}`);
  }

  const basemapLayers = map.getLayer(OSM_LAYER_ID) ? 1 : 0;
  const basemapSources = map.getSource(OSM_SOURCE_ID) ? 1 : 0;
  const layerTypes = {circle: 0, line: 0, fill: 0, symbol: 0, other: 0};
  for (const id of activeLayerIds) {
    const type = map.getLayer(id)?.type;
    if (type === 'circle' || type === 'line' || type === 'fill' || type === 'symbol') layerTypes[type] += 1;
    else layerTypes.other += 1;
  }
  const sourceCounts = sourceCountsByGeometry(config);
  const sourceFeatureCopies = config.geometries.reduce((sum, geometry) => {
    const uniqueForGeometry = config.layerDataMode === 'partitioned'
      ? config.objectsPerLayer * countLayersForGeometry(config, geometry)
      : config.featureCount;
    return sum + uniqueForGeometry * (sourceCounts.get(geometry) ?? 1);
  }, 0);
  return {
    requestedUniqueFeatures,
    sourceFeatureCopies,
    featureLayerPairs,
    visibleUniqueFeatures: uniqueFeatures.size,
    visibleFeatureLayerHits: featureLayerHits.size,
    benchmarkSources: activeSourceIds.length,
    basemapSources,
    totalSources: activeSourceIds.length + basemapSources,
    benchmarkLayers: activeLayerIds.length,
    basemapLayers,
    totalStyleLayers: map.getStyle().layers.length,
    layerTypes,
  };
}

function visibleFeatureCounts(): {visibleUniqueFeatures: number; visibleFeatureLayerHits: number} {
  const rendered = activeLayerIds.length > 0 ? map.queryRenderedFeatures({layers: activeLayerIds}) : [];
  const uniqueFeatures = new Set<string>();
  const featureLayerHits = new Set<string>();
  for (const feature of rendered) {
    const geometry = /^benchmark-source-(points|lines|polygons)-/.exec(feature.source)?.[1]
      ?? feature.sourceLayer
      ?? feature.source;
    const featureId = feature.id ?? feature.properties?.id ?? JSON.stringify(feature.geometry);
    const featureKey = `${geometry}:${String(featureId)}`;
    uniqueFeatures.add(featureKey);
    featureLayerHits.add(`${feature.layer.id}:${featureKey}`);
  }
  return {visibleUniqueFeatures: uniqueFeatures.size, visibleFeatureLayerHits: featureLayerHits.size};
}

async function captureMapSnapshot(
  stage: BenchmarkScreenshot['stage'],
  label: string,
  startedAt: number,
): Promise<BenchmarkScreenshot> {
  const counts = visibleFeatureCounts();
  const base = {
    stage,
    label,
    elapsedMs: Math.round(performance.now() - startedAt),
    ...counts,
    zoom: Number(map.getZoom().toFixed(2)),
  };
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Тайм-аут снимка карты')), 3_000);
      map.once('render', () => {
        window.clearTimeout(timeout);
        try {
          const source = map.getCanvas();
          const width = 480;
          const height = Math.max(240, Math.round(width * source.clientHeight / Math.max(1, source.clientWidth)));
          const thumbnail = document.createElement('canvas');
          thumbnail.width = width;
          thumbnail.height = height;
          const context = thumbnail.getContext('2d');
          if (!context) throw new Error('Canvas 2D недоступен');
          context.drawImage(source, 0, 0, width, height);
          resolve(thumbnail.toDataURL('image/webp', 0.62));
        } catch (error) {
          reject(error);
        }
      });
      map.triggerRepaint();
    });
    return {...base, dataUrl, error: null};
  } catch (error) {
    return {...base, dataUrl: null, error: error instanceof Error ? error.message : String(error)};
  }
}

function resolveConfig(partial: Partial<BenchmarkConfig>): BenchmarkConfig {
  const requestedProfile = partial.profile ?? defaults.profile;
  const profileConfig = requestedProfile === 'custom' ? {} : profilePresets[requestedProfile];
  const merged: BenchmarkConfig = {...defaults, ...profileConfig, ...partial};
  const requestedSpread = Math.min(300, Math.max(1, merged.spreadKm));
  const mvtSpreads = [3, 30, 150] as const;
  const spreadKm = merged.mode === 'mvt'
    ? mvtSpreads.reduce((closest, value) => Math.abs(value - requestedSpread) < Math.abs(closest - requestedSpread) ? value : closest)
    : requestedSpread;
  return {
    ...merged,
    sourceCount: Math.max(merged.sourceCount, merged.geometries.length),
    pixelRatio: Math.min(4, Math.max(0.5, merged.pixelRatio)),
    spreadKm,
  };
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

function realtimeFrame(timestamp: number): void {
  if (!realtimeMonitor.active) return;
  if (realtimeMonitor.lastFrameAt !== null) {
    realtimeMonitor.frameDurations.push(timestamp - realtimeMonitor.lastFrameAt);
    if (realtimeMonitor.frameDurations.length > 300) realtimeMonitor.frameDurations.shift();
  }
  realtimeMonitor.lastFrameAt = timestamp;
  realtimeMonitor.animationFrame = requestAnimationFrame(realtimeFrame);
}

const metricExplanations: Record<string, string> = {
  'FPS rolling': 'Средняя частота кадров по последнему окну измерений. Чем выше, тем плавнее карта.',
  'Frame p95': '95% измеренных кадров были отрисованы не медленнее этого времени. Меньше — лучше.',
  'Кадров в окне': 'Количество последних кадров, использованных для расчёта realtime-метрик.',
  'Long tasks': 'Задачи главного потока дольше 50 мс, которые могут вызывать зависания интерфейса.',
  'Видимых объектов': 'Число уникальных тематических объектов, реально попавших в текущую область карты.',
  'Попаданий в layers': 'Сколько раз видимые объекты попали в style layers. Один объект может учитываться несколько раз.',
  'Объектов в сцене': 'Общее число тестовых объектов, загруженных в текущий сценарий, включая невидимые на экране.',
  Zoom: 'Текущий уровень масштаба карты MapLibre.',
  'Тематических sources': 'Количество источников тестовых данных без учёта подложки.',
  'Тестовых layers': 'Количество style layers, созданных стендом для тестовых данных.',
  'Экран карты': 'Фактический размер canvas карты в CSS-пикселях.',
  'Буфер рендера': 'Физический размер WebGL-буфера. Он растёт вместе с DPR и напрямую влияет на нагрузку GPU.',
  'DPR рендера': 'Pixel ratio MapLibre, заданный стендом. Чем выше значение, тем больше пикселей отрисовывает GPU.',
  'DPR устройства': 'Системный Device Pixel Ratio браузера. Стенд его не меняет и показывает для сравнения.',
  'Радиус разброса': 'Максимальное расстояние объектов GeoJSON от центра Москвы. Чем меньше радиус, тем плотнее сцена.',
  'Плотность сцены': 'Расчётное число тестовых объектов на квадратный километр внутри заданного радиуса.',
  'JS heap': 'Объём памяти JavaScript, используемый страницей. Доступен не во всех браузерах.',
  'Логических CPU': 'Количество логических процессоров, которое браузер сообщает странице.',
  'Device memory': 'Приблизительный объём оперативной памяти устройства, сообщаемый браузером.',
  Network: 'Объём данных, переданных по сети за время текущего измерения.',
  Профиль: 'Выбранный профиль нагрузки и группировки обозначений.',
  Стиль: 'Используемая сложность визуализации: простые примитивы или составной ГОСТ proxy.',
  'Уникальных объектов': 'Количество разных тестовых объектов без повторов между style layers.',
  'Копий в sources': 'Сколько экземпляров объектов фактически хранится во всех тематических источниках.',
  'Объект × слой': 'Суммарное число сочетаний объектов и style layers, которые должен обработать движок.',
  'Видимых попаданий': 'Количество уникальных сочетаний видимого объекта и style layer на текущем экране.',
  'Sources темы': 'Количество источников тестовых данных без подложки.',
  'Sources всего': 'Все источники карты, включая тематические данные и подложку.',
  'Всего style layers': 'Все style layers карты, включая фон и подложку.',
  'Symbol layers': 'Количество слоёв символов, участвующих в размещении и проверке коллизий.',
  'Line / Fill': 'Количество линейных и полигональных style layers.',
  FPS: 'Средняя частота кадров во время автоматического pan/zoom. Чем выше, тем лучше.',
  'До idle': 'Время от запуска сценария до состояния MapLibre idle.',
  Setup: 'Время создания источников и style layers тестового сценария.',
  Score: 'Итоговая оценка 0–1000 для сравнения одинаковых сценариев на одном устройстве.',
  Плавность: 'До 550 очков за FPS и низкий frame p95.',
  Отзывчивость: 'До 250 очков за быстрое создание сцены и достижение idle.',
  Стабильность: 'До 200 очков за отсутствие long tasks и ошибок.',
};

function metricCell(label: string, value: string | number): string {
  const explanation = metricExplanations[label] ?? `Значение показателя «${label}» в текущем измерении.`;
  return `<div class="metric-cell" tabindex="0" data-tooltip="${escapeHtml(explanation)}"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value))}</dd></div>`;
}

function renderRealtimeMetrics(): void {
  const config = realtimeMonitor.config;
  if (!realtimeMonitor.active || !config) return;
  const rendered = activeLayerIds.length > 0 ? map.queryRenderedFeatures({layers: activeLayerIds}) : [];
  const uniqueFeatures = new Set<string>();
  for (const feature of rendered) {
    const featureId = feature.id ?? feature.properties?.id ?? JSON.stringify(feature.geometry);
    uniqueFeatures.add(`${feature.sourceLayer ?? feature.source}:${String(featureId)}`);
  }
  const frames = realtimeMonitor.frameDurations;
  const averageFrame = frames.length > 0 ? frames.reduce((sum, value) => sum + value, 0) / frames.length : 0;
  const fps = averageFrame > 0 ? 1000 / averageFrame : 0;
  const resourceNow = resourceSnapshot();
  const memory = performance as Performance & {memory?: {usedJSHeapSize: number; totalJSHeapSize: number}};
  const canvas = map.getCanvas();
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  const requestedFeatures = config.layerDataMode === 'partitioned'
    ? config.objectsPerLayer * config.layerCount
    : config.featureCount * config.geometries.length;
  const transferredMb = (resourceNow.transferredBytes - realtimeMonitor.resourceBefore.transferredBytes) / 1024 / 1024;
  const densityPerSquareKm = requestedFeatures / (Math.PI * config.spreadKm ** 2);
  const values = new Map<string, string>([
    ['FPS rolling', fps.toFixed(1)],
    ['Frame p95', `${percentile(frames, 0.95).toFixed(1)} ms`],
    ['Кадров в окне', String(frames.length)],
    ['Long tasks', String(realtimeMonitor.longTasks.length)],
    ['Видимых объектов', uniqueFeatures.size.toLocaleString('ru-RU')],
    ['Попаданий в layers', rendered.length.toLocaleString('ru-RU')],
    ['Объектов в сцене', requestedFeatures.toLocaleString('ru-RU')],
    ['Zoom', map.getZoom().toFixed(2)],
    ['Тематических sources', String(activeSourceIds.length)],
    ['Тестовых layers', String(activeLayerIds.length)],
    ['Экран карты', `${canvas.clientWidth} × ${canvas.clientHeight}`],
    ['Буфер рендера', `${canvas.width} × ${canvas.height}`],
    ['DPR рендера', map.getPixelRatio().toFixed(2)],
    ['DPR устройства', window.devicePixelRatio.toFixed(2)],
    ['Радиус разброса', `${config.spreadKm.toFixed(0)} км`],
    ['Плотность сцены', `${densityPerSquareKm.toFixed(2)} / км²`],
    ['JS heap', memory.memory ? `${(memory.memory.usedJSHeapSize / 1024 / 1024).toFixed(1)} MB` : 'н/д'],
    ['Логических CPU', String(navigator.hardwareConcurrency || 'н/д')],
    ['Device memory', (navigator as Navigator & {deviceMemory?: number}).deviceMemory ? `${(navigator as Navigator & {deviceMemory?: number}).deviceMemory} GB` : 'н/д'],
    ['Network', `${transferredMb.toFixed(2)} MB`],
  ]);

  if (!metricsElement.querySelector('.realtime-metrics')) {
    const realtimeDevice = deviceAssessment({
      environment: {
        userAgent: navigator.userAgent,
        viewport: {width: window.innerWidth, height: window.innerHeight, dpr: map.getPixelRatio()},
        hardwareConcurrency: navigator.hardwareConcurrency || null,
        deviceMemoryGb: (navigator as Navigator & {deviceMemory?: number}).deviceMemory ?? null,
        renderer: getRenderer(gl),
      },
    });
    metricsElement.innerHTML = `
      <div class="realtime-metrics">
        <h3>Плавность сейчас</h3>
        <dl>
          ${metricCell('FPS rolling', values.get('FPS rolling')!)}
          ${metricCell('Frame p95', values.get('Frame p95')!)}
          ${metricCell('Long tasks', values.get('Long tasks')!)}
        </dl>
        <h3>Что реально на экране</h3>
        <dl>
          ${metricCell('Видимых объектов', values.get('Видимых объектов')!)}
          ${metricCell('Попаданий в layers', values.get('Попаданий в layers')!)}
          ${metricCell('Объектов в сцене', values.get('Объектов в сцене')!)}
          ${metricCell('Тематических sources', values.get('Тематических sources')!)}
          ${metricCell('Тестовых layers', values.get('Тестовых layers')!)}
          ${metricCell('Буфер рендера', values.get('Буфер рендера')!)}
          ${metricCell('DPR рендера', values.get('DPR рендера')!)}
        </dl>
        <h3>Память и данные</h3>
        <dl>
          ${metricCell('JS heap', values.get('JS heap')!)}
          ${metricCell('Network', values.get('Network')!)}
        </dl>
        <section class="device-summary">
          <strong>${realtimeDevice.label}</strong>
          <span>${escapeHtml(realtimeDevice.detail)}</span>
          <small>${escapeHtml(getRenderer(gl) ?? 'WebGL renderer недоступен')}</small>
        </section>
        <p class="metric-note">Точный процент загрузки CPU/GPU браузер не предоставляет; FPS, frame time, long tasks и JS heap используются как клиентские индикаторы нагрузки.</p>
      </div>
    `;
  }

  for (const cell of metricsElement.querySelectorAll<HTMLElement>('.metric-cell')) {
    const label = cell.querySelector('dt')?.textContent;
    const value = label ? values.get(label) : undefined;
    const output = cell.querySelector('dd');
    if (value !== undefined && output) output.textContent = value;
  }
}

function stopRealtimeMonitoring(updateStatus = true): void {
  realtimeMonitor.active = false;
  if (realtimeMonitor.animationFrame !== null) cancelAnimationFrame(realtimeMonitor.animationFrame);
  if (realtimeMonitor.interval !== null) window.clearInterval(realtimeMonitor.interval);
  realtimeMonitor.observer?.disconnect();
  realtimeMonitor.animationFrame = null;
  realtimeMonitor.interval = null;
  realtimeMonitor.observer = null;
  realtimeMonitor.lastFrameAt = null;
  stopLiveButton.disabled = true;
  if (labMode.value === 'realtime') runButton.textContent = 'Запустить realtime';
  if (updateStatus) {
    setStatus('Realtime-мониторинг остановлен. Сцена оставлена на карте.');
    mapBadge.textContent = 'realtime · paused';
  }
}

function beginRealtimeMonitoring(config: BenchmarkConfig): void {
  realtimeMonitor.active = true;
  realtimeMonitor.config = config;
  realtimeMonitor.frameDurations = [];
  realtimeMonitor.longTasks = [];
  realtimeMonitor.lastFrameAt = null;
  realtimeMonitor.resourceBefore = resourceSnapshot();
  realtimeMonitor.startedAt = performance.now();
  if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
    realtimeMonitor.observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) realtimeMonitor.longTasks.push(entry.duration);
    });
    realtimeMonitor.observer.observe({entryTypes: ['longtask']});
  }
  realtimeMonitor.animationFrame = requestAnimationFrame(realtimeFrame);
  realtimeMonitor.interval = window.setInterval(renderRealtimeMetrics, 1_000);
  stopLiveButton.disabled = false;
  runButton.textContent = 'Перезапустить realtime';
  renderRealtimeMetrics();
}

async function startRealtime(partial: Partial<BenchmarkConfig> = {}): Promise<void> {
  const config = resolveConfig({...partial, labMode: 'realtime'});
  if (config.geometries.length === 0) throw new Error('Выберите хотя бы один тип геометрии');
  stopRealtimeMonitoring(false);
  setStatus('Перестроение realtime-сцены…', true);
  try {
    await waitForMapReady();
    map.setPixelRatio(config.pixelRatio);
    applyBasemap(config.basemap);
    let datasets = new Map<GeometryKind, GeneratedDataset>();
    if (config.mode === 'geojson') datasets = (await generateDatasets(config)).datasets;
    const idlePromise = waitForMapEvent('idle');
    await addScenario(config, datasets);
    await idlePromise;
    beginRealtimeMonitoring(config);
    setStatus('Realtime-мониторинг активен. Изменяйте сцену или перемещайте карту.');
    mapBadge.textContent = 'realtime · live';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Ошибка realtime: ${message}`);
    throw error;
  }
}

async function runBenchmark(partial: Partial<BenchmarkConfig> = {}): Promise<BenchmarkResult> {
  stopRealtimeMonitoring(false);
  const config = resolveConfig({...partial, labMode: 'benchmark'});
  if (config.geometries.length === 0) throw new Error('Выберите хотя бы один тип геометрии');
  if (config.layerCount < config.geometries.length) {
    throw new Error('Количество слоёв не может быть меньше числа выбранных типов геометрии');
  }
  if (config.mode === 'geojson' && config.layerDataMode === 'partitioned' && config.objectsPerLayer * config.layerCount > 2_000_000) {
    throw new Error('Для GeoJSON ограничьте общий набор двумя миллионами объектов или используйте MVT');
  }
  const errors: string[] = [];
  const longTasks: number[] = [];
  const resourceBefore = resourceSnapshot();
  const started = performance.now();
  let generationMs = 0;
  let datasets = new Map<GeometryKind, GeneratedDataset>();
  const screenshots: BenchmarkScreenshot[] = [];

  setStatus('Подготовка набора данных…', true);
  const errorHandler = (event: ErrorEvent | MapStyleImageMissingEvent) => {
    if ('error' in event) errors.push(event.error?.message ?? String(event.error));
  };
  map.on('error', errorHandler);

  let observer: PerformanceObserver | null = null;
  if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(entry.duration);
    });
    observer.observe({entryTypes: ['longtask']});
  }

  try {
    await waitForMapReady();
    map.setPixelRatio(config.pixelRatio);
    applyBasemap(config.basemap);
    if (config.mode === 'geojson') {
      const generated = await generateDatasets(config);
      datasets = generated.datasets;
      generationMs = generated.generationMs;
    }

    setStatus('Добавление источников и слоёв…', true);
    const setupStarted = performance.now();
    const renderPromise = waitForMapEvent('render');
    await addScenario(config, datasets);
    await renderPromise;
    const firstRenderMs = performance.now() - setupStarted;
    const idleStarted = performance.now();
    await waitForMapEvent('idle');
    const idleMs = performance.now() - idleStarted;
    screenshots.push(await captureMapSnapshot('scene-ready', 'Сцена готова до движения', started));

    setStatus('Измерение pan/zoom и времени кадров…', true);
    const interactionStarted = performance.now();
    const [frames] = await Promise.all([
      sampleFrames(config.interactionMs),
      animateCamera(config.interactionMs, async () => {
        screenshots.push(await captureMapSnapshot('interaction-mid', 'Середина pan/zoom', started));
      }),
    ]);
    const interactionMs = performance.now() - interactionStarted;
    screenshots.push(await captureMapSnapshot('completed', 'Финальное состояние карты', started));
    const resourceAfter = resourceSnapshot();
    const canvas = map.getCanvas();
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    const memory = performance as Performance & {
      memory?: {usedJSHeapSize: number; totalJSHeapSize: number};
    };

    lastResult = {
      schemaVersion: 6,
      runId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      config,
      environment: {
        userAgent: navigator.userAgent,
        viewport: {width: window.innerWidth, height: window.innerHeight, dpr: map.getPixelRatio()},
        hardwareConcurrency: navigator.hardwareConcurrency || null,
        deviceMemoryGb: (navigator as Navigator & {deviceMemory?: number}).deviceMemory ?? null,
        renderer: getRenderer(gl),
      },
      timings: {
        datasetGenerationMs: generationMs,
        sourceAndLayerSetupMs: firstRenderMs,
        firstRenderMs,
        idleMs,
        interactionMs,
        totalMs: performance.now() - started,
      },
      frames,
      longTasks: {
        count: longTasks.length,
        totalMs: longTasks.reduce((sum, value) => sum + value, 0),
        maxMs: Math.max(0, ...longTasks),
      },
      network: {
        requests: resourceAfter.requests - resourceBefore.requests,
        transferredBytes: resourceAfter.transferredBytes - resourceBefore.transferredBytes,
        decodedBytes: resourceAfter.decodedBytes - resourceBefore.decodedBytes,
      },
      memory: {
        usedJsHeapBytes: memory.memory?.usedJSHeapSize ?? null,
        totalJsHeapBytes: memory.memory?.totalJSHeapSize ?? null,
      },
      map: {
        sources: activeSourceIds.length,
        layers: activeLayerIds.length,
        loadedTiles: null,
        canvasCssPixels: {width: canvas.clientWidth, height: canvas.clientHeight},
        renderBufferPixels: {
          width: canvas.width,
          height: canvas.height,
          megapixels: Number((canvas.width * canvas.height / 1_000_000).toFixed(2)),
        },
      },
      workload: calculateWorkload(config),
      score: {total: 0, smoothness: 0, responsiveness: 0, stability: 0, scenarioKey: ''},
      screenshots,
      errors,
    };
    lastResult.score = calculateBenchmarkScore(lastResult);
    storeScoreResult(lastResult);
    renderMetrics(lastResult);
    downloadButton.disabled = false;
    downloadHtmlButton.disabled = false;
    viewReportButton.disabled = false;
    const volume = config.layerDataMode === 'partitioned'
      ? `${config.layerCount} слоёв × ${config.objectsPerLayer.toLocaleString('ru-RU')} объектов`
      : `${config.geometries.length} типов × ${config.featureCount.toLocaleString('ru-RU')} объектов`;
    setStatus(`Готово: ${config.mode.toUpperCase()}, ${volume}.`);
    return lastResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Ошибка: ${message}`);
    throw error;
  } finally {
    observer?.disconnect();
    map.off('error', errorHandler);
  }
}

function scoreScenarioKey(config: BenchmarkConfig): string {
  return JSON.stringify({
    profile: config.profile,
    styleMode: config.styleMode,
    geometries: [...config.geometries].sort(),
    basemap: config.basemap,
    layerDataMode: config.layerDataMode,
    objectsPerLayer: config.objectsPerLayer,
    featureCount: config.featureCount,
    verticesPerFeature: config.verticesPerFeature,
    sourceCount: config.sourceCount,
    layerCount: config.layerCount,
    pixelRatio: config.pixelRatio,
    spreadKm: config.spreadKm,
    collisionLayer: config.collisionLayer,
    interactionMs: config.interactionMs,
    seed: config.seed,
  });
}

function calculateBenchmarkScore(result: BenchmarkResult): BenchmarkScore {
  const fpsPoints = 300 * Math.min(1, result.frames.fps / 60);
  const framePoints = 250 * Math.min(1, 16.67 / Math.max(16.67, result.frames.frameMsP95));
  const idlePoints = 150 * Math.min(1, 1_000 / Math.max(1_000, result.timings.idleMs));
  const setupPoints = 100 * Math.min(1, 500 / Math.max(500, result.timings.sourceAndLayerSetupMs));
  const longTaskPoints = 150 * Math.max(0, 1 - result.longTasks.totalMs / 1_000);
  const errorPoints = result.errors.length === 0 ? 50 : 0;
  const smoothness = Math.round(fpsPoints + framePoints);
  const responsiveness = Math.round(idlePoints + setupPoints);
  const stability = Math.round(longTaskPoints + errorPoints);
  return {
    total: Math.max(0, Math.min(1_000, smoothness + responsiveness + stability)),
    smoothness,
    responsiveness,
    stability,
    scenarioKey: scoreScenarioKey(result.config),
  };
}

function loadScoreHistory(): BenchmarkResult[] {
  try {
    const stored = JSON.parse(localStorage.getItem(SCORE_HISTORY_STORAGE_KEY) ?? '[]') as BenchmarkResult[];
    return Array.isArray(stored)
      ? stored.filter((result) => [5, 6].includes(result?.schemaVersion) && typeof result.score?.total === 'number').slice(0, 20)
      : [];
  } catch {
    return [];
  }
}

function updateScoreboardButton(): void {
  const empty = scoreHistory.length === 0;
  scoreboardButton.disabled = empty;
  viewReportButton.disabled = empty;
  downloadButton.disabled = empty;
  downloadHtmlButton.disabled = empty;
  scoreboardButton.textContent = scoreHistory.length > 0 ? `История запусков · ${scoreHistory.length}` : 'История запусков';
}

function storeScoreResult(result: BenchmarkResult): void {
  scoreHistory = [result, ...scoreHistory.filter((item) => item.runId !== result.runId)].slice(0, 20);
  try {
    localStorage.setItem(SCORE_HISTORY_STORAGE_KEY, JSON.stringify(scoreHistory));
  } catch {
    scoreHistory = scoreHistory.map((item, index) => index < 8 ? item : {...item, screenshots: undefined});
    try {
      localStorage.setItem(SCORE_HISTORY_STORAGE_KEY, JSON.stringify(scoreHistory));
    } catch {
      scoreHistory = scoreHistory.map((item, index) => index === 0 ? item : {...item, screenshots: undefined});
      try {
        localStorage.setItem(SCORE_HISTORY_STORAGE_KEY, JSON.stringify(scoreHistory));
      } catch {
        // Прогон остаётся доступен в текущей вкладке, даже если хранилище браузера заполнено.
      }
    }
  }
  updateScoreboardButton();
}

function renderScoreboard(): void {
  const scenarioKey = lastResult?.score.scenarioKey;
  const comparable = scenarioKey
    ? scoreHistory.filter((result) => result.score.scenarioKey === scenarioKey).sort((a, b) => b.score.total - a.score.total)
    : [];
  const history = [...scoreHistory].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  if (history.length === 0) {
    scoreboardContent.innerHTML = '<div class="score-empty">Сначала выполните Benchmark.</div>';
    return;
  }
  const podium = comparable.slice(0, 3).map((result, index) => `
    <div class="score-place">
      <span>${index + 1} место · ${result.config.mode.toUpperCase()}</span>
      <strong>${result.score.total}</strong>
      <small>${new Date(result.timestamp).toLocaleTimeString('ru-RU')}</small>
    </div>
  `).join('');
  const historyRows = history.map((result) => `
    <tr class="${result.score.scenarioKey === scenarioKey ? 'is-comparable' : ''}">
      <td>${new Date(result.timestamp).toLocaleString('ru-RU', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'})}</td>
      <td><strong>${result.score.total}</strong></td>
      <td>${result.config.mode.toUpperCase()}</td>
      <td>${profileLabel(result.config.profile)}</td>
      <td>${result.config.featureCount.toLocaleString('ru-RU')}</td>
      <td>${result.config.layerCount}</td>
      <td>${result.config.spreadKm} км</td>
      <td>${result.frames.fps.toFixed(1)}</td>
      <td>${result.frames.frameMsP95.toFixed(1)} ms</td>
    </tr>
  `).join('');
  scoreboardContent.innerHTML = `
    <p class="scoreboard-note">Пьедестал сравнивает запуски с настройками последнего результата; доставка GeoJSON/MVT может отличаться. Ниже всегда показана полная история. Score: плавность 550, отзывчивость 250, стабильность 200 очков.</p>
    <h3 class="scoreboard-section-title">Сопоставимый рейтинг · ${comparable.length}</h3>
    ${comparable.length > 0 ? `<div class="score-podium">${podium}</div>` : '<div class="score-empty">Запустите Benchmark, чтобы построить сопоставимый рейтинг.</div>'}
    <h3 class="scoreboard-section-title">Вся история · ${history.length}</h3>
    <table class="score-table">
      <thead><tr><th>Дата</th><th>Score</th><th>Доставка</th><th>Профиль</th><th>Объектов</th><th>Layers</th><th>Разброс</th><th>FPS</th><th>p95</th></tr></thead>
      <tbody>${historyRows}</tbody>
    </table>
  `;
}

function verdictFor(result: BenchmarkResult): {tone: 'good' | 'warn' | 'bad'; label: string; text: string} {
  if (result.errors.length > 0 || result.score.total < 550) {
    return {tone: 'bad', label: 'Перегружено', text: 'Сценарий заметно превышает комфортный предел этого устройства.'};
  }
  if (result.score.total < 800 || result.frames.frameMsP95 > 25) {
    return {tone: 'warn', label: 'На границе', text: 'Карта работает, но возможны рывки и задержки при взаимодействии.'};
  }
  return {tone: 'good', label: 'Стабильно', text: 'Устройство уверенно справилось с этим сценарием.'};
}

function deviceAssessment(result: Pick<BenchmarkResult, 'environment'>): {label: string; detail: string} {
  const cores = result.environment.hardwareConcurrency;
  const memory = result.environment.deviceMemoryGb;
  if (cores === null && memory === null) return {label: 'Не определён', detail: 'Браузер скрыл сведения о CPU и памяти'};
  const points = (cores === null ? 1 : cores >= 12 ? 3 : cores >= 6 ? 2 : 1)
    + (memory === null ? 1 : memory >= 8 ? 3 : memory >= 4 ? 2 : 1);
  const label = points >= 6 ? 'Высокий класс' : points >= 4 ? 'Средний класс' : 'Базовый класс';
  return {
    label,
    detail: `${cores ?? 'н/д'} логич. CPU · ${memory ? `${memory} GB RAM` : 'RAM н/д'} · эвристика`,
  };
}

function bottleneckFor(result: BenchmarkResult): string {
  if (result.errors.length) return `Ошибки карты: ${result.errors[0]}`;
  if (result.frames.frameMsP95 > 33) return 'Основное ограничение — тяжёлые кадры во время pan/zoom.';
  if (result.longTasks.totalMs > 300) return 'Основное ограничение — блокировки главного потока JavaScript.';
  if (result.timings.idleMs > 2_000) return 'Основное ограничение — долгая подготовка карты до состояния idle.';
  if (result.timings.sourceAndLayerSetupMs > 1_000) return 'Основное ограничение — создание sources и style layers.';
  return 'Явного узкого места в этом прогоне не обнаружено.';
}

function comparableDelta(result: BenchmarkResult): string | null {
  const previous = scoreHistory.find((item) => item.runId !== result.runId && item.score.scenarioKey === result.score.scenarioKey);
  if (!previous) return null;
  const delta = result.score.total - previous.score.total;
  return `${delta >= 0 ? '+' : ''}${delta} к предыдущему сопоставимому запуску`;
}

function renderMetrics(result: BenchmarkResult): void {
  const verdict = verdictFor(result);
  const device = deviceAssessment(result);
  const bufferMp = result.map.renderBufferPixels?.megapixels
    ?? Number((result.environment.viewport.width * result.environment.viewport.height * result.environment.viewport.dpr ** 2 / 1_000_000).toFixed(2));
  const delta = comparableDelta(result);
  setResultPanelCollapsed(false);
  metricsElement.innerHTML = `
    <section class="result-verdict is-${verdict.tone}">
      <div><span>Итог сценария</span><strong>${verdict.label}</strong></div>
      <b>${result.score.total}<small>/1000</small></b>
      <p>${verdict.text}</p>
      ${delta ? `<small class="result-delta">${escapeHtml(delta)}</small>` : ''}
    </section>
    <h3>Что реально отрисовано</h3>
    <div class="result-hero-grid">
      <div><span>Объектов на экране</span><strong>${result.workload.visibleUniqueFeatures.toLocaleString('ru-RU')}</strong><small>уникальных</small></div>
      <div><span>Попаданий в стили</span><strong>${result.workload.visibleFeatureLayerHits.toLocaleString('ru-RU')}</strong><small>объект × layer</small></div>
      <div><span>Буфер GPU</span><strong>${bufferMp.toFixed(2)}</strong><small>мегапикселей</small></div>
    </div>
    <section class="plain-result-list">
      <div><span>Загружено в сценарий</span><strong>${result.workload.requestedUniqueFeatures.toLocaleString('ru-RU')} объектов</strong></div>
      <div><span>Структура карты</span><strong>${result.workload.benchmarkSources} sources · ${result.workload.benchmarkLayers} layers</strong></div>
      <div><span>Плавность pan/zoom</span><strong>${result.frames.fps.toFixed(1)} FPS · p95 ${result.frames.frameMsP95.toFixed(1)} ms</strong></div>
      <div><span>Подготовка</span><strong>setup ${result.timings.sourceAndLayerSetupMs.toFixed(0)} ms · idle ${result.timings.idleMs.toFixed(0)} ms</strong></div>
    </section>
    <h3>Устройство</h3>
    <section class="device-summary">
      <strong>${device.label}</strong>
      <span>${escapeHtml(device.detail)}</span>
      <small>${escapeHtml(result.environment.renderer ?? 'WebGL renderer не раскрыт')}</small>
    </section>
    <p class="bottleneck-note">${escapeHtml(bottleneckFor(result))}</p>
    <p class="metric-note">Класс устройства — ориентир по данным браузера, не измерение загрузки CPU/GPU в процентах. Все сырые метрики и снимки карты находятся в отчёте.</p>
  `;
}

function profileLabel(profile: BenchmarkProfile): string {
  return ({
    custom: 'Свой',
    'gost-optimized': 'ГОСТ opt',
    'gost-working': 'ГОСТ work',
    'gost-literal': 'ГОСТ 59/84',
  } as const)[profile];
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function reportRows(rows: Array<[string, string | number]>): string {
  return rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
}

function singleRunReportContent(result: BenchmarkResult): string {
  const config = result.config;
  const verdict = verdictFor(result);
  const device = deviceAssessment(result);
  const screenshots = result.screenshots?.map((shot) => `
    <figure class="report-shot">
      ${shot.dataUrl ? `<img src="${shot.dataUrl}" alt="${escapeHtml(shot.label)}">` : '<div class="shot-missing">Снимок недоступен</div>'}
      <figcaption><strong>${escapeHtml(shot.label)}</strong><span>+${shot.elapsedMs} ms · zoom ${shot.zoom.toFixed(2)} · ${shot.visibleUniqueFeatures.toLocaleString('ru-RU')} объектов на экране</span>${shot.error ? `<small>${escapeHtml(shot.error)}</small>` : ''}</figcaption>
    </figure>
  `).join('') ?? '';
  return `
    <section class="report-summary">
      <div><span>Вердикт</span><strong>${verdict.label}</strong></div>
      <div><span>Score</span><strong>${result.score.total}</strong></div>
      <div><span>На экране</span><strong>${result.workload.visibleUniqueFeatures.toLocaleString('ru-RU')}</strong></div>
      <div><span>FPS / p95</span><strong>${result.frames.fps.toFixed(1)} / ${result.frames.frameMsP95.toFixed(1)}</strong></div>
      <div><span>Устройство</span><strong>${device.label}</strong></div>
    </section>
    <p class="report-conclusion">${escapeHtml(verdict.text)} ${escapeHtml(bottleneckFor(result))}</p>
    ${screenshots ? `<section class="report-section"><h3>Карта по этапам</h3><div class="report-shots">${screenshots}</div></section>` : ''}
    <section class="report-section">
      <h3>Сценарий</h3>
      <dl>${reportRows([
        ['Run ID', result.runId],
        ['Дата', new Date(result.timestamp).toLocaleString('ru-RU')],
        ['Профиль', profileLabel(config.profile)],
        ['Доставка', config.mode.toUpperCase()],
        ['Геометрии', config.geometries.join(', ')],
        ['Стилизация', config.styleMode === 'gost' ? 'ГОСТ proxy' : 'Простая'],
        ['DPR рендера', config.pixelRatio.toFixed(2)],
        ['Разброс', `${config.spreadKm.toFixed(0)} км`],
        ['Объектов на тип', config.featureCount.toLocaleString('ru-RU')],
        ['Источников темы', result.workload.benchmarkSources],
        ['Тестовых layers', result.workload.benchmarkLayers],
      ])}</dl>
    </section>
    <section class="report-section">
      <h3>Нагрузка и экран</h3>
      <dl>${reportRows([
        ['Уникальных объектов', result.workload.requestedUniqueFeatures.toLocaleString('ru-RU')],
        ['Копий в sources', result.workload.sourceFeatureCopies.toLocaleString('ru-RU')],
        ['Объект × слой', result.workload.featureLayerPairs.toLocaleString('ru-RU')],
        ['Видимых объектов', result.workload.visibleUniqueFeatures.toLocaleString('ru-RU')],
        ['Видимых попаданий', result.workload.visibleFeatureLayerHits.toLocaleString('ru-RU')],
        ['Буфер рендера', result.map.renderBufferPixels ? `${result.map.renderBufferPixels.width} × ${result.map.renderBufferPixels.height} · ${result.map.renderBufferPixels.megapixels} MP` : 'н/д'],
        ['Symbol / Line / Fill', `${result.workload.layerTypes.symbol} / ${result.workload.layerTypes.line} / ${result.workload.layerTypes.fill}`],
        ['Viewport', `${result.environment.viewport.width} × ${result.environment.viewport.height} @${result.environment.viewport.dpr}`],
        ['Плотность сцены', `${(result.workload.requestedUniqueFeatures / (Math.PI * config.spreadKm ** 2)).toFixed(2)} / км²`],
      ])}</dl>
    </section>
    <section class="report-section">
      <h3>Производительность</h3>
      <dl>${reportRows([
        ['FPS', result.frames.fps.toFixed(1)],
        ['Frame p50', `${result.frames.frameMsP50.toFixed(1)} ms`],
        ['Frame p95', `${result.frames.frameMsP95.toFixed(1)} ms`],
        ['Frame p99', `${result.frames.frameMsP99.toFixed(1)} ms`],
        ['Кадров >16 ms', result.frames.framesOver16Ms],
        ['Кадров >50 ms', result.frames.framesOver50Ms],
        ['Setup', `${result.timings.sourceAndLayerSetupMs.toFixed(0)} ms`],
        ['До idle', `${result.timings.idleMs.toFixed(0)} ms`],
        ['Long tasks', `${result.longTasks.count} / ${result.longTasks.totalMs.toFixed(0)} ms`],
        ['Network', `${(result.network.transferredBytes / 1024 / 1024).toFixed(2)} MB`],
        ['JS heap', result.memory.usedJsHeapBytes ? `${(result.memory.usedJsHeapBytes / 1024 / 1024).toFixed(1)} MB` : 'н/д'],
      ])}</dl>
    </section>
    <section class="report-section">
      <h3>Окружение</h3>
      <dl>${reportRows([
        ['WebGL', result.environment.renderer ?? 'н/д'],
        ['Логических CPU', result.environment.hardwareConcurrency ?? 'н/д'],
        ['Device memory', result.environment.deviceMemoryGb ? `${result.environment.deviceMemoryGb} GB` : 'н/д'],
        ['User agent', result.environment.userAgent],
        ['Ошибки', result.errors.length ? result.errors.join('; ') : 'Нет'],
      ])}</dl>
    </section>
  `;
}

function cumulativeReportContent(history: BenchmarkResult[]): string {
  if (history.length === 0) return '<div class="score-empty">Сначала выполните Benchmark.</div>';
  const latest = history[0];
  const rows = history.map((run, index) => {
    const verdict = verdictFor(run);
    return `<tr class="${index === 0 ? 'is-comparable' : ''}"><td>${new Date(run.timestamp).toLocaleString('ru-RU')}</td><td>${run.config.mode.toUpperCase()}</td><td>${profileLabel(run.config.profile)}</td><td>${run.workload.visibleUniqueFeatures.toLocaleString('ru-RU')}</td><td>${run.workload.benchmarkSources} / ${run.workload.benchmarkLayers}</td><td>${run.frames.fps.toFixed(1)}</td><td>${run.frames.frameMsP95.toFixed(1)} ms</td><td>${run.score.total}</td><td>${verdict.label}</td></tr>`;
  }).join('');
  return `
    <section class="report-history-head">
      <div><span>Запусков сохранено</span><strong>${history.length}</strong></div>
      <div><span>Период</span><strong>${new Date(history.at(-1)!.timestamp).toLocaleDateString('ru-RU')} — ${new Date(latest.timestamp).toLocaleDateString('ru-RU')}</strong></div>
      <div><span>Последний сценарий</span><strong>${latest.config.mode.toUpperCase()} · ${latest.workload.benchmarkSources}/${latest.workload.benchmarkLayers}</strong></div>
    </section>
    <section class="report-section"><h3>Сравнение всех запусков</h3><div class="report-table-wrap"><table class="score-table"><thead><tr><th>Дата</th><th>Доставка</th><th>Профиль</th><th>На экране</th><th>Sources / layers</th><th>FPS</th><th>p95</th><th>Score</th><th>Итог</th></tr></thead><tbody>${rows}</tbody></table></div></section>
    <section class="report-run"><h2>Последний запуск</h2>${singleRunReportContent(latest)}</section>
    ${history.slice(1).map((run, index) => `<details class="report-run"><summary>${history.length - index - 1}. ${new Date(run.timestamp).toLocaleString('ru-RU')} · ${run.config.mode.toUpperCase()} · score ${run.score.total}</summary>${singleRunReportContent(run)}</details>`).join('')}
  `;
}

function cumulativeReportDocument(history: BenchmarkResult[]): string {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MapLibre cumulative benchmark report</title><style>
    :root{font-family:Inter,system-ui,sans-serif;color:#18302b;background:#eef4f1}body{max-width:1280px;margin:0 auto;padding:32px}header{margin-bottom:24px}h1{margin:4px 0;font-size:30px}p{color:#59716b}.report-history-head,.report-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.report-history-head>div,.report-summary>div,.report-section,.report-run{background:#fff;border:1px solid #d7e3de;border-radius:12px;padding:18px}.report-history-head span,.report-summary span,dt{color:#688079;font-size:11px;text-transform:uppercase;letter-spacing:.06em}.report-history-head strong,.report-summary strong{display:block;margin-top:6px;font-size:21px}.report-section,.report-run{margin-top:14px}.report-section h3{margin:0 0 12px}.report-section dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1px;margin:0;background:#dce7e2}.report-section dl div{background:#fff;padding:10px}.report-section dd{margin:4px 0 0;font-weight:600;overflow-wrap:anywhere}.report-conclusion{padding:14px;background:#edf7f2;border-left:4px solid #29a77d}.report-shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}.report-shot{margin:0;border:1px solid #d7e3de;border-radius:10px;overflow:hidden}.report-shot img,.shot-missing{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;background:#dce7e2}.shot-missing{display:grid;place-items:center;color:#688079}.report-shot figcaption{display:grid;gap:3px;padding:10px}.report-shot figcaption span,.report-shot figcaption small{color:#688079;font-size:11px}.score-table{width:100%;border-collapse:collapse;font-size:12px}.score-table th,.score-table td{padding:9px;text-align:left;border-bottom:1px solid #d7e3de}.report-table-wrap{overflow:auto}details summary{cursor:pointer;font-weight:700}.report-run h2{margin-top:0}@media(max-width:700px){body{padding:14px}}@media print{body{background:#fff;padding:0}.report-section,.report-summary>div,.report-run{break-inside:avoid}}
  </style></head><body><header><p>ЦП ЕИТП · GIS PoC</p><h1>MapLibre Performance Lab</h1><p>Накопительный отчёт сформирован ${escapeHtml(new Date().toLocaleString('ru-RU'))}. Сохранено запусков: ${history.length}.</p></header>${cumulativeReportContent(history)}</body></html>`;
}

function cumulativeReportData(history: BenchmarkResult[]): object {
  return {
    reportSchemaVersion: 1,
    generatedAt: new Date().toISOString(),
    description: 'Накопительный отчёт MapLibre Performance Lab. Сравнивать score следует только у одинаковых scenarioKey.',
    limitations: ['Браузер не предоставляет точную загрузку CPU/GPU в процентах.', 'Класс устройства является эвристической оценкой.'],
    runs: history,
  };
}

function downloadTextFile(contents: string, filename: string, type: string): void {
  const blob = new Blob([contents], {type});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formConfig(form: HTMLFormElement): BenchmarkConfig {
  const data = new FormData(form);
  const geometries = data.getAll('geometries') as GeometryKind[];
  if (geometries.length === 0) throw new Error('Выберите хотя бы один тип геометрии');
  return {
    labMode: data.get('labMode') as BenchmarkConfig['labMode'],
    profile: data.get('profile') as BenchmarkConfig['profile'],
    styleMode: data.get('styleMode') as BenchmarkConfig['styleMode'],
    mode: data.get('mode') as BenchmarkConfig['mode'],
    geometries,
    basemap: data.get('basemap') as BenchmarkConfig['basemap'],
    layerDataMode: data.get('layerDataMode') as BenchmarkConfig['layerDataMode'],
    objectsPerLayer: Number((form.elements.namedItem('objectsPerLayer') as HTMLInputElement).value),
    featureCount: Number(data.get('featureCount')),
    verticesPerFeature: Number(data.get('verticesPerFeature')),
    sourceCount: Number(data.get('sourceCount')),
    layerCount: Number(data.get('layerCount')),
    pixelRatio: Number(data.get('pixelRatio')),
    spreadKm: Number(data.get('spreadKm')),
    collisionLayer: data.get('collisionLayer') === 'on',
    interactionMs: Number(data.get('interactionMs')),
    seed: Number(data.get('seed')),
  };
}

const benchmarkForm = document.querySelector<HTMLFormElement>('#benchmark-form')!;
const labMode = document.querySelector<HTMLInputElement>('#lab-mode')!;
const labModeTabs = document.querySelectorAll<HTMLButtonElement>('[data-lab-mode]');
const labModeHint = document.querySelector<HTMLSpanElement>('#lab-mode-hint')!;
const benchmarkProfile = document.querySelector<HTMLSelectElement>('#benchmark-profile')!;
const profileHint = document.querySelector<HTMLSpanElement>('#profile-hint')!;
const styleMode = document.querySelector<HTMLSelectElement>('#style-mode')!;
const layerDataMode = document.querySelector<HTMLSelectElement>('#layer-data-mode')!;
const objectsPerLayer = document.querySelector<HTMLInputElement>('#objects-per-layer')!;
const pixelRatioInput = benchmarkForm.elements.namedItem('pixelRatio') as HTMLInputElement;
const sourceCountInput = benchmarkForm.elements.namedItem('sourceCount') as HTMLInputElement;

function syncSourceMinimum(): void {
  const selectedGeometryCount = benchmarkForm.querySelectorAll('input[name="geometries"]:checked').length;
  const minimum = Math.max(1, selectedGeometryCount);
  sourceCountInput.min = String(minimum);
  if (Number(sourceCountInput.value) < minimum) sourceCountInput.value = String(minimum);
}

function applyConfigToForm(config: BenchmarkConfig): void {
  const values: Array<[string, string | number]> = [
    ['labMode', config.labMode],
    ['profile', config.profile],
    ['styleMode', config.styleMode],
    ['mode', config.mode],
    ['basemap', config.basemap],
    ['layerDataMode', config.layerDataMode],
    ['objectsPerLayer', config.objectsPerLayer],
    ['featureCount', config.featureCount],
    ['verticesPerFeature', config.verticesPerFeature],
    ['sourceCount', config.sourceCount],
    ['layerCount', config.layerCount],
    ['pixelRatio', config.pixelRatio],
    ['spreadKm', config.spreadKm],
    ['interactionMs', config.interactionMs],
    ['seed', config.seed],
  ];
  for (const [name, value] of values) {
    const control = benchmarkForm.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
    if (control) control.value = String(value);
  }
  for (const checkbox of benchmarkForm.querySelectorAll<HTMLInputElement>('input[name="geometries"]')) {
    checkbox.checked = config.geometries.includes(checkbox.value as GeometryKind);
  }
  (benchmarkForm.elements.namedItem('collisionLayer') as HTMLInputElement).checked = config.collisionLayer;
  objectsPerLayer.disabled = config.layerDataMode !== 'partitioned';
  syncSourceMinimum();
  updateProfileHint(config.profile, config.styleMode);
  updateLabMode(config.labMode);
}

function updateLabMode(mode: BenchmarkConfig['labMode']): void {
  const realtime = mode === 'realtime';
  labMode.value = mode;
  for (const tab of labModeTabs) {
    tab.setAttribute('aria-selected', String(tab.dataset.labMode === mode));
  }
  liveControls.hidden = !realtime;
  runButton.textContent = realtime ? 'Запустить realtime' : 'Запустить измерение';
  labModeHint.textContent = realtime
    ? 'Непрерывные метрики при изменении сцены и движении карты.'
    : 'Один воспроизводимый прогон с итоговым отчётом.';
  if (!realtime && realtimeMonitor.active) stopRealtimeMonitoring();
}

function updateProfileHint(profile: BenchmarkProfile, styleMode: BenchmarkConfig['styleMode']): void {
  const hints: Record<BenchmarkProfile, string> = {
    custom: styleMode === 'gost'
      ? 'Ручная конфигурация с составными линиями, знаками, штриховкой и подписями.'
      : 'Простой стиль без составных обозначений.',
    'gost-optimized': '3 источника всего · 30 style layers · объединённые классы.',
    'gost-working': '4 источника всего · 48 style layers · рекомендуемый предметный сценарий.',
    'gost-literal': '59 источников всего · 84 style layers · тяжёлый вариант по структуре приложения А.',
  };
  profileHint.textContent = hints[profile];
}

function persistSettings(): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(formConfig(benchmarkForm)));
  } catch {
    // Не сохраняем промежуточное невалидное состояние, например без геометрии.
  }
}

function applyLivePixelRatio(): void {
  const requested = Number(pixelRatioInput.value);
  if (!Number.isFinite(requested) || requested < 0.5 || requested > 4) return;
  const pixelRatio = Math.min(4, Math.max(0.5, requested));
  if (!realtimeMonitor.active || !realtimeMonitor.config) return;
  map.setPixelRatio(pixelRatio);
  realtimeMonitor.config = {...realtimeMonitor.config, pixelRatio};
  renderRealtimeMetrics();
  setStatus(`DPR рендера ${pixelRatio.toFixed(2)} применён без перестройки сцены.`);
  mapBadge.textContent = 'realtime · live';
}

applyConfigToForm(initialConfig);
setResultPanelCollapsed(localStorage.getItem(RESULT_PANEL_STORAGE_KEY) === 'true', false);

layerDataMode.addEventListener('change', () => {
  objectsPerLayer.disabled = layerDataMode.value !== 'partitioned';
});
for (const tab of labModeTabs) {
  tab.addEventListener('click', () => {
    updateLabMode(tab.dataset.labMode as BenchmarkConfig['labMode']);
    persistSettings();
  });
}
styleMode.addEventListener('change', () => {
  if (benchmarkProfile.value === 'custom') updateProfileHint('custom', styleMode.value as BenchmarkConfig['styleMode']);
});
for (const checkbox of benchmarkForm.querySelectorAll<HTMLInputElement>('input[name="geometries"]')) {
  checkbox.addEventListener('change', syncSourceMinimum);
}
benchmarkProfile.addEventListener('change', () => {
  const profile = benchmarkProfile.value as BenchmarkProfile;
  if (profile === 'custom') {
    updateProfileHint(profile, (benchmarkForm.elements.namedItem('styleMode') as HTMLSelectElement).value as BenchmarkConfig['styleMode']);
    persistSettings();
    return;
  }
  const current = formConfig(benchmarkForm);
  const next: BenchmarkConfig = {...current, ...profilePresets[profile], profile};
  applyConfigToForm(next);
  persistSettings();
  setStatus(`Профиль «${benchmarkProfile.selectedOptions[0].textContent}» применён. Можно запускать измерение.`);
});
benchmarkForm.addEventListener('input', (event) => {
  persistSettings();
  if (event.target === pixelRatioInput) {
    applyLivePixelRatio();
  } else if (realtimeMonitor.active) {
    runButton.textContent = 'Применить изменения';
  }
});
benchmarkForm.addEventListener('change', persistSettings);
resultPanelToggle.addEventListener('click', () => {
  setResultPanelCollapsed(resultPanel.getAttribute('aria-expanded') === 'true');
});
resetSettingsButton.addEventListener('click', () => {
  stopRealtimeMonitoring(false);
  localStorage.removeItem(SETTINGS_STORAGE_KEY);
  applyConfigToForm(defaults);
  void waitForMapReady().then(() => applyBasemap(defaults.basemap));
  setStatus('Настройки сброшены. Карта готова к запуску.');
});
benchmarkForm.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    const config = formConfig(benchmarkForm);
    const action = config.labMode === 'realtime' ? startRealtime(config) : runBenchmark(config);
    void action.catch(console.error);
  } catch (error) {
    setStatus(`Ошибка: ${error instanceof Error ? error.message : String(error)}`);
  }
});

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-live-field]')) {
  button.addEventListener('click', () => {
    const field = button.dataset.liveField;
    const delta = Number(button.dataset.liveDelta);
    if (!field || !Number.isFinite(delta)) return;
    const input = benchmarkForm.elements.namedItem(field) as HTMLInputElement | null;
    if (!input) return;
    const minimum = Number(input.min || 0);
    const maximum = Number(input.max || Number.MAX_SAFE_INTEGER);
    input.value = String(Math.min(maximum, Math.max(minimum, Number(input.value) + delta)));
    persistSettings();
    void startRealtime(formConfig(benchmarkForm)).catch(console.error);
  });
}

toggleLiveStyleButton.addEventListener('click', () => {
  styleMode.value = styleMode.value === 'gost' ? 'simple' : 'gost';
  persistSettings();
  void startRealtime(formConfig(benchmarkForm)).catch(console.error);
});

stopLiveButton.addEventListener('click', () => stopRealtimeMonitoring());

downloadButton.addEventListener('click', () => {
  if (scoreHistory.length === 0) return;
  downloadTextFile(JSON.stringify(cumulativeReportData(scoreHistory), null, 2), `maplibre-benchmark-history-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
});

downloadHtmlButton.addEventListener('click', () => {
  if (scoreHistory.length === 0) return;
  downloadTextFile(cumulativeReportDocument(scoreHistory), `maplibre-benchmark-report-${new Date().toISOString().slice(0, 10)}.html`, 'text/html');
});

viewReportButton.addEventListener('click', () => {
  if (scoreHistory.length === 0) return;
  reportDialogContent.innerHTML = cumulativeReportContent(scoreHistory);
  reportDialog.showModal();
});

closeReportButton.addEventListener('click', () => reportDialog.close());

scoreboardButton.addEventListener('click', () => {
  renderScoreboard();
  scoreboardDialog.showModal();
});

closeScoreboardButton.addEventListener('click', () => scoreboardDialog.close());

clearScoreboardButton.addEventListener('click', () => {
  scoreHistory = [];
  localStorage.removeItem(SCORE_HISTORY_STORAGE_KEY);
  updateScoreboardButton();
  renderScoreboard();
});

scoreHistory = loadScoreHistory();
updateScoreboardButton();

map.on('load', () => setStatus('Карта готова к запуску.'));

window.benchmarkApi = {
  run: runBenchmark,
  startRealtime,
  stopRealtime: () => stopRealtimeMonitoring(),
  getLastResult: () => lastResult,
  defaults,
};
