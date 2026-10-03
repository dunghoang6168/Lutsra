#pragma once
#include <atomic>
#include <cstddef>
#include <vector>

class SpscFloatRingBuffer {
public:
  explicit SpscFloatRingBuffer(size_t capacity) : data_(capacity + 1) {}
  size_t write(const float* source, size_t count) noexcept {
    size_t written = 0;
    auto head = head_.load(std::memory_order_relaxed);
    const auto tail = tail_.load(std::memory_order_acquire);
    while (written < count) {
      const auto next = (head + 1) % data_.size();
      if (next == tail) break;
      data_[head] = source[written++]; head = next;
    }
    head_.store(head, std::memory_order_release);
    return written;
  }
  size_t read(float* target, size_t count) noexcept {
    size_t readCount = 0;
    auto tail = tail_.load(std::memory_order_relaxed);
    const auto head = head_.load(std::memory_order_acquire);
    while (readCount < count && tail != head) {
      target[readCount++] = data_[tail]; tail = (tail + 1) % data_.size();
    }
    tail_.store(tail, std::memory_order_release);
    return readCount;
  }
  void clear() noexcept { tail_.store(head_.load(std::memory_order_acquire), std::memory_order_release); }
private:
  std::vector<float> data_;
  alignas(64) std::atomic<size_t> head_{0};
  alignas(64) std::atomic<size_t> tail_{0};
};
