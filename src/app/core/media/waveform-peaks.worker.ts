/// <reference lib="webworker" />

import { FLACDecoder, FLACDecodedAudio } from '@wasm-audio-decoders/flac';
import { WaveformAccumulator } from './waveform-aggregation';

const PEAK_COUNT = 1024;
type Stage = 'fetch' | 'decode' | 'aggregate';

addEventListener('message', (event: MessageEvent<{ trackId: string; duration: number }>) => {
  void analyze(event.data.trackId, event.data.duration);
});

async function analyze(trackId: string, duration: number): Promise<void> {
  let stage: Stage = 'fetch';
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let decoder: FLACDecoder | null = null;
  let decoderReady = false;
  try {
    const response = await fetch(`music://track/${encodeURIComponent(trackId)}`);
    if (!response.ok || !response.body) throw new Error(`Audio request failed (${response.status})`);
    reader = response.body.getReader();
    stage = 'decode';
    decoder = new FLACDecoder();
    await decoder.ready;
    decoderReady = true;
    const accumulator = new WaveformAccumulator();
    accumulator.enablePreview(duration, PEAK_COUNT);
    let lastPreviewAt = performance.now();
    while (true) {
      stage = 'fetch';
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.length) continue;
      stage = 'decode';
      const decoded = await decoder.decode(value);
      stage = 'aggregate';
      appendDecoded(accumulator, decoded);
      const now = performance.now();
      if (now - lastPreviewAt >= 200) {
        const preview = accumulator.preview();
        if (preview && preview.coverage >= 0.005) {
          postMessage({ type: 'progress', peaks: preview.peaks.buffer, coverage: preview.coverage }, [preview.peaks.buffer]);
          lastPreviewAt = now;
        }
      }
    }
    stage = 'decode';
    const tail = await decoder.flush();
    stage = 'aggregate';
    appendDecoded(accumulator, tail);
    const peaks = accumulator.finish(PEAK_COUNT);
    postMessage({ type: 'done', peaks: peaks.buffer }, [peaks.buffer]);
  } catch (error) {
    postMessage({ type: 'error', stage, message: error instanceof Error ? error.message : String(error) });
  } finally {
    try { reader?.releaseLock(); } catch { /* The stream may already be closed. */ }
    if (decoderReady) decoder?.free();
  }
}

function appendDecoded(accumulator: WaveformAccumulator, decoded: FLACDecodedAudio): void {
  accumulator.append(decoded.channelData, decoded.samplesDecoded, decoded.sampleRate);
}
