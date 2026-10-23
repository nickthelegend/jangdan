/** A canvas-textured quad: one draw call for a label, caption or ring, redrawn only when it changes. */
import { CanvasTexture, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from '@iwsdk/core';

export class TextQuad {
  readonly canvas: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D;
  readonly texture: CanvasTexture;
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private key = '';

  constructor(
    readonly pxW: number,
    readonly pxH: number,
    readonly metersW: number,
    name: string,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = pxW;
    this.canvas.height = pxH;
    this.g = this.canvas.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    const mat = new MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, depthTest: false, side: DoubleSide, toneMapped: false });
    this.mesh = new Mesh(new PlaneGeometry(metersW, (metersW * pxH) / pxW), mat);
    this.mesh.name = name;
    this.mesh.renderOrder = 20;
  }

  /** Redraw only when `key` changes. */
  draw(key: string, paint: (g: CanvasRenderingContext2D, w: number, h: number) => void): void {
    if (key === this.key) return;
    this.key = key;
    this.g.clearRect(0, 0, this.pxW, this.pxH);
    paint(this.g, this.pxW, this.pxH);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
