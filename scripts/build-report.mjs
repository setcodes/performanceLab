import {readdir, readFile, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

const rawDir = path.resolve('results/raw');
const reportDir = path.resolve('results/reports');
const files = (await readdir(rawDir)).filter((file) => file.endsWith('.json'));
const browserRuns = [];
let k6 = null;

for (const file of files) {
  try {
    const value = JSON.parse(await readFile(path.join(rawDir, file), 'utf8'));
    if ([1, 2, 3, 4].includes(value.schemaVersion) && value.config && value.frames) browserRuns.push(value);
    if (file === 'k6-summary.json') k6 = value;
  } catch (error) {
    console.warn(`Пропущен ${file}: ${error.message}`);
  }
}

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const rows = browserRuns.map((run) => {
  const geometries = run.config.geometries || [run.config.geometry];
  const requestedUnique = run.workload?.requestedUniqueFeatures
    ?? (run.config.layerDataMode === 'partitioned'
      ? run.config.objectsPerLayer * run.config.layerCount
      : run.config.featureCount * geometries.length);
  const featureLayerPairs = run.workload?.featureLayerPairs
    ?? (run.config.layerDataMode === 'partitioned'
      ? run.config.objectsPerLayer * run.config.layerCount
      : run.config.featureCount * run.config.layerCount);
  return `
  <tr>
    <td>${esc(run.config.mode.toUpperCase())}</td><td>${esc(geometries.join(' + '))}</td>
    <td>${esc(run.config.layerDataMode === 'partitioned' ? 'по слоям' : 'общий')}</td>
    <td>${Number(run.config.layerDataMode === 'partitioned' ? run.config.objectsPerLayer : run.config.featureCount).toLocaleString('ru-RU')}</td><td>${run.config.sourceCount}</td><td>${run.config.layerCount}</td>
    <td>${Number(requestedUnique).toLocaleString('ru-RU')}</td><td>${Number(featureLayerPairs).toLocaleString('ru-RU')}</td><td>${run.workload?.visibleUniqueFeatures?.toLocaleString('ru-RU') ?? '—'}</td>
    <td>${run.frames.fps.toFixed(1)}</td><td>${run.frames.frameMsP95.toFixed(1)}</td>
    <td>${run.timings.idleMs.toFixed(0)}</td><td>${run.longTasks.count}</td>
  </tr>`;
}).join('');

const k6Duration = k6?.metrics?.http_req_duration?.values || {};
const k6Failed = k6?.metrics?.http_req_failed?.values || {};
const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Отчёт MapLibre Performance Lab</title>
<style>
body{font-family:Inter,system-ui,sans-serif;margin:0;padding:40px;color:#e9fff8;background:#071018}main{max-width:1200px;margin:auto}h1{font-size:36px;margin-bottom:8px}p{color:#93aab2}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:24px 0}.card{padding:18px;background:#0c202b;border:1px solid #1d3944;border-radius:10px}.card b{display:block;margin-top:8px;font-size:24px;color:#6df5ca}table{width:100%;border-collapse:collapse;background:#0a1922}th,td{text-align:right;padding:11px;border-bottom:1px solid #17313c;font-variant-numeric:tabular-nums}th:first-child,td:first-child,th:nth-child(2),td:nth-child(2){text-align:left}th{color:#8ca5ae;font-size:11px;text-transform:uppercase}@media(max-width:800px){body{padding:18px}.cards{grid-template-columns:1fr 1fr}.table-wrap{overflow:auto}}</style>
</head><body><main><p>ЦП ЕИТП · воспроизводимый GIS PoC</p><h1>MapLibre Performance Lab</h1><p>Сформирован ${new Date().toLocaleString('ru-RU')}. Browser runs: ${browserRuns.length}.</p>
<div class="cards">
<div class="card">k6 requests<b>${esc(k6?.metrics?.http_reqs?.values?.count ?? '—')}</b></div>
<div class="card">Martin p95<b>${k6 ? Number(k6Duration['p(95)'] ?? 0).toFixed(1) + ' ms' : '—'}</b></div>
<div class="card">Martin p99<b>${k6 ? Number(k6Duration['p(99)'] ?? 0).toFixed(1) + ' ms' : '—'}</b></div>
<div class="card">Errors<b>${k6 ? (Number(k6Failed.rate ?? 0) * 100).toFixed(2) + '%' : '—'}</b></div>
</div>
<div class="table-wrap"><table><thead><tr><th>Delivery</th><th>Geometry</th><th>Data mode</th><th>Features</th><th>Sources</th><th>Layers</th><th>Unique</th><th>Feature × layer</th><th>Visible</th><th>FPS</th><th>Frame p95</th><th>Idle</th><th>Long tasks</th></tr></thead><tbody>${rows || '<tr><td colspan="13">Нет браузерных результатов</td></tr>'}</tbody></table></div>
</main></body></html>`;

await mkdir(reportDir, {recursive: true});
const output = path.join(reportDir, 'index.html');
await writeFile(output, html, 'utf8');
console.log(output);
