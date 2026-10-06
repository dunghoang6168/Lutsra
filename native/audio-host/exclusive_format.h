#pragma once
#include <algorithm>
#include <optional>
#include <string>
#include <tuple>
#include <vector>

struct AudioFormatInfo { int sampleRate{}; int bitDepth{}; int channels{}; };
struct SupportedFormatInfo {
  int sampleRate{}; int bitDepth{}; int channels{}; int containerBits{};
  bool operator==(const SupportedFormatInfo&) const = default;
};
struct ExclusiveFormatChoice {
  std::optional<SupportedFormatInfo> format;
  std::vector<SupportedFormatInfo> candidates;
  std::vector<std::string> reasons;
};

inline ExclusiveFormatChoice chooseExclusiveFormat(
    AudioFormatInfo source, const std::vector<SupportedFormatInfo>& supported) {
  ExclusiveFormatChoice result;
  const auto family = [](int rate) { return rate % 44100 == 0 ? 44100 : 48000; };
  for (const auto& f : supported) {
    if (f.sampleRate == source.sampleRate ||
        (f.sampleRate > source.sampleRate && family(f.sampleRate) == family(source.sampleRate)))
      result.candidates.push_back(f);
  }
  const auto score = [&](const SupportedFormatInfo& f) {
    const int bits = source.bitDepth > 0 ? source.bitDepth : 24;
    const int container = f.containerBits == 32 && f.bitDepth == 24 ? 0 :
                          f.containerBits == 24 ? 1 : f.containerBits == 32 ? 2 : 3;
    return std::tuple(f.sampleRate, f.channels == source.channels ? 0 : 1,
                      f.bitDepth >= bits ? 0 : 1,
                      f.bitDepth == bits ? 0 : 1,
                      f.bitDepth < bits ? -f.bitDepth : 0, container);
  };
  std::stable_sort(result.candidates.begin(), result.candidates.end(),
                   [&](const auto& a, const auto& b) { return score(a) < score(b); });
  if (result.candidates.empty()) return result;
  result.format = result.candidates.front();
  const auto& f = *result.format;
  if (f.sampleRate != source.sampleRate) result.reasons.push_back("Sample-rate conversion");
  if (f.channels != source.channels) result.reasons.push_back("Channel conversion");
  if (source.bitDepth > f.bitDepth) result.reasons.push_back("Bit-depth reduction");
  return result;
}

inline bool canPrepareExclusive(AudioFormatInfo source,
                                const std::vector<SupportedFormatInfo>& supported,
                                SupportedFormatInfo stream) {
  const auto choice = chooseExclusiveFormat(source, supported);
  return choice.format && *choice.format == stream;
}

// Event-driven Exclusive has two alternating buffers. The first event after
// submission means that buffer STARTED playing; only the second drains it.
struct ExclusiveFadeDrain {
  int eventsRemaining{};
  void submittedFinalFade() noexcept { eventsRemaining = 2; }
  bool nextEvent() noexcept { return eventsRemaining > 0 && --eventsRemaining == 0; }
};
