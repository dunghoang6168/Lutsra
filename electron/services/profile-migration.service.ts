import { randomUUID } from 'node:crypto';
import { cp, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { isPathInside } from '../utils/path-utils.js';

const NEW_DATABASE_NAME = 'lutsra.sqlite';
const LEGACY_PROFILES = [
  { name: 'Audio Lutstra', databaseName: 'audio-lutstra.sqlite' },
  { name: 'Audio BlaBla', databaseName: 'audio-blabla.sqlite' },
  { name: 'audio-blabla', databaseName: 'audio-blabla.sqlite' },
] as const;

/** Copies the most recently used legacy profile on first launch, leaving the original untouched. */
export async function migrateLegacyProfile(targetUserData: string, appData: string): Promise<string | null> {
  const targetDatabase = path.join(targetUserData, NEW_DATABASE_NAME);
  if (await exists(targetDatabase)) return null;

  const candidates = await Promise.all(LEGACY_PROFILES.map(async (profile) => {
    const root = path.join(appData, profile.name);
    if (path.resolve(root).toLowerCase() === path.resolve(targetUserData).toLowerCase()) return null;
    try {
      const info = await stat(path.join(root, profile.databaseName));
      return info.isFile() ? { root, databaseName: profile.databaseName, modified: info.mtimeMs } : null;
    } catch { return null; }
  }));
  const source = candidates.filter((value): value is { root: string; databaseName: string; modified: number } => value !== null)
    .sort((left, right) => right.modified - left.modified)[0];
  if (!source) return null;

  await mkdir(targetUserData, { recursive: true });
  const sourceArtwork = path.join(source.root, 'artwork-cache');
  const targetArtwork = path.join(targetUserData, 'artwork-cache');
  if (await exists(sourceArtwork)) await cp(sourceArtwork, targetArtwork, { recursive: true, force: false });

  const temporaryDatabase = path.join(targetUserData, `${NEW_DATABASE_NAME}.${randomUUID()}.migrating`);
  let sourceDatabase: DatabaseSync | null = null;
  let migratedDatabase: DatabaseSync | null = null;
  try {
    sourceDatabase = new DatabaseSync(path.join(source.root, source.databaseName), { readOnly: true });
    await backup(sourceDatabase, temporaryDatabase);
    sourceDatabase.close();
    sourceDatabase = null;

    migratedDatabase = new DatabaseSync(temporaryDatabase);
    migratedDatabase.exec('BEGIN IMMEDIATE');
    try {
      const rows = migratedDatabase.prepare('SELECT hash, path FROM artworks').all() as Array<{ hash: string; path: string }>;
      const update = migratedDatabase.prepare('UPDATE artworks SET path = ? WHERE hash = ?');
      for (const row of rows) {
        if (!isPathInside(row.path, sourceArtwork)) continue;
        update.run(path.join(targetArtwork, path.relative(sourceArtwork, row.path)), row.hash);
      }
      migratedDatabase.exec('COMMIT');
    } catch (error) {
      migratedDatabase.exec('ROLLBACK');
      throw error;
    }
    migratedDatabase.close();
    migratedDatabase = null;

    // Publishing the database last prevents a partial copy from being mistaken for a completed migration.
    if (await exists(targetDatabase)) return null;
    await rename(temporaryDatabase, targetDatabase);
    return source.root;
  } finally {
    migratedDatabase?.close();
    sourceDatabase?.close();
    await rm(temporaryDatabase, { force: true });
  }
}

async function exists(filePath: string): Promise<boolean> {
  try { await stat(filePath); return true; } catch { return false; }
}
