import * as THREE from 'three';

/**
 * The virtual monitor, rendered two different ways.
 *
 * LAYER PATH (preferred): XRMediaBinding.createCylinderLayer() hands the video
 * element straight to the Quest compositor. The frame is sampled exactly once,
 * at native panel resolution, and is never touched by foveation. This is how
 * commercial remote-desktop apps get readable text and it is the single
 * biggest legibility win available to us.
 *
 * TEXTURE PATH (fallback): the classic VideoTexture-on-a-mesh. The frame gets
 * resampled into the eye buffer and then again by lens correction, so fine
 * type softens noticeably. Still perfectly usable, and it is the only option
 * if media layers are unavailable or reject a MediaStream-backed video.
 *
 * Both are built every session so you can A/B them live — press the left
 * controller's X button. Trust your eyes over anyone's spec sheet.
 */
export class CurvedScreen {
  constructor({
    video,
    radius = 1.6,
    height = 0.9,
    aspect = 3840 / 1600,
    eyeHeight = 1.3,
  } = {}) {
    this.video = video;
    this.radius = radius;
    this.height = height;
    this.aspect = aspect;
    this.eyeHeight = eyeHeight;
    this.yaw = 0;

    this.layer = null;
    this.layerActive = false;
    this.layerError = null;

    this.group = new THREE.Group();
    this._buildMesh();
  }

  /** Arc the screen subtends, derived so the pixels stay square. */
  get centralAngle() {
    return (this.aspect * this.height) / this.radius;
  }

  // ------------------------------------------------------------ mesh path

  _buildMesh() {
    const angle = this.centralAngle;
    const thetaStart = Math.PI - angle / 2; // centre the arc on -Z

    const texture = new THREE.VideoTexture(this.video);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 1;
    // Viewed from inside the cylinder the UVs run right-to-left, so flip them.
    texture.wrapS = THREE.RepeatWrapping;
    texture.repeat.x = -1;
    texture.offset.x = 1;
    this.texture = texture;

    const geo = new THREE.CylinderGeometry(
      this.radius, this.radius, this.height,
      96, 1, true, thetaStart, angle,
    );
    this.screenMesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, toneMapped: false }),
    );
    this.screenMesh.renderOrder = 10;

    // Matte bezel, sitting a hair further out so it reads as a frame.
    const bezelGeo = new THREE.CylinderGeometry(
      this.radius + 0.012, this.radius + 0.012, this.height + 0.055,
      96, 1, true, thetaStart - 0.022, angle + 0.044,
    );
    this.bezelMesh = new THREE.Mesh(
      bezelGeo,
      new THREE.MeshBasicMaterial({ color: 0x0d0e10, side: THREE.BackSide, toneMapped: false }),
    );
    this.bezelMesh.renderOrder = 9;

    // Soft inward vignette so the bright desktop does not knife-edge into a
    // dark room. Sits marginally in front of the video.
    const vign = new THREE.Mesh(
      new THREE.CylinderGeometry(
        this.radius - 0.004, this.radius - 0.004, this.height,
        96, 1, true, thetaStart, angle,
      ),
      new THREE.MeshBasicMaterial({
        map: makeVignetteTexture(),
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    vign.material.map.wrapS = THREE.RepeatWrapping;
    vign.material.map.repeat.x = -1;
    vign.material.map.offset.x = 1;
    vign.renderOrder = 11;
    this.vignetteMesh = vign;

    this.group.add(this.bezelMesh, this.screenMesh, this.vignetteMesh);
    this.group.position.y = this.eyeHeight;
  }

  // ----------------------------------------------------------- layer path

  /**
   * Try to promote the screen to a compositor layer. Returns true on success.
   * Failure is expected on some runtimes — MediaStream-backed video in a media
   * layer is far less battle-tested than a plain video file — so every step is
   * guarded and the mesh stays ready as a fallback.
   */
  async tryEnableLayer(renderer, session, refSpace) {
    this.layerError = null;

    if (typeof XRMediaBinding === 'undefined') {
      this.layerError = 'XRMediaBinding unavailable';
      return false;
    }
    const base = renderer.xr.getBaseLayer?.();
    if (!base || typeof XRProjectionLayer === 'undefined' || !(base instanceof XRProjectionLayer)) {
      this.layerError = 'session is not using projection layers';
      return false;
    }
    if (this.video.readyState < 2) {
      this.layerError = 'video has no frames yet';
      return false;
    }

    try {
      const binding = new XRMediaBinding(session);
      const layer = binding.createCylinderLayer(this.video, {
        space: refSpace,
        transform: this._rigidTransform(),
        radius: this.radius,
        centralAngle: this.centralAngle,
        aspectRatio: this.aspect,
        layout: 'mono',
      });
      // Order matters: later layers composite on top. The projection layer
      // carries the environment, the media layer carries the desktop.
      session.updateRenderState({ layers: [base, layer] });
      this.layer = layer;
      this.layerActive = true;
      this._syncMeshVisibility();
      return true;
    } catch (err) {
      this.layerError = err.message || String(err);
      this.layer = null;
      this.layerActive = false;
      return false;
    }
  }

  _rigidTransform() {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    return new XRRigidTransform(
      { x: 0, y: this.eyeHeight, z: 0 },
      { x: q.x, y: q.y, z: q.z, w: q.w },
    );
  }

  _syncMeshVisibility() {
    const showMesh = !this.layerActive;
    this.screenMesh.visible = showMesh;
    this.vignetteMesh.visible = showMesh;
    // Keep the bezel in both modes — it grounds the layer in the environment.
    this.bezelMesh.visible = true;
  }

  /** Flip between compositor layer and textured mesh at runtime. */
  toggleMode(renderer, session) {
    if (!this.layer) return this.layerActive;
    const base = renderer.xr.getBaseLayer?.();
    this.layerActive = !this.layerActive;
    try {
      session.updateRenderState({ layers: this.layerActive ? [base, this.layer] : [base] });
    } catch {
      this.layerActive = false;
    }
    this._syncMeshVisibility();
    return this.layerActive;
  }

  // -------------------------------------------------------------- placing

  /** Re-centre the screen on wherever the user is currently looking. */
  recenter(camera) {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.group.rotation.y = this.yaw;
    if (this.layer) this.layer.transform = this._rigidTransform();
  }

  nudgeHeight(delta) {
    this.eyeHeight = THREE.MathUtils.clamp(this.eyeHeight + delta, 0.6, 2.4);
    this.group.position.y = this.eyeHeight;
    if (this.layer) this.layer.transform = this._rigidTransform();
  }

  nudgeDistance(delta) {
    const next = THREE.MathUtils.clamp(this.radius + delta, 0.8, 4.0);
    if (next === this.radius) return;
    this.radius = next;
    if (this.layer) {
      this.layer.radius = this.radius;
      this.layer.centralAngle = this.centralAngle;
    }
    this._rebuildMeshGeometry();
  }

  setAspect(aspect) {
    this.aspect = aspect;
    if (this.layer) {
      this.layer.aspectRatio = aspect;
      this.layer.centralAngle = this.centralAngle;
    }
    this._rebuildMeshGeometry();
  }

  _rebuildMeshGeometry() {
    const angle = this.centralAngle;
    const thetaStart = Math.PI - angle / 2;
    const rebuild = (mesh, r, h, pad = 0) => {
      mesh.geometry.dispose();
      mesh.geometry = new THREE.CylinderGeometry(
        r, r, h, 96, 1, true, thetaStart - pad, angle + pad * 2,
      );
    };
    rebuild(this.screenMesh, this.radius, this.height);
    rebuild(this.vignetteMesh, this.radius - 0.004, this.height);
    rebuild(this.bezelMesh, this.radius + 0.012, this.height + 0.055, 0.022);
  }

  dispose() {
    this.texture?.dispose();
    for (const m of [this.screenMesh, this.bezelMesh, this.vignetteMesh]) {
      m.geometry.dispose();
      m.material.map?.dispose();
      m.material.dispose();
    }
  }
}

/** Transparent in the middle, darkening toward the edges. */
function makeVignetteTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.28, size / 2, size / 2, size * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.75, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
