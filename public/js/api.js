// HTTP client for the SkyBlink API (see docs/api.md). Difference images and
// spectra are computed in the browser from the view's data cube (see cube.js). With ?mock=1 every call
// is routed to ./mock.js, which serves the static files in frontend/mock/.
import * as mock from './mock.js';

export const MOCK = new URLSearchParams(location.search).get('mock') === '1';

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const NETWORK_MSG = "Couldn't reach the SkyBlink server. Check your connection and try again.";

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(path, { headers: { Accept: 'application/json' }, ...options });
  } catch (err) {
    if (err && err.name === 'AbortError') throw new ApiError('Cancelled.', -1);
    throw new ApiError(NETWORK_MSG, 0);
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const detail = body && typeof body.detail === 'string' ? body.detail : null;
    if (res.status === 404) throw new ApiError(detail || 'Not found.', 404);
    if (!detail && (res.status === 504 || res.status === 502)) {
      throw new ApiError("NASA's archive took too long to answer. Please try again in a minute.", res.status);
    }
    throw new ApiError(detail || `The server had a problem (HTTP ${res.status}). Please try again.`, res.status);
  }
  if (body === null) throw new ApiError('The server sent an unreadable reply.', res.status);
  return body;
}

export function resolve(q) {
  if (MOCK) return mock.resolve(q);
  return request(`/api/resolve?q=${encodeURIComponent(q)}`);
}

export function featured() {
  if (MOCK) return mock.featured();
  return request('/api/featured');
}

/** POST /api/build. `signal` (AbortSignal) cancels the wait; the server may finish anyway. */
export function startBuild({ ra, dec, fov, det }, { signal } = {}) {
  if (MOCK) return mock.startBuild({ ra, dec, fov, det }, { signal });
  return request('/api/build', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ra, dec, fov, det }),
  });
}

export function buildStatus(key) {
  if (MOCK) return mock.buildStatus(key);
  return request(`/api/build/${encodeURIComponent(key)}`);
}

export function view(key) {
  if (MOCK) return mock.view(key);
  return request(`/api/view/${encodeURIComponent(key)}`);
}

/** GET /api/config → {live_fovs, mode}, or null when the server has no such endpoint (404). */
export async function config() {
  if (MOCK) return mock.config();
  try {
    return await request('/api/config');
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

const BINARY_TIMEOUT_MS = 60000;

/** Fetch a binary file (the float16 data cube) as an ArrayBuffer; gives up after 60 s instead of hanging. */
export async function fetchBinary(url) {
  if (MOCK) return mock.fetchBinary(url);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), BINARY_TIMEOUT_MS);
  try {
    let res;
    try {
      res = await fetch(url, { signal: abort.signal });
    } catch {
      throw new ApiError(abort.signal.aborted ? 'The pixel data took too long to download. Please try again.' : NETWORK_MSG, 0);
    }
    if (!res.ok) throw new ApiError(`Could not download the pixel data (HTTP ${res.status}).`, res.status);
    try {
      return await res.arrayBuffer();
    } catch {
      throw new ApiError('The pixel data download was interrupted. Please try again.', 0);
    }
  } finally {
    clearTimeout(timer);
  }
}
