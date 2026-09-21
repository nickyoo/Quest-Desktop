import * as THREE from 'three';

/**
 * A small readout floating below the monitor. Deliberately a canvas texture
 * rather than DOM overlay — there is no DOM inside an immersive session.
 *
 * Redrawn a few times a second, not every frame: uploading a 512px texture at
 * 90Hz for text that changes once a second is pure waste.
 */
export class StatusPanel {
  constructor({ width = 0.62, height = 0.31 } = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 512;
    this.ctx = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        fog: false,
        toneMapped: false,
        depthWrite: false,
      }),
    );
    this.mesh.renderOrder = 500;
    this.lines = [];
    this._dirty = true;
    this._lastDraw = 0;
  }

  set(lines) {
    if (lines.length === this.lines.length && lines.every((l, i) => l === this.lines[i])) return;
    this.lines = lines;
    this._dirty = true;
  }

  update(t) {
    if (!this._dirty || t - this._lastDraw < 0.25) return;
    this._lastDraw = t;
    this._dirty = false;

    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(11,12,14,0.86)';
    roundRect(ctx, 0, 0, w, h, 18);
    ctx.fill();
    ctx.strokeStyle = 'rgba(200,125,32,0.35)';
    ctx.lineWidth = 3;
    roundRect(ctx, 1.5, 1.5, w - 3, h - 3, 18);
    ctx.stroke();

    ctx.font = '600 26px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'top';

    let y = 30;
    for (const line of this.lines) {
      if (line.startsWith('--')) {
        ctx.fillStyle = 'rgba(200,125,32,0.85)';
        ctx.font = '600 21px ui-monospace, Menlo, monospace';
        ctx.fillText(line.replace(/^--\s*/, '').toUpperCase(), 32, y + 4);
        y += 34;
      } else {
        const [key, ...rest] = line.split(':');
        const value = rest.join(':').trim();
        ctx.font = '400 25px ui-monospace, Menlo, monospace';
        ctx.fillStyle = 'rgba(125,133,144,1)';
        ctx.fillText(key, 32, y);
        ctx.fillStyle = 'rgba(215,219,226,1)';
        ctx.fillText(value, 360, y);
        y += 34;
      }
    }

    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
