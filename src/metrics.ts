import type {FrameMetrics} from './types';

export function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

export async function sampleFrames(durationMs: number): Promise<FrameMetrics> {
  const frameTimes: number[] = [];
  const started = performance.now();
  let previous = started;

  await new Promise<void>((resolve) => {
    const frame = (now: number) => {
      frameTimes.push(now - previous);
      previous = now;
      if (now - started >= durationMs) resolve();
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });

  const elapsed = frameTimes.reduce((sum, value) => sum + value, 0);
  return {
    samples: frameTimes.length,
    fps: elapsed > 0 ? (frameTimes.length / elapsed) * 1000 : 0,
    frameMsP50: percentile(frameTimes, 0.5),
    frameMsP95: percentile(frameTimes, 0.95),
    frameMsP99: percentile(frameTimes, 0.99),
    framesOver16Ms: frameTimes.filter((value) => value > 16.7).length,
    framesOver50Ms: frameTimes.filter((value) => value > 50).length,
  };
}

export function getRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext | null): string | null {
  if (!gl) return null;
  const extension = gl.getExtension('WEBGL_debug_renderer_info');
  if (!extension) return null;
  return gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) as string;
}

