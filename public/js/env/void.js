import * as THREE from 'three';
import { Environment, InfiniteGrid, DustField } from './shared.js';

/**
 * Environment 2 — Deep Graphite Infinite Horizon.
 *
 * Nothing but a fading grid and suspended dust. Three draw calls. The point is
 * that there is nothing to look at, which after an hour of work is the feature.
 */
export class VoidEnvironment extends Environment {
  static id = 'void';
  static label = 'Deep Graphite';

  constructor() {
    super();
    this.enclosed = true;
    this.background = new THREE.Color(0x0b0c0e);
    this.fog = new THREE.FogExp2(0x0b0c0e, 0.055);

    this.grid = new InfiniteGrid({
      major: 1.0,
      minor: 0.25,
      majorColor: 0x1e2330,
      minorColor: 0x14181f,
      fadeDistance: 9.0,
    });

    // A barely-there horizon band, so the void reads as depth rather than a
    // flat black wall pressed against your face.
    //
    // Closed, not open-ended: in an AR session anything we do not draw becomes
    // passthrough, so even the emptiest environment needs to actually enclose
    // the user. Otherwise you glance up and find your real ceiling.
    const horizon = new THREE.Mesh(
      new THREE.CylinderGeometry(22, 22, 14, 32, 1, false),
      new THREE.MeshBasicMaterial({
        color: 0x12151c,
        side: THREE.BackSide,
        transparent: true,
        opacity: 0.85,
        fog: false,
        toneMapped: false,
      }),
    );
    horizon.position.y = 4;

    this.dust = new DustField({ count: 120, box: 4, opacity: 0.2 });

    this.group.add(horizon, this.grid.mesh, this.dust.points);
  }

  update(t, dt, camera) {
    this.dust.update(t, camera);
  }

  dispose() {
    this.grid.dispose();
    this.dust.dispose();
    super.dispose();
  }
}
