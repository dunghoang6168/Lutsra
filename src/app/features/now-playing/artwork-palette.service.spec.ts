import { ArtworkPaletteService, extractArtworkPalette } from './artwork-palette.service';

describe('artwork palette', () => {
  function pixels(colors: Array<[number, number, number, number]>): ImageData {
    return new ImageData(new Uint8ClampedArray(colors.flat()), colors.length, 1);
  }

  it('returns one color for a solid cover and two distinct colors for a mixed cover', () => {
    expect(extractArtworkPalette(pixels([[210, 45, 25, 255], [210, 45, 25, 255]])))
      .toEqual({ primary: '210 45 25', secondary: '210 45 25' });
    expect(extractArtworkPalette(pixels([
      [210, 45, 25, 255], [210, 45, 25, 255], [30, 95, 215, 255],
    ]))).toEqual({ primary: '210 45 25', secondary: '30 95 215' });
  });

  it('ignores transparent pixels and returns no palette for an empty cover', () => {
    expect(extractArtworkPalette(pixels([[240, 30, 20, 0], [40, 170, 85, 255]])))
      .toEqual({ primary: '40 170 85', secondary: '40 170 85' });
    expect(extractArtworkPalette(pixels([[240, 30, 20, 0]]))).toBeNull();
  });

  it('reads an image using Canvas and falls back for a missing image', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#cc4422';
    context.fillRect(0, 0, 2, 2);
    const service = new ArtworkPaletteService();
    expect(await service.getPalette(canvas.toDataURL())).toEqual({ primary: '204 68 34', secondary: '204 68 34' });
    expect(await service.getPalette('data:image/png;base64,broken')).toBeNull();
  });
});
