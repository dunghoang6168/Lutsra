#pragma once
#include <algorithm>
#include <cmath>
#include <cstddef>
extern "C" {
#include <libavutil/mem.h>
#include <libavutil/tx.h>
}

// Mirrors the Chromium engine's AnalyserNode (Blackman window, 0.5 smoothing,
// -90..-10 dB) so both engines draw the same spectrum. Output bins sit on a
// fixed 0..24 kHz axis whatever the device rate, which is what the renderer's
// log bands assume.
class SpectrumAnalyzer {
public:
  static constexpr size_t kBins = 1024;
  static constexpr size_t kMaxFftSize = 8192;
  static constexpr double kAxisHz = 24000.0;

  // ~43 ms of audio at any rate, like an fftSize of 2048 at 48 kHz.
  static size_t fftSizeFor(int sampleRate) {
    size_t size = 2048;
    while (size < kMaxFftSize && size * 48000 < 2048 * static_cast<size_t>(std::max(0, sampleRate)))
      size *= 2;
    return size;
  }

  SpectrumAnalyzer() = default;
  SpectrumAnalyzer(const SpectrumAnalyzer &) = delete;
  SpectrumAnalyzer &operator=(const SpectrumAnalyzer &) = delete;
  ~SpectrumAnalyzer() { release(); }

  // samples: `size` mono samples, oldest first. out: kBins bytes.
  bool analyze(const float *samples, size_t size, int sampleRate, unsigned char *out) {
    if (sampleRate <= 0 || size < 2 || size > kMaxFftSize || (size & (size - 1)))
      return false;
    if (size != size_ && !init(size))
      return false;
    for (size_t i = 0; i < size; ++i)
      input_[i] = samples[i] * window_[i];
    fn_(tx_, spectrum_, input_, sizeof(float));

    const double binHz = static_cast<double>(sampleRate) / size;
    const size_t sourceBins = size / 2 + 1;
    for (size_t k = 0; k < kBins; ++k) {
      // Loudest FFT bin inside this output bin, or the nearest one when the
      // FFT is coarser than the output axis.
      size_t first = static_cast<size_t>(std::ceil(k * kAxisHz / kBins / binHz));
      size_t last = static_cast<size_t>(std::ceil((k + 1) * kAxisHz / kBins / binHz));
      if (last <= first) {
        first = static_cast<size_t>(std::lround((k + 0.5) * kAxisHz / kBins / binHz));
        last = first + 1;
      }
      float magnitude = 0;
      for (size_t j = first; j < last && j < sourceBins; ++j)
        magnitude = std::max(magnitude, std::hypot(spectrum_[j].re, spectrum_[j].im));
      smoothed_[k] = 0.5f * smoothed_[k] + 0.5f * magnitude / static_cast<float>(size);
      const double db = 20.0 * std::log10(std::max(smoothed_[k], 1e-12f));
      out[k] = static_cast<unsigned char>(std::clamp((db + 90.0) * 255.0 / 80.0, 0.0, 255.0));
    }
    return true;
  }

private:
  bool init(size_t size) {
    release();
    const float scale = 1.0f;
    input_ = static_cast<float *>(av_malloc(size * sizeof(float)));
    window_ = static_cast<float *>(av_malloc(size * sizeof(float)));
    spectrum_ = static_cast<AVComplexFloat *>(av_malloc((size / 2 + 1) * sizeof(AVComplexFloat)));
    if (!input_ || !window_ || !spectrum_ ||
        av_tx_init(&tx_, &fn_, AV_TX_FLOAT_RDFT, 0, static_cast<int>(size), &scale, 0) < 0) {
      release();
      return false;
    }
    constexpr double pi = 3.14159265358979323846;
    for (size_t i = 0; i < size; ++i) {
      const double x = 2.0 * pi * i / size;
      window_[i] = static_cast<float>(0.42 - 0.5 * std::cos(x) + 0.08 * std::cos(2.0 * x));
    }
    size_ = size;
    return true;
  }

  void release() {
    av_tx_uninit(&tx_);
    av_freep(&input_);
    av_freep(&window_);
    av_freep(&spectrum_);
    size_ = 0;
  }

  AVTXContext *tx_{};
  av_tx_fn fn_{};
  float *input_{}, *window_{};
  AVComplexFloat *spectrum_{};
  size_t size_{};
  float smoothed_[kBins]{};
};
