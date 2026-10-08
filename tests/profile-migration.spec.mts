import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { copyLegacyBrowserStorage, migrateLegacyProfile } from '../electron/services/profile-migration.service';

const temporaryRoots: string[] = [];
const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0).reverse()) database.close();
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryProfile() {
  const appData = mkdtempSync(path.join(os.tmpdir(), 'lutstra-profile-migration-'));
  temporaryRoots.push(appData);
  return { appData, target: path.join(appData, 'Lutstra'), source: path.join(appData, 'Lutsra') };
}

function createDatabase(root: string, name: string, title: string): DatabaseSync {
  mkdirSync(root, { recursive: true });
  const database = new DatabaseSync(path.join(root, name));
  databases.push(database);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA wal_autocheckpoint = 0;
    CREATE TABLE tracks (title TEXT NOT NULL);
    CREATE TABLE artworks (hash TEXT PRIMARY KEY, path TEXT NOT NULL);
    PRAGMA wal_checkpoint(TRUNCATE);
  `);
  // These committed rows remain in WAL while the connection stays open.
  database.prepare('INSERT INTO tracks VALUES (?)').run(title);
  database.prepare('INSERT INTO artworks VALUES (?, ?)')
    .run('cover', path.join(root, 'artwork-cache', 'cover.jpg'));
  return database;
}

function writeStorage(root: string): void {
  for (const directory of ['artwork-cache', 'Local Storage', 'IndexedDB']) {
    const nested = path.join(root, directory, 'nested');
    mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(nested, 'payload'), `${directory}: retained data`);
  }
}

function snapshot(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      // SQLite readers can update shared-memory read marks without changing persisted data.
      else if (!entry.name.endsWith('-shm')) result[path.relative(root, file)] = readFileSync(file).toString('hex');
    }
  }
  visit(root);
  return result;
}

describe('legacy profile migration', () => {
  it('copies committed WAL data and browser storage, preserves the source and runs only once', async () => {
    const { appData, target, source } = temporaryProfile();
    createDatabase(source, 'lutsra.sqlite', 'Only in WAL');
    writeStorage(source);
    expect(statSync(path.join(source, 'lutsra.sqlite-wal')).size).toBeGreaterThan(32);
    const before = snapshot(source);
    const sourceMtime = statSync(path.join(source, 'lutsra.sqlite')).mtimeMs;

    copyLegacyBrowserStorage(target, appData);
    expect(await migrateLegacyProfile(target, appData)).toBe(source);
    const migrated = new DatabaseSync(path.join(target, 'lutstra.sqlite'), { readOnly: true });
    databases.push(migrated);
    expect(migrated.prepare('SELECT title FROM tracks').get()?.['title']).toBe('Only in WAL');
    expect(migrated.prepare('SELECT path FROM artworks').get()?.['path'])
      .toBe(path.join(target, 'artwork-cache', 'cover.jpg'));
    for (const directory of ['artwork-cache', 'Local Storage', 'IndexedDB']) {
      expect(readFileSync(path.join(target, directory, 'nested', 'payload'), 'utf8'))
        .toBe(`${directory}: retained data`);
    }
    expect(snapshot(source)).toEqual(before);
    expect(statSync(path.join(source, 'lutsra.sqlite')).mtimeMs).toBe(sourceMtime);
    const targetBefore = snapshot(target);
    copyLegacyBrowserStorage(target, appData);
    expect(await migrateLegacyProfile(target, appData)).toBeNull();
    expect(snapshot(target)).toEqual(targetBefore);
    expect(snapshot(source)).toEqual(before);
  });

  it('prefers Lutsra even when the older profile main database has a newer mtime', async () => {
    const { appData, target, source } = temporaryProfile();
    const older = path.join(appData, 'Audio Lutstra');
    createDatabase(source, 'lutsra.sqlite', 'Current profile');
    createDatabase(older, 'audio-lutstra.sqlite', 'Older profile');
    utimesSync(path.join(source, 'lutsra.sqlite'), new Date('2020-01-01'), new Date('2020-01-01'));
    utimesSync(path.join(older, 'audio-lutstra.sqlite'), new Date('2021-01-01'), new Date('2021-01-01'));

    expect(await migrateLegacyProfile(target, appData)).toBe(source);
    const migrated = new DatabaseSync(path.join(target, 'lutstra.sqlite'), { readOnly: true });
    databases.push(migrated);
    expect(migrated.prepare('SELECT title FROM tracks').get()?.['title']).toBe('Current profile');
  });

  it('does not overwrite or merge browser storage directories that already exist', () => {
    const { appData, target, source } = temporaryProfile();
    writeStorage(source);
    for (const directory of ['Local Storage', 'IndexedDB']) {
      mkdirSync(path.join(target, directory), { recursive: true });
      writeFileSync(path.join(target, directory, 'existing'), 'Keep destination');
    }
    const before = snapshot(target);
    copyLegacyBrowserStorage(target, appData);
    expect(snapshot(target)).toEqual(before);
    expect(existsSync(path.join(target, 'Local Storage', 'nested'))).toBe(false);
    expect(existsSync(path.join(target, 'IndexedDB', 'nested'))).toBe(false);
  });

  it('falls back to the most recently modified older database when Lutsra has no database', async () => {
    const { appData, target, source } = temporaryProfile();
    mkdirSync(source);
    const older = path.join(appData, 'Audio BlaBla');
    const newer = path.join(appData, 'Audio Lutstra');
    createDatabase(older, 'audio-blabla.sqlite', 'Oldest');
    createDatabase(newer, 'audio-lutstra.sqlite', 'Newest fallback');
    utimesSync(path.join(older, 'audio-blabla.sqlite'), new Date('2020-01-01'), new Date('2020-01-01'));
    utimesSync(path.join(newer, 'audio-lutstra.sqlite'), new Date('2021-01-01'), new Date('2021-01-01'));
    expect(await migrateLegacyProfile(target, appData)).toBe(newer);
  });
});
