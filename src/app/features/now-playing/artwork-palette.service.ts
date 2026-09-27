import { Injectable } from '@angular/core';

export interface ArtworkPalette {
  primary: string;
  secondary: string;
}

interface ColorBucket {
  count: number;
  red: number;
  green: number;
  blue: number;
}

const SAMPLE_SIZE = 32;

export function extractArtworkPalette(pixels: ImageData): ArtworkPalette | null {
  const buckets = new Map<number, ColorBucket>();
  const data = pixels.data;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] < 128) continue;
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const brightest = Math.max(red, green, blue);
    const darkest = Math.min(red, green, blue);
    if (brightest < 28 || (darkest > 238 && brightest - darkest < 16)) continue;
    const key = (red >> 5) << 6 | (green >> 5) << 3 | (blue >> 5);
    const bucket = buckets.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 };
    bucket.count++;
    bucket.red += red;
    bucket.green += green;
    bucket.blue += blue;
    buckets.set(key, bucket);
  }

  const colors = [...buckets.values()].map((bucket) => {
    const red = Math.round(bucket.red / bucket.count);
    const green = Math.round(bucket.green / bucket.count);
    const blue = Math.round(bucket.blue / bucket.count);
    const saturation = (Math.max(red, green, blue) - Math.min(red, green, blue)) / 255;
    return { red, green, blue, score: bucket.count * (0.35 + saturation * 0.65) };
  }).sort((left, right) => right.score - left.score);

  if (!colors.length) return null;
  const primary = colors[0];
  const secondary = colors.find((color) =>
    Math.hypot(color.red - primary.red, color.green - primary.green, color.blue - primary.blue) >= 72,
  ) ?? primary;
  const cssColor = (color: typeof primary) => `${color.red} ${color.green} ${color.blue}`;
  return { primary: cssColor(primary), secondary: cssColor(secondary) };
}

@Injectable({ providedIn: 'root' })
export class ArtworkPaletteService {
  private readonly cache = new Map<string, ArtworkPalette>();

  getPalette(source: string): Promise<ArtworkPalette | null> {
    const cached = this.cache.get(source);
    if (cached) return Promise.resolve(cached);
    return new Promise((resolve) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = SAMPLE_SIZE;
          canvas.height = SAMPLE_SIZE;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) { resolve(null); return; }
          context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
          const palette = extractArtworkPalette(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE));
          if (palette) {
            if (this.cache.size >= 30) this.cache.delete(this.cache.keys().next().value!);
            this.cache.set(source, palette);
          }
          resolve(palette);
        } catch {
          resolve(null);
        }
      };
      image.onerror = () => resolve(null);
      image.src = source;
    });
  }
}
