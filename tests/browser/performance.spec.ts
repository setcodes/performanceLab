import {expect, test} from '@playwright/test';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {BenchmarkConfig, BenchmarkResult} from '../../src/types';

const geoJsonScenarios: Array<Partial<BenchmarkConfig> & {name: string}> = [
  {name: 'geojson-points-50k-10-layers', mode: 'geojson', geometries: ['points'], basemap: 'none', featureCount: 50_000, layerCount: 10},
  {name: 'geojson-lines-10k-16-vertices', mode: 'geojson', geometries: ['lines'], basemap: 'none', featureCount: 10_000, verticesPerFeature: 16, layerCount: 10},
  {name: 'geojson-polygons-2k-32-vertices', mode: 'geojson', geometries: ['polygons'], basemap: 'none', featureCount: 2_000, verticesPerFeature: 32, layerCount: 10},
  {name: 'geojson-points-50k-100-layers', mode: 'geojson', geometries: ['points'], basemap: 'none', featureCount: 50_000, layerCount: 100},
  {name: 'geojson-mixed-5k-30-layers', mode: 'geojson', geometries: ['points', 'lines', 'polygons'], basemap: 'none', featureCount: 5_000, verticesPerFeature: 16, layerCount: 30},
  {name: 'geojson-100-layers-100-objects-each', mode: 'geojson', geometries: ['points'], basemap: 'none', layerDataMode: 'partitioned', objectsPerLayer: 100, layerCount: 100},
];

const mvtScenarios: Array<Partial<BenchmarkConfig> & {name: string}> = [
  {name: 'mvt-points-250k-25-layers', mode: 'mvt', geometries: ['points'], basemap: 'none', featureCount: 250_000, layerCount: 25},
  {name: 'mvt-lines-50k-50-layers', mode: 'mvt', geometries: ['lines'], basemap: 'none', featureCount: 50_000, layerCount: 50},
  {name: 'mvt-polygons-10k-collision', mode: 'mvt', geometries: ['polygons'], basemap: 'none', featureCount: 10_000, layerCount: 25, collisionLayer: true},
  {name: 'mvt-mixed-30-layers', mode: 'mvt', geometries: ['points', 'lines', 'polygons'], basemap: 'none', featureCount: 250_000, layerCount: 30},
  {name: 'mvt-100-layers-1000-objects-each', mode: 'mvt', geometries: ['points'], basemap: 'none', layerDataMode: 'partitioned', objectsPerLayer: 1_000, layerCount: 100},
];

const scenarios = process.env.TEST_MVT === '1' ? [...geoJsonScenarios, ...mvtScenarios] : geoJsonScenarios;
const enforceBudgets = process.env.ENFORCE_BUDGETS === '1';
const frameP95Budget = Number(process.env.FRAME_P95_BUDGET_MS ?? 100);

test.beforeEach(async ({page}) => {
  await page.goto('http://127.0.0.1:4173?basemap=none');
  await page.waitForFunction(() => Boolean(window.benchmarkApi));
});

test('settings persist and result panel collapses', async ({page}) => {
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.selectOption('#layer-data-mode', 'partitioned');
  await page.locator('input[name="objectsPerLayer"]').fill('750');
  await page.locator('input[name="sourceCount"]').fill('3');
  await page.locator('input[name="layerCount"]').fill('30');
  await page.locator('input[name="pixelRatio"]').fill('1.5');
  await page.selectOption('select[name="spreadKm"]', '3');
  await page.locator('input[name="geometries"][value="lines"]').check();
  await page.locator('[data-lab-mode="realtime"]').click();
  await expect(page.locator('[data-lab-mode="realtime"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#live-controls')).toBeVisible();
  await page.reload();

  await expect(page.locator('#layer-data-mode')).toHaveValue('partitioned');
  await expect(page.locator('input[name="objectsPerLayer"]')).toHaveValue('750');
  await expect(page.locator('input[name="sourceCount"]')).toHaveValue('3');
  await expect(page.locator('input[name="layerCount"]')).toHaveValue('30');
  await expect(page.locator('input[name="pixelRatio"]')).toHaveValue('1.5');
  await expect(page.locator('select[name="spreadKm"]')).toHaveValue('3');
  await expect(page.locator('input[name="geometries"][value="lines"]')).toBeChecked();
  await expect(page.locator('#lab-mode')).toHaveValue('realtime');
  await expect(page.locator('[data-lab-mode="realtime"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#live-controls')).toBeVisible();

  await page.locator('#result-panel-toggle').click();
  await expect(page.locator('#app')).toHaveClass(/results-collapsed/);
  await page.reload();
  await expect(page.locator('#app')).toHaveClass(/results-collapsed/);
});

for (const scenario of scenarios) {
  test(scenario.name, async ({page}, testInfo) => {
    const result = await page.evaluate(async (input) => {
      return window.benchmarkApi.run({...input, interactionMs: 3_000});
    }, scenario) as BenchmarkResult;

    expect(result.schemaVersion).toBe(5);
    expect(result.score.total).toBeGreaterThanOrEqual(0);
    expect(result.score.total).toBeLessThanOrEqual(1_000);
    // A heavily blocked main thread can legitimately produce only a few RAF samples;
    // that is a measured failure mode, not a broken test harness.
    expect(result.frames.samples).toBeGreaterThan(0);
    expect(Number.isFinite(result.frames.frameMsP95)).toBe(true);
    expect(result.timings.totalMs).toBeGreaterThan(0);
    expect(result.map.layers).toBe(scenario.layerCount);
    expect(result.map.sources).toBe(Math.max(scenario.geometries?.length ?? 1, scenario.sourceCount ?? 1));
    const expectedUnique = scenario.layerDataMode === 'partitioned'
      ? (scenario.objectsPerLayer ?? 0) * (scenario.layerCount ?? 0)
      : (scenario.featureCount ?? 0) * (scenario.geometries?.length ?? 1);
    const expectedPairs = scenario.layerDataMode === 'partitioned'
      ? expectedUnique
      : (scenario.featureCount ?? 0) * (scenario.layerCount ?? 0);
    expect(result.workload.requestedUniqueFeatures).toBe(expectedUnique);
    expect(result.workload.featureLayerPairs).toBe(expectedPairs);
    expect(result.workload.benchmarkLayers).toBe(scenario.layerCount);
    expect(result.workload.totalStyleLayers).toBe((scenario.layerCount ?? 0) + 1);
    expect(result.errors, result.errors.join('\n')).toEqual([]);

    if (enforceBudgets) {
      expect(result.frames.frameMsP95).toBeLessThanOrEqual(frameP95Budget);
    }

    await mkdir(path.resolve('results/raw'), {recursive: true});
    const file = path.resolve('results/raw', `${scenario.name}-${result.runId}.json`);
    await writeFile(file, JSON.stringify(result, null, 2), 'utf8');
    await testInfo.attach('benchmark-result', {
      body: Buffer.from(JSON.stringify(result, null, 2)),
      contentType: 'application/json',
    });
  });
}

test('GOST working profile applies compound styles', async ({page}) => {
  const result = await page.evaluate(async () => window.benchmarkApi.run({
    profile: 'gost-working',
    basemap: 'none',
    pixelRatio: 1.25,
    featureCount: 500,
    interactionMs: 1_000,
  }));

  expect(result.config.styleMode).toBe('gost');
  expect(result.config.geometries).toEqual(['points', 'lines', 'polygons']);
  expect(result.map.sources).toBe(4);
  expect(result.map.layers).toBe(48);
  expect(result.environment.viewport.dpr).toBe(1.25);
  expect(result.workload.layerTypes.symbol).toBeGreaterThan(0);
  expect(result.workload.layerTypes.line).toBeGreaterThan(0);
  expect(result.workload.layerTypes.fill).toBeGreaterThan(0);
  expect(result.errors, result.errors.join('\n')).toEqual([]);

  await page.locator('#view-report-button').click();
  await expect(page.locator('#report-dialog')).toBeVisible();
  await expect(page.locator('#report-dialog-content')).toContainText('Производительность');
  await page.locator('#close-report-button').click();
  await expect(page.locator('#metrics .metric-cell')).toHaveCount(26);
  await expect(page.locator('#metrics .metric-cell').first()).toHaveAttribute('data-tooltip', /оценка 0–1000/i);
  await page.evaluate(async () => {
    for (let index = 0; index < 2; index += 1) {
      await window.benchmarkApi.run({
        profile: 'gost-working',
        basemap: 'none',
        pixelRatio: 1.25,
        featureCount: 500,
        interactionMs: 1_000,
      });
    }
    await window.benchmarkApi.run({
      profile: 'custom', styleMode: 'simple', basemap: 'none', geometries: ['points'],
      featureCount: 100, sourceCount: 1, layerCount: 1, spreadKm: 3, interactionMs: 500,
    });
    await window.benchmarkApi.run({
      profile: 'gost-working', basemap: 'none', pixelRatio: 1.25,
      featureCount: 500, interactionMs: 1_000,
    });
  });
  await page.locator('#scoreboard-button').click();
  await expect(page.locator('#scoreboard-dialog')).toBeVisible();
  await expect(page.locator('#scoreboard-dialog .score-place')).toHaveCount(3);
  await expect(page.locator('#scoreboard-dialog tbody tr')).toHaveCount(5);
  await expect(page.locator('#scoreboard-content')).toContainText('Вся история · 5');
  await expect(page.locator('#scoreboard-content')).toContainText('место');
  await expect(page.locator('#scoreboard-content')).toContainText('Score');
  await page.locator('#close-scoreboard-button').click();
});

test('GeoJSON spread controls visible geometry density', async ({page}) => {
  const run = (spreadKm: number) => page.evaluate(async (spread) => window.benchmarkApi.run({
    mode: 'geojson',
    profile: 'custom',
    styleMode: 'simple',
    basemap: 'none',
    geometries: ['points'],
    featureCount: 500,
    sourceCount: 1,
    layerCount: 1,
    spreadKm: spread,
    interactionMs: 500,
  }), spreadKm);

  const dense = await run(3);
  const sparse = await run(150);

  expect(dense.config.spreadKm).toBe(3);
  expect(sparse.config.spreadKm).toBe(150);
  expect(dense.workload.visibleUniqueFeatures).toBeGreaterThan(sparse.workload.visibleUniqueFeatures);
});

test('realtime mode exposes live screen and hardware metrics', async ({page}) => {
  await page.evaluate(async () => window.benchmarkApi.startRealtime({
    mode: 'geojson',
    basemap: 'none',
    geometries: ['points', 'lines'],
    featureCount: 500,
    sourceCount: 2,
    layerCount: 12,
    pixelRatio: 1.5,
    styleMode: 'gost',
  }));

  await expect(page.locator('#status')).toContainText('Realtime-мониторинг активен');
  await expect(page.locator('#metrics')).toContainText('Состав экрана');
  await expect(page.locator('#metrics')).toContainText('JS heap');
  await expect(page.locator('#metrics')).toContainText('DPR рендера');
  await expect(page.locator('#metrics')).toContainText('1.50');
  const firstMetric = page.locator('#metrics .metric-cell').first();
  await expect(firstMetric).toHaveAttribute('data-tooltip', /частота кадров/i);
  await expect(firstMetric).not.toHaveAttribute('title', /.+/);
  await firstMetric.evaluate((element) => element.setAttribute('data-node-stability', 'preserved'));
  await page.locator('input[name="pixelRatio"]').fill('0.75');
  await expect(page.locator('#status')).toContainText('применён без перестройки сцены');
  await expect(page.locator('#map-badge')).toContainText('realtime · live');
  await expect(page.locator('#metrics')).toContainText('0.75');
  await expect(firstMetric).toHaveAttribute('data-node-stability', 'preserved');
  await page.locator('input[name="layerCount"]').fill('14');
  await expect(page.locator('#run-button')).toHaveText('Применить изменения');
  await page.waitForTimeout(1_100);
  await expect(firstMetric).toHaveAttribute('data-node-stability', 'preserved');
  await page.evaluate(() => window.benchmarkApi.stopRealtime());
  await expect(page.locator('#status')).toContainText('остановлен');
});
