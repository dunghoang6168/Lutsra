import { Injectable } from '@angular/core';

const SAMPLE_SIZE = 60;
const CACHE_LIMIT = 30;

/** Distance the glow travels on each side, as a fraction of the cover size. */
export const EDGE_GLOW_SPREAD = 1;

export function createEdgeGlowPixels(cover: ImageData, spread = EDGE_GLOW_SPREAD): ImageData {
  const { width, height } = cover;
  const margin = Math.max(1, Math.round(width * spread));
  const outputWidth = width + margin * 2;
  const outputHeight = height + margin * 2;
  const output = new ImageData(outputWidth, outputHeight);
  const perimeter = smoothPerimeter(cover, spread);
  // Give the CSS blur edge-colored pixels behind the cover. Without this
  // buffer, blurring the transparent center dims the glow right at the edge.
  const innerBleed = Math.floor(Math.min(width, height) / 3);

  for (let y = 0; y < outputHeight; y++) {
    for (let x = 0; x < outputWidth; x++) {
      const coverX = x - margin;
      const coverY = y - margin;
      const outsideX = Math.max(0, -coverX, coverX - width + 1);
      const outsideY = Math.max(0, -coverY, coverY - height + 1);
      const insideCover = !outsideX && !outsideY;

      // A rounded-square falloff reaches farther into diagonal corners than
      // Euclidean distance, without the sharp corners of max(dx, dy).
      const distance = (outsideX ** 4 + outsideY ** 4) ** 0.25;
      const progress = Math.min(1, distance / margin);
      if (!insideCover && progress >= 1) continue;

      let edgeX = Math.max(0, Math.min(width - 1, coverX));
      let edgeY = Math.max(0, Math.min(height - 1, coverY));
      if (insideCover) {
        const left = coverX;
        const right = width - 1 - coverX;
        const top = coverY;
        const bottom = height - 1 - coverY;
        const nearest = Math.min(left, right, top, bottom);
        if (nearest >= innerBleed) continue;
        if (nearest === left) edgeX = 0;
        else if (nearest === right) edgeX = width - 1;
        else if (nearest === top) edgeY = 0;
        else edgeY = height - 1;
      }
      const color = perimeter[perimeterIndex(edgeX, edgeY, width, height)];
      if (!color[3]) continue;
      const index = (y * outputWidth + x) * 4;
      const fade = insideCover ? 1 : 1 - progress * progress * (3 - 2 * progress);
      output.data[index] = color[0];
      output.data[index + 1] = color[1];
      output.data[index + 2] = color[2];
      output.data[index + 3] = Math.round(color[3] * fade);
    }
  }

  return output;
}

type EdgeColor = [number, number, number, number];

function smoothPerimeter(cover: ImageData, spread: number): EdgeColor[] {
  const { width, height } = cover;
  const perimeter: EdgeColor[] = [];
  for (let x = 0; x < width; x++) perimeter.push(sampleEdge(cover, x, 0));
  for (let y = 1; y < height; y++) perimeter.push(sampleEdge(cover, width - 1, y));
  for (let x = width - 2; x >= 0; x--) perimeter.push(sampleEdge(cover, x, height - 1));
  for (let y = height - 2; y > 0; y--) perimeter.push(sampleEdge(cover, 0, y));

  // A wider glow also mixes color across a wider arc of the border. Wrapping
  // the kernel around the ring lets both neighboring sides light each corner.
  const sigma = Math.min(22, 6 + spread * 8);
  const radius = Math.ceil(sigma * 2.5);
  const weights = Array.from({ length: radius + 1 }, (_, offset) =>
    Math.exp(-(offset * offset) / (2 * sigma * sigma)));
  return perimeter.map((_, index): EdgeColor => {
    let red = 0; let green = 0; let blue = 0; let alpha = 0; let totalWeight = 0;
    for (let offset = -radius; offset <= radius; offset++) {
      const color = perimeter[(index + offset + perimeter.length) % perimeter.length];
      const weight = weights[Math.abs(offset)];
      const weightedAlpha = color[3] * weight;
      red += color[0] * weightedAlpha;
      green += color[1] * weightedAlpha;
      blue += color[2] * weightedAlpha;
      alpha += weightedAlpha;
      totalWeight += weight;
    }
    if (!alpha) return [0, 0, 0, 0];
    return [Math.round(red / alpha), Math.round(green / alpha), Math.round(blue / alpha),
      Math.round(alpha / totalWeight)];
  });
}

function sampleEdge(cover: ImageData, x: number, y: number): EdgeColor {
  const { width, height, data } = cover;
  const left = x === 0 ? 0 : x === width - 1 ? Math.max(0, width - 3) : x - 1;
  const right = x === 0 ? Math.min(width - 1, 2) : x === width - 1 ? width - 1 : x + 1;
  const top = y === 0 ? 0 : y === height - 1 ? Math.max(0, height - 3) : y - 1;
  const bottom = y === 0 ? Math.min(height - 1, 2) : y === height - 1 ? height - 1 : y + 1;
  let red = 0; let green = 0; let blue = 0; let alpha = 0;
  for (let sampleY = top; sampleY <= bottom; sampleY++) {
    for (let sampleX = left; sampleX <= right; sampleX++) {
      const pixel = (sampleY * width + sampleX) * 4;
      const weight = data[pixel + 3] / 255;
      red += data[pixel] * weight;
      green += data[pixel + 1] * weight;
      blue += data[pixel + 2] * weight;
      alpha += weight;
    }
  }
  if (!alpha) return [0, 0, 0, 0];
  const samples = (right - left + 1) * (bottom - top + 1);
  return [red / alpha, green / alpha, blue / alpha, 255 * alpha / samples];
}

function perimeterIndex(x: number, y: number, width: number, height: number): number {
  if (y === 0) return x;
  if (x === width - 1) return width - 1 + y;
  if (y === height - 1) return width + height - 2 + width - 1 - x;
  return width * 2 + height - 2 + height - 2 - y;
}

@Injectable({ providedIn: 'root' })
export class ArtworkEdgeGlowService {
  private readonly samples = new Map<string, Promise<ImageData | null>>();
  private readonly cache = new Map<string, Promise<string | null>>();

  getGlow(source: string, spread = EDGE_GLOW_SPREAD): Promise<string | null> {
    const key = `${source}|${spread}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const result = this.getSample(source).then((sample) => {
      if (!sample) return null;
      try {
        const pixels = createEdgeGlowPixels(sample, spread);
        const glowCanvas = document.createElement('canvas');
        glowCanvas.width = pixels.width;
        glowCanvas.height = pixels.height;
        const glowContext = glowCanvas.getContext('2d');
        if (!glowContext) return null;
        glowContext.putImageData(pixels, 0, 0);
        return glowCanvas.toDataURL('image/png');
      } catch {
        return null;
      }
    });

    if (this.cache.size >= CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, result);
    return result;
  }

  private getSample(source: string): Promise<ImageData | null> {
    const cached = this.samples.get(source);
    if (cached) return cached;

    const result = new Promise<ImageData | null>((resolve) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        try {
          const sampleCanvas = document.createElement('canvas');
          sampleCanvas.width = sampleCanvas.height = SAMPLE_SIZE;
          const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });
          if (!sampleContext) { resolve(null); return; }
          sampleContext.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
          resolve(sampleContext.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE));
        } catch {
          resolve(null);
        }
      };
      image.onerror = () => resolve(null);
      image.src = source;
    });

    if (this.samples.size >= CACHE_LIMIT) this.samples.delete(this.samples.keys().next().value!);
    this.samples.set(source, result);
    return result;
  }
}
