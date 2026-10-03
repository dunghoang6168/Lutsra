#include <initguid.h>
#include "audio_host.h"
#include <algorithm>
#include <avrt.h>
#include <chrono>
#include <cmath>
#include <functiondiscoverykeys_devpkey.h>
#include <ksmedia.h>
#include <propvarutil.h>
#include <sstream>
#include <utility>

using Microsoft::WRL::ComPtr;
class DeviceNotificationClient final : public IMMNotificationClient {
public:
  explicit DeviceNotificationClient(std::function<void()> changed)
      : changed_(std::move(changed)) {}
  ULONG STDMETHODCALLTYPE AddRef() override { return ++refs_; }
  ULONG STDMETHODCALLTYPE Release() override {
    auto value = --refs_;
    if (!value)
      delete this;
    return value;
  }
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id, void **out) override {
    if (!out)
      return E_POINTER;
    *out = nullptr;
    if (id == __uuidof(IUnknown) || id == __uuidof(IMMNotificationClient)) {
      *out = static_cast<IMMNotificationClient *>(this);
      AddRef();
      return S_OK;
    }
    return E_NOINTERFACE;
  }
  HRESULT STDMETHODCALLTYPE OnDeviceStateChanged(LPCWSTR, DWORD) override {
    changed_();
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE OnDeviceAdded(LPCWSTR) override {
    changed_();
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE OnDeviceRemoved(LPCWSTR) override {
    changed_();
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE OnDefaultDeviceChanged(EDataFlow flow, ERole role,
                                                   LPCWSTR) override {
    if (flow == eRender && role == eMultimedia)
      changed_();
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE OnPropertyValueChanged(LPCWSTR,
                                                   const PROPERTYKEY key) override {
    if (IsEqualPropertyKey(key, PKEY_AudioEngine_DeviceFormat))
      changed_();
    return S_OK;
  }

private:
  std::atomic<ULONG> refs_{1};
  std::function<void()> changed_;
};
static std::string jsonEscape(const std::string &value) {
  std::string out;
  for (char c : value) {
    if (c == '\\' || c == '"')
      out += '\\';
    if (static_cast<unsigned char>(c) >= 0x20)
      out += c;
  }
  return out;
}
static std::string narrow(const std::wstring &value) {
  if (value.empty())
    return {};
  int n = WideCharToMultiByte(CP_UTF8, 0, value.data(), (int)value.size(),
                              nullptr, 0, nullptr, nullptr);
  std::string out(n, '\0');
  WideCharToMultiByte(CP_UTF8, 0, value.data(), (int)value.size(), out.data(),
                      n, nullptr, nullptr);
  return out;
}
static std::wstring friendlyName(IMMDevice *device) {
  ComPtr<IPropertyStore> store;
  PROPVARIANT value;
  PropVariantInit(&value);
  std::wstring name = L"Audio output";
  if (SUCCEEDED(device->OpenPropertyStore(STGM_READ, &store)) &&
      SUCCEEDED(store->GetValue(PKEY_Device_FriendlyName, &value)) &&
      value.vt == VT_LPWSTR)
    name = value.pwszVal;
  PropVariantClear(&value);
  return name;
}
static AudioFormatInfo formatInfo(const WAVEFORMATEX *format) {
  return {(int)format->nSamplesPerSec, (int)format->wBitsPerSample,
          (int)format->nChannels};
}
static bool isFloatMixFormat(const WAVEFORMATEX *format) {
  if (format->wFormatTag == WAVE_FORMAT_IEEE_FLOAT)
    return true;
  if (format->wFormatTag != WAVE_FORMAT_EXTENSIBLE ||
      format->cbSize < sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX))
    return false;
  return IsEqualGUID(
      reinterpret_cast<const WAVEFORMATEXTENSIBLE *>(format)->SubFormat,
      KSDATAFORMAT_SUBTYPE_IEEE_FLOAT);
}

WasapiHost::WasapiHost(EventSink sink) : sink_(std::move(sink)) {
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  deviceEvent_ = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  invalidatedEvent_ = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                   IID_PPV_ARGS(&enumerator_));
  if (enumerator_) {
    notification_.Attach(new DeviceNotificationClient([this] {
      deviceDirty_.store(true, std::memory_order_release);
      if (deviceEvent_)
        SetEvent(deviceEvent_);
    }));
    enumerator_->RegisterEndpointNotificationCallback(notification_.Get());
  }
  std::string error;
  initializeEndpoint(L"system-default", error);
  telemetryThread_ = std::thread(&WasapiHost::telemetryLoopSafe, this);
  deviceMonitorThread_ = std::thread(&WasapiHost::deviceMonitorLoop, this);
}
WasapiHost::~WasapiHost() {
  if (enumerator_ && notification_)
    enumerator_->UnregisterEndpointNotificationCallback(notification_.Get());
  notification_.Reset();
  stopping_ = true;
  if (deviceEvent_)
    SetEvent(deviceEvent_);
  if (invalidatedEvent_)
    SetEvent(invalidatedEvent_);
  if (deviceMonitorThread_.joinable())
    deviceMonitorThread_.join();
  renderStopping_ = true;
  if (audioEvent_)
    SetEvent(audioEvent_);
  if (renderThread_.joinable())
    renderThread_.join();
  if (telemetryThread_.joinable())
    telemetryThread_.join();
  shutdownAudio();
  delete active_;
  delete incoming_;
  for (size_t i = 0; i < deferredCount_; ++i)
    delete deferredRetired_[i];
  for (size_t i = 0; i < mailboxCount_; ++i) {
    const auto &command = mailbox_[(mailboxHead_ + i) % mailbox_.size()];
    if (command.kind == CommandKind::SetActive ||
        command.kind == CommandKind::SetIncoming)
      delete command.decoder;
  }
  reap();
  if (deviceEvent_)
    CloseHandle(deviceEvent_);
  if (invalidatedEvent_)
    CloseHandle(invalidatedEvent_);
  CoUninitialize();
}

std::vector<DeviceInfo> WasapiHost::listDevices() {
  std::lock_guard lock(controlMutex_);
  std::vector<DeviceInfo> result;
  if (!enumerator_)
    return result;
  ComPtr<IMMDevice> defaultDevice;
  LPWSTR defaultId = nullptr;
  if (SUCCEEDED(enumerator_->GetDefaultAudioEndpoint(eRender, eMultimedia,
                                                     &defaultDevice)))
    defaultDevice->GetId(&defaultId);
  ComPtr<IMMDeviceCollection> collection;
  if (FAILED(enumerator_->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE,
                                             &collection))) {
    if (defaultId)
      CoTaskMemFree(defaultId);
    return result;
  }
  UINT count = 0;
  collection->GetCount(&count);
  for (UINT i = 0; i < count; i++) {
    ComPtr<IMMDevice> device;
    LPWSTR id = nullptr;
    if (FAILED(collection->Item(i, &device)) || FAILED(device->GetId(&id)))
      continue;
    ComPtr<IAudioClient> client;
    WAVEFORMATEX *mix = nullptr;
    AudioFormatInfo info{};
    if (SUCCEEDED(device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr,
                                   &client)) &&
        SUCCEEDED(client->GetMixFormat(&mix))) {
      info = formatInfo(mix);
      CoTaskMemFree(mix);
    }
    result.push_back({id, friendlyName(device.Get()),
                      defaultId && wcscmp(id, defaultId) == 0, info});
    CoTaskMemFree(id);
  }
  if (defaultId)
    CoTaskMemFree(defaultId);
  return result;
}

WasapiHost::EndpointBundle::~EndpointBundle() {
  if (mixFormat)
    CoTaskMemFree(mixFormat);
  if (event)
    CloseHandle(event);
}

std::unique_ptr<WasapiHost::EndpointBundle>
WasapiHost::createEndpoint(const std::wstring &id, std::string &error) {
  error.clear();
  if (!enumerator_) {
    error = "OUTPUT_DEVICE_UNAVAILABLE";
    return nullptr;
  }
  auto bundle = std::make_unique<EndpointBundle>();
  const HRESULT deviceResult = id == L"system-default"
      ? enumerator_->GetDefaultAudioEndpoint(eRender, eMultimedia, &bundle->device)
      : enumerator_->GetDevice(id.c_str(), &bundle->device);
  if (FAILED(deviceResult)) {
    error = "OUTPUT_DEVICE_UNAVAILABLE";
    return nullptr;
  }
  bundle->name = friendlyName(bundle->device.Get());
  LPWSTR endpointId = nullptr;
  if (SUCCEEDED(bundle->device->GetId(&endpointId)) && endpointId) {
    bundle->endpointId = endpointId;
    CoTaskMemFree(endpointId);
  }
  HRESULT hr = bundle->device->Activate(__uuidof(IAudioClient3), CLSCTX_ALL,
                                         nullptr, &bundle->client);
  if (SUCCEEDED(hr))
    hr = bundle->client->GetMixFormat(&bundle->mixFormat);
  if (FAILED(hr)) {
    error = hr == AUDCLNT_E_DEVICE_IN_USE ? "OUTPUT_DEVICE_BUSY"
                                          : "OUTPUT_DEVICE_UNAVAILABLE";
    return nullptr;
  }
  bundle->event = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  if (!bundle->event) {
    error = "OUTPUT_DEVICE_UNAVAILABLE";
    return nullptr;
  }
  // Music playback favors glitch resistance over minimum output latency.
  constexpr REFERENCE_TIME kSharedBufferHns = 100 * 10'000; // 100 ms
  hr = bundle->client->Initialize(AUDCLNT_SHAREMODE_SHARED,
                                  AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                                  kSharedBufferHns, 0, bundle->mixFormat,
                                  nullptr);
  if (SUCCEEDED(hr))
    hr = bundle->client->SetEventHandle(bundle->event);
  if (SUCCEEDED(hr))
    hr = bundle->client->GetBufferSize(&bundle->bufferFrames);
  if (SUCCEEDED(hr))
    hr = bundle->client->GetService(IID_PPV_ARGS(&bundle->renderClient));
  if (FAILED(hr)) {
    error = hr == AUDCLNT_E_DEVICE_IN_USE ? "OUTPUT_DEVICE_BUSY" :
            hr == AUDCLNT_E_UNSUPPORTED_FORMAT ? "OUTPUT_FORMAT_UNSUPPORTED" :
            "OUTPUT_DEVICE_UNAVAILABLE";
    return nullptr;
  }
  return bundle;
}

bool WasapiHost::swapEndpoint(std::unique_ptr<EndpointBundle> bundle,
                              const std::wstring &id, std::string &error) {
  if (!bundle)
    return false;
  const int previousRate = mixFormat_ ? mixFormat_->nSamplesPerSec : 0;
  const int previousChannels = mixFormat_ ? mixFormat_->nChannels : 0;
  playing_ = false;
  shutdownAudio();
  // No render thread runs now. Apply queued ownership transfers before reopening.
  while (mailboxCount_) {
    processMailbox();
    if (mailboxCount_)
      std::this_thread::sleep_for(std::chrono::milliseconds(2));
  }
  device_ = std::move(bundle->device);
  client_ = std::move(bundle->client);
  renderClient_ = std::move(bundle->renderClient);
  mixFormat_ = std::exchange(bundle->mixFormat, nullptr);
  audioEvent_ = std::exchange(bundle->event, nullptr);
  bufferFrames_ = bundle->bufferFrames;
  activeEndpointId_ = std::move(bundle->endpointId);
  deviceName_ = std::move(bundle->name);
  activeId_ = id;
  connected_ = true;
  endpointGeneration_.fetch_add(1, std::memory_order_release);
  if (previousRate && (previousRate != mixFormat_->nSamplesPerSec ||
                       previousChannels != mixFormat_->nChannels)) {
    fadeFramesRemaining_ = 0;
    fadeFramesTotal_ = 0;
    const auto reopen = [&](DecoderPipeline *&slot, AudioFormatInfo &source,
                            double &duration, double seconds) {
      if (!slot)
        return true;
      auto replacement = std::make_unique<DecoderPipeline>();
      if (!replacement->open(slot->path(), mixFormat_->nSamplesPerSec,
                             mixFormat_->nChannels, seconds, error))
        return false;
      delete slot;
      slot = replacement.release();
      source = slot->sourceFormat();
      duration = slot->duration();
      return true;
    };
    if (!reopen(active_, activeSource_, activeDuration_, position_.load()) ||
        !reopen(incoming_, incomingSource_, incomingDuration_,
                preparedPosition_.load())) {
      delete active_;
      delete incoming_;
      active_ = incoming_ = nullptr;
      activeToken_ = incomingToken_ = 0;
      error = error.empty() ? "MEDIA_DECODE" : error;
    }
    publishActive();
  }
  renderStopping_ = false;
  deviceInvalidated_ = false;
  renderThread_ = std::thread(&WasapiHost::renderLoopSafe, this);
  return error.empty();
}

bool WasapiHost::initializeEndpoint(const std::wstring &id,
                                    std::string &error) {
  auto bundle = createEndpoint(id, error);
  return bundle && swapEndpoint(std::move(bundle), id, error);
}bool WasapiHost::selectDevice(const std::wstring &id, std::string &error) {
  std::lock_guard lock(controlMutex_);
  if (!initializeEndpoint(id, error))
    return false;
  preferredId_ = id;
  return true;
}
bool WasapiHost::enqueue(RenderCommand command) {
  std::unique_lock lock(mailboxMutex_);
  mailboxAvailable_.wait(lock, [this] {
    return mailboxCount_ < mailbox_.size() || stopping_ || renderStopping_;
  });
  if (stopping_ || renderStopping_)
    return false;
  mailbox_[(mailboxHead_ + mailboxCount_) % mailbox_.size()] = command;
  ++mailboxCount_;
  if (audioEvent_)
    SetEvent(audioEvent_);
  return true;
}

bool WasapiHost::load(const std::string &trackId, const std::wstring &path,
                      std::string &error) {
  std::lock_guard lock(controlMutex_);
  if (!mixFormat_) {
    error = "OUTPUT_DEVICE_UNAVAILABLE";
    return false;
  }
  auto decoder = std::make_unique<DecoderPipeline>();
  if (!decoder->open(path, mixFormat_->nSamplesPerSec,
                     mixFormat_->nChannels, error))
    return false;
  playing_ = false;
  if (client_)
    client_->Stop();
  const uint64_t token = nextToken_++;
  trackIds_[token] = trackId;
  desiredActiveToken_ = token;
  desiredIncomingToken_ = 0;
  expectedPromotionToken_ = 0;
  currentExhausted_ = false;
  const AudioFormatInfo source = decoder->sourceFormat();
  const double duration = decoder->duration();
  if (!enqueue({CommandKind::ClearIncoming}) ||
      !enqueue({CommandKind::SetActive, decoder.get(), token, 0, 0,
                source, duration})) {
    error = "OUTPUT_DEVICE_UNAVAILABLE";
    return false;
  }
  decoder.release();
  sendEvent("{\"kind\":\"state\",\"value\":{\"state\":\"paused\",\"trackId\":\"" +
            jsonEscape(trackId) + "\"}}");
  return true;
}

bool WasapiHost::prepare(const std::string &trackId, const std::wstring &path,
                         std::string &error) {
  std::lock_guard lock(controlMutex_);
  if (!mixFormat_) {
    error = "OUTPUT_DEVICE_UNAVAILABLE";
    return false;
  }
  auto decoder = std::make_unique<DecoderPipeline>();
  if (!decoder->open(path, mixFormat_->nSamplesPerSec,
                     mixFormat_->nChannels, error))
    return false;
  const uint64_t token = nextToken_++;
  trackIds_[token] = trackId;
  desiredIncomingToken_ = token;
  expectedPromotionToken_ = 0;
  const AudioFormatInfo source = decoder->sourceFormat();
  const double duration = decoder->duration();
  if (!enqueue({CommandKind::SetIncoming, decoder.get(), token, 0, 0,
                source, duration})) {
    error = "OUTPUT_DEVICE_UNAVAILABLE";
    return false;
  }
  decoder.release();
  return true;
}

bool WasapiHost::startClientWithSilence() {
  if (!client_ || !renderClient_)
    return false;
  client_->Stop();
  if (FAILED(client_->Reset()))
    return false;
  BYTE *bytes = nullptr;
  if (FAILED(renderClient_->GetBuffer(bufferFrames_, &bytes)))
    return false;
  if (FAILED(renderClient_->ReleaseBuffer(bufferFrames_,
                                           AUDCLNT_BUFFERFLAGS_SILENT)))
    return false;
  return SUCCEEDED(client_->Start());
}

void WasapiHost::play() {
  std::unique_lock lock(controlMutex_);
  const uint64_t token = desiredActiveToken_;
  if (!token || !client_ || deviceInvalidated_)
    return;
  if (playing_)
    return;
  const uint64_t generation = endpointGeneration_.load();
  const size_t minimumSamples =
      static_cast<size_t>(mixFormat_->nSamplesPerSec) * mixFormat_->nChannels / 4;
  lock.unlock();
  const auto deadline = std::chrono::steady_clock::now() +
                        std::chrono::milliseconds(1500);
  while (std::chrono::steady_clock::now() < deadline) {
    if (activeTokenSnapshot_.load() == token &&
        (activeBufferedSamples_.load() >= minimumSamples ||
         activeDecodeFinished_))
      break;
    std::this_thread::sleep_for(std::chrono::milliseconds(5));
  }
  lock.lock();
  if (desiredActiveToken_ != token || activeTokenSnapshot_.load() != token ||
      !client_ || deviceInvalidated_ || endpointGeneration_.load() != generation)
    return;
  if (!startClientWithSilence())
    return;
  playing_ = true;
  sendEvent("{\"kind\":\"state\",\"value\":{\"state\":\"playing\",\"trackId\":\"" +
            jsonEscape(trackIds_[desiredActiveToken_]) + "\"}}");
}

void WasapiHost::pause() {
  std::lock_guard lock(controlMutex_);
  playing_ = false;
  if (client_)
    client_->Stop();
  // TODO: ramp the last 5-10 ms before Stop to avoid a possible pause click.
  sendEvent("{\"kind\":\"state\",\"value\":{\"state\":\"paused\",\"trackId\":\"" +
            jsonEscape(trackIds_[desiredActiveToken_]) + "\"}}");
}

void WasapiHost::seek(double seconds) {
  std::lock_guard lock(controlMutex_);
  if (!desiredActiveToken_)
    return;
  currentExhausted_ = false;
  const double target = std::max(0.0, seconds);
  position_ = target;
  enqueue({CommandKind::SeekActive, nullptr, 0, 0, target});
}

void WasapiHost::setVolume(float volume) {
  std::lock_guard lock(controlMutex_);
  volume_ = std::clamp(volume, 0.0f, 1.0f);
  sendEvent("{\"kind\":\"volume\",\"value\":{\"volume\":" +
            std::to_string(volume_.load()) + ",\"isMuted\":" +
            (muted_ ? "true" : "false") + "}}");
}

void WasapiHost::setMute(bool muted) {
  std::lock_guard lock(controlMutex_);
  muted_ = muted;
  sendEvent("{\"kind\":\"volume\",\"value\":{\"volume\":" +
            std::to_string(volume_.load()) + ",\"isMuted\":" +
            (muted ? "true" : "false") + "}}");
}

void WasapiHost::setFallback(bool enabled) {
  std::lock_guard lock(controlMutex_);
  fallback_ = enabled;
}

void WasapiHost::setSpectrum(bool enabled) {
  std::lock_guard lock(controlMutex_);
  spectrumEnabled_ = enabled;
}

void WasapiHost::cancelPrepared() {
  std::lock_guard lock(controlMutex_);
  desiredIncomingToken_ = 0;
  expectedPromotionToken_ = 0;
  enqueue({CommandKind::ClearIncoming});
}

bool WasapiHost::transition(double seconds) {
  std::unique_lock lock(controlMutex_);
  if (!desiredIncomingToken_ || !mixFormat_)
    return false;
  if (!playing_) {
    if (!currentExhausted_)
      return false;
    const uint64_t token = desiredIncomingToken_;
    desiredIncomingToken_ = 0;
    if (!enqueue({CommandKind::Promote}))
      return false;
    lock.unlock();
    const auto deadline = std::chrono::steady_clock::now() +
                          std::chrono::milliseconds(500);
    while (activeTokenSnapshot_.load() != token &&
           std::chrono::steady_clock::now() < deadline)
      std::this_thread::sleep_for(std::chrono::milliseconds(2));
    lock.lock();
    if (activeTokenSnapshot_.load() != token || !client_)
      return false;
    desiredActiveToken_ = token;
    if (!startClientWithSilence())
      return false;
    playing_ = true;
    return true;
  }
  const int frames = std::max(1, static_cast<int>(seconds * mixFormat_->nSamplesPerSec));
  expectedPromotionToken_ = desiredIncomingToken_;
  desiredIncomingToken_ = 0;
  return enqueue({CommandKind::BeginFade, nullptr, 0, frames});
}
std::string WasapiHost::statusJson() {
  std::lock_guard lock(controlMutex_);
  const AudioFormatInfo source{sourceRate_.load(), sourceBits_.load(),
                               sourceChannels_.load()};
  auto output = mixFormat_ ? formatInfo(mixFormat_) : AudioFormatInfo{};
  bool resample = source.sampleRate && source.sampleRate != output.sampleRate,
       channels = source.channels && source.channels != output.channels;
  auto active =
      activeId_.empty() ? "null" : "\"" + jsonEscape(narrow(activeId_)) + "\"";
  return "{\"preferredDeviceId\":\"" + jsonEscape(narrow(preferredId_)) +
         "\",\"activeDeviceId\":" + active + ",\"deviceName\":\"" +
         jsonEscape(narrow(deviceName_)) +
         "\",\"mode\":\"shared\",\"sourceFormat\":{" +
         "\"sampleRate\":" + std::to_string(source.sampleRate) +
         ",\"bitDepth\":" + std::to_string(source.bitDepth) +
         ",\"channels\":" + std::to_string(source.channels) +
         "},\"outputFormat\":{\"sampleRate\":" +
         std::to_string(output.sampleRate) +
         ",\"bitDepth\":" + std::to_string(output.bitDepth) +
         ",\"channels\":" + std::to_string(output.channels) +
         "},\"isConnected\":" + (connected_ ? "true" : "false") +
         ",\"capabilitiesAvailable\":true,\"reason\":\"WASAPI Shared engine "
         "mix "
         "format\",\"backend\":\"native-shared\",\"hostState\":\"ready\","
         "\"resamplingActive\":" +
         (resample ? "true" : "false") +
         ",\"channelConversionActive\":" + (channels ? "true" : "false") +
         ",\"bitPerfectEligible\":false,\"processingReasons\":[\"WASAPI Shared "
         "engine processing\"" +
         (resample ? ",\"Sample-rate conversion\"" : "") +
         (channels ? ",\"Channel conversion\"" : "") +
         "],\"underruns\":" + std::to_string(underruns_.load()) + "}";
}
void WasapiHost::signalRenderFailure(HRESULT result) noexcept {
  if (result != AUDCLNT_E_DEVICE_INVALIDATED &&
      result != AUDCLNT_E_SERVICE_NOT_RUNNING &&
      result != AUDCLNT_E_RESOURCES_INVALIDATED)
    return;
  if (!deviceInvalidated_.exchange(true, std::memory_order_acq_rel)) {
    wasPlayingBeforeInvalidation_ = playing_.exchange(false);
    if (invalidatedEvent_)
      SetEvent(invalidatedEvent_);
  }
}

void WasapiHost::deviceMonitorLoop() {
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  while (!stopping_) {
    if (!deviceEvent_ || !invalidatedEvent_) {
      std::this_thread::sleep_for(std::chrono::milliseconds(250));
      continue;
    }
    HANDLE events[] = {invalidatedEvent_, deviceEvent_};
    const DWORD result = WaitForMultipleObjects(2, events, FALSE, INFINITE);
    if (stopping_)
      break;
    if (result == WAIT_OBJECT_0) {
      recoverInvalidated();
      continue;
    }
    if (result != WAIT_OBJECT_0 + 1)
      continue;
    std::this_thread::sleep_for(std::chrono::milliseconds(250));
    if (!deviceDirty_.exchange(false, std::memory_order_acq_rel))
      continue;
    std::lock_guard lock(controlMutex_);
    onDevicesChanged();
  }
  CoUninitialize();
}

void WasapiHost::recoverInvalidated() {
  const bool resume = wasPlayingBeforeInvalidation_.exchange(false);
  std::wstring selectedId, endpointId;
  {
    std::lock_guard lock(controlMutex_);
    selectedId = activeId_;
    endpointId = activeEndpointId_;
    playing_ = false;
    const auto found = trackIds_.find(desiredActiveToken_);
    const std::string trackId = found == trackIds_.end() ? "" : found->second;
    sendEvent("{\"kind\":\"state\",\"value\":{\"state\":\"paused\",\"trackId\":\"" +
              jsonEscape(trackId) + "\"}}");
    sendEvent("{\"kind\":\"output-interrupted\",\"value\":{\"reason\":\"device-invalidated\"}}");
  }
  std::string failure = "OUTPUT_DEVICE_UNAVAILABLE";
  for (const int delay : {100, 500, 1500}) {
    if (stopping_)
      return;
    std::this_thread::sleep_for(std::chrono::milliseconds(delay));
    if (stopping_)
      return;
    std::lock_guard lock(controlMutex_);
    if (activeId_ != selectedId || activeEndpointId_ != endpointId)
      return;
    std::string error;
    auto bundle = createEndpoint(selectedId, error);
    if (bundle) {
      const bool sameEndpoint = bundle->endpointId == endpointId;
      if (swapEndpoint(std::move(bundle), selectedId, error)) {
        deviceInvalidated_ = false;
        connected_ = true;
        if (sameEndpoint && resume && desiredActiveToken_ && client_) {
          if (startClientWithSilence()) {
            playing_ = true;
            const auto found = trackIds_.find(desiredActiveToken_);
            const std::string trackId = found == trackIds_.end() ? "" : found->second;
            sendEvent("{\"kind\":\"state\",\"value\":{\"state\":\"playing\",\"trackId\":\"" +
                      jsonEscape(trackId) + "\"}}");
          }
        }
        sendEvent("{\"kind\":\"devices-changed\"}");
        return;
      }
    }
    failure = error == "OUTPUT_DEVICE_BUSY" ? error : "OUTPUT_DEVICE_UNAVAILABLE";
    if (failure == "OUTPUT_DEVICE_BUSY")
      sendEvent("{\"kind\":\"output-interrupted\",\"value\":{\"reason\":\"device-busy\"}}");
  }
  std::lock_guard lock(controlMutex_);
  if (activeId_ != selectedId || activeEndpointId_ != endpointId)
    return;
  connected_ = failure == "OUTPUT_DEVICE_BUSY";
  const auto found = trackIds_.find(desiredActiveToken_);
  const std::string trackId = found == trackIds_.end() ? "" : found->second;
  sendEvent("{\"kind\":\"state\",\"value\":{\"state\":\"error\",\"trackId\":\"" +
            jsonEscape(trackId) + "\",\"error\":{\"code\":\"" + failure +
            "\",\"message\":\"The selected audio output is unavailable.\",\"trackId\":\"" +
            jsonEscape(trackId) + "\"}}}");
}
void WasapiHost::onDevicesChanged() {
  // Called only by the monitor while it owns controlMutex_.
  if (!enumerator_)
    return;
  const auto pauseForChange = [this] {
    playing_ = false;
    if (client_)
      client_->Stop();
    const auto found = trackIds_.find(desiredActiveToken_);
    const std::string trackId = found == trackIds_.end() ? "" : found->second;
    sendEvent("{\"kind\":\"state\",\"value\":{\"state\":\"paused\",\"trackId\":\"" +
              jsonEscape(trackId) + "\"}}");
  };
  bool available = true;
  if (preferredId_ != L"system-default") {
    ComPtr<IMMDevice> preferred;
    DWORD state = 0;
    available = SUCCEEDED(enumerator_->GetDevice(preferredId_.c_str(), &preferred)) &&
                SUCCEEDED(preferred->GetState(&state)) &&
                (state & DEVICE_STATE_ACTIVE);
  } else {
    ComPtr<IMMDevice> nextDefault;
    LPWSTR id = nullptr;
    if (SUCCEEDED(enumerator_->GetDefaultAudioEndpoint(eRender, eMultimedia,
                                                       &nextDefault)) &&
        SUCCEEDED(nextDefault->GetId(&id))) {
      if (activeEndpointId_ != id) {
        pauseForChange();
        std::string error;
        if (!initializeEndpoint(L"system-default", error))
          connected_ = false;
      }
      CoTaskMemFree(id);
    } else {
      available = false;
    }
  }
  if (!available) {
    pauseForChange();
    connected_ = false;
    activeId_.clear();
    if (fallback_) {
      const auto savedId = preferredId_;
      const auto savedName = deviceName_;
      std::string error;
      if (initializeEndpoint(L"system-default", error))
        activeId_ = L"system-default";
      preferredId_ = savedId;
      deviceName_ = savedName;
      connected_ = false;
    }
  } else if (!connected_) {
    std::string error;
    if (initializeEndpoint(preferredId_, error))
      connected_ = true;
  } else if (mixFormat_ && !activeEndpointId_.empty()) {
    ComPtr<IMMDevice> activeDevice;
    ComPtr<IAudioClient> probe;
    WAVEFORMATEX *latest = nullptr;
    if (SUCCEEDED(enumerator_->GetDevice(activeEndpointId_.c_str(),
                                         &activeDevice)) &&
        SUCCEEDED(activeDevice->Activate(__uuidof(IAudioClient), CLSCTX_ALL,
                                         nullptr, &probe)) &&
        SUCCEEDED(probe->GetMixFormat(&latest))) {
      const bool changed = latest->nSamplesPerSec != mixFormat_->nSamplesPerSec ||
                           latest->nChannels != mixFormat_->nChannels ||
                           latest->wBitsPerSample != mixFormat_->wBitsPerSample;
      CoTaskMemFree(latest);
      if (changed) {
        pauseForChange();
        std::string error;
        if (!initializeEndpoint(activeId_, error))
          connected_ = false;
      }
    }
  }
  sendEvent("{\"kind\":\"devices-changed\"}");
}
void WasapiHost::shutdownAudio() {
  if (renderThread_.joinable()) {
    renderStopping_ = true;
    if (audioEvent_)
      SetEvent(audioEvent_);
    renderThread_.join();
  }
  if (client_)
    client_->Stop();
  renderClient_.Reset();
  client_.Reset();
  device_.Reset();
  if (mixFormat_) {
    CoTaskMemFree(mixFormat_);
    mixFormat_ = nullptr;
  }
  if (audioEvent_) {
    CloseHandle(audioEvent_);
    audioEvent_ = nullptr;
  }
}

void WasapiHost::flushRetired() noexcept {
  if (!deferredCount_ || !graveyardMutex_.try_lock())
    return;
  while (deferredCount_ && graveyardCount_ < graveyard_.size()) {
    graveyard_[graveyardCount_++] = deferredRetired_[0];
    for (size_t i = 1; i < deferredCount_; ++i)
      deferredRetired_[i - 1] = deferredRetired_[i];
    --deferredCount_;
  }
  graveyardMutex_.unlock();
}

void WasapiHost::retire(DecoderPipeline *decoder) noexcept {
  if (!decoder)
    return;
  if (deferredCount_ == deferredRetired_.size())
    flushRetired();
  // processMailbox and promoteIncoming leave room before calling retire.
  if (deferredCount_ < deferredRetired_.size())
    deferredRetired_[deferredCount_++] = decoder;
}

void WasapiHost::reap() {
  std::array<DecoderPipeline *, 16> pending{};
  size_t count = 0;
  {
    std::lock_guard lock(graveyardMutex_);
    count = graveyardCount_;
    for (size_t i = 0; i < count; ++i)
      pending[i] = graveyard_[i];
    graveyardCount_ = 0;
  }
  for (size_t i = 0; i < count; ++i)
    delete pending[i];
}

void WasapiHost::pushRenderEvent(RenderEvent event) noexcept {
  const size_t head = eventHead_.load(std::memory_order_relaxed);
  const size_t next = (head + 1) % renderEvents_.size();
  if (next == eventTail_.load(std::memory_order_acquire))
    return;
  renderEvents_[head] = event;
  eventHead_.store(next, std::memory_order_release);
}

std::string WasapiHost::trackIdFor(uint64_t token) {
  std::lock_guard lock(controlMutex_);
  const auto found = trackIds_.find(token);
  return found == trackIds_.end() ? std::string{} : found->second;
}

void WasapiHost::drainRenderEvents() {
  size_t tail = eventTail_.load(std::memory_order_relaxed);
  const size_t head = eventHead_.load(std::memory_order_acquire);
  while (tail != head) {
    const RenderEvent event = renderEvents_[tail];
    tail = (tail + 1) % renderEvents_.size();
    if (event.kind == RenderEventKind::Underrun)
      continue;
    if (event.token != activeTokenSnapshot_.load())
      continue;
    const std::string trackId = trackIdFor(event.token);
    if (event.kind == RenderEventKind::Promoted) {
      {
        std::lock_guard lock(controlMutex_);
        if (expectedPromotionToken_ == event.token) {
          desiredActiveToken_ = event.token;
          expectedPromotionToken_ = 0;
        }
      }
      sendEvent("{\"kind\":\"state\",\"value\":{\"state\":\"playing\",\"trackId\":\"" +
                jsonEscape(trackId) + "\"}}");
    } else if (event.kind == RenderEventKind::DecodeFailed) {
      sendEvent("{\"kind\":\"state\",\"value\":{\"state\":\"error\",\"trackId\":\"" +
                jsonEscape(trackId) +
                "\",\"error\":{\"code\":\"MEDIA_DECODE\",\"message\":\"The audio stream could not be decoded.\",\"trackId\":\"" +
                jsonEscape(trackId) + "\"}}}");
    } else {
      sendEvent("{\"kind\":\"state\",\"value\":{\"state\":\"ended\",\"trackId\":\"" +
                jsonEscape(trackId) + "\"}}");
    }
  }
  eventTail_.store(tail, std::memory_order_release);
}

void WasapiHost::publishActive() noexcept {
  activeTokenSnapshot_.store(activeToken_, std::memory_order_release);
  activeBufferedSamples_ = 0;
  activeDecodeFinished_ = false;
  sourceRate_ = activeSource_.sampleRate;
  sourceBits_ = activeSource_.bitDepth;
  sourceChannels_ = activeSource_.channels;
  activeDurationSnapshot_ = activeDuration_;
}

void WasapiHost::promoteIncoming() noexcept {
  if (!incoming_ || deferredCount_ == deferredRetired_.size())
    return;
  retire(active_);
  active_ = incoming_;
  activeToken_ = incomingToken_;
  activeSource_ = incomingSource_;
  activeDuration_ = incomingDuration_;
  incoming_ = nullptr;
  incomingToken_ = 0;
  position_ = active_->position();
  preparedPosition_ = 0;
  fadeFramesRemaining_ = 0;
  fadeFramesTotal_ = 0;
  currentExhausted_ = false;
  publishActive();
  pushRenderEvent({RenderEventKind::Promoted, activeToken_, 0});
}

void WasapiHost::processMailbox() noexcept {
  flushRetired();
  if (deferredCount_ == deferredRetired_.size() || !mailboxMutex_.try_lock())
    return;
  if (!mailboxCount_) {
    mailboxMutex_.unlock();
    return;
  }
  const RenderCommand command = mailbox_[mailboxHead_];
  if (command.kind == CommandKind::Stop &&
      deferredCount_ > deferredRetired_.size() - 2) {
    mailboxMutex_.unlock();
    return;
  }
  mailboxHead_ = (mailboxHead_ + 1) % mailbox_.size();
  --mailboxCount_;
  mailboxMutex_.unlock();
  mailboxAvailable_.notify_one();
  switch (command.kind) {
  case CommandKind::SetActive:
    retire(active_);
    active_ = command.decoder;
    activeToken_ = command.token;
    activeSource_ = command.source;
    activeDuration_ = command.duration;
    position_ = 0;
    currentExhausted_ = false;
    fadeFramesRemaining_ = 0;
    fadeFramesTotal_ = 0;
    publishActive();
    break;
  case CommandKind::SetIncoming:
    retire(incoming_);
    incoming_ = command.decoder;
    incomingToken_ = command.token;
    incomingSource_ = command.source;
    incomingDuration_ = command.duration;
    preparedPosition_ = 0;
    fadeFramesRemaining_ = 0;
    break;
  case CommandKind::ClearIncoming:
    retire(incoming_);
    incoming_ = nullptr;
    incomingToken_ = 0;
    fadeFramesRemaining_ = 0;
    fadeFramesTotal_ = 0;
    break;
  case CommandKind::BeginFade:
    if (incoming_) {
      fadeFramesRemaining_ = command.frames;
      fadeFramesTotal_ = command.frames;
    }
    break;
  case CommandKind::Promote:
    promoteIncoming();
    break;
  case CommandKind::Stop:
    retire(active_);
    retire(incoming_);
    active_ = incoming_ = nullptr;
    activeToken_ = incomingToken_ = 0;
    publishActive();
    break;
  case CommandKind::SeekActive:
    if (active_) {
      active_->seek(command.seconds);
    }
    break;
  }
}

void WasapiHost::renderLoopSafe() {
  const UINT32 channels = mixFormat_->nChannels;
  std::vector<float> outgoing(static_cast<size_t>(bufferFrames_) * channels);
  std::vector<float> incoming(outgoing.size());
  DWORD task = 0;
  HANDLE mmcss = AvSetMmThreadCharacteristicsW(L"Pro Audio", &task);
  float smoothedGain = 0;
  while (!renderStopping_) {
    processMailbox();
    if (active_) {
      active_->acknowledgeSeek();
      if (!active_->seekPending())
        position_ = active_->position();
      activeBufferedSamples_ = active_->seekPending() ? 0 : active_->bufferedSamples();
      activeDecodeFinished_ = active_->ended() || active_->failed();
    } else {
      activeBufferedSamples_ = 0;
      activeDecodeFinished_ = false;
    }
    if (incoming_)
      incoming_->acknowledgeSeek();
    const DWORD wait = WaitForSingleObject(audioEvent_, playing_ ? 50 : 15);
    processMailbox();
    if (active_) {
      active_->acknowledgeSeek();
      if (!active_->seekPending())
        position_ = active_->position();
      activeBufferedSamples_ = active_->seekPending() ? 0 : active_->bufferedSamples();
      activeDecodeFinished_ = active_->ended() || active_->failed();
    } else {
      activeBufferedSamples_ = 0;
      activeDecodeFinished_ = false;
    }
    if (incoming_)
      incoming_->acknowledgeSeek();
    if (renderStopping_ || wait != WAIT_OBJECT_0 || !playing_ || !renderClient_)
      continue;
    UINT32 padding = 0;
    const HRESULT paddingResult = client_->GetCurrentPadding(&padding);
    if (FAILED(paddingResult)) {
      signalRenderFailure(paddingResult);
      continue;
    }
    const UINT32 frames = bufferFrames_ - padding;
    if (!frames)
      continue;
    BYTE *bytes = nullptr;
    const HRESULT bufferResult = renderClient_->GetBuffer(frames, &bytes);
    if (FAILED(bufferResult)) {
      signalRenderFailure(bufferResult);
      continue;
    }
    const size_t samples = static_cast<size_t>(frames) * channels;
    std::fill_n(outgoing.data(), samples, 0.0f);
    std::fill_n(incoming.data(), samples, 0.0f);
    const size_t read = active_ ? active_->read(outgoing.data(), samples) : 0;
    if (active_ && read < samples && !active_->ended()) {
      ++underruns_;
      pushRenderEvent({RenderEventKind::Underrun, activeToken_, 1});
    }
    const bool outgoingEnded = active_ && active_->ended() && read == 0;
    bool promoted = false;
    int remaining = fadeFramesRemaining_;
    if (remaining > 0 && incoming_) {
      incoming_->read(incoming.data(), samples);
      preparedPosition_ = incoming_->position();
      if (outgoingEnded && deferredCount_ < deferredRetired_.size()) {
        std::copy_n(incoming.data(), samples, outgoing.data());
        promoteIncoming();
        promoted = true;
      } else {
        const int total = fadeFramesTotal_;
        for (UINT32 frame = 0; frame < frames; ++frame) {
          const float t = 1.0f - static_cast<float>(std::max(0, remaining -
              static_cast<int>(frame))) / total;
          for (UINT32 channel = 0; channel < channels; ++channel) {
            const size_t i = static_cast<size_t>(frame) * channels + channel;
            outgoing[i] = outgoing[i] * (1.0f - t) + incoming[i] * t;
          }
        }
        remaining = std::max(0, remaining - static_cast<int>(frames));
        fadeFramesRemaining_ = remaining;
        if (remaining == 0 && deferredCount_ < deferredRetired_.size()) {
          promoteIncoming();
          promoted = true;
        } else if (remaining == 0) {
          fadeFramesRemaining_ = 1;
        }
      }
    }
    const float target = muted_ ? 0.0f : volume_.load();
    const size_t ramp = std::max<size_t>(1, std::min(samples,
        static_cast<size_t>(mixFormat_->nSamplesPerSec) * channels / 200));
    const float step = (target - smoothedGain) / static_cast<float>(ramp);
    for (size_t i = 0; i < samples; ++i) {
      smoothedGain = i < ramp ? smoothedGain + step : target;
      outgoing[i] *= smoothedGain;
    }
    if (isFloatMixFormat(mixFormat_)) {
      std::copy_n(outgoing.data(), samples, reinterpret_cast<float *>(bytes));
    } else if (mixFormat_->wBitsPerSample == 16) {
      auto *out = reinterpret_cast<int16_t *>(bytes);
      for (size_t i = 0; i < samples; ++i)
        out[i] = static_cast<int16_t>(std::clamp(outgoing[i], -1.0f, 1.0f) * 32767);
    } else {
      auto *out = reinterpret_cast<int32_t *>(bytes);
      for (size_t i = 0; i < samples; ++i)
        out[i] = static_cast<int32_t>(std::clamp(outgoing[i], -1.0f, 1.0f) * 2147483647.0f);
    }
    if (spectrumEnabled_) {
      for (size_t bin = 0; bin < 128; ++bin) {
        float peak = 0;
        for (size_t i = bin * samples / 128; i < (bin + 1) * samples / 128; ++i)
          peak = std::max(peak, std::abs(outgoing[i]));
        spectrum_[bin] = static_cast<unsigned char>(std::min(255.0f, peak * 255.0f));
      }
    }
    const HRESULT releaseResult = renderClient_->ReleaseBuffer(frames, 0);
    if (FAILED(releaseResult)) {
      signalRenderFailure(releaseResult);
      continue;
    }
    if (!promoted && active_ && !active_->seekPending())
      position_ = active_->position();
    if (outgoingEnded && !promoted) {
      currentExhausted_ = true;
      playing_ = false;
      pushRenderEvent({active_->failed() ? RenderEventKind::DecodeFailed
                                         : RenderEventKind::Ended,
                       activeToken_, 0});
    }
  }
  if (mmcss)
    AvRevertMmThreadCharacteristics(mmcss);
  flushRetired();
}

void WasapiHost::telemetryLoopSafe() {
  int timeDivider = 0;
  while (!stopping_) {
    std::this_thread::sleep_for(std::chrono::milliseconds(34));
    drainRenderEvents();
    reap();
    if (playing_ && ++timeDivider >= 3) {
      timeDivider = 0;
      sendEvent("{\"kind\":\"time\",\"value\":{\"currentTime\":" +
                std::to_string(position_.load()) + ",\"duration\":" +
                std::to_string(activeDurationSnapshot_.load()) + "}}", true);
    }
    if (spectrumEnabled_) {
      std::ostringstream out;
      out << "{\"kind\":\"spectrum\",\"bins\":[";
      for (int i = 0; i < 128; ++i) {
        if (i)
          out << ',';
        out << static_cast<int>(spectrum_[i].load());
      }
      out << "]}";
      sendEvent(out.str(), true, true);
    }
  }
  drainRenderEvents();
  reap();
}
