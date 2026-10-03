#include "audio_host.h"
#include <algorithm>
#include <avrt.h>
#include <chrono>
#include <cmath>
#include <functiondiscoverykeys_devpkey.h>
#include <ksmedia.h>
#include <propvarutil.h>
#include <sstream>

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
  HRESULT STDMETHODCALLTYPE OnDefaultDeviceChanged(EDataFlow flow, ERole,
                                                   LPCWSTR) override {
    if (flow == eRender)
      changed_();
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE OnPropertyValueChanged(LPCWSTR,
                                                   const PROPERTYKEY) override {
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
  CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                   IID_PPV_ARGS(&enumerator_));
  if (enumerator_) {
    notification_.Attach(
        new DeviceNotificationClient([this] { onDevicesChanged(); }));
    enumerator_->RegisterEndpointNotificationCallback(notification_.Get());
  }
  std::string error;
  initializeEndpoint(L"system-default", error);
  telemetryThread_ = std::thread(&WasapiHost::telemetryLoopSafe, this);
}
WasapiHost::~WasapiHost() {
  if (enumerator_ && notification_)
    enumerator_->UnregisterEndpointNotificationCallback(notification_.Get());
  notification_.Reset();
  stopping_ = true;
  renderStopping_ = true;
  if (audioEvent_)
    SetEvent(audioEvent_);
  if (renderThread_.joinable())
    renderThread_.join();
  if (telemetryThread_.joinable())
    telemetryThread_.join();
  shutdownAudio();
  current_.reset();
  prepared_.reset();
  CoUninitialize();
}

std::vector<DeviceInfo> WasapiHost::listDevices() {
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

bool WasapiHost::initializeEndpoint(const std::wstring &id,
                                    std::string &error) {
  std::lock_guard lock(controlMutex_);
  const bool resume = playing_.exchange(false);
  shutdownAudio();
  HRESULT hr;
  if (id == L"system-default")
    hr = enumerator_->GetDefaultAudioEndpoint(eRender, eMultimedia, &device_);
  else
    hr = enumerator_->GetDevice(id.c_str(), &device_);
  if (FAILED(hr)) {
    error = "OUTPUT_DEVICE_UNAVAILABLE";
    return false;
  }
  deviceName_ = friendlyName(device_.Get());
  LPWSTR endpointId = nullptr;
  if (SUCCEEDED(device_->GetId(&endpointId))) {
    activeEndpointId_ = endpointId;
    CoTaskMemFree(endpointId);
  }
  if (FAILED(device_->Activate(__uuidof(IAudioClient3), CLSCTX_ALL, nullptr,
                               &client_)) ||
      FAILED(client_->GetMixFormat(&mixFormat_))) {
    error = "OUTPUT_DEVICE_UNAVAILABLE";
    return false;
  }
  UINT32 defaultPeriod = 0, fundamental = 0, minPeriod = 0, maxPeriod = 0;
  client_->GetSharedModeEnginePeriod(mixFormat_, &defaultPeriod, &fundamental,
                                     &minPeriod, &maxPeriod);
  audioEvent_ = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  if (!audioEvent_) {
    error = "OUTPUT_DEVICE_UNAVAILABLE";
    return false;
  }
  hr = client_->InitializeSharedAudioStream(AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                                            defaultPeriod, mixFormat_, nullptr);
  if (FAILED(hr) || FAILED(client_->SetEventHandle(audioEvent_)) ||
      FAILED(client_->GetBufferSize(&bufferFrames_)) ||
      FAILED(client_->GetService(IID_PPV_ARGS(&renderClient_)))) {
    error = "OUTPUT_DEVICE_UNAVAILABLE";
    shutdownAudio();
    return false;
  }
  activeId_ = id;
  connected_ = true;
  renderStopping_ = false;
  renderThread_ = std::thread(&WasapiHost::renderLoopSafe, this);
  if (resume)
    play();
  return true;
}
bool WasapiHost::selectDevice(const std::wstring &id, std::string &error) {
  if (!initializeEndpoint(id, error))
    return false;
  preferredId_ = id;
  return true;
}
bool WasapiHost::load(const std::string &trackId, const std::wstring &path,
                      std::string &error) {
  std::lock_guard lock(controlMutex_);
  playing_ = false;
  if (client_)
    client_->Stop();
  retired_.reset();
  auto decoder = std::make_unique<DecoderPipeline>();
  if (!mixFormat_ || !decoder->open(path, mixFormat_->nSamplesPerSec,
                                    mixFormat_->nChannels, error))
    return false;
  current_ = std::move(decoder);
  prepared_.reset();
  preparedTrackId_.clear();
  preparedPosition_ = 0;
  fadeFramesRemaining_ = 0;
  fadeFramesTotal_ = 0;
  transitionCompleted_ = false;
  endedPending_ = false;
  currentExhausted_ = false;
  currentTrackId_ = trackId;
  source_ = current_->sourceFormat();
  position_ = 0;
  sink_("{\"kind\":\"state\",\"value\":{\"state\":\"paused\",\"trackId\":\"" +
        jsonEscape(trackId) + "\"}}");
  return true;
}
bool WasapiHost::prepare(const std::string &trackId, const std::wstring &path,
                         std::string &error) {
  std::lock_guard lock(controlMutex_);
  retired_.reset();
  auto decoder = std::make_unique<DecoderPipeline>();
  if (!mixFormat_ || !decoder->open(path, mixFormat_->nSamplesPerSec,
                                    mixFormat_->nChannels, error))
    return false;
  prepared_ = std::move(decoder);
  preparedTrackId_ = trackId;
  preparedPosition_ = 0;
  return true;
}
void WasapiHost::play() {
  if (current_ && client_) {
    playing_ = true;
    client_->Start();
    sink_(
        "{\"kind\":\"state\",\"value\":{\"state\":\"playing\",\"trackId\":\"" +
        jsonEscape(currentTrackId_) + "\"}}");
  }
}
void WasapiHost::pause() {
  playing_ = false;
  if (client_)
    client_->Stop();
  sink_("{\"kind\":\"state\",\"value\":{\"state\":\"paused\",\"trackId\":\"" +
        jsonEscape(currentTrackId_) + "\"}}");
}
void WasapiHost::seek(double seconds) {
  if (current_) {
    currentExhausted_ = false;
    endedPending_ = false;
    current_->seek(seconds);
    position_ = seconds;
  }
}
void WasapiHost::setVolume(float volume) {
  volume_ = std::clamp(volume, 0.0f, 1.0f);
  sink_("{\"kind\":\"volume\",\"value\":{\"volume\":" +
        std::to_string(volume_.load()) +
        ",\"isMuted\":" + (muted_ ? "true" : "false") + "}}");
}
void WasapiHost::setMute(bool muted) {
  muted_ = muted;
  sink_("{\"kind\":\"volume\",\"value\":{\"volume\":" +
        std::to_string(volume_.load()) +
        ",\"isMuted\":" + (muted ? "true" : "false") + "}}");
}
void WasapiHost::cancelPrepared() {
  std::lock_guard lock(controlMutex_);
  prepared_.reset();
  preparedTrackId_.clear();
  preparedPosition_ = 0;
  fadeFramesRemaining_ = 0;
  fadeFramesTotal_ = 0;
}
bool WasapiHost::promotePrepared(bool startPlayback) {
  if (!prepared_ || !mixFormat_)
    return false;
  if (startPlayback && client_) {
    const HRESULT result = client_->Start();
    if (FAILED(result) && result != AUDCLNT_E_NOT_STOPPED)
      return false;
  }
  retired_ = std::move(current_);
  current_ = std::move(prepared_);
  currentTrackId_ = preparedTrackId_;
  completedTrackId_ = currentTrackId_;
  preparedTrackId_.clear();
  source_ = current_->sourceFormat();
  position_ = preparedPosition_.exchange(0);
  fadeFramesRemaining_ = 0;
  fadeFramesTotal_ = 0;
  endedPending_ = false;
  currentExhausted_ = false;
  transitionCompleted_.store(true, std::memory_order_release);
  if (startPlayback)
    playing_ = true;
  return true;
}
bool WasapiHost::transition(double seconds) {
  std::lock_guard lock(controlMutex_);
  if (!prepared_ || !mixFormat_)
    return false;
  preparedPosition_ = 0;
  if (!playing_)
    return currentExhausted_ && promotePrepared(true);
  int frames = std::max(1, (int)(seconds * mixFormat_->nSamplesPerSec));
  fadeFramesTotal_ = frames;
  fadeFramesRemaining_ = frames;
  return true;
}

std::string WasapiHost::statusJson() {
  auto output = mixFormat_ ? formatInfo(mixFormat_) : AudioFormatInfo{};
  bool resample = source_.sampleRate && source_.sampleRate != output.sampleRate,
       channels = source_.channels && source_.channels != output.channels;
  auto active =
      activeId_.empty() ? "null" : "\"" + jsonEscape(narrow(activeId_)) + "\"";
  return "{\"preferredDeviceId\":\"" + jsonEscape(narrow(preferredId_)) +
         "\",\"activeDeviceId\":" + active + ",\"deviceName\":\"" +
         jsonEscape(narrow(deviceName_)) +
         "\",\"mode\":\"shared\",\"sourceFormat\":{" +
         "\"sampleRate\":" + std::to_string(source_.sampleRate) +
         ",\"bitDepth\":" + std::to_string(source_.bitDepth) +
         ",\"channels\":" + std::to_string(source_.channels) +
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
         (channels ? ",\"Channel conversion\"" : "") + "]}";
}
void WasapiHost::onDevicesChanged() {
  bool available = true;
  if (preferredId_ != L"system-default") {
    ComPtr<IMMDevice> preferred;
    DWORD state = 0;
    available =
        SUCCEEDED(enumerator_->GetDevice(preferredId_.c_str(), &preferred)) &&
        SUCCEEDED(preferred->GetState(&state)) && (state & DEVICE_STATE_ACTIVE);
  } else {
    ComPtr<IMMDevice> nextDefault;
    LPWSTR id = nullptr;
    if (SUCCEEDED(enumerator_->GetDefaultAudioEndpoint(eRender, eMultimedia,
                                                       &nextDefault)) &&
        SUCCEEDED(nextDefault->GetId(&id))) {
      if (activeEndpointId_ != id) {
        pause();
        std::string error;
        initializeEndpoint(L"system-default", error);
        playing_ = false;
      }
      CoTaskMemFree(id);
    }
  }
  if (!available) {
    pause();
    connected_ = false;
    activeId_.clear();
    if (fallback_) {
      auto savedId = preferredId_;
      auto savedName = deviceName_;
      std::string error;
      if (initializeEndpoint(L"system-default", error))
        activeId_ = L"system-default";
      preferredId_ = savedId;
      deviceName_ = savedName;
      connected_ = false;
    }
  } else if (!connected_) {
    std::string error;
    initializeEndpoint(preferredId_, error);
    playing_ = false;
    connected_ = error.empty();
  }
  sink_("{\"kind\":\"devices-changed\"}");
}
void WasapiHost::shutdownAudio() {
  if (client_)
    client_->Stop();
  if (renderThread_.joinable()) {
    renderStopping_ = true;
    if (audioEvent_)
      SetEvent(audioEvent_);
    renderThread_.join();
  }
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

void WasapiHost::renderLoopSafe() {
  DWORD task = 0;
  HANDLE mmcss = AvSetMmThreadCharacteristicsW(L"Pro Audio", &task);
  const UINT32 channels = mixFormat_->nChannels;
  std::vector<float> outgoing((size_t)bufferFrames_ * channels),
      incoming(outgoing.size());
  float smoothedGain = 0;
  while (!renderStopping_) {
    if (WaitForSingleObject(audioEvent_, 250) != WAIT_OBJECT_0 || !playing_ ||
        !renderClient_)
      continue;
    UINT32 padding = 0;
    if (FAILED(client_->GetCurrentPadding(&padding)))
      continue;
    UINT32 frames = bufferFrames_ - padding;
    if (!frames)
      continue;
    BYTE *bytes = nullptr;
    if (FAILED(renderClient_->GetBuffer(frames, &bytes)))
      continue;
    const size_t samples = (size_t)frames * channels;
    std::fill_n(outgoing.data(), samples, 0.0f);
    std::fill_n(incoming.data(), samples, 0.0f);
    const size_t read = current_ ? current_->read(outgoing.data(), samples) : 0;
    const bool outgoingEnded = current_ && current_->ended() && read == 0;
    bool promoted = false;
    int remaining = fadeFramesRemaining_.load(std::memory_order_acquire);
    if (remaining > 0 && prepared_) {
      const size_t incomingRead = prepared_->read(incoming.data(), samples);
      preparedPosition_ =
          preparedPosition_.load() +
          (double)incomingRead / channels / mixFormat_->nSamplesPerSec;
      if (outgoingEnded) {
        std::copy_n(incoming.data(), samples, outgoing.data());
        promoted = promotePrepared(false);
      } else {
        const int total = fadeFramesTotal_.load();
        for (UINT32 frame = 0; frame < frames; frame++) {
          const float t =
              1.0f - (float)std::max(0, remaining - (int)frame) / (float)total;
          for (UINT32 channel = 0; channel < channels; channel++) {
            const size_t i = (size_t)frame * channels + channel;
            outgoing[i] = outgoing[i] * (1.0f - t) + incoming[i] * t;
          }
        }
        remaining = std::max(0, remaining - (int)frames);
        fadeFramesRemaining_.store(remaining);
        if (remaining == 0)
          promoted = promotePrepared(false);
      }
    }
    const float target = muted_ ? 0.0f : volume_.load();
    const size_t ramp = std::max<size_t>(
        1,
        std::min(samples, (size_t)mixFormat_->nSamplesPerSec * channels / 200));
    const float step = (target - smoothedGain) / (float)ramp;
    for (size_t i = 0; i < samples; i++) {
      smoothedGain = i < ramp ? smoothedGain + step : target;
      outgoing[i] *= smoothedGain;
    }
    if (isFloatMixFormat(mixFormat_)) {
      std::copy_n(outgoing.data(), samples, reinterpret_cast<float *>(bytes));
    } else if (mixFormat_->wBitsPerSample == 16) {
      auto *out = reinterpret_cast<int16_t *>(bytes);
      for (size_t i = 0; i < samples; i++)
        out[i] = (int16_t)(std::clamp(outgoing[i], -1.0f, 1.0f) * 32767);
    } else {
      auto *out = reinterpret_cast<int32_t *>(bytes);
      for (size_t i = 0; i < samples; i++)
        out[i] =
            (int32_t)(std::clamp(outgoing[i], -1.0f, 1.0f) * 2147483647.0f);
    }
    if (spectrumEnabled_) {
      for (size_t bin = 0; bin < 128; bin++) {
        float peak = 0;
        for (size_t i = bin * samples / 128; i < (bin + 1) * samples / 128; i++)
          peak = std::max(peak, std::abs(outgoing[i]));
        spectrum_[bin] = (unsigned char)std::min(255.0f, peak * 255.0f);
      }
    }
    renderClient_->ReleaseBuffer(frames, 0);
    if (!promoted)
      position_ =
          position_.load() + (double)frames / mixFormat_->nSamplesPerSec;
    if (outgoingEnded && !promoted) {
      currentExhausted_ = true;
      playing_ = false;
      endedPending_.store(true, std::memory_order_release);
    }
  }
  if (mmcss)
    AvRevertMmThreadCharacteristics(mmcss);
}

void WasapiHost::telemetryLoopSafe() {
  int timeDivider = 0;
  while (!stopping_) {
    std::this_thread::sleep_for(std::chrono::milliseconds(34));
    if (transitionCompleted_.exchange(false, std::memory_order_acq_rel))
      sink_("{\"kind\":\"state\",\"value\":{\"state\":\"playing\",\"trackId\":"
            "\"" +
            jsonEscape(completedTrackId_) + "\"}}");
    if (endedPending_.exchange(false, std::memory_order_acq_rel)) {
      if (current_ && current_->failed())
        sink_("{\"kind\":\"state\",\"value\":{\"state\":\"error\",\"trackId\":"
              "\"" +
              jsonEscape(currentTrackId_) +
              "\",\"error\":{\"code\":\"MEDIA_DECODE\",\"message\":\"The audio "
              "stream could not be decoded.\",\"trackId\":\"" +
              jsonEscape(currentTrackId_) + "\"}}}");
      else
        sink_("{\"kind\":\"state\",\"value\":{\"state\":\"ended\",\"trackId\":"
              "\"" +
              jsonEscape(currentTrackId_) + "\"}}");
    }
    if (playing_ && ++timeDivider >= 3) {
      timeDivider = 0;
      sink_("{\"kind\":\"time\",\"value\":{\"currentTime\":" +
            std::to_string(position_.load()) + ",\"duration\":" +
            std::to_string(current_ ? current_->duration() : 0) + "}}");
    }
    if (spectrumEnabled_) {
      std::ostringstream out;
      out << "{\"kind\":\"spectrum\",\"bins\":[";
      for (int i = 0; i < 128; i++) {
        if (i)
          out << ',';
        out << (int)spectrum_[i].load();
      }
      out << "]}";
      sink_(out.str());
    }
  }
}
