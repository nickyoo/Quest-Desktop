import * as THREE from 'three';
import { Environment, DustField, surfaceTexture, basic } from './shared.js';

/**
 * Environment 3 — The Heavy Cab.
 *
 * A locomotive / gantry-crane cabin: roll cage, faceted safety glass, an
 * analog console deck under the display, heavy rain outside. Enclosed and
 * protective, which is a very different headspace from the open void.
 */
export class CabEnvironment extends Environment {
  static id = 'cab';
  static label = 'Heavy Cab';

  constructor() {
    super();
    this.enclosed = true;
    this.background = new THREE.Color(0x0c0f11);
    this.fog = new THREE.FogExp2(0x0c0f11, 0.07);

    // --- cabin shell -----------------------------------------------------
    const hull = surfaceTexture({ base: '#2b2e22', topShade: 0.6, bottomShade: 0.5, blotches: 22 });
    const shell = basic(new THREE.BoxGeometry(3.4, 2.5, 3.6), { map: hull, side: THREE.BackSide });
    shell.position.set(0, 1.25, -0.2);

    // --- faceted windshield ---------------------------------------------
    const glass = new THREE.MeshBasicMaterial({
      color: 0x1a2428,
      transparent: true,
      opacity: 0.30,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    });

    const centrePane = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.5), glass);
    centrePane.position.set(0, 1.35, -1.85);

    const leftPane = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.5), glass);
    leftPane.position.set(-1.33, 1.35, -1.62);
    leftPane.rotation.y = Math.PI / 5;

    const rightPane = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.5), glass);
    rightPane.position.set(1.33, 1.35, -1.62);
    rightPane.rotation.y = -Math.PI / 5;

    // --- roll cage -------------------------------------------------------
    const beams = [
      // [x, y, z, rotZ, rotY, length]
      [-1.0, 1.35, -1.83, 0, 0, 1.6], [1.0, 1.35, -1.83, 0, 0, 1.6],
      [-1.68, 1.35, -1.4, 0, 0, 1.6], [1.68, 1.35, -1.4, 0, 0, 1.6],
      [0, 2.13, -1.82, Math.PI / 2, 0, 2.2],
      [0, 0.58, -1.82, Math.PI / 2, 0, 2.2],
      [-1.5, 2.13, -0.4, Math.PI / 2, Math.PI / 2, 2.8],
      [1.5, 2.13, -0.4, Math.PI / 2, Math.PI / 2, 2.8],
    ];
    const cage = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.085, 1, 0.085),
      new THREE.MeshBasicMaterial({
        map: surfaceTexture({ base: '#3a3a26', topShade: 0.35, bottomShade: 0.45, blotches: 14 }),
        toneMapped: false,
      }),
      beams.length,
    );
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    beams.forEach(([x, y, z, rz, ry, len], i) => {
      q.setFromEuler(e.set(0, ry, rz));
      cage.setMatrixAt(i, m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, len, 1)));
    });
    cage.instanceMatrix.needsUpdate = true;

    // --- console deck ----------------------------------------------------
    const deck = basic(new THREE.BoxGeometry(2.3, 0.1, 0.55), {
      map: surfaceTexture({ base: '#24261c', topShade: 0.25, bottomShade: 0.6, blotches: 12 }),
    });
    deck.position.set(0, 0.80, -1.15);
    deck.rotation.x = -0.22;

    const dials = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.022, 12),
      new THREE.MeshBasicMaterial({ color: 0x15170f, toneMapped: false }),
      7,
    );
    for (let i = 0; i < 7; i++) {
      q.setFromEuler(e.set(-0.22, 0, 0));
      dials.setMatrixAt(i, m.compose(
        new THREE.Vector3(-0.78 + i * 0.26, 0.868, -1.10),
        q,
        new THREE.Vector3(1, 1, 1),
      ));
    }
    dials.instanceMatrix.needsUpdate = true;

    // The one live instrument in the cab — a faint phosphor-green voltmeter.
    this.voltmeter = basic(new THREE.PlaneGeometry(0.22, 0.09), {
      color: 0x2e6f40, fog: false, transparent: true, opacity: 0.75,
    });
    this.voltmeter.position.set(0.95, 0.875, -1.06);
    this.voltmeter.rotation.x = -Math.PI / 2 - 0.22;

    // --- world outside ---------------------------------------------------
    const silhouettes = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const w = 6 + Math.random() * 14;
      const h = 4 + Math.random() * 12;
      const s = basic(new THREE.PlaneGeometry(w, h), { color: 0x0a0d0f, fog: false });
      s.position.set((Math.random() - 0.5) * 60, h / 2 - 2, -16 - i * 7);
      silhouettes.add(s);
    }

    this.rain = makeRain();
    this.dust = new DustField({ count: 70, box: 3, color: 0xc8d0c0, opacity: 0.12 });

    this.group.add(
      shell, centrePane, leftPane, rightPane, cage, deck, dials,
      this.voltmeter, silhouettes, this.rain, this.dust.points,
    );
  }

  update(t, dt, camera) {
    this.dust.update(t, camera);
    // Needle flicker on the voltmeter.
    this.voltmeter.material.opacity = 0.62 + Math.sin(t * 2.3) * 0.06 + Math.sin(t * 7.1) * 0.03;

    const pos = this.rain.geometry.attributes.position;
    const arr = pos.array;
    const fall = dt * 9.0;
    for (let i = 0; i < arr.length; i += 6) {
      arr[i + 1] -= fall;
      arr[i + 4] -= fall;
      if (arr[i + 4] < -3) {
        const y = 12 + Math.random() * 4;
        arr[i + 1] = y;
        arr[i + 4] = y - (0.3 + Math.random() * 0.35);
      }
    }
    pos.needsUpdate = true;
  }

  dispose() {
    this.dust.dispose();
    super.dispose();
  }
}

/** Rain as vertical line segments — reads far better than round sprites. */
function makeRain(count = 700) {
  const pos = new Float32Array(count * 6);
  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * 34;
    const z = -Math.random() * 34 + 4;
    const y = Math.random() * 15 - 3;
    const len = 0.3 + Math.random() * 0.35;
    pos.set([x, y, z, x, y - len, z], i * 6);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const lines = new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({
      color: 0x8fa3ad, transparent: true, opacity: 0.22, depthWrite: false, fog: true,
    }),
  );
  lines.frustumCulled = false;
  return lines;
}
