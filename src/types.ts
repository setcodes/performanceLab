export type GeometryKind = 'points' | 'lines' | 'polygons';
export type DeliveryMode = 'geojson' | 'mvt';
export type BasemapMode = 'osm' | 'none';
export type LayerDataMode = 'shared' | 'partitioned';
export type BenchmarkProfile = 'custom' | 'gost-optimized' | 'gost-working' | 'gost-literal';
export type StyleMode = 'simple' | 'gost';
export type LabMode = 'benchmark' | 'realtime';

export interface BenchmarkConfig {
  labMode: LabMode;
  profile: BenchmarkProfile;
  styleMode: StyleMode;
  mode: DeliveryMode;
  geometries: GeometryKind[];
  basemap: BasemapMode;
  layerDataMode: LayerDataMode;
  objectsPerLayer: number;
  featureCount: number;
  verticesPerFeature: number;
  sourceCount: number;
  layerCount: number;
  pixelRatio: number;
  spreadKm: number;
  collisionLayer: boolean;
  interactionMs: number;
  seed: number;
}

export interface FrameMetrics {
  samples: number;
  fps: number;
  frameMsP50: number;
  frameMsP95: number;
  frameMsP99: number;
  framesOver16Ms: number;
  framesOver50Ms: number;
}

export interface BenchmarkScore {
  total: number;
  smoothness: number;
  responsiveness: number;
  stability: number;
  scenarioKey: string;
}

export interface BenchmarkScreenshot {
  stage: 'scene-ready' | 'interaction-mid' | 'completed';
  label: string;
  elapsedMs: number;
  dataUrl: string | null;
  visibleUniqueFeatures: number;
  visibleFeatureLayerHits: number;
  zoom: number;
  error: string | null;
}

export interface BenchmarkResult {
  schemaVersion: 5 | 6;
  runId: string;
  timestamp: string;
  config: BenchmarkConfig;
  environment: {
    userAgent: string;
    viewport: {width: number; height: number; dpr: number};
    hardwareConcurrency: number | null;
    deviceMemoryGb: number | null;
    renderer: string | null;
  };
  timings: {
    datasetGenerationMs: number;
    sourceAndLayerSetupMs: number;
    firstRenderMs: number;
    idleMs: number;
    interactionMs: number;
    totalMs: number;
  };
  frames: FrameMetrics;
  longTasks: {count: number; totalMs: number; maxMs: number};
  network: {requests: number; transferredBytes: number; decodedBytes: number};
  memory: {usedJsHeapBytes: number | null; totalJsHeapBytes: number | null};
  map: {
    sources: number;
    layers: number;
    loadedTiles: number | null;
    canvasCssPixels?: {width: number; height: number};
    renderBufferPixels?: {width: number; height: number; megapixels: number};
  };
  workload: {
    requestedUniqueFeatures: number;
    sourceFeatureCopies: number;
    featureLayerPairs: number;
    visibleUniqueFeatures: number;
    visibleFeatureLayerHits: number;
    benchmarkSources: number;
    basemapSources: number;
    totalSources: number;
    benchmarkLayers: number;
    basemapLayers: number;
    totalStyleLayers: number;
    layerTypes: {circle: number; line: number; fill: number; symbol: number; other: number};
  };
  score: BenchmarkScore;
  screenshots?: BenchmarkScreenshot[];
  errors: string[];
}

export interface DatasetRequest {
  geometry: GeometryKind;
  featureCount: number;
  verticesPerFeature: number;
  seed: number;
  bucketCount: number;
  spreadKm: number;
}

export interface GeneratedDataset {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    id: number;
    properties: {id: number; category: number; weight: number; label: string; layerBucket: number};
    geometry: {type: 'Point' | 'LineString' | 'Polygon'; coordinates: unknown};
  }>;
}

declare global {
  interface Window {
    benchmarkApi: {
      run(config: Partial<BenchmarkConfig>): Promise<BenchmarkResult>;
      startRealtime(config: Partial<BenchmarkConfig>): Promise<void>;
      stopRealtime(): void;
      getLastResult(): BenchmarkResult | null;
      defaults: BenchmarkConfig;
    };
  }
}
