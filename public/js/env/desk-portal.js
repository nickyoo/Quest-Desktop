import * as THREE from 'three';

const STORAGE_KEY = 'hypercanvas.deskPortal';

/**
 * Environment 4 — The Hybrid Desk Cutout.
 *
 * How the cutout actually works: in an `immersive-ar` session the compositor
 * shows passthrough wherever our framebuffer alpha is zero. So we do not draw
 * a "window" — we draw an invisible solid that writes depth but no colour,
 * first, and every piece of virtual scenery behind it fails the depth test and
 * never writes a pixel. What is left is untouched alpha, and the headset fills
 * it with the real world.
 *
 * Two things the naive version gets wrong:
 *
 *  1. Sizing the mask to the desk slab alone. The mask has to cover your hands
 *     wherever they go, and hands go above the desk constantly. A tight box
 *     means your hand crosses the boundary and is swallowed by a virtual wall
 *     mid-gesture, which is genuinely unpleasant. Hence `headroom`.
 *
 *  2. Hard-coding the desk dimensions. Quest 3 already knows where your desk
 *     is if you ran Space Setup, and WebXR exposes it through plane detection.
 *     We fit to the real plane and fall back to numbers only if we must.
 */
export class DeskPortal {
  constructor({
    width = 1.4,
    depth = 0.8,
    surfaceY = 0.75,
    headroom = 0.45,
    underhang = 0.35,
    reach = 0.25,
  } = {}) {
    this.config = { width, depth, surfaceY, headroom, underhang, reach };
    Object.assign(this.config, loadSaved());

    this.group = new THREE.Group();
    this.enabled = false;
    this.calibrating = false;
    this.autoFitRequested = true;
    this.fitSource = 'default';
    this._lastFitAttempt = 0;

    // colorWrite:false is the whole trick — the mesh contributes depth and
    // nothing else, so the framebuffer keeps alpha 0 right here.
    this.mask = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true }),
    );
    // Must run before every piece of scenery, including the floor grid.
    this.mask.renderOrder = -1000;

    this.outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0xc87d20, fog: false, transparent: true, opacity: 0.9 }),
    );
    this.outline.renderOrder = 1000;
    this.outline.visible = false;

    this.group.add(this.mask, this.outline);
    this.group.visible = false;
    this._applyTransform();
  }

  setEnabled(on) {
    this.enabled = on;
    this.group.visible = on;
    if (on) this.autoFitRequested = true;
    return this.enabled;
  }

  setCalibrating(on) {
    this.calibrating = on;
    this.outline.visible = on && this.enabled;
  }

  /**
   * Fit the mask to a real detected desk. Runs only when asked and at most
   * every couple of seconds — planes keep refining their extents, and chasing
   * that every frame makes the cutout edges crawl.
   */
  updateFromFrame(frame, refSpace, t) {
    if (!this.enabled || !this.autoFitRequested) return false;
    if (!frame.detectedPlanes || frame.detectedPlanes.size === 0) return false;
    if (t - this._lastFitAttempt < 2.0) return false;
    this._lastFitAttempt = t;

    let best = null;
    for (const plane of frame.detectedPlanes) {
      if (plane.orientation !== 'horizontal') continue;

      const label = plane.semanticLabel;
      if (label && !['table', 'desk'].includes(label)) continue;

      const pose = frame.getPose(plane.planeSpace, refSpace);
      if (!pose) continue;

      const y = pose.transform.position.y;
      // Floors and ceilings are horizontal too. A desk is waist-to-chest high.
      if (y < 0.5 || y > 1.2) continue;

      const extent = polygonExtent(plane.polygon);
      if (extent.width < 0.4 || extent.depth < 0.25) continue;

      const p = pose.transform.position;
      const distance = Math.hypot(p.x, p.z);
      // Prefer a labelled plane, then the nearest one.
      const score = (label ? 0 : 10) + distance;
      if (!best || score < best.score) best = { score, pose, extent };
    }

    if (!best) return false;

    const p = best.pose.transform.position;
    const o = best.pose.transform.orientation;
    this.config.width = best.extent.width;
    this.config.depth = best.extent.depth;
    this.config.surfaceY = p.y;
    this._center = new THREE.Vector3(p.x + best.extent.cx, p.y, p.z + best.extent.cz);
    this._quaternion = new THREE.Quaternion(o.x, o.y, o.z, o.w);
    this.fitSource = 'detected plane';
    this.autoFitRequested = false;
    this._applyTransform();
    save(this.config);
    return true;
  }

  /** Manual placement, for when Space Setup has not marked the desk. */
  nudge(dx, dy, dz) {
    const c = this.config;
    c.offsetX = (c.offsetX || 0) + dx;
    c.surfaceY = THREE.MathUtils.clamp(c.surfaceY + dy, 0.3, 1.5);
    c.offsetZ = (c.offsetZ || 0) + dz;
    this.fitSource = 'manual';
    this._applyTransform();
    save(c);
  }

  resize(dw, dd) {
    const c = this.config;
    c.width = THREE.MathUtils.clamp(c.width + dw, 0.5, 3.0);
    c.depth = THREE.MathUtils.clamp(c.depth + dd, 0.3, 1.6);
    this.fitSource = 'manual';
    this._applyTransform();
    save(c);
  }

  requestAutoFit() {
    this.autoFitRequested = true;
    this._lastFitAttempt = 0;
  }

  _applyTransform() {
    const c = this.config;

    // Generous on every axis that your hands actually travel: up for gestures,
    // toward you for forearms, down so the desk edge does not clip mid-slab.
    const boxW = c.width + 0.12;
    const boxD = c.depth + c.reach;
    const boxH = c.headroom + c.underhang;

    this.mask.geometry.dispose();
    this.mask.geometry = new THREE.BoxGeometry(boxW, boxH, boxD);
    this.outline.geometry.dispose();
    this.outline.geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(boxW, boxH, boxD));

    const center = this._center
      ? this._center.clone()
      : new THREE.Vector3(0, c.surfaceY, -(c.depth / 2) - 0.15);

    center.x += c.offsetX || 0;
    center.z += c.offsetZ || 0;
    center.y = c.surfaceY + (c.headroom - c.underhang) / 2;
    // Shift the volume toward the user by half the added reach.
    center.z += c.reach / 2;

    this.mask.position.copy(center);
    this.outline.position.copy(center);

    if (this._quaternion) {
      this.mask.quaternion.copy(this._quaternion);
      this.outline.quaternion.copy(this._quaternion);
    }
  }

  get summary() {
    const c = this.config;
    return `${c.width.toFixed(2)}m x ${c.depth.toFixed(2)}m @ ${c.surfaceY.toFixed(2)}m (${this.fitSource})`;
  }

  dispose() {
    this.mask.geometry.dispose();
    this.mask.material.dispose();
    this.outline.geometry.dispose();
    this.outline.material.dispose();
  }
}

/** Plane polygons are in plane-local space; we want centre plus extents. */
function polygonExtent(polygon) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const pt of polygon) {
    minX = Math.min(minX, pt.x); maxX = Math.max(maxX, pt.x);
    minZ = Math.min(minZ, pt.z); maxZ = Math.max(maxZ, pt.z);
  }
  return {
    width: maxX - minX,
    depth: maxZ - minZ,
    cx: (minX + maxX) / 2,
    cz: (minZ + maxZ) / 2,
  };
}

function save(config) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch { /* private browsing, ignore */ }
}

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}
