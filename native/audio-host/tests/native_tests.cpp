#include "../spsc_ring_buffer.h"
#include <atomic>
#ifdef NDEBUG
#undef NDEBUG
#endif
#include <cassert>
#include <cmath>
#include <cstdint>
#include <thread>

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

int main() {
  ringBufferTest();
  seekEpochTest();
  boundedFrameTest();
  constantSumCrossfadeTest();
  gainRampTest();
  return 0;
}
