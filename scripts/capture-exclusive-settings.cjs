// Render-only native status fixtures: no playback or hardware changes.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.SWEEP_URL || 'http://127.0.0.1:4315';
const out = path.resolve('artifacts/phase5/settings');
fs.mkdirSync(out, { recursive: true });
app.setPath('userData', path.resolve('artifacts/phase5/settings-profile'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 1100, show: false, useContentSize: true, webPreferences: { backgroundThrottling: false } });
  for (const layout of ['inset','classic','liquid-glass']) {
    await win.loadURL(base + '/settings'); await wait(1200);
    await win.webContents.executeJavaScript(`localStorage.setItem('lutsra.layout.mode',${JSON.stringify(layout)})`);
    await win.loadURL(base + '/settings'); await wait(1200);
    for (const theme of ['dark','light']) for (const mode of ['shared','exclusive-dsp']) {
      await win.webContents.executeJavaScript(`(() => {
        document.head.insertAdjacentHTML('beforeend','<style>*,*::before,*::after{transition:none!important;animation:none!important}</style>');
        document.documentElement.setAttribute('data-theme',${JSON.stringify(theme)});
        const settings = ng.getComponent(document.querySelector('app-settings'));
        const player = settings.player;
        const mode = ${JSON.stringify(mode)};
        const device = {id:'tec-fixture',name:'Speakers (TE-C)',isDefault:false,isConnected:true,supportedModes:['shared','exclusive-dsp'],supportedFormats:[],mixFormat:{sampleRate:96000,bitDepth:32,channels:2}};
        const status = {preferredDeviceId:device.id,activeDeviceId:device.id,deviceName:device.name,backend:'native-shared',hostState:'ready',mode,isConnected:true,capabilitiesAvailable:true,sourceFormat:{sampleRate:96000,bitDepth:24,channels:2},outputFormat:{sampleRate:96000,bitDepth:mode==='shared'?32:24,channels:2},outputSampleType:mode==='shared'?'float':'integer',deviceFormat:mode==='shared'?{sampleRate:96000,bitDepth:24,channels:2}:null,processingReasons:mode==='shared'?['WASAPI Shared engine processing']:['Exclusive DSP mode','Software volume'],resamplingActive:false,channelConversionActive:false,bitPerfectEligible:false};
        player.engine.getAudioPathStatus = async () => status;
        player.engine.listOutputDevices = async () => [device];
        player.audioEngineBackend.set('native-shared');player.preferredAudioOutputId.set(device.id);player.preferredAudioOutputName.set(device.name);
        player.outputMode.set(mode);player.exclusiveBufferMs.set(20);player.outputDevices.set([device]);player.audioPathStatus.set(status);player.playbackNotice.set(null);
        ng.applyChanges(settings);
        document.querySelector('.exclusive-advanced')?.setAttribute('open','');
        document.querySelector('.audio-output-card').scrollIntoView({block:'start'});
        const header = document.querySelector('app-header')?.getBoundingClientRect();
        const card = document.querySelector('.audio-output-card').getBoundingClientRect();
        if (header && header.bottom > card.top) document.querySelector('.settings-page').scrollTop -= header.bottom - card.top + parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--space-4'));
      })()`);
      await wait(250); win.webContents.invalidate(); await wait(100);
      await win.webContents.capturePage(); // Warm the hidden compositor before saving.
      win.webContents.invalidate(); await wait(200);
      fs.writeFileSync(path.join(out, `${layout}-${theme}-${mode}.png`), (await win.webContents.capturePage()).toPNG());
    }
  }
  console.log(JSON.stringify({ screenshots: 12, nativeStatusFixtures: true, playback: false, output: out }));
  win.destroy(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
