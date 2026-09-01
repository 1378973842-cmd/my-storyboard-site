/**
 * 深度估测：优先走本站 /api/canvas/novel-view-depth（服务端 Depth Anything）。
 * 浏览器直连 HF 在国内常失败，只作兜底。
 */
import {
  drawImageToDepthCanvas,
  normalizeDepth01,
  orientDepthNearCenter,
} from './novelViewDepth.js';

const MODEL_LABEL = 'Depth Anything';
const MODEL_ID = 'onnx-community/depth-anything-v2-small';
const HF_HOSTS = ['https://hf-mirror.com', 'https://huggingface.co'];

let browserPipePromise = null;

export function novelViewDepthModelLabel() {
  return MODEL_LABEL;
}

function decodeDepthPayload(json) {
  const width = Number(json?.width) || 0;
  const height = Number(json?.height) || 0;
  const b64 = String(json?.dataB64 || '');
  if (!width || !height || !b64) throw new Error('empty depth');
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const raw = new Float32Array(bin.length);
  for (let i = 0; i < bin.length; i++) raw[i] = bin[i] / 255;
  return {
    width,
    height,
    data: orientDepthNearCenter(raw, width, height),
    model: String(json?.model || MODEL_LABEL),
  };
}

async function estimateViaServer(opts = {}) {
  const url = String(opts.url || '').trim();
  if (url && !url.startsWith('blob:') && !url.startsWith('data:')) {
    opts.onProgress?.({ status: 'progress', file: MODEL_LABEL, loaded: 1, total: 3 });
    const res = await fetch('/api/canvas/novel-view-depth', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceUrl: url }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) {
      throw new Error(json?.detail || json?.error || `depth ${res.status}`);
    }
    return decodeDepthPayload(json);
  }
  if (!opts.img) throw new Error('no image');
  const canvas = drawImageToDepthCanvas(opts.img);
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('depth snapshot'))), 'image/jpeg', 0.92);
  });
  const fd = new FormData();
  fd.append('image', blob, 'frame.jpg');
  opts.onProgress?.({ status: 'progress', file: MODEL_LABEL, loaded: 1, total: 3 });
  const res = await fetch('/api/canvas/novel-view-depth', {
    method: 'POST',
    credentials: 'same-origin',
    body: fd,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(json?.detail || json?.error || `depth ${res.status}`);
  }
  return decodeDepthPayload(json);
}

async function loadBrowserPipeline(onProgress) {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  env.useFS = false;
  let lastErr = null;
  for (const host of HF_HOSTS) {
    try {
      env.remoteHost = host;
      env.remotePathTemplate = '{model}/resolve/{revision}/{file}';
      return await pipeline('depth-estimation', MODEL_ID, {
        dtype: 'q8',
        progress_callback: onProgress,
      });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('depth model');
}

function getBrowserPipeline(onProgress) {
  if (!browserPipePromise) {
    browserPipePromise = loadBrowserPipeline(onProgress).catch((err) => {
      browserPipePromise = null;
      throw err;
    });
  }
  return browserPipePromise;
}

function tensorToArray(t) {
  if (!t) return null;
  if (t.data instanceof Float32Array) return t.data;
  if (ArrayBuffer.isView(t.data)) return Float32Array.from(t.data);
  if (Array.isArray(t.data)) return Float32Array.from(t.data);
  if (t instanceof Float32Array) return t;
  return null;
}

function dimsOf(t, fallbackLen) {
  const dims = t?.dims || t?.size;
  if (Array.isArray(dims) && dims.length >= 2) {
    const h = Number(dims[dims.length - 2]) || 0;
    const w = Number(dims[dims.length - 1]) || 0;
    if (w && h) return { width: w, height: h };
  }
  const n = Math.sqrt(fallbackLen || 0);
  const s = Math.max(1, Math.round(n));
  return { width: s, height: s };
}

async function estimateInBrowser(img, onProgress) {
  const canvas = drawImageToDepthCanvas(img);
  const pipe = await getBrowserPipeline(onProgress);
  const out = await pipe(canvas);
  const tensor = out?.predicted_depth || out?.depth;
  let raw = tensorToArray(tensor);
  let width = 0;
  let height = 0;
  if (raw) {
    const dims = dimsOf(tensor, raw.length);
    width = dims.width;
    height = dims.height;
    if (width * height !== raw.length && raw.length > 0) {
      const s = Math.max(1, Math.round(Math.sqrt(raw.length)));
      width = s;
      height = Math.max(1, Math.round(raw.length / s));
    }
  }
  if (!raw?.length || !width || !height) throw new Error('empty depth');
  return {
    width,
    height,
    data: orientDepthNearCenter(normalizeDepth01(raw), width, height),
    model: MODEL_LABEL,
  };
}

export function shortNovelViewDepthError(err) {
  const m = String(err?.message || err || '');
  if (/Failed to fetch|network|ENOTFOUND|huggingface|hf-mirror|ECONN|timeout/i.test(m)) {
    return '网络拉不到深度模型';
  }
  if (/找不到原图|不支持的原图/i.test(m)) return '读不到这张图';
  return (m.replace(/^Error:\s*/i, '').slice(0, 48) || '估算失败');
}

export async function estimateNovelViewDepth(img, opts = {}) {
  if (!img && !opts.url) throw new Error('no image');
  try {
    return await estimateViaServer({ url: opts.url, img, onProgress: opts.onProgress });
  } catch (serverErr) {
    try {
      return await estimateInBrowser(img, opts.onProgress);
    } catch {
      throw serverErr;
    }
  }
}
