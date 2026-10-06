const ID_PATTERN = /^[a-z]+-[a-f0-9]{64}$/;

export function validId(value: unknown): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new Error('Invalid identifier');
  return value;
}

export function validIdArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 10000) throw new Error('Invalid identifier list');
  return value.map(validId);
}

export function validDirectoryPath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 32767 || value.includes('\0')) {
    throw new Error('Invalid directory path');
  }
  return value;
}

export function validName(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 200) throw new Error('Invalid name');
  return value.trim();
}

export function validTitleBarAppearance(value: unknown): 'light' | 'dark' {
  if (value !== 'light' && value !== 'dark') throw new Error('Invalid title bar appearance');
  return value;
}

export function validMusicBrainzId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error('Invalid MusicBrainz identifier');
  return value.toLowerCase();
}

export function validWikipediaOverride(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error('Invalid Wikipedia URL');
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['en.wikipedia.org', 'vi.wikipedia.org'].includes(url.hostname) || !url.pathname.startsWith('/wiki/')) throw new Error('Invalid Wikipedia URL');
  return url.toString();
}

export function validArtistSourceUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid source URL');
  const url = new URL(value);
  const allowed = url.hostname === 'musicbrainz.org' || url.hostname === 'en.wikipedia.org' || url.hostname === 'vi.wikipedia.org' || url.hostname === 'www.wikidata.org' || url.hostname === 'www.theaudiodb.com';
  if (url.protocol !== 'https:' || !allowed) throw new Error('Untrusted source URL');
  return url.toString();
}

export function validOutputMode(value: unknown): 'shared' | 'exclusive-dsp' {
  if (value !== 'shared' && value !== 'exclusive-dsp') throw new Error('Invalid audio output mode');
  return value;
}

export function validExclusiveBufferMs(value: unknown): number {
  if (typeof value !== 'number' || ![10,20,40,80].includes(value)) throw new Error('Invalid Exclusive buffer');
  return value;
}
