import { net, protocol } from 'electron';
import { access, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseService } from '../services/database.service.js';
import { isPathInside } from '../utils/path-utils.js';
import { createFileResponse } from './file-response.js';


export function registerPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
    { scheme: 'music', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  ]);
}

export function installProtocolHandlers(database: DatabaseService, rendererRoot: string, development: boolean): void {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname || '/');
    if (pathname === '/') pathname = '/index.html';
    let target = path.resolve(rendererRoot, `.${pathname}`);
    if (!isPathInside(target, rendererRoot)) return response(403, 'Forbidden');
    try { await access(target); } catch { target = path.join(rendererRoot, 'index.html'); }
    return net.fetch(pathToFileURL(target).toString());
  });

  protocol.handle('music', async (request) => {
    if (!['GET', 'HEAD'].includes(request.method)) return response(405, 'Method not allowed');
    const initiatorOrigin = (request as Request & { initiatorOrigin?: string }).initiatorOrigin;
    if (!trustedInitiator(initiatorOrigin, development)) return response(403, 'Forbidden');
    const url = new URL(request.url); const id = decodeURIComponent(url.pathname.replace(/^\//, ''));
    if (url.hostname === 'artwork') {
      if (!/^[a-f0-9]{64}$/.test(id)) return response(400, 'Invalid resource ID');
      const artwork = database.resolveArtwork(id); if (!artwork) return response(404, 'Artwork not found');
      return createFileResponse(artwork.path, request, artwork.mime, initiatorOrigin);
    }
    if (url.hostname !== 'track') return response(404, 'Resource not found');
    if (!/^track-[a-f0-9]{64}$/.test(id)) return response(400, 'Invalid resource ID');
    const track = database.resolveTrack(id); if (!track) return response(404, 'Track not found');
    let canonical: string; try { canonical = await realpath(track.path); } catch { return response(404, 'Audio file not found'); }
    if (!database.listFolders().some((folder) => isPathInside(canonical, folder.path))) return response(403, 'Track is outside registered music folders');
    return createFileResponse(canonical, request, track.mime, initiatorOrigin);
  });
}
function trustedInitiator(origin: string | undefined, development: boolean): boolean { return origin === 'app://lutsra' || (development && origin === 'http://localhost:4200'); }
function response(status: number, message: string): Response { return new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } }); }
