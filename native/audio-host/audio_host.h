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
#include <unordered_map>
#include <vector>
#include "spsc_ring_buffer.h"

struct AudioFormatInfo { int sampleRate{}; int bitDepth{}; int channels{}; };
struct DeviceInfo { std::wstring id; std::wstring name; bool isDefault{}; AudioFormatInfo mix; };

class DecoderPipeline {
public:
  DecoderPipeline(); ~DecoderPipeline();
  bool open(const std::wstring& path, int outputRate, int outputChannels, std::string& error);
  bool open(const std::wstring& path, int outputRate, int outputChannels, double startSeconds, std::string& error);
  void seek(double seconds); void stop();
  size_t read(float* output, size_t sampleCount) noexcept {
    acknowledgeSeek();
    if (seekPending())
      return 0;
    const size_t count = ring_.readAligned(output, sampleCount, outputChannels_);
    framesConsumed_.fetch_add(count / outputChannels_, std::memory_order_relaxed);
    return count;
  }
  void acknowledgeSeek() noexcept;
  bool seekPending() const noexcept {
    return seekGeneration_.load(std::memory_order_acquire) !=
           settledSeekGeneration_.load(std::memory_order_acquire);
  }
  double position() const noexcept {
    return outputRate_ ? static_cast<double>(framesConsumed_.load()) / outputRate_ : 0;
  }
  size_t bufferedSamples() const noexcept { return ring_.availableSamples(); }
  AudioFormatInfo sourceFormat() const noexcept { return source_; }
  double duration() const noexcept { return duration_; }
  const std::wstring& path() const noexcept { return path_; }
  bool ended() const noexcept { return ended_.load(); }
  bool failed() const noexcept { return failed_.load(); }
private:
  void decodeLoop();
  SpscFloatRingBuffer ring_{4 * 1024 * 1024};
  std::thread worker_; std::atomic<bool> stopping_{false}, ended_{false}, failed_{false};
  std::atomic<double> pendingSeek_{-1};
  std::atomic<uint64_t> seekEpoch_{0}, consumerEpoch_{0};
  std::atomic<uint64_t> seekGeneration_{0}, settledSeekGeneration_{0};
  std::atomic<uint64_t> seekBaseFrames_{0}, framesConsumed_{0};
  std::mutex wakeMutex_; std::condition_variable wakeCondition_;
  std::wstring path_; int outputRate_{}, outputChannels_{}; AudioFormatInfo source_{}; double duration_{};
};

// The render thread exclusively owns active_ and incoming_ after mailbox transfer.
// Control creates decoders and transfers raw pointers; only the reaper deletes them.
// Render publishes POD events and atomic snapshots, never strings or sink calls.
// Endpoint resources are changed only while the render thread is stopped.
class WasapiHost {
public:
  using EventSink = std::function<void(const std::string&, bool lossy, bool spectrum)>;
  explicit WasapiHost(EventSink sink); ~WasapiHost();
  std::vector<DeviceInfo> listDevices();
  bool selectDevice(const std::wstring& id, std::string& error);
  bool load(const std::string& trackId, const std::wstring& path, std::string& error);
  bool prepare(const std::string& trackId, const std::wstring& path, std::string& error);
  void play(); void pause(); void seek(double seconds); void setVolume(float volume); void setMute(bool muted);
  void cancelPrepared(); bool transition(double seconds);
  void setFallback(bool enabled);
  void setSpectrum(bool enabled);
  std::string statusJson();
private:
  void sendEvent(const std::string& payload, bool lossy = false, bool spectrum = false) { sink_(payload, lossy, spectrum); }
  struct EndpointBundle {
    Microsoft::WRL::ComPtr<IMMDevice> device;
    Microsoft::WRL::ComPtr<IAudioClient3> client;
    Microsoft::WRL::ComPtr<IAudioRenderClient> renderClient;
    WAVEFORMATEX* mixFormat{};
    HANDLE event{};
    UINT32 bufferFrames{};
    std::wstring endpointId, name;
    ~EndpointBundle();
  };
  std::unique_ptr<EndpointBundle> createEndpoint(const std::wstring& id, std::string& error);
  bool swapEndpoint(std::unique_ptr<EndpointBundle> bundle, const std::wstring& id, std::string& error);
  bool initializeEndpoint(const std::wstring& id, std::string& error);
  enum class CommandKind { SetActive, SetIncoming, ClearIncoming, BeginFade, Promote, Stop, SeekActive };
  struct RenderCommand {
    CommandKind kind{};
    DecoderPipeline* decoder{};
    uint64_t token{};
    int frames{};
    double seconds{};
    AudioFormatInfo source{};
    double duration{};
  };
  enum class RenderEventKind { Promoted, Ended, DecodeFailed, Underrun };
  struct RenderEvent { RenderEventKind kind{}; uint64_t token{}; uint64_t value{}; };
  bool enqueue(RenderCommand command);
  void processMailbox() noexcept;
  void retire(DecoderPipeline* decoder) noexcept;
  void flushRetired() noexcept;
  void reap();
  void pushRenderEvent(RenderEvent event) noexcept;
  void drainRenderEvents();
  void publishActive() noexcept;
  void promoteIncoming() noexcept;
  std::string trackIdFor(uint64_t token);
  void renderLoopSafe(); void telemetryLoopSafe(); void shutdownAudio();
  void deviceMonitorLoop();
  void recoverInvalidated();
  void signalRenderFailure(HRESULT result) noexcept;
  bool startClientWithSilence();
  void onDevicesChanged();
  EventSink sink_; std::wstring preferredId_{L"system-default"}, activeId_{L"system-default"}, activeEndpointId_, deviceName_{L"System Default"};
  std::atomic<bool> connected_{true};
  std::unordered_map<uint64_t, std::string> trackIds_;
  uint64_t nextToken_{1}, desiredActiveToken_{}, desiredIncomingToken_{}, expectedPromotionToken_{};
  Microsoft::WRL::ComPtr<IMMDeviceEnumerator> enumerator_; Microsoft::WRL::ComPtr<IMMDevice> device_;
  Microsoft::WRL::ComPtr<IMMNotificationClient> notification_;
  Microsoft::WRL::ComPtr<IAudioClient3> client_; Microsoft::WRL::ComPtr<IAudioRenderClient> renderClient_;
  WAVEFORMATEX* mixFormat_{}; HANDLE audioEvent_{}; UINT32 bufferFrames_{};
  DecoderPipeline* active_{};
  DecoderPipeline* incoming_{};
  uint64_t activeToken_{}, incomingToken_{};
  AudioFormatInfo activeSource_{}, incomingSource_{};
  double activeDuration_{}, incomingDuration_{};
  std::array<RenderCommand, 16> mailbox_{};
  size_t mailboxHead_{}, mailboxCount_{};
  std::mutex mailboxMutex_;
  std::condition_variable mailboxAvailable_;
  std::array<DecoderPipeline*, 16> graveyard_{};
  size_t graveyardCount_{};
  std::mutex graveyardMutex_;
  std::array<DecoderPipeline*, 8> deferredRetired_{};
  size_t deferredCount_{};
  std::array<RenderEvent, 4096> renderEvents_{};
  std::atomic<size_t> eventHead_{0}, eventTail_{0};
  HANDLE deviceEvent_{};
  HANDLE invalidatedEvent_{};
  std::atomic<bool> deviceDirty_{false};
  std::atomic<bool> deviceInvalidated_{false}, wasPlayingBeforeInvalidation_{false};
  std::thread renderThread_, telemetryThread_, deviceMonitorThread_; std::atomic<bool> stopping_{false}, renderStopping_{false}, playing_{false}, muted_{false}, fallback_{false}, spectrumEnabled_{false};
  std::atomic<float> volume_{0.8f}; std::atomic<double> position_{0}, activeDurationSnapshot_{0};
  std::atomic<int> sourceRate_{0}, sourceBits_{0}, sourceChannels_{0};
  std::atomic<uint64_t> activeTokenSnapshot_{0}, underruns_{0};
  std::atomic<size_t> activeBufferedSamples_{0};
  std::atomic<bool> activeDecodeFinished_{false};
  std::atomic<uint64_t> endpointGeneration_{0};
  std::atomic<double> preparedPosition_{0};
  std::atomic<int> fadeFramesRemaining_{0}, fadeFramesTotal_{0};
  std::atomic<bool> currentExhausted_{false};
  std::array<std::atomic<unsigned char>, 128> spectrum_{};
  std::mutex controlMutex_;
};
