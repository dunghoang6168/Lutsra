#pragma once
#include <windows.h>
#include <audioclient.h>
#include <mmdeviceapi.h>
#include <wrl/client.h>
#include <atomic>
#include <array>
#include <condition_variable>
#include <functional>
#include <mutex>
#include <memory>
#include <string>
#include <thread>
#include <vector>
#include "spsc_ring_buffer.h"

struct AudioFormatInfo { int sampleRate{}; int bitDepth{}; int channels{}; };
struct DeviceInfo { std::wstring id; std::wstring name; bool isDefault{}; AudioFormatInfo mix; };

class DecoderPipeline {
public:
  DecoderPipeline(); ~DecoderPipeline();
  bool open(const std::wstring& path, int outputRate, int outputChannels, std::string& error);
  void seek(double seconds); void stop();
  size_t read(float* output, size_t sampleCount) noexcept { return ring_.read(output, sampleCount); }
  AudioFormatInfo sourceFormat() const noexcept { return source_; }
  double duration() const noexcept { return duration_; }
  bool ended() const noexcept { return ended_.load(); }
  bool failed() const noexcept { return failed_.load(); }
private:
  void decodeLoop();
  SpscFloatRingBuffer ring_{4 * 1024 * 1024};
  std::thread worker_; std::atomic<bool> stopping_{false}, ended_{false}, failed_{false};
  std::atomic<double> pendingSeek_{-1};
  std::mutex wakeMutex_; std::condition_variable wakeCondition_;
  std::wstring path_; int outputRate_{}, outputChannels_{}; AudioFormatInfo source_{}; double duration_{};
};

class WasapiHost {
public:
  using EventSink = std::function<void(const std::string&)>;
  explicit WasapiHost(EventSink sink); ~WasapiHost();
  std::vector<DeviceInfo> listDevices();
  bool selectDevice(const std::wstring& id, std::string& error);
  bool load(const std::string& trackId, const std::wstring& path, std::string& error);
  bool prepare(const std::string& trackId, const std::wstring& path, std::string& error);
  void play(); void pause(); void seek(double seconds); void setVolume(float volume); void setMute(bool muted);
  void cancelPrepared(); bool transition(double seconds);
  void setFallback(bool enabled) { fallback_ = enabled; }
  void setSpectrum(bool enabled) { spectrumEnabled_ = enabled; }
  std::string statusJson();
private:
  bool initializeEndpoint(const std::wstring& id, std::string& error);
  bool promotePrepared(bool startPlayback);
  void renderLoopSafe(); void telemetryLoopSafe(); void shutdownAudio();
  void onDevicesChanged();
  EventSink sink_; std::wstring preferredId_{L"system-default"}, activeId_{L"system-default"}, activeEndpointId_, deviceName_{L"System Default"};
  std::atomic<bool> connected_{true};
  std::string currentTrackId_, preparedTrackId_, completedTrackId_;
  Microsoft::WRL::ComPtr<IMMDeviceEnumerator> enumerator_; Microsoft::WRL::ComPtr<IMMDevice> device_;
  Microsoft::WRL::ComPtr<IMMNotificationClient> notification_;
  Microsoft::WRL::ComPtr<IAudioClient3> client_; Microsoft::WRL::ComPtr<IAudioRenderClient> renderClient_;
  WAVEFORMATEX* mixFormat_{}; HANDLE audioEvent_{}; UINT32 bufferFrames_{};
  std::unique_ptr<DecoderPipeline> current_, prepared_;
  std::unique_ptr<DecoderPipeline> retired_;
  std::thread renderThread_, telemetryThread_; std::atomic<bool> stopping_{false}, renderStopping_{false}, playing_{false}, muted_{false}, fallback_{false}, spectrumEnabled_{false};
  std::atomic<float> volume_{0.8f}; std::atomic<double> position_{0};
  std::atomic<double> preparedPosition_{0};
  std::atomic<int> fadeFramesRemaining_{0}, fadeFramesTotal_{0};
  std::atomic<bool> transitionCompleted_{false}, endedPending_{false}, currentExhausted_{false};
  std::array<std::atomic<unsigned char>, 128> spectrum_{};
  std::mutex controlMutex_; AudioFormatInfo source_{};
};
