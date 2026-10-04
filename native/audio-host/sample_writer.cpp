#include "sample_writer.h"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <ks.h>
#include <ksmedia.h>

static int32_t integerSample(float sample, double scale,
                             double minimum, double maximum) noexcept {
  // Clamp before narrowing; float cannot represent INT32_MAX, and NaN must
  // never reach a float-to-integer cast. Double holds both bounds exactly.
  const double scaled = std::isnan(sample) ? 0.0 : static_cast<double>(sample) * scale;
  return static_cast<int32_t>(std::clamp(scaled, minimum, maximum));
}

void writeSamples(const float *in, size_t samples,
                   const WAVEFORMATEX *format, BYTE *out) noexcept {
  const auto *extended = format->wFormatTag == WAVE_FORMAT_EXTENSIBLE &&
      format->cbSize >= sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX)
      ? reinterpret_cast<const WAVEFORMATEXTENSIBLE *>(format) : nullptr;
  const bool isFloat = format->wFormatTag == WAVE_FORMAT_IEEE_FLOAT ||
      (extended && IsEqualGUID(extended->SubFormat, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT));
  if (isFloat && format->wBitsPerSample == 32) {
    std::memcpy(out, in, samples * sizeof(float));
    return;
  }
  const bool isPcm = format->wFormatTag == WAVE_FORMAT_PCM ||
      (extended && IsEqualGUID(extended->SubFormat, KSDATAFORMAT_SUBTYPE_PCM));
  if (isPcm && format->wBitsPerSample == 16) {
    for (size_t i = 0; i < samples; ++i) {
      const auto sample = static_cast<int16_t>(integerSample(in[i], 32768.0, -32768.0, 32767.0));
      std::memcpy(out + i * sizeof(sample), &sample, sizeof(sample));
    }
  } else if (isPcm && format->wBitsPerSample == 24) {
    for (size_t i = 0; i < samples; ++i) {
      const auto sample = static_cast<uint32_t>(integerSample(in[i], 8388608.0, -8388608.0, 8388607.0));
      out[i * 3] = static_cast<BYTE>(sample);
      out[i * 3 + 1] = static_cast<BYTE>(sample >> 8);
      out[i * 3 + 2] = static_cast<BYTE>(sample >> 16);
    }
  } else if (isPcm && format->wBitsPerSample == 32) {
    const bool valid24 = extended && extended->Samples.wValidBitsPerSample == 24;
    for (size_t i = 0; i < samples; ++i) {
      auto sample = static_cast<uint32_t>(integerSample(in[i], 2147483648.0, -2147483648.0, 2147483647.0));
      // WAVEFORMATEXTENSIBLE valid bits are left-aligned. Padding stays zero
      // even for clipped or processed samples that are not exact 24-bit PCM.
      if (valid24)
        sample &= 0xffffff00u;
      std::memcpy(out + i * sizeof(sample), &sample, sizeof(sample));
    }
  } else {
    std::memset(out, 0, samples * (format->wBitsPerSample / 8));
  }
}
