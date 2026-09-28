import { ArtworkEdgeGlowService, createEdgeGlowPixels, EDGE_GLOW_SPREAD } from './artwork-edge-glow.service';

describe('artwork edge glow', () => {
  it('spreads each edge color outward without using the center color', () => {
    const cover = new ImageData(60, 60);
    for (let y = 0; y < 60; y++) {
      for (let x = 0; x < 60; x++) {
        const index = (y * 60 + x) * 4;
        const color = x < 3 ? [255, 0, 0] : x >= 57 ? [0, 255, 0]
          : y < 3 ? [0, 0, 255] : y >= 57 ? [255, 255, 0] : [255, 0, 255];
        cover.data.set([...color, 255], index);
      }
    }

    const glow = createEdgeGlowPixels(cover);
    const pixel = (x: number, y: number) => [...glow.data.slice((y * glow.width + x) * 4, (y * glow.width + x) * 4 + 4)];
    expect(EDGE_GLOW_SPREAD).toBe(1);
    const left = pixel(30, 90);
    const right = pixel(150, 90);
    const top = pixel(90, 30);
    const bottom = pixel(90, 150);
    expect(left[0]).toBeGreaterThan(left[1]);
    expect(left[0]).toBeGreaterThan(left[2]);
    expect(right[1]).toBeGreaterThan(right[0]);
    expect(top[2]).toBeGreaterThan(top[0]);
    expect(bottom[0]).toBeGreaterThan(bottom[2]);
    expect(bottom[1]).toBeGreaterThan(bottom[2]);
    expect(pixel(90, 90)[3]).toBe(0);
    const innerEdge = pixel(65, 90);
    expect(innerEdge[0]).toBeGreaterThan(innerEdge[1]);
    expect(innerEdge[3]).toBeGreaterThan(0);
    expect(pixel(0, 90)[3]).toBe(0);
    expect(pixel(30, 90)[3]).toBeGreaterThan(0);
    const corner = pixel(40, 40);
    expect(corner[0]).toBeGreaterThan(0);
    expect(corner[2]).toBeGreaterThan(0);
    // At this position the old Euclidean falloff was already fully transparent.
    expect(pixel(12, 12)[3]).toBeGreaterThan(0);
    expect(createEdgeGlowPixels(cover, 0.2).width).toBe(84);
    expect(createEdgeGlowPixels(cover, 2).width).toBe(300);
    const small = createEdgeGlowPixels(cover, 0.2);
    const large = createEdgeGlowPixels(cover, 2);
    expect(large.data[(60 * large.width + 60) * 4 + 2])
      .toBeGreaterThan(small.data[(6 * small.width + 6) * 4 + 2]);
  });

  it('does not pull a bright center into a dark perimeter', () => {
    const cover = new ImageData(60, 60);
    for (let y = 3; y < 57; y++) {
      for (let x = 3; x < 57; x++) cover.data.set([255, 0, 255, 255], (y * 60 + x) * 4);
    }
    for (let y = 0; y < 60; y++) {
      for (let x = 0; x < 60; x++) {
        if (x < 3 || x >= 57 || y < 3 || y >= 57) cover.data.set([0, 0, 0, 255], (y * 60 + x) * 4);
      }
    }
    const glow = createEdgeGlowPixels(cover, 2);
    const pixel = [...glow.data.slice((60 * glow.width + 60) * 4, (60 * glow.width + 60) * 4 + 4)];
    expect(pixel[0]).toBe(0);
    expect(pixel[2]).toBe(0);
    expect(pixel[3]).toBeGreaterThan(0);
  });

  it('stays bright next to a light cover after the Panel blur', () => {
    const cover = new ImageData(60, 60);
    cover.data.fill(255);
    const glow = createEdgeGlowPixels(cover);
    const source = document.createElement('canvas');
    source.width = glow.width;
    source.height = glow.height;
    source.getContext('2d')!.putImageData(glow, 0, 0);

    const rendered = document.createElement('canvas');
    rendered.width = rendered.height = 720;
    const context = rendered.getContext('2d')!;
    context.filter = 'blur(32px)';
    context.drawImage(source, 0, 0, 720, 720);
    const opacity = (x: number) => context.getImageData(x, 360, 1, 1).data[3];
    expect(opacity(235)).toBeGreaterThan(opacity(200));
  });

  it('loads once per cover and returns null when the image cannot be read', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 4;
    canvas.getContext('2d')!.fillRect(0, 0, 4, 4);
    const service = new ArtworkEdgeGlowService();
    const source = canvas.toDataURL();
    const first = service.getGlow(source);
    expect(service.getGlow(source)).toBe(first);
    expect(await first).toMatch(/^data:image\/png;base64,/);
    const wider = service.getGlow(source, 1.5);
    expect(service.getGlow(source, 1.5)).toBe(wider);
    expect(await wider).not.toBe(await first);
    expect(await service.getGlow('data:image/png;base64,broken')).toBeNull();
  });
});
