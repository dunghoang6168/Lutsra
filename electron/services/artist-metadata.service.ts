import { Artist, ArtistMatchCandidate, ArtistMetadataSource, ArtistMetadataUpdate, ArtistOnlineMetadata } from '../../src/app/core/models/index.js';
import { ArtworkService } from './artwork.service.js';
import { DatabaseService, StoredArtistMetadata } from './database.service.js';
import { readFile, stat } from 'node:fs/promises';

const USER_AGENT = 'Lutstra/0.2.3 (local desktop music player)';
const SUCCESS_TTL = 30 * 24 * 60 * 60 * 1000;
const NOT_FOUND_TTL = 7 * 24 * 60 * 60 * 1000;
const ERROR_TTL = 24 * 60 * 60 * 1000;
const AVATAR_MISSING_TTL = 7 * 24 * 60 * 60 * 1000;
const RESOLVER_VERSION = 5;
const MBID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Fetcher = typeof fetch;

export class ArtistMetadataService {
  private musicBrainzTail = Promise.resolve();
  private lastMusicBrainzRequest = 0;
  private refreshAllTask: Promise<void> | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly artwork: ArtworkService,
    private readonly onUpdate: (value: ArtistMetadataUpdate) => void,
    private readonly fetcher: Fetcher = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  refreshMissing(force = false): Promise<void> {
    if (this.refreshAllTask) return force ? this.refreshAllTask.then(() => this.refreshMissing(true)) : this.refreshAllTask;
    this.refreshAllTask = this.refreshMissingInternal(force).finally(() => { this.refreshAllTask = null; });
    return this.refreshAllTask;
  }

  async ensureArtist(artistId: string): Promise<void> {
    const cached = this.database.getArtistMetadata(artistId);
    if (cached && cached.nextRetryAt > this.now() && cached.resolverVersion >= RESOLVER_VERSION) {
      this.onUpdate({ artistId, metadata: publicMetadata(cached), status: cached.status, ...(cached.lastError ? { error: cached.lastError } : {}) });
      return;
    }
    await this.refreshArtistInternal(artistId, false);
  }

  refreshArtist(artistId: string): Promise<ArtistOnlineMetadata | null> {
    return this.refreshArtistInternal(artistId, true);
  }

  async searchCandidates(name: string): Promise<ArtistMatchCandidate[]> {
    const query = `artist:"${name.replace(/["\\]/g, ' ').trim()}"`;
    const data = await this.musicBrainzJson(`/ws/2/artist/?query=${encodeURIComponent(query)}&fmt=json&limit=10`) as {
      artists?: Array<Record<string, unknown>>;
    };
    return (data.artists ?? []).slice(0, 10).map(mapCandidate);
  }

  async setArtistMatch(artistId: string, musicBrainzId: string): Promise<ArtistOnlineMetadata | null> {
    if (!MBID_PATTERN.test(musicBrainzId)) throw new Error('Invalid MusicBrainz artist ID');
    const artist = this.requireArtist(artistId);
    this.database.saveArtistMetadata({
      ...emptyStored(artist, this.now()), musicBrainzId: musicBrainzId.toLowerCase(), matchMode: 'manual',
      status: 'not-found', nextRetryAt: 0, lastError: null,
    });
    return this.enrichAndSave(artist, musicBrainzId.toLowerCase(), 'manual', null);
  }

  async setWikipediaOverride(artistId: string, value: string | null): Promise<ArtistOnlineMetadata | null> {
    const artist = this.requireArtist(artistId);
    const previous = this.database.getArtistMetadata(artistId);
    if (!previous?.musicBrainzId) throw new Error('Select a MusicBrainz artist before setting Wikipedia');
    const url = value?.trim() ? validWikipediaUrl(value.trim()) : null;
    return this.enrichAndSave(artist, previous.musicBrainzId, previous.matchMode, url);
  }

  private async refreshMissingInternal(force: boolean): Promise<void> {
    for (const artist of this.database.getLibrary().artists) {
      const cached = this.database.getArtistMetadata(artist.id);
      if (!cached || cached.nextRetryAt <= this.now() || cached.resolverVersion < RESOLVER_VERSION || (force && !cached.avatarHash)) {
        try { await this.refreshArtistInternal(artist.id, force && !cached?.avatarHash); } catch { /* Per-artist errors are emitted and cached. */ }
      }
    }
  }

  private async refreshArtistInternal(artistId: string, force: boolean): Promise<ArtistOnlineMetadata | null> {
    const artist = this.requireArtist(artistId);
    const previous = this.database.getArtistMetadata(artistId);
    if (!force && previous && previous.nextRetryAt > this.now() && previous.resolverVersion >= RESOLVER_VERSION) return publicMetadata(previous);
    try {
      if (previous?.musicBrainzId) {
        return await this.enrichAndSave(artist, previous.musicBrainzId, previous.matchMode, previous.wikipediaOverrideUrl);
      }
      const candidates = await this.searchCandidates(artist.name);
      const wanted = normalizeName(artist.name);
      const exact = candidates.filter((candidate) =>
        candidate.score >= 90 && [candidate.name, ...candidate.aliases].some((name) => normalizeName(name) === wanted),
      );
      if (exact.length !== 1) {
        const status = exact.length > 1 ? 'ambiguous' : 'not-found';
        const stored = { ...emptyStored(artist, this.now()), status, nextRetryAt: this.now() + NOT_FOUND_TTL } as StoredArtistMetadata;
        this.database.saveArtistMetadata(stored);
        this.onUpdate({ artistId, metadata: null, status });
        return null;
      }
      return await this.enrichAndSave(artist, exact[0].musicBrainzId, 'automatic', null);
    } catch (error) {
      const message = errorMessage(error);
      if (previous?.status === 'available') {
        this.database.saveArtistMetadata({ ...previous, nextRetryAt: this.now() + ERROR_TTL, lastError: message });
        const metadata = publicMetadata(previous);
        this.onUpdate({ artistId, metadata, status: 'error', error: message });
        return metadata;
      }
      this.database.saveArtistMetadata({ ...emptyStored(artist, this.now()), ...previous, artistId, artistName: artist.name, status: 'error', nextRetryAt: this.now() + ERROR_TTL, lastError: message });
      this.onUpdate({ artistId, metadata: null, status: 'error', error: message });
      throw error;
    }
  }

  private async enrichAndSave(artist: Artist, mbid: string, matchMode: 'automatic' | 'manual', wikipediaOverrideUrl: string | null): Promise<ArtistOnlineMetadata | null> {
    const previous = this.database.getArtistMetadata(artist.id);
    const relationships = await this.musicBrainzJson(`/ws/2/artist/${mbid}?inc=url-rels&fmt=json`) as { country?: string; disambiguation?: string; relations?: Array<Record<string, unknown>> };
    const urls = relationshipUrls(relationships.relations ?? []);
    const preferVietnamese = relationships.country === 'VN';
    const wikidataId = urls.wikidataId ?? await this.findWikidataByMbid(mbid).catch(() => null);

    const wiki = await this.wikipediaData(wikipediaOverrideUrl, urls.wikipedia, wikidataId, preferVietnamese);
    const audioDb = await this.audioDbData(mbid);
    const musicBrainzDescription = cleanText(stringValue(relationships.disambiguation));
    const freshBiography = wiki.biography ? { text: wiki.biography, sourceUrl: wiki.sourceUrl, source: 'wikipedia' as const }
      : audioDb.biography ? { text: audioDb.biography, sourceUrl: audioDb.sourceUrl, source: 'theaudiodb' as const }
      : wiki.description ? { text: wiki.description, sourceUrl: wiki.wikidataUrl, source: 'wikidata' as const }
      : musicBrainzDescription ? { text: musicBrainzDescription, sourceUrl: `https://musicbrainz.org/artist/${mbid}`, source: 'musicbrainz' as const }
      : null;
    const cachedBiography = previous?.musicBrainzId === mbid && previous.wikipediaOverrideUrl === wikipediaOverrideUrl && previous.biography
      ? { text: previous.biography, sourceUrl: previous.biographySourceUrl, source: biographySource(previous.biographySourceUrl) }
      : null;
    const retainedBiography = cachedBiography && biographyPriority(cachedBiography.source, cachedBiography.sourceUrl, preferVietnamese) >
      biographyPriority(freshBiography?.source ?? null, freshBiography?.sourceUrl ?? null, preferVietnamese);
    const selectedBiography = retainedBiography ? cachedBiography : freshBiography;
    const biography = selectedBiography?.text ?? null;
    const biographySourceUrl = selectedBiography?.sourceUrl ?? null;
    const sources = uniqueSources(['musicbrainz', ...wiki.sources, ...audioDb.sources,
      ...(retainedBiography && cachedBiography.source ? [cachedBiography.source] : [])]);
    const wikiImageSource = wiki.sourceUrl ?? wiki.wikidataUrl;
    const [avatarResult, aboutImageResult] = await Promise.all([
      this.downloadFirstImage([
        { url: wiki.imageUrl, sourceUrl: wikiImageSource },
        { url: audioDb.avatarUrl, sourceUrl: audioDb.sourceUrl },
      ]),
      this.downloadFirstImage([
        { url: audioDb.fanartUrl, sourceUrl: audioDb.sourceUrl },
        { url: wiki.imageUrl, sourceUrl: wikiImageSource },
      ]),
    ]);
    const avatarHash = avatarResult?.hash ?? null;
    const aboutImageHash = aboutImageResult?.hash ?? null;
    const storedAvatarHash = avatarHash ?? previous?.avatarHash ?? null;
    const storedAboutImageHash = aboutImageHash ?? previous?.aboutImageHash ?? null;
    const hasContent = Boolean(biography || storedAvatarHash || storedAboutImageHash);
    const fetchedAt = this.now();
    const stored: StoredArtistMetadata = {
      artistId: artist.id, artistName: artist.name, musicBrainzId: mbid, matchMode, wikipediaOverrideUrl,
      biography, biographySourceUrl, avatarHash: storedAvatarHash,
      avatarSourceUrl: avatarResult?.sourceUrl ?? previous?.avatarSourceUrl ?? null,
      aboutImageHash: storedAboutImageHash,
      aboutImageSourceUrl: aboutImageResult?.sourceUrl ?? previous?.aboutImageSourceUrl ?? null, sources,
      status: hasContent ? 'available' : 'matched-empty', fetchedAt,
      nextRetryAt: fetchedAt + (retainedBiography ? AVATAR_MISSING_TTL : hasContent ? (storedAvatarHash ? SUCCESS_TTL : AVATAR_MISSING_TTL) : NOT_FOUND_TTL), lastError: null,
      resolverVersion: RESOLVER_VERSION, customAvatarHash: previous?.customAvatarHash ?? null,
    };
    this.database.saveArtistMetadata(stored);
    const metadata = publicMetadata(stored);
    this.onUpdate({ artistId: artist.id, metadata, status: stored.status });
    return metadata;
  }

  private async findWikidataByMbid(mbid: string): Promise<string | null> {
    const query = `SELECT DISTINCT ?item WHERE { ?item wdt:P434 "${mbid}". } LIMIT 10`;
    const result = await this.json(`https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`, { 'user-agent': USER_AGENT }) as { results?: { bindings?: Array<{ item?: { value?: string } }> } };
    const ids = (result.results?.bindings ?? []).map((row) => row.item?.value?.match(/^https?:\/\/www\.wikidata\.org\/entity\/(Q\d+)$/)?.[1]).filter((id): id is string => Boolean(id));
    return ids.length === 1 ? ids[0] : null;
  }

  async selectCustomAvatar(artistId: string, filePath: string): Promise<string> {
    this.requireArtist(artistId);
    const size = (await stat(filePath)).size;
    if (size <= 0 || size > 8 * 1024 * 1024) throw new Error('Artist image must be 8 MiB or smaller');
    const bytes = await readFile(filePath);
    const mime = detectImageMime(bytes);
    if (!mime) throw new Error('Choose a JPEG, PNG or WebP image');
    const hash = await this.artwork.saveBuffer(bytes, mime);
    if (!hash) throw new Error('Artist image could not be saved');
    this.ensureMetadataRow(artistId);
    this.database.setCustomArtistAvatar(artistId, hash);
    this.emitCustomAvatar(artistId, `music://artwork/${hash}`);
    return `music://artwork/${hash}`;
  }

  clearCustomAvatar(artistId: string): void {
    this.requireArtist(artistId);
    this.database.setCustomArtistAvatar(artistId, null);
    this.emitCustomAvatar(artistId, null);
  }

  private ensureMetadataRow(artistId: string): void {
    if (this.database.getArtistMetadata(artistId)) return;
    this.database.saveArtistMetadata(emptyStored(this.requireArtist(artistId), this.now()));
  }

  private emitCustomAvatar(artistId: string, customAvatar: string | null): void {
    const cached = this.database.getArtistMetadata(artistId);
    this.onUpdate({ artistId, metadata: cached ? publicMetadata(cached) : null, customAvatar, status: cached?.status ?? 'not-found' });
  }

  private async wikipediaData(overrideUrl: string | null, relationUrls: Partial<Record<'en' | 'vi', string>>, wikidataId: string | null, preferVietnamese: boolean): Promise<{
    biography: string | null; description: string | null; imageUrl: string | null;
    sourceUrl: string | null; wikidataUrl: string | null; sources: ArtistMetadataSource[];
  }> {
    const pages: string[] = overrideUrl ? [overrideUrl] : [];
    const sitelinkPages: Partial<Record<'en' | 'vi', string>> = {};
    const languages = preferVietnamese ? ['vi', 'en'] as const : ['en', 'vi'] as const;
    let description: string | null = null;
    let imageUrl: string | null = null;
    let wikidataUrl: string | null = null;
    const sources: ArtistMetadataSource[] = [];
    if (wikidataId) {
      wikidataUrl = `https://www.wikidata.org/wiki/${wikidataId}`;
      try {
        const entity = await this.json(`https://www.wikidata.org/wiki/Special:EntityData/${wikidataId}.json`) as { entities?: Record<string, Record<string, unknown>> };
        const item = entity.entities?.[wikidataId];
        const descriptions = item?.['descriptions'] as Record<string, { value?: string }> | undefined;
        const sitelinks = item?.['sitelinks'] as Record<string, { title?: string }> | undefined;
        const claims = item?.['claims'] as Record<string, Array<{ mainsnak?: { datavalue?: { value?: string } } }>> | undefined;
        description = languages.map((language) => descriptions?.[language]?.value?.trim()).find(Boolean) ?? null;
        if (!overrideUrl) {
          for (const language of languages) {
            const title = sitelinks?.[`${language}wiki`]?.title;
            if (title) sitelinkPages[language] = wikipediaPageUrl(language, title);
          }
        }
        const fileName = claims?.['P18']?.[0]?.mainsnak?.datavalue?.value;
        if (typeof fileName === 'string') imageUrl = `https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(fileName)}`;
        sources.push('wikidata');
      } catch { /* Wikipedia may still be available through an override or MusicBrainz relationship. */ }
    }
    let biography: string | null = null;
    if (!overrideUrl) {
      for (const language of languages) {
        if (sitelinkPages[language]) pages.push(sitelinkPages[language]);
        if (relationUrls[language]) pages.push(relationUrls[language]);
      }
    }
    let sourceUrl: string | null = null;
    for (const page of [...new Set(pages)]) {
      try {
        const parsed = new URL(page);
        const title = wikipediaTitle(page);
        const summary = await this.json(`https://${parsed.hostname}/api/rest_v1/page/summary/${encodeURIComponent(title)}`) as Record<string, unknown>;
        const extract = typeof summary['extract'] === 'string' ? cleanText(summary['extract']) : null;
        if (!extract) continue;
        biography = extract;
        const contentUrls = summary['content_urls'] as { desktop?: { page?: string } } | undefined;
        sourceUrl = contentUrls?.desktop?.page ?? page;
        const original = summary['originalimage'] as { source?: string } | undefined;
        const thumbnail = summary['thumbnail'] as { source?: string } | undefined;
        imageUrl = original?.source ?? thumbnail?.source ?? imageUrl;
        sources.push('wikipedia');
        break;
      } catch { /* Try the next language, preserving Wikidata details. */ }
    }
    return { biography, description, imageUrl, sourceUrl, wikidataUrl, sources };
  }

  private async audioDbData(mbid: string): Promise<{ biography: string | null; avatarUrl: string | null; fanartUrl: string | null; sourceUrl: string; sources: ArtistMetadataSource[] }> {
    try {
      const data = await this.json(`https://www.theaudiodb.com/api/v1/json/123/artist-mb.php?i=${encodeURIComponent(mbid)}`) as { artists?: Array<Record<string, unknown>> | null };
      const artist = data.artists?.[0];
      if (!artist) return { biography: null, avatarUrl: null, fanartUrl: null, sourceUrl: 'https://www.theaudiodb.com/', sources: [] };
      const id = stringValue(artist['idArtist']);
      return {
        biography: cleanText(stringValue(artist['strBiographyEN'])), avatarUrl: stringValue(artist['strArtistThumb']),
        fanartUrl: stringValue(artist['strArtistFanart']) ?? stringValue(artist['strArtistFanart2']) ?? stringValue(artist['strArtistFanart3']),
        sourceUrl: id ? `https://www.theaudiodb.com/artist/${id}` : 'https://www.theaudiodb.com/', sources: ['theaudiodb'],
      };
    } catch {
      return { biography: null, avatarUrl: null, fanartUrl: null, sourceUrl: 'https://www.theaudiodb.com/', sources: [] };
    }
  }

  private async downloadImage(url: string): Promise<string | null> {
    let currentUrl = url;
    let response: Response | null = null;
    for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
      const parsed = new URL(currentUrl);
      if (!allowedImageHost(parsed.hostname) || parsed.protocol !== 'https:') return null;
      response = await this.fetcher(currentUrl, { headers: { accept: 'image/jpeg,image/png,image/webp' }, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      if (!location) return null;
      currentUrl = new URL(location, currentUrl).toString();
      response = null;
    }
    if (!response?.ok) return null;
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (declaredLength > 8 * 1024 * 1024) return null;
    const mime = response.headers.get('content-type') ?? '';
    const bytes = new Uint8Array(await response.arrayBuffer());
    return this.artwork.saveBuffer(bytes, mime);
  }

  private async downloadFirstImage(candidates: Array<{ url: string | null; sourceUrl: string | null }>): Promise<{ hash: string; sourceUrl: string | null } | null> {
    for (const candidate of candidates) {
      if (!candidate.url) continue;
      try {
        const hash = await this.downloadImage(candidate.url);
        if (hash) return { hash, sourceUrl: candidate.sourceUrl };
      } catch { /* Try the next provider without discarding stale cache. */ }
    }
    return null;
  }

  private async musicBrainzJson(path: string): Promise<unknown> {
    let release!: () => void;
    const previous = this.musicBrainzTail;
    this.musicBrainzTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const wait = Math.max(0, 1000 - (this.now() - this.lastMusicBrainzRequest));
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastMusicBrainzRequest = this.now();
      return await this.json(`https://musicbrainz.org${path}`, { 'user-agent': USER_AGENT });
    } finally { release(); }
  }

  private async json(url: string, headers: Record<string, string> = {}): Promise<unknown> {
    const response = await this.fetchWithTimeout(url, headers);
    if (!response.ok) throw new Error(`Metadata request failed (${response.status})`);
    return response.json();
  }

  private fetchWithTimeout(url: string, headers: Record<string, string> = {}): Promise<Response> {
    return this.fetcher(url, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(10_000) });
  }

  private requireArtist(artistId: string): Artist {
    const artist = this.database.getLibrary().artists.find((item) => item.id === artistId);
    if (!artist) throw new Error('Artist not found');
    return artist;
  }
}

function mapCandidate(value: Record<string, unknown>): ArtistMatchCandidate {
  const aliases = Array.isArray(value['aliases']) ? value['aliases'].flatMap((item) => {
    const name = item && typeof item === 'object' ? stringValue((item as Record<string, unknown>)['name']) : null;
    return name ? [name] : [];
  }) : [];
  return {
    musicBrainzId: stringValue(value['id']) ?? '', name: stringValue(value['name']) ?? 'Unknown Artist', aliases,
    type: stringValue(value['type']), country: stringValue(value['country']),
    disambiguation: stringValue(value['disambiguation']), score: Number(value['score'] ?? 0),
  };
}

function relationshipUrls(relations: Array<Record<string, unknown>>): { wikipedia: Partial<Record<'en' | 'vi', string>>; wikidataId: string | null } {
  const wikipedia: Partial<Record<'en' | 'vi', string>> = {};
  let wikidataId: string | null = null;
  for (const relation of relations) {
    const resource = relation['url'] && typeof relation['url'] === 'object' ? stringValue((relation['url'] as Record<string, unknown>)['resource']) : null;
    if (!resource) continue;
    try {
      const url = new URL(resource);
      if (relation['type'] === 'wikipedia' && (url.hostname === 'en.wikipedia.org' || url.hostname === 'vi.wikipedia.org') && url.pathname.startsWith('/wiki/')) {
        url.protocol = 'https:'; wikipedia[url.hostname.slice(0, 2) as 'en' | 'vi'] = url.toString();
      }
      if (relation['type'] === 'wikidata' && (url.hostname === 'www.wikidata.org' || url.hostname === 'wikidata.org')) wikidataId = url.pathname.match(/\/wiki\/(Q\d+)$/)?.[1] ?? wikidataId;
    } catch { /* Ignore malformed third-party relationships. */ }
  }
  return { wikipedia, wikidataId };
}

function emptyStored(artist: Artist, now: number): StoredArtistMetadata {
  return { artistId: artist.id, artistName: artist.name, musicBrainzId: null, matchMode: 'automatic', wikipediaOverrideUrl: null,
    biography: null, biographySourceUrl: null, avatarHash: null, avatarSourceUrl: null, aboutImageHash: null,
    aboutImageSourceUrl: null, sources: [], status: 'not-found', fetchedAt: null, nextRetryAt: now, lastError: null,
    resolverVersion: RESOLVER_VERSION, customAvatarHash: null };
}

function detectImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

function publicMetadata(value: StoredArtistMetadata): ArtistOnlineMetadata | null {
  if (!value.musicBrainzId || value.status !== 'available' || value.fetchedAt === null) return null;
  return { musicBrainzId: value.musicBrainzId, matchMode: value.matchMode, biography: value.biography,
    biographySourceUrl: value.biographySourceUrl, avatar: value.avatarHash ? `music://artwork/${value.avatarHash}` : null,
    avatarSourceUrl: value.avatarSourceUrl, aboutImage: value.aboutImageHash ? `music://artwork/${value.aboutImageHash}` : null,
    aboutImageSourceUrl: value.aboutImageSourceUrl, sources: value.sources, fetchedAt: value.fetchedAt };
}

function normalizeName(value: string): string { return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase(); }
function stringValue(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function cleanText(value: string | null): string | null { return value ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || null : null; }
function uniqueSources(values: ArtistMetadataSource[]): ArtistMetadataSource[] { return [...new Set(values)]; }
function biographySource(url: string | null): ArtistMetadataSource | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    if (host === 'en.wikipedia.org' || host === 'vi.wikipedia.org') return 'wikipedia';
    if (host === 'www.theaudiodb.com') return 'theaudiodb';
    if (host === 'www.wikidata.org') return 'wikidata';
    if (host === 'musicbrainz.org') return 'musicbrainz';
  } catch { /* Legacy cache may contain a malformed source URL. */ }
  return null;
}
function biographyPriority(source: ArtistMetadataSource | null, url: string | null, preferVietnamese: boolean): number {
  if (source === 'wikipedia') {
    const preferred = preferVietnamese ? 'vi.wikipedia.org' : 'en.wikipedia.org';
    try { return url && new URL(url).hostname === preferred ? 5 : 4; }
    catch { return 4; }
  }
  if (source === 'theaudiodb') return 3;
  if (source === 'wikidata') return 2;
  if (source === 'musicbrainz') return 1;
  return 0;
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function wikipediaTitle(url: string): string { return decodeURIComponent(new URL(url).pathname.replace(/^\/wiki\//, '')).replace(/_/g, ' '); }
function wikipediaPageUrl(language: 'en' | 'vi', title: string): string { return `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`; }
function validWikipediaUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['en.wikipedia.org', 'vi.wikipedia.org'].includes(url.hostname) || !url.pathname.startsWith('/wiki/')) throw new Error('Use an English or Vietnamese Wikipedia article URL');
  return url.toString();
}
function allowedImageHost(hostname: string): boolean {
  return hostname === 'upload.wikimedia.org' || hostname === 'commons.wikimedia.org' || hostname === 'www.theaudiodb.com' || hostname.endsWith('.theaudiodb.com');
}
