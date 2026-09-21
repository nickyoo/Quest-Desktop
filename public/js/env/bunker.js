import * as THREE from 'three';
import { Environment, DustField, surfaceTexture, basic, normalizeUVs, softCircleTexture } from './shared.js';

const W = 8;      // room width
const H = 3.2;    // ceiling height
const FRONT = -3.0;
const BACK = 5.0;

// Aperture sits ABOVE the monitor, not at chest height as originally specced —
// a slot at y=1.0–1.8 would be squarely behind the screen and never visible.
const APERTURE = { y0: 2.30, y1: 2.85, halfWidth: 3.6 };
const ALCOVE = { y0: 0.55, y1: 2.05, halfWidth: 2.6, depth: 0.6 };

/**
 * Environment 1 — The Monolith Bunker.
 *
 * Cast concrete, recessed amber channels, and a horizontal slot looking out
 * into a black void with distant beacons. Twelve draw calls, no lights.
 */
export class BunkerEnvironment extends Environment {
  static id = 'bunker';
  static label = 'Monolith Bunker';

  constructor() {
    super();
    this.enclosed = true;
    this.background = new THREE.Color(0x0a0a0c);
    this.fog = new THREE.FogExp2(0x0a0a0c, 0.045);

    const concrete = surfaceTexture({ base: '#1b1c1e', topShade: 0.6, bottomShade: 0.55 });
    const floorTex = surfaceTexture({ base: '#151617', topShade: 0.35, bottomShade: 0.35, blotches: 34 });
    const ceilTex = surfaceTexture({ base: '#141517', topShade: 0.7, bottomShade: 0.2 });

    // --- shell -----------------------------------------------------------
    const depth = BACK - FRONT;
    const midZ = (BACK + FRONT) / 2;

    const floor = basic(new THREE.PlaneGeometry(W, depth), { map: floorTex, side: THREE.DoubleSide });
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, midZ);

    const ceiling = basic(new THREE.PlaneGeometry(W, depth), { map: ceilTex, side: THREE.DoubleSide });
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, H, midZ);

    const backWall = basic(new THREE.PlaneGeometry(W, H), { map: concrete });
    backWall.position.set(0, H / 2, BACK);
    backWall.rotation.y = Math.PI;

    const leftWall = basic(new THREE.PlaneGeometry(depth, H), { map: concrete });
    leftWall.position.set(-W / 2, H / 2, midZ);
    leftWall.rotation.y = Math.PI / 2;

    const rightWall = basic(new THREE.PlaneGeometry(depth, H), { map: concrete });
    rightWall.position.set(W / 2, H / 2, midZ);
    rightWall.rotation.y = -Math.PI / 2;

    // --- front bulkhead, with the alcove and aperture cut out ------------
    const shape = new THREE.Shape()
      .moveTo(-W / 2, 0).lineTo(W / 2, 0).lineTo(W / 2, H).lineTo(-W / 2, H).lineTo(-W / 2, 0);
    shape.holes.push(rectPath(-ALCOVE.halfWidth, ALCOVE.y0, ALCOVE.halfWidth, ALCOVE.y1));
    shape.holes.push(rectPath(-APERTURE.halfWidth, APERTURE.y0, APERTURE.halfWidth, APERTURE.y1));

    const frontTex = surfaceTexture({ base: '#1d1e20', topShade: 0.5, bottomShade: 0.62 });
    const frontWall = basic(normalizeUVs(new THREE.ShapeGeometry(shape)), {
      map: frontTex, side: THREE.DoubleSide,
    });
    frontWall.position.z = FRONT;

    // Recess behind the monitor. A BackSide box shows its interior through the
    // near face, which the culler drops — exactly the look of a cast-in niche.
    const alcove = basic(
      new THREE.BoxGeometry(ALCOVE.halfWidth * 2, ALCOVE.y1 - ALCOVE.y0, ALCOVE.depth),
      { map: surfaceTexture({ base: '#141517', topShade: 0.75, bottomShade: 0.75 }), side: THREE.BackSide },
    );
    alcove.position.set(0, (ALCOVE.y0 + ALCOVE.y1) / 2, FRONT - ALCOVE.depth / 2);

    // --- structure -------------------------------------------------------
    const rust = surfaceTexture({ base: '#2c2420', topShade: 0.3, bottomShade: 0.45, blotches: 18 });

    const ribs = new THREE.InstancedMesh(
      new THREE.BoxGeometry(W, 0.18, 0.3),
      new THREE.MeshBasicMaterial({ map: rust, toneMapped: false }),
      8,
    );
    placeRow(ribs, 8, (i) => [0, H - 0.09, FRONT + 0.9 + i * 1.0]);

    const joints = new THREE.InstancedMesh(
      new THREE.BoxGeometry(W, 0.012, 0.05),
      new THREE.MeshBasicMaterial({ color: 0x0b0b0c, toneMapped: false }),
      7,
    );
    placeRow(joints, 7, (i) => [0, 0.007, FRONT + 1.0 + i * 1.1]);

    // Recessed amber channels. fog:false keeps them readable down the room.
    const leds = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.05, 0.02, depth - 1.2),
      new THREE.MeshBasicMaterial({ color: 0xc87d20, fog: false, toneMapped: false }),
      2,
    );
    placeRow(leds, 2, (i) => [i === 0 ? -2.45 : 2.45, H - 0.035, midZ]);

    // --- the void beyond the slot ---------------------------------------
    const backdrop = basic(new THREE.PlaneGeometry(160, 60), {
      color: 0x08090b, fog: false, side: THREE.DoubleSide,
    });
    backdrop.position.set(0, 10, -55);

    this.beacons = makeBeacons();

    this.dust = new DustField({ count: 110, box: 4, color: 0xd8c9a8, opacity: 0.18 });

    this.group.add(
      floor, ceiling, backWall, leftWall, rightWall,
      frontWall, alcove, ribs, joints, leds,
      backdrop, this.beacons, this.dust.points,
    );
  }

  update(t, dt, camera) {
    this.dust.update(t, camera);
    // Slow asynchronous pulse, like real aviation obstruction beacons.
    this.beacons.material.opacity = 0.55 + Math.sin(t * 0.8) * 0.2;
  }

  dispose() {
    this.dust.dispose();
    super.dispose();
  }
}

function rectPath(x0, y0, x1, y1) {
  return new THREE.Path().moveTo(x0, y0).lineTo(x1, y0).lineTo(x1, y1).lineTo(x0, y1).lineTo(x0, y0);
}

function placeRow(instanced, count, fn) {
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const [x, y, z] = fn(i);
    instanced.setMatrixAt(i, m.makeTranslation(x, y, z));
  }
  instanced.instanceMatrix.needsUpdate = true;
}

function makeBeacons(count = 14) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3 + 0] = (Math.random() - 0.5) * 90;
    pos[i * 3 + 1] = 2 + Math.random() * 9;
    pos[i * 3 + 2] = -28 - Math.random() * 25;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      size: 1.4,
      map: softCircleTexture(),
      color: 0xd8321e,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      sizeAttenuation: true,
    }),
  );
  points.frustumCulled = false;
  return points;
}
