#pragma once
#include <windows.h>
#include <mmreg.h>
#include <cstddef>

// Pure conversion: no allocation, gain, resampling or device access.
void writeSamples(const float* in, size_t samples, const WAVEFORMATEX* format, BYTE* out) noexcept;
