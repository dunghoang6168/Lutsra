import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..'),host=path.join(root,'dist-electron','audio-host','lutsra-audio-host.exe'),ffmpeg=path.join(root,'native','audio-host','third_party','ffmpeg','bin','ffmpeg.exe');
const temporary=mkdtempSync(path.join(os.tmpdir(),'lutsra-codecs-'));
const codecs=[['wav','pcm_s16le',44100],['flac','flac',96000],['mp3','libmp3lame',44100],['m4a','aac',48000],['ogg','libvorbis',48000],['opus','libopus',48000]];
for(const [extension,codec,rate] of codecs)execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=1','-ar',String(rate),'-ac','2','-c:a',codec,'-y',path.join(temporary,`sample.${extension}`)]);

const pipe=`\\\\.\\pipe\\lutsra-codecs-${randomUUID()}`,nonce=randomBytes(32).toString('hex');let child; const exclusiveResults=[]; let socket,buffer=Buffer.alloc(0),counter=0;const pending=new Map(),events=[];let helloResolve,helloReject;
const hello=new Promise((resolve,reject)=>{helloResolve=resolve;helloReject=reject;});
const server=net.createServer((connection)=>{socket=connection;connection.on('data',(chunk)=>{buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=4){const length=buffer.readUInt32LE(0);if(!length||length>1024*1024)throw new Error('Invalid frame');if(buffer.length<length+4)return;const message=JSON.parse(buffer.subarray(4,length+4).toString('utf8'));buffer=buffer.subarray(length+4);if(message.type==='hello'){message.payload?.nonce===nonce?helloResolve():helloReject(new Error('Handshake mismatch'));}else if(message.type==='response'&&pending.has(message.id)){const request=pending.get(message.id);pending.delete(message.id);message.ok===false?request.reject(new Error(message.error?.code)):request.resolve(message.payload);}else if(message.type==='event')events.push(message.payload);}});});
try {
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(pipe,resolve);});child=spawn(host,['--pipe',pipe,'--nonce',nonce,'--protocol','1'],{windowsHide:true,stdio:'ignore'});const timeout=setTimeout(()=>helloReject(new Error('Handshake timeout')),8000);await hello;clearTimeout(timeout);
function request(type, payload) {
  const id = `codec-${++counter}`, json = Buffer.from(JSON.stringify({ protocolVersion: 1, id, type, payload })), frame = Buffer.alloc(json.length + 4);
  frame.writeUInt32LE(json.length); json.copy(frame, 4);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`No response for ${type}`)); }, 10_000);
    pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } });
    socket.write(frame);
  });
}
async function waitForEvent(predicate,timeoutMs=2500){const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){const match=events.find(predicate);if(match)return match;await new Promise((resolve)=>setTimeout(resolve,20));}throw new Error(`Timed out waiting for host event: ${JSON.stringify(events)}`);}
await request('set-mute',{isMuted:true});const verified=[];
for(const [extension,,rate] of codecs){events.length=0;await request('load',{trackId:`test-${extension}`,path:path.join(temporary,`sample.${extension}`)});const status=await request('get-path-status');if(status.sourceFormat?.sampleRate!==rate)throw new Error(`${extension}: source sample rate mismatch`);await request('play');await new Promise((resolve)=>setTimeout(resolve,180));if(!events.some((event)=>event.kind==='time'))throw new Error(`${extension}: no time telemetry: ${JSON.stringify(events)}`);await request('seek',{positionSeconds:.35});await request('pause');if(events.some((event)=>event.kind==='state'&&event.value?.state==='error'))throw new Error(`${extension}: decoder emitted an error`);verified.push(extension);}
await request('load',{trackId:'crossfade-a',path:path.join(temporary,'sample.wav')});if(!await request('prepare',{trackId:'crossfade-b',path:path.join(temporary,'sample.flac')}))throw new Error('Prepared decoder was not ready');await request('play');if(!await request('transition',{crossfadeSeconds:.1}))throw new Error('Crossfade was rejected');await new Promise((resolve)=>setTimeout(resolve,250));await request('pause');
events.length=0;await request('load',{trackId:'automatic-a',path:path.join(temporary,'sample.wav')});if(!await request('prepare',{trackId:'automatic-b',path:path.join(temporary,'sample.flac')}))throw new Error('Automatic successor was not prepared');await request('play');await waitForEvent((event)=>event.kind==='state'&&event.value?.state==='playing'&&event.value?.trackId==='automatic-b');if(events.some((event)=>event.kind==='state'&&event.value?.state==='ended'&&event.value?.trackId==='automatic-a'))throw new Error('Gapless successor waited for an ended round trip');await waitForEvent((event)=>event.kind==='time'&&event.value?.currentTime>0);await new Promise((resolve)=>setTimeout(resolve,120));if(events.filter((event)=>event.kind==='state'&&event.value?.state==='playing'&&event.value?.trackId==='automatic-b').length!==1)throw new Error('Prepared successor emitted duplicate completion events');await request('pause');
events.length=0;await request('load',{trackId:'early-eof-a',path:path.join(temporary,'sample.wav')});if(!await request('prepare',{trackId:'early-eof-b',path:path.join(temporary,'sample.flac')}))throw new Error('Early-EOF successor was not prepared');await request('play');await new Promise((resolve)=>setTimeout(resolve,700));if(!await request('transition',{crossfadeSeconds:.8}))throw new Error('Early-EOF crossfade was rejected');await waitForEvent((event)=>event.kind==='state'&&event.value?.state==='playing'&&event.value?.trackId==='early-eof-b');if(events.some((event)=>event.kind==='state'&&event.value?.state==='ended'&&event.value?.trackId==='early-eof-a'))throw new Error('Outgoing EOF stopped an active transition');await request('pause');
events.length=0;await request('load',{trackId:'rapid-seek',path:path.join(temporary,'sample.flac')});await request('play');await request('seek',{positionSeconds:.7});await request('seek',{positionSeconds:.1});await request('seek',{positionSeconds:.5});await new Promise((resolve)=>setTimeout(resolve,350));if(!events.some((event)=>event.kind==='time'&&event.value?.currentTime>=.5))throw new Error(`Rapid seek did not resume telemetry: ${JSON.stringify(events)}`);await request('pause');
events.length=0;await request('load',{trackId:'paused-seek',path:path.join(temporary,'sample.mp3')});await request('seek',{positionSeconds:.4});await request('play');await new Promise((resolve)=>setTimeout(resolve,250));if(!events.some((event)=>event.kind==='time'&&event.value?.currentTime>=.4))throw new Error('Paused seek did not resume playback');await request('pause');
events.length=0;await request('load',{trackId:'eof-seek',path:path.join(temporary,'sample.wav')});await request('play');await new Promise((resolve)=>setTimeout(resolve,1300));if(!events.some((event)=>event.kind==='state'&&event.value?.state==='ended'))throw new Error('EOF state was not observed');events.length=0;await request('seek',{positionSeconds:.2});await request('play');await new Promise((resolve)=>setTimeout(resolve,300));if(!events.some((event)=>event.kind==='time'&&event.value?.currentTime>=.2))throw new Error('Decoder did not recover after EOF seek');await request('pause');

// Exclusive deliberately owns TE-C for this muted pass; no audible opt-in.
await request('pause');
const devices = await request('list-devices');
const exclusiveDevice = devices.find(d => d.id !== 'system-default' && /TE-C/i.test(d.name) && d.supportedModes.includes('exclusive-dsp'));
if (!exclusiveDevice) throw new Error('TE-C is required for Exclusive acceptance.');
await request('select-device', { deviceId: exclusiveDevice.id });
await request('set-output-mode', { mode: 'exclusive-dsp', bufferMs: 20 });
for (const [extension,,rate] of codecs) {
  events.length = 0;
  await request('load', { trackId: 'exclusive-' + extension, path: path.join(temporary, 'sample.' + extension) });
  await request('play');
  const status = await request('get-path-status');
  if (status.mode !== 'exclusive-dsp' || status.outputFormat.sampleRate !== rate || status.resamplingActive || status.deviceFormat !== null || status.outputSampleType !== 'integer')
    throw new Error('Exclusive output format mismatch: ' + JSON.stringify(status));
  await new Promise(resolve => setTimeout(resolve, 180));
  await request('pause');
  exclusiveResults.push({ codec: extension, rate, outputBits: status.outputFormat.bitDepth });
}
// Real prepare decision: same rate, different precision must not splice.
execFileSync(ffmpeg, ['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=4','-ar','44100','-ac','2','-c:a','pcm_s24le','-y',path.join(temporary,'24bit.wav')]);
await request('load', { trackId: '16bit', path: path.join(temporary,'sample.wav') });
if (await request('prepare', { trackId: '24bit', path: path.join(temporary,'24bit.wav') })) throw new Error('16 -> 24-bit prepare must return false on TE-C.');
if (await request('prepare', { trackId: 'different-rate', path: path.join(temporary,'sample.flac') })) throw new Error('Different-rate prepare must return false.');
await request('load', { trackId: 'exclusive-gapless-a', path: path.join(temporary,'sample.wav') });
if (!await request('prepare', { trackId: 'exclusive-gapless-b', path: path.join(temporary,'sample.wav') })) throw new Error('Same format prepare must succeed.');
events.length = 0;
await request('play');
await waitForEvent(event => event.kind === 'state' && event.value?.state === 'playing' && event.value?.trackId === 'exclusive-gapless-b');
if (events.some(event => event.kind === 'state' && event.value?.state === 'ended' && event.value?.trackId === 'exclusive-gapless-a')) throw new Error('Exclusive gapless waited for ended.');
await request('pause');
const fadeResults = [];
await request('load', { trackId: 'exclusive-crossfade-a', path: path.join(temporary,'24bit.wav') });
if (!await request('prepare', { trackId: 'exclusive-crossfade-b', path: path.join(temporary,'24bit.wav') })) throw new Error('Same-format Exclusive crossfade prepare failed.');
events.length = 0;
await request('play');
if (!await request('transition', { crossfadeSeconds: 0.1 })) throw new Error('Exclusive crossfade rejected.');
await waitForEvent(event => event.kind === 'state' && event.value?.state === 'playing' && event.value?.trackId === 'exclusive-crossfade-b');
await request('pause');
await request('load', { trackId: 'exclusive-eof', path: path.join(temporary,'sample.wav') });
events.length = 0;
await request('play');
await waitForEvent(event => event.kind === 'state' && event.value?.state === 'ended' && event.value?.trackId === 'exclusive-eof');
await request('pause');
// Vary the request phase at 80 ms: a fixed delay can accidentally hide the
// initial wait for a writable buffer before the two-event hardware drain.
for (const [bufferMs, pauseDelayMs] of [[10,200],[20,200],[40,200],...[0,20,40,60,80,120,160,200].map(delay => [80,delay])]) {
  await request('set-output-mode', { mode: 'exclusive-dsp', bufferMs });
  await request('load', { trackId: 'fade-' + bufferMs, path: path.join(temporary,'24bit.wav') });
  await request('play');
  await new Promise(resolve => setTimeout(resolve, pauseDelayMs));
  const before = await request('get-path-status');
  events.length = 0;
  const started = Date.now();
  await request('pause');
  const elapsedMs = Date.now() - started;
  const after = await request('get-path-status');
  if (after.stopFadeTimeouts !== before.stopFadeTimeouts) throw new Error('Exclusive fade timed out at ' + bufferMs + ' ms: ' + JSON.stringify({before,after,elapsedMs}));
  const pausedPosition = events.filter(event => event.kind === 'time').at(-1)?.value.currentTime;
  if (!Number.isFinite(pausedPosition)) throw new Error('Pause did not publish its final position.');
  await new Promise(resolve => setTimeout(resolve, 50));
  if (events.filter(event => event.kind === 'time').at(-1)?.value.currentTime !== pausedPosition) throw new Error('Position advanced while paused.');
  await request('play');
  await waitForEvent(event => event.kind === 'time' && event.value?.currentTime > pausedPosition);
  await request('pause');
  const resumedPause = await request('get-path-status');
  if (resumedPause.stopFadeTimeouts !== before.stopFadeTimeouts) throw new Error('Resumed Exclusive fade timed out at ' + bufferMs + ' ms.');
  fadeResults.push({ requestedMs: bufferMs, pauseDelayMs, actualMs: before.bufferMs, elapsedMs, timeouts: resumedPause.stopFadeTimeouts });
}
// A failed different endpoint selection must leave the original stream playing.
await request('load', { trackId: 'failed-device', path: path.join(temporary,'24bit.wav') });
await request('play');
events.length = 0;
let selectionFailed = false;
try { await request('select-device', { deviceId: 'missing-test-endpoint' }); } catch { selectionFailed = true; }
if (!selectionFailed) throw new Error('Missing endpoint selection unexpectedly succeeded.');
await waitForEvent(event => event.kind === 'time' && event.value?.currentTime > 0.2);
if (events.some(event => event.kind === 'state' && event.value?.state === 'paused')) throw new Error('Failed different endpoint selection paused playback.');
await request('pause');
await request('set-output-mode', { mode: 'shared', bufferMs: 20 });
await request('shutdown');await new Promise((resolve)=>child.once('exit',resolve));console.log(JSON.stringify({exclusiveDevice: exclusiveDevice.name, exclusive: exclusiveResults, fadeResults, differentEndpointFailureKeepsPlaying:true, exclusiveGapless:true, exclusiveCrossfade:true, exclusiveEofDrain:true, preparePrecisionBoundary:true, verified,crossfade:true,gaplessPreparedAdvance:true,earlyEofHandoff:true,rapidSeek:true,pausedSeek:true,eofSeekRecovery:true,muted:true}));

} finally {
  child?.kill(); socket?.destroy(); server.close();
  rmSync(temporary, { recursive: true, force: true });
}
