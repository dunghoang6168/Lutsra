import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const nativeRoot = path.join(root, 'native', 'audio-host');
const manifest = JSON.parse(readFileSync(path.join(nativeRoot, 'ffmpeg-dependency.json'), 'utf8'));
const thirdParty = path.join(nativeRoot, 'third_party');
const binaryArchive = path.join(thirdParty, manifest.archive);
const sourceArchive = path.join(thirdParty, manifest.sourceArchive);
const ffmpegRoot = path.join(thirdParty, 'ffmpeg');
mkdirSync(thirdParty, { recursive: true });

async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Dependency download failed (${response.status})`);
  writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}
if (!existsSync(binaryArchive)) await download(manifest.url, binaryArchive);
const digest = createHash('sha256').update(readFileSync(binaryArchive)).digest('hex');
if (digest !== manifest.sha256) throw new Error(`FFmpeg SHA-256 mismatch: expected ${manifest.sha256}, received ${digest}`);
if (!existsSync(sourceArchive)) await download(manifest.sourceUrl, sourceArchive);
if (existsSync(ffmpegRoot)) rmSync(ffmpegRoot, { recursive: true, force: true });
const extraction = path.join(thirdParty, '_extract');
if (existsSync(extraction)) rmSync(extraction, { recursive: true, force: true });
mkdirSync(extraction, { recursive: true });
execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Expand-Archive -LiteralPath $env:LUTSRA_AUDIO_ARCHIVE -DestinationPath $env:LUTSRA_AUDIO_EXTRACT -Force'], {
  stdio: 'inherit',
  env: { ...process.env, LUTSRA_AUDIO_ARCHIVE: binaryArchive, LUTSRA_AUDIO_EXTRACT: extraction },
});
const fs = await import('node:fs');
const extracted = fs.readdirSync(extraction, { withFileTypes: true }).find((entry) => entry.isDirectory());
if (!extracted) throw new Error('FFmpeg archive did not contain a root directory.');
fs.renameSync(path.join(extraction, extracted.name), ffmpegRoot);
rmSync(extraction, { recursive: true, force: true });
