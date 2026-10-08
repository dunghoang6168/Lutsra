import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const vswhere = path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
if (!existsSync(vswhere)) throw new Error('Visual Studio Build Tools were not found.');
const install = execFileSync(vswhere, ['-latest','-products','*','-requires','Microsoft.Component.MSBuild','-property','installationPath'], { encoding:'utf8' }).trim();
const msbuild = path.join(install,'MSBuild','Current','Bin','MSBuild.exe');
const project = path.join(root,'native','audio-host','lutstra-audio-host-tests.vcxproj');
const ffmpegRoot = process.env.LUTSTRA_FFMPEG_ROOT || path.join(root,'native','audio-host','third_party','ffmpeg');
execFileSync(msbuild,[project,'/m','/p:Configuration=Release','/p:Platform=x64',`/p:FfmpegRoot=${ffmpegRoot}`],{stdio:'inherit'});
for (const file of readdirSync(path.join(ffmpegRoot,'bin'))) {
  if (file.toLowerCase().endsWith('.dll')) copyFileSync(path.join(ffmpegRoot,'bin',file),path.join(root,'native','audio-host','x64','Release',file));
}
execFileSync(path.join(root,'native','audio-host','x64','Release','lutstra-audio-host-tests.exe'),[],{stdio:'inherit'});
