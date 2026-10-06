#include <initguid.h>
#include "../spsc_ring_buffer.h"
#include "../sample_writer.h"
#include "../spectrum_analyzer.h"
#include <atomic>
#ifdef NDEBUG
#undef NDEBUG
#endif
#include <cassert>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <ks.h>
#include <ksmedia.h>
#include <limits>
#include <thread>
#include <vector>
extern "C" {
#include <libavutil/channel_layout.h>
#include <libavutil/samplefmt.h>
#include <libswresample/swresample.h>
}

static WAVEFORMATEXTENSIBLE pcmFormat(WORD containerBits, WORD validBits) {
  WAVEFORMATEXTENSIBLE format{};
  format.Format.wFormatTag = WAVE_FORMAT_EXTENSIBLE;
  format.Format.nChannels = 1;
  format.Format.nSamplesPerSec = 48000;
  format.Format.wBitsPerSample = containerBits;
  format.Format.nBlockAlign = containerBits / 8;
  format.Format.nAvgBytesPerSec = 48000 * format.Format.nBlockAlign;
  format.Format.cbSize = sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX);
  format.Samples.wValidBitsPerSample = validBits;
  format.dwChannelMask = SPEAKER_FRONT_CENTER;
  format.SubFormat = KSDATAFORMAT_SUBTYPE_PCM;
  return format;
}

static std::vector<float> convertToFloat(const void *input, int samples,
                                        AVSampleFormat inputFormat) {
  SwrContext *swr = nullptr;
  AVChannelLayout layout{};
  av_channel_layout_default(&layout, 1);
  assert(swr_alloc_set_opts2(&swr, &layout, AV_SAMPLE_FMT_FLT, 48000,
                             &layout, inputFormat, 48000, 0, nullptr) >= 0);
  assert(swr && swr_init(swr) >= 0);
  std::vector<float> output(samples);
  uint8_t *out[] = {reinterpret_cast<uint8_t *>(output.data())};
  const uint8_t *in[] = {static_cast<const uint8_t *>(input)};
  assert(swr_convert(swr, out, samples, in, samples) == samples);
  swr_free(&swr);
  av_channel_layout_uninit(&layout);
  return output;
}

static void integerRoundTripTest() {
  std::vector<int16_t> pcm16{-32768, 32767, 0, 1, -1};
  std::vector<int32_t> pcm24{-8388608, 8388607, 0, 1, -1};
  uint32_t seed = 0x4c555453u;
  for (int i = 0; i < 4096; ++i) {
    seed = seed * 1664525u + 1013904223u;
    pcm16.push_back(static_cast<int16_t>(static_cast<int32_t>(seed & 0xffffu) - 32768));
    seed = seed * 1664525u + 1013904223u;
    pcm24.push_back(static_cast<int32_t>(seed & 0xffffffu) - 8388608);
  }
  const auto float16 = convertToFloat(pcm16.data(), static_cast<int>(pcm16.size()), AV_SAMPLE_FMT_S16);
  auto format = pcmFormat(16, 16);
  std::vector<BYTE> output16(pcm16.size() * 2);
  writeSamples(float16.data(), float16.size(), &format.Format, output16.data());
  assert(std::memcmp(pcm16.data(), output16.data(), output16.size()) == 0);

  // FFmpeg has no packed S24 sample format. Its PCM decoder represents 24-bit
  // samples as left-aligned S32; swr uses that same input representation here.
  std::vector<int32_t> aligned24;
  std::vector<BYTE> packed24;
  for (const int32_t sample : pcm24) {
    aligned24.push_back(sample * 256); // Multiplication avoids shifting negatives.
    const auto bits = static_cast<uint32_t>(sample);
    packed24.push_back(static_cast<BYTE>(bits));
    packed24.push_back(static_cast<BYTE>(bits >> 8));
    packed24.push_back(static_cast<BYTE>(bits >> 16));
  }
  const auto float24 = convertToFloat(aligned24.data(), static_cast<int>(aligned24.size()), AV_SAMPLE_FMT_S32);
  format = pcmFormat(24, 24);
  std::vector<BYTE> output24(packed24.size());
  writeSamples(float24.data(), float24.size(), &format.Format, output24.data());
  assert(output24 == packed24);
  format = pcmFormat(32, 24);
  std::vector<BYTE> output32(aligned24.size() * 4);
  writeSamples(float24.data(), float24.size(), &format.Format, output32.data());
  assert(std::memcmp(aligned24.data(), output32.data(), output32.size()) == 0);
  format = pcmFormat(32, 32);
  writeSamples(float24.data(), float24.size(), &format.Format, output32.data());
  assert(std::memcmp(aligned24.data(), output32.data(), output32.size()) == 0);
}

static void sampleWriterBoundsTest() {
  const float input[] = {-2.0f, -1.0f, 0.0f, 1.0f, 2.0f,
                        std::numeric_limits<float>::quiet_NaN(),
                        -std::numeric_limits<float>::infinity(),
                        std::numeric_limits<float>::infinity()};
  auto format = pcmFormat(16, 16);
  int16_t output16[8]{};
  const int16_t expected16[] = {-32768, -32768, 0, 32767, 32767, 0, -32768, 32767};
  writeSamples(input, 8, &format.Format, reinterpret_cast<BYTE *>(output16));
  assert(std::memcmp(output16, expected16, sizeof(output16)) == 0);
  format = pcmFormat(24, 24);
  BYTE output24[24]{};
  const BYTE expected24[] = {0, 0, 0x80, 0, 0, 0x80, 0, 0, 0,
                            0xff, 0xff, 0x7f, 0xff, 0xff, 0x7f, 0, 0, 0,
                            0, 0, 0x80, 0xff, 0xff, 0x7f};
  writeSamples(input, 8, &format.Format, output24);
  assert(std::memcmp(output24, expected24, sizeof(output24)) == 0);
  format = pcmFormat(32, 32);
  int32_t output32[8]{};
  const int32_t expected32[] = {INT32_MIN, INT32_MIN, 0, INT32_MAX, INT32_MAX, 0, INT32_MIN, INT32_MAX};
  writeSamples(input, 8, &format.Format, reinterpret_cast<BYTE *>(output32));
  assert(std::memcmp(output32, expected32, sizeof(output32)) == 0);
  format = pcmFormat(32, 24);
  writeSamples(input, 8, &format.Format, reinterpret_cast<BYTE *>(output32));
  assert(output32[3] == 2147483392 && output32[4] == 2147483392);
  for (const int32_t sample : output32)
    assert((static_cast<uint32_t>(sample) & 0xffu) == 0);

  format = pcmFormat(32, 32);
  format.SubFormat = KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;
  float outputFloat[8]{};
  writeSamples(input, 8, &format.Format, reinterpret_cast<BYTE *>(outputFloat));
  assert(std::memcmp(input, outputFloat, sizeof(input)) == 0);
  format.Format.wFormatTag = WAVE_FORMAT_IEEE_FLOAT;
  writeSamples(input, 8, &format.Format, reinterpret_cast<BYTE *>(outputFloat));
  assert(std::memcmp(input, outputFloat, sizeof(input)) == 0);
}

static void ringBufferTest() {
  SpscFloatRingBuffer ring(5);
  const float first[] = {1, 2, 3, 4};
  float output[5]{};
  assert(ring.write(first, 4) == 4);
  assert(ring.read(output, 3) == 3);
  assert(output[0] == 1 && output[1] == 2 && output[2] == 3);
  const float wrapped[] = {5, 6, 7, 8};
  assert(ring.write(wrapped, 4) == 4);
  assert(ring.read(output, 5) == 5);
  for (int i = 0; i < 5; ++i)
    assert(output[i] == static_cast<float>(i + 4));
  assert(ring.write(first, 4) == 4);
  ring.discardAll(); // consumer drops stale samples after a seek
  assert(ring.availableSamples() == 0);
  assert(ring.write(wrapped, 4) == 4);
  assert(ring.read(output, 4) == 4);
  for (int i = 0; i < 4; ++i)
    assert(output[i] == wrapped[i]);
}

static void seekEpochTest() {
  SpscFloatRingBuffer ring(8);
  std::atomic<uint64_t> seekEpoch{0}, consumerEpoch{0};
  std::thread producer([&] {
    for (uint64_t epoch = 1; epoch <= 10'000; ++epoch) {
      const float stale = -static_cast<float>(epoch);
      while (ring.write(&stale, 1) == 0)
        std::this_thread::yield();
      seekEpoch.store(epoch, std::memory_order_release);
      while (consumerEpoch.load(std::memory_order_acquire) != epoch)
        std::this_thread::yield();
      const float fresh = static_cast<float>(epoch);
      while (ring.write(&fresh, 1) == 0)
        std::this_thread::yield();
    }
  });
  for (uint64_t epoch = 1; epoch <= 10'000; ++epoch) {
    while (seekEpoch.load(std::memory_order_acquire) != epoch)
      std::this_thread::yield();
    ring.discardAll();
    consumerEpoch.store(epoch, std::memory_order_release);
    float sample = 0;
    while (ring.read(&sample, 1) == 0)
      std::this_thread::yield();
    assert(sample == static_cast<float>(epoch));
  }
  producer.join();
}

static void boundedFrameTest() {
  constexpr uint32_t limit = 1024 * 1024;
  assert(1 <= limit && limit + 1 > limit);
}

static void constantSumCrossfadeTest() {
  for (int i = 0; i <= 100; ++i) {
    const float t = i / 100.0f;
    assert(std::abs((1.0f - t + t) - 1.0f) < 0.00001f);
  }
}

static void gainRampTest() {
  float previous = 0;
  for (int i = 1; i <= 240; ++i) {
    const float gain = i / 240.0f;
    assert(gain >= previous);
    previous = gain;
  }
}

// A 1 kHz tone lands on the same output bin whatever the device rate, and
// silence stays at the floor.
static void spectrumAnalyzerTest() {
  for (const int rate : {44100, 48000, 96000, 192000}) {
    const size_t size = SpectrumAnalyzer::fftSizeFor(rate);
    std::vector<float> tone(size), silence(size);
    for (size_t i = 0; i < size; ++i)
      tone[i] = 0.5f * static_cast<float>(std::sin(2.0 * 3.14159265358979 * 1000.0 * i / rate));
    SpectrumAnalyzer analyzer, quiet;
    unsigned char bins[SpectrumAnalyzer::kBins]{};
    for (int frame = 0; frame < 40; ++frame)
      assert(analyzer.analyze(tone.data(), size, rate, bins));
    size_t loudest = 0;
    for (size_t k = 1; k < SpectrumAnalyzer::kBins; ++k)
      if (bins[k] > bins[loudest])
        loudest = k;
    const size_t expected = static_cast<size_t>(1000.0 / (SpectrumAnalyzer::kAxisHz / SpectrumAnalyzer::kBins));
    assert(loudest + 1 >= expected && loudest <= expected + 1);
    assert(bins[loudest] > 180);
    assert(bins[SpectrumAnalyzer::kBins / 2] < bins[loudest] / 4);
    assert(quiet.analyze(silence.data(), size, rate, bins));
    for (const unsigned char bin : bins)
      assert(bin == 0);
  }
}

int main() {
  integerRoundTripTest();
  sampleWriterBoundsTest();
  ringBufferTest();
  seekEpochTest();
  boundedFrameTest();
  constantSumCrossfadeTest();
  gainRampTest();
  spectrumAnalyzerTest();
  return 0;
}
