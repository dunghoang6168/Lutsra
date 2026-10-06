import { describe, expect, it } from 'vitest';
import type { FolderNode, MusicFolder } from '../src/app/core/models';

describe('folders overview artwork selection logic', () => {
  function selectOverviewArtworks(
    roots: readonly MusicFolder[],
    trees: ReadonlyMap<string, FolderNode>,
    artworkFor: (node: FolderNode | null | undefined) => string | null,
  ): string[] {
    const artworks = new Set<string>();
    for (const root of roots) {
      const tree = trees.get(root.id);
      const artwork = artworkFor(tree);
      if (artwork) artworks.add(artwork);
      if (artworks.size === 4) break;
    }
    return [...artworks];
  }

  const makeRoot = (id: string, name: string): MusicFolder => ({
    id,
    name,
    path: `/music/${name}`,
    createdAt: new Date().toISOString(),
  });

  const makeNode = (id: string, name: string): FolderNode => ({
    id,
    name,
    path: `/music/${name}`,
    isFolder: true,
  });

  it('selects up to 4 distinct artworks following roots order', () => {
    const roots = [
      makeRoot('r1', 'Rock'),
      makeRoot('r2', 'Jazz'),
      makeRoot('r3', 'Classical'),
      makeRoot('r4', 'Pop'),
      makeRoot('r5', 'Electronic'),
    ];
    const trees = new Map<string, FolderNode>([
      ['r1', makeNode('r1', 'Rock')],
      ['r2', makeNode('r2', 'Jazz')],
      ['r3', makeNode('r3', 'Classical')],
      ['r4', makeNode('r4', 'Pop')],
      ['r5', makeNode('r5', 'Electronic')],
    ]);
    const artworks: Record<string, string> = {
      r1: 'art-1',
      r2: 'art-2',
      r3: 'art-3',
      r4: 'art-4',
      r5: 'art-5',
    };
    const artworkFor = (node: FolderNode | null | undefined) => (node ? artworks[node.id] ?? null : null);

    const result = selectOverviewArtworks(roots, trees, artworkFor);
    expect(result).toEqual(['art-1', 'art-2', 'art-3', 'art-4']);
  });

  it('deduplicates duplicate artworks across root folders', () => {
    const roots = [
      makeRoot('r1', 'Folder 1'),
      makeRoot('r2', 'Folder 2'),
      makeRoot('r3', 'Folder 3'),
      makeRoot('r4', 'Folder 4'),
    ];
    const trees = new Map<string, FolderNode>([
      ['r1', makeNode('r1', 'Folder 1')],
      ['r2', makeNode('r2', 'Folder 2')],
      ['r3', makeNode('r3', 'Folder 3')],
      ['r4', makeNode('r4', 'Folder 4')],
    ]);
    const artworks: Record<string, string> = {
      r1: 'common-art',
      r2: 'common-art',
      r3: 'other-art',
      r4: 'other-art',
    };
    const artworkFor = (node: FolderNode | null | undefined) => (node ? artworks[node.id] ?? null : null);

    const result = selectOverviewArtworks(roots, trees, artworkFor);
    expect(result).toEqual(['common-art', 'other-art']);
  });

  it('skips roots with no artwork or failed artwork', () => {
    const roots = [
      makeRoot('r1', 'Folder 1'),
      makeRoot('r2', 'Folder 2'),
      makeRoot('r3', 'Folder 3'),
    ];
    const trees = new Map<string, FolderNode>([
      ['r1', makeNode('r1', 'Folder 1')],
      ['r2', makeNode('r2', 'Folder 2')],
      ['r3', makeNode('r3', 'Folder 3')],
    ]);
    const failedArtworks = new Set(['failed-art']);
    const artworkFor = (node: FolderNode | null | undefined) => {
      if (node?.id === 'r1') return 'valid-art';
      if (node?.id === 'r2') return failedArtworks.has('failed-art') ? null : 'failed-art';
      return null;
    };

    const result = selectOverviewArtworks(roots, trees, artworkFor);
    expect(result).toEqual(['valid-art']);
  });

  it('returns empty array when roots have no artwork', () => {
    const roots = [makeRoot('r1', 'Empty 1'), makeRoot('r2', 'Empty 2')];
    const trees = new Map<string, FolderNode>();
    const artworkFor = () => null;

    const result = selectOverviewArtworks(roots, trees, artworkFor);
    expect(result).toEqual([]);
  });
});

