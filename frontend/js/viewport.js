// Pure zoom/pan maths for the image stage. A viewport is {cx, cy, z}: the grid
// point (in pixel units, 0..P) at the canvas centre and the zoom (1 = whole grid).

export const MAX_ZOOM = 16;

export function fitViewport(P) {
  return { cx: P / 2, cy: P / 2, z: 1 };
}

/** Keep the visible window inside the grid. */
export function clampViewport(vp, P) {
  const z = Math.min(MAX_ZOOM, Math.max(1, vp.z));
  const half = P / (2 * z);
  const cx = Math.min(P - half, Math.max(half, vp.cx));
  const cy = Math.min(P - half, Math.max(half, vp.cy));
  return { cx, cy, z };
}

export function gridToScreen(vp, P, size, gx, gy) {
  const k = (size / P) * vp.z;
  return { x: (gx - vp.cx) * k + size / 2, y: (gy - vp.cy) * k + size / 2 };
}

export function screenToGrid(vp, P, size, sx, sy) {
  const k = (size / P) * vp.z;
  return { x: (sx - size / 2) / k + vp.cx, y: (sy - size / 2) / k + vp.cy };
}

/** Zoom by `factor`, keeping grid point (gx, gy) at the same screen position. */
export function zoomAt(vp, factor, gx, gy, P) {
  const z = Math.min(MAX_ZOOM, Math.max(1, vp.z * factor));
  const r = vp.z / z;
  return clampViewport({ cx: gx - (gx - vp.cx) * r, cy: gy - (gy - vp.cy) * r, z }, P);
}

/** Move the view by a grid-pixel offset (positive = content moves right/down). */
export function panBy(vp, dx, dy, P) {
  return clampViewport({ ...vp, cx: vp.cx - dx, cy: vp.cy - dy }, P);
}
