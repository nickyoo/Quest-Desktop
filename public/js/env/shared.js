import * as THREE from 'three';

/**
 * Shared building blocks for every environment.
 *
 * Hard rule throughout: no runtime lights, no shadow maps, nothing but
 * MeshBasicMaterial. Every bit of "lighting" you see is painted into a canvas
 * texture at load time. That is what keeps the headset pinned at 90Hz with
 * frames to spare for the video decoder.
 */

/** Vertical gradient — our stand-in for baked ambient occlusion. */
export function gradientTexture(stops, { width = 4, height = 256 } = {}) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, height);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/**
 * Mottled surface with a fake AO gradient baked in: dark at the floor line,
 * dark again at the ceiling, brightest at eye level. Reads as poured concrete
 * lit from recessed channels without costing a single light.
 */
export function surfaceTexture({
  base = '#1b1c1e',
  speckle = 'rgba(255,255,255,0.045)',
  grime = 'rgba(0,0,0,0.30)',
  topShade = 0.55,
  bottomShade = 0.72,
  size = 512,
  blotches = 26,
  specks = 2600,
} = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // Soft blotches: uneven pour, damp patches.
  for (let i = 0; i < blotches; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = size * (0.04 + Math.random() * 0.16);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, grime);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Fine aggregate.
  ctx.fillStyle = speckle;
  for (let i = 0; i < specks; i++) {
    ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1);
  }

  // The "bake": darken top and bottom edges.
  const ao = ctx.createLinearGradient(0, 0, 0, size);
  ao.addColorStop(0, `rgba(0,0,0,${topShade})`);
  ao.addColorStop(0.42, 'rgba(0,0,0,0)');
  ao.addColorStop(0.62, 'rgba(0,0,0,0)');
  ao.addColorStop(1, `rgba(0,0,0,${bottomShade})`);
  ctx.fillStyle = ao;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Soft round sprite for dust motes and rain. */
export function softCircleTexture(size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

/**
 * Suspended dust. Lives in a box that snaps along with the user in whole-box
 * steps, so the field feels infinite but parallax stays honest — if the box
 * simply followed the head, the motes would look glued to your face.
 */
export class DustField {
  constructor({ count = 160, box = 4, color = 0xe0d8c0, opacity = 0.25, size = 0.012 } = {}) {
    this.box = box;
    this.count = count;

    const positions = new Float32Array(count * 3);
    this.phase = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * box;
      positions[i * 3 + 1] = (Math.random() - 0.5) * box;
      positions[i * 3 + 2] = (Math.random() - 0.5) * box;
      this.phase[i * 3 + 0] = Math.random() * Math.PI * 2;
      this.phase[i * 3 + 1] = Math.random() * Math.PI * 2;
      this.phase[i * 3 + 2] = 0.25 + Math.random() * 0.7; // per-mote speed
    }
    this.base = positions.slice();

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size,
        map: softCircleTexture(),
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        sizeAttenuation: true,
        blending: THREE.NormalBlending,
      }),
    );
    this.points.frustumCulled = false;
    this._anchor = new THREE.Vector3();
    this._head = new THREE.Vector3();
  }

  update(t, camera) {
    camera.getWorldPosition(this._head);

    // Snap the field to a lattice of box-sized cells centred on the head.
    this._anchor.set(
      Math.round(this._head.x / this.box) * this.box,
      Math.round(this._head.y / this.box) * this.box,
      Math.round(this._head.z / this.box) * this.box,
    );
    this.points.position.copy(this._anchor);

    const pos = this.points.geometry.attributes.position.array;
    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      const speed = this.phase[i3 + 2];
      pos[i3 + 0] = this.base[i3 + 0] + Math.sin(t * 0.17 * speed + this.phase[i3]) * 0.22;
      pos[i3 + 1] = this.base[i3 + 1] + Math.sin(t * 0.11 * speed + this.phase[i3 + 1]) * 0.16;
      pos[i3 + 2] = this.base[i3 + 2] + Math.cos(t * 0.14 * speed + this.phase[i3]) * 0.22;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.map?.dispose();
    this.points.material.dispose();
  }
}

/**
 * Anti-aliased floor grid that fades to nothing at a fixed radius. Derivative-
 * based line width means it stays exactly one pixel wide at any distance and
 * never shimmers — the usual failure mode of a texture-based grid in VR.
 */
export class InfiniteGrid {
  constructor({
    major = 1.0,
    minor = 0.25,
    majorColor = 0x1e2330,
    minorColor = 0x161a24,
    fadeDistance = 8.0,
    y = 0,
  } = {}) {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uMajor: { value: new THREE.Color(majorColor) },
        uMinor: { value: new THREE.Color(minorColor) },
        uMajorSize: { value: major },
        uMinorSize: { value: minor },
        uFade: { value: fadeDistance },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vWorld;
        uniform vec3 uMajor;
        uniform vec3 uMinor;
        uniform float uMajorSize;
        uniform float uMinorSize;
        uniform float uFade;

        float gridMask(vec2 p, float scale) {
          vec2 coord = p / scale;
          vec2 deriv = fwidth(coord);
          vec2 g = abs(fract(coord - 0.5) - 0.5) / deriv;
          return 1.0 - min(min(g.x, g.y), 1.0);
        }

        void main() {
          float dist = distance(vWorld.xz, cameraPosition.xz);
          float fade = 1.0 - smoothstep(uFade * 0.35, uFade, dist);
          if (fade <= 0.001) discard;

          float maj = gridMask(vWorld.xz, uMajorSize);
          float min_ = gridMask(vWorld.xz, uMinorSize);

          float alpha = max(maj, min_ * 0.35) * fade;
          if (alpha < 0.002) discard;

          gl_FragColor = vec4(mix(uMinor, uMajor, maj), alpha);
        }
      `,
    });

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = y;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -5;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/** Convenience: an unlit mesh in one call. */
export function basic(geometry, params) {
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ toneMapped: false, ...params }));
}

/** Base class every environment implements. */
export class Environment {
  /** @param {{enclosed:boolean}} opts */
  constructor() {
    this.group = new THREE.Group();
    /** When true this environment fully encloses the user and hides passthrough. */
    this.enclosed = true;
    this.background = new THREE.Color(0x0a0b0e);
    this.fog = null;
  }
  update(/* t, dt, camera */) {}
  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh || o.isPoints || o.isInstancedMesh) {
        o.geometry?.dispose?.();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          m?.map?.dispose?.();
          m?.dispose?.();
        }
      }
    });
  }
}

/**
 * Remap a geometry's UVs to 0..1 across its own bounding box.
 *
 * ShapeGeometry writes raw vertex coordinates into the UV attribute, which
 * means a wall built from a Shape would tile its texture by the metre. Our
 * surface textures carry a baked top/bottom shading gradient that must span
 * the surface exactly once, so we normalize instead of tiling.
 */
export function normalizeUVs(geometry) {
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  const w = max.x - min.x || 1;
  const h = max.y - min.y || 1;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) - min.x) / w, (uv.getY(i) - min.y) / h);
  }
  uv.needsUpdate = true;
  return geometry;
}
