#include "audio_host.h"
#include <atomic>
#include <condition_variable>
#include <cstdlib>
#include <deque>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <windows.h>

static constexpr uint32_t kProtocol = 1, kMaxFrame = 1024 * 1024;
static constexpr size_t kMaxCriticalFrames = 8192;
enum class FrameClass { Critical, Time, Spectrum };
static std::atomic<HANDLE> pipeHandle{INVALID_HANDLE_VALUE};
static std::mutex writeMutex;
static std::condition_variable writeCondition;
static std::deque<std::string> criticalQueue;
static std::optional<std::string> latestTime;
static std::optional<std::string> latestSpectrum;
static bool writerStopping = false;
static bool queueOverflow = false;
static std::thread writerThread;
static std::string escapeJson(const std::string &v) {
  std::string o;
  for (char c : v) {
    if (c == '"' || c == '\\')
      o += '\\';
    if ((unsigned char)c >= 0x20)
      o += c;
  }
  return o;
}
static std::wstring wide(const std::string &v) {
  if (v.empty())
    return {};
  int n = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, v.data(),
                              (int)v.size(), nullptr, 0);
  if (n <= 0)
    return {};
  std::wstring o(n, L'\0');
  MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, v.data(), (int)v.size(),
                      o.data(), n);
  return o;
}
static std::string narrow(const std::wstring &v) {
  if (v.empty())
    return {};
  int n = WideCharToMultiByte(CP_UTF8, 0, v.data(), (int)v.size(), nullptr, 0,
                              nullptr, nullptr);
  std::string o(n, '\0');
  WideCharToMultiByte(CP_UTF8, 0, v.data(), (int)v.size(), o.data(), n, nullptr,
                      nullptr);
  return o;
}
static bool writeAll(const void *d, DWORD n) {
  auto *p = (const BYTE *)d;
  HANDLE event = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  if (!event)
    return false;
  while (n) {
    OVERLAPPED overlapped{};
    overlapped.hEvent = event;
    ResetEvent(event);
    DWORD w = 0;
    BOOL ok = WriteFile(pipeHandle, p, n, &w, &overlapped);
    if (!ok && GetLastError() == ERROR_IO_PENDING) {
      if (WaitForSingleObject(event, INFINITE) != WAIT_OBJECT_0 ||
          !GetOverlappedResult(pipeHandle, &overlapped, &w, FALSE)) {
        CloseHandle(event);
        return false;
      }
    } else if (!ok) {
      CloseHandle(event);
      return false;
    }
    if (!w) {
      CloseHandle(event);
      return false;
    }
    p += w;
    n -= w;
  }
  CloseHandle(event);
  return true;
}
static void writerLoop() {
  for (;;) {
    std::string j;
    {
      std::unique_lock lock(writeMutex);
      writeCondition.wait(lock, [] {
        return writerStopping || queueOverflow || !criticalQueue.empty() ||
               latestTime || latestSpectrum;
      });
      if (queueOverflow)
        return;
      if (!criticalQueue.empty()) {
        j = std::move(criticalQueue.front());
        criticalQueue.pop_front();
      } else if (latestTime) {
        j = std::move(*latestTime);
        latestTime.reset();
      } else if (latestSpectrum) {
        j = std::move(*latestSpectrum);
        latestSpectrum.reset();
      } else if (writerStopping) {
        return;
      }
    }
    uint32_t n = (uint32_t)j.size();
    if (!writeAll(&n, 4) || !writeAll(j.data(), n))
      return;
  }
}
static bool sendJson(const std::string &j,
                     FrameClass frameClass = FrameClass::Critical) {
  if (j.empty() || j.size() > kMaxFrame)
    return false;
  bool overflow = false;
  {
    std::lock_guard lock(writeMutex);
    if (writerStopping || queueOverflow)
      return false;
    if (frameClass == FrameClass::Time)
      latestTime = j;
    else if (frameClass == FrameClass::Spectrum)
      latestSpectrum = j;
    else if (criticalQueue.size() < kMaxCriticalFrames)
      criticalQueue.push_back(j);
    else {
      queueOverflow = true;
      overflow = true;
    }
  }
  writeCondition.notify_all();
  if (overflow) {
    // Closing the pipe makes Electron handle this as a host crash.
    HANDLE handle = pipeHandle.exchange(INVALID_HANDLE_VALUE);
    if (handle != INVALID_HANDLE_VALUE) {
      CancelIoEx(handle, nullptr);
      CloseHandle(handle);
    }
    return false;
  }
  return true;
}
static void stopWriter() {
  {
    std::lock_guard lock(writeMutex);
    writerStopping = true;
  }
  writeCondition.notify_one();
  if (writerThread.joinable())
    writerThread.join();
}
static bool readAll(void *d, DWORD n) {
  auto *p = (BYTE *)d;
  HANDLE event = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  if (!event)
    return false;
  while (n) {
    OVERLAPPED overlapped{};
    overlapped.hEvent = event;
    ResetEvent(event);
    DWORD r = 0;
    BOOL ok = ReadFile(pipeHandle, p, n, &r, &overlapped);
    if (!ok && GetLastError() == ERROR_IO_PENDING) {
      if (WaitForSingleObject(event, INFINITE) != WAIT_OBJECT_0 ||
          !GetOverlappedResult(pipeHandle, &overlapped, &r, FALSE)) {
        CloseHandle(event);
        return false;
      }
    } else if (!ok) {
      CloseHandle(event);
      return false;
    }
    if (!r) {
      CloseHandle(event);
      return false;
    }
    p += r;
    n -= r;
  }
  CloseHandle(event);
  return true;
}
static bool readFrame(std::string &j) {
  uint32_t n = 0;
  if (!readAll(&n, 4) || !n || n > kMaxFrame)
    return false;
  j.resize(n);
  return readAll(j.data(), n);
}
static size_t keyPos(const std::string &j, const std::string &k) {
  return j.find("\"" + k + "\"");
}
static std::string stringField(const std::string &j, const std::string &k) {
  auto p = keyPos(j, k);
  if (p == std::string::npos || (p = j.find(':', p)) == std::string::npos ||
      (p = j.find('"', p)) == std::string::npos)
    return {};
  std::string o;
  for (++p; p < j.size(); p++) {
    char c = j[p];
    if (c == '"')
      break;
    if (c == '\\' && p + 1 < j.size()) {
      char e = j[++p];
      o += e == 'n' ? '\n' : e == 'r' ? '\r' : e == 't' ? '\t' : e;
    } else
      o += c;
  }
  return o;
}
static double numberField(const std::string &j, const std::string &k,
                          double fallback = 0) {
  auto p = keyPos(j, k);
  if (p == std::string::npos || (p = j.find(':', p)) == std::string::npos)
    return fallback;
  char *e = nullptr;
  double v = strtod(j.c_str() + p + 1, &e);
  return e == j.c_str() + p + 1 ? fallback : v;
}
static bool boolField(const std::string &j, const std::string &k) {
  auto p = keyPos(j, k);
  if (p == std::string::npos || (p = j.find(':', p)) == std::string::npos)
    return false;
  p = j.find_first_not_of(" \t\r\n", p + 1);
  return p != std::string::npos && j.compare(p, 4, "true") == 0;
}
static void response(const std::string &id,
                     const std::string &payload = "null") {
  sendJson("{\"protocolVersion\":1,\"id\":\"" + escapeJson(id) +
           "\",\"type\":\"response\",\"ok\":true,\"payload\":" + payload + "}");
}
static void failure(const std::string &id, const std::string &code) {
  sendJson("{\"protocolVersion\":1,\"id\":\"" + escapeJson(id) +
           "\",\"type\":\"response\",\"ok\":false,\"error\":{\"code\":\"" +
           escapeJson(code) +
           "\",\"message\":\"Native audio operation failed.\"}}");
}
static std::string deviceJson(const DeviceInfo &d) {
  return "{\"id\":\"" + escapeJson(narrow(d.id)) + "\",\"name\":\"" +
         escapeJson(narrow(d.name)) +
         "\",\"isDefault\":" + (d.isDefault ? "true" : "false") +
         ",\"isConnected\":true,\"supportedModes\":[\"shared\"],"
         "\"supportedFormats\":null,\"mixFormat\":{\"sampleRate\":" +
         std::to_string(d.mix.sampleRate) +
         ",\"bitDepth\":" + std::to_string(d.mix.bitDepth) +
         ",\"channels\":" + std::to_string(d.mix.channels) + "}}";
}

int wmain(int argc, wchar_t **argv) {
  std::wstring pipe, nonce;
  for (int i = 1; i + 1 < argc; i++) {
    if (wcscmp(argv[i], L"--pipe") == 0)
      pipe = argv[++i];
    else if (wcscmp(argv[i], L"--nonce") == 0)
      nonce = argv[++i];
  }
  if (pipe.empty() || nonce.empty())
    return 2;
  if (!WaitNamedPipeW(pipe.c_str(), 8000))
    return 3;
  pipeHandle =
      CreateFileW(pipe.c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr,
                  OPEN_EXISTING, FILE_FLAG_OVERLAPPED, nullptr);
  if (pipeHandle == INVALID_HANDLE_VALUE)
    return 4;
  writerThread = std::thread(writerLoop);
  sendJson(
      "{\"protocolVersion\":1,\"type\":\"hello\",\"payload\":{\"nonce\":\"" +
      escapeJson(narrow(nonce)) + "\"}}");
  WasapiHost host([](const std::string &p, bool lossy, bool spectrum) {
    sendJson("{\"protocolVersion\":1,\"type\":\"event\",\"payload\":" + p +
             "}", lossy ? (spectrum ? FrameClass::Spectrum : FrameClass::Time)
                         : FrameClass::Critical);
  });
  std::string j;
  while (readFrame(j)) {
    if ((uint32_t)numberField(j, "protocolVersion") != kProtocol)
      break;
    auto id = stringField(j, "id"), type = stringField(j, "type");
    std::string error;
    if (type == "load") {
      if (host.load(stringField(j, "trackId"), wide(stringField(j, "path")),
                    error))
        response(id);
      else
        failure(id, error);
    } else if (type == "prepare") {
      bool ok = host.prepare(stringField(j, "trackId"),
                             wide(stringField(j, "path")), error);
      error.empty() ? response(id, ok ? "true" : "false") : failure(id, error);
    } else if (type == "play") {
      if (host.play(error))
        response(id);
      else
        failure(id, error);
    } else if (type == "pause") {
      host.pause();
      response(id);
    } else if (type == "seek") {
      host.seek(numberField(j, "positionSeconds"));
      response(id);
    } else if (type == "set-volume") {
      host.setVolume((float)numberField(j, "volume", .8));
      response(id);
    } else if (type == "set-mute") {
      host.setMute(boolField(j, "isMuted"));
      response(id);
    } else if (type == "cancel-prepared") {
      host.cancelPrepared();
      response(id);
    } else if (type == "transition")
      response(id, host.transition(numberField(j, "crossfadeSeconds"))
                       ? "true"
                       : "false");
    else if (type == "list-devices") {
      auto devices = host.listDevices();
      std::string out = "[{\"id\":\"system-default\",\"name\":\"System "
                        "Default\",\"isDefault\":true,\"isConnected\":true,"
                        "\"supportedModes\":[\"shared\"],\"supportedFormats\":"
                        "null,\"mixFormat\":null}";
      for (auto &d : devices)
        out += "," + deviceJson(d);
      response(id, out + "]");
    } else if (type == "select-device") {
      if (host.selectDevice(wide(stringField(j, "deviceId")), error))
        response(id);
      else
        failure(id, error);
    } else if (type == "set-fallback") {
      host.setFallback(boolField(j, "enabled"));
      response(id);
    } else if (type == "get-path-status")
      response(id, host.statusJson());
    else if (type == "set-spectrum") {
      host.setSpectrum(boolField(j, "enabled"));
      response(id);
    } else if (type == "shutdown") {
      response(id);
      break;
    } else
      failure(id, "AUDIO_HOST_PROTOCOL_ERROR");
  }
  stopWriter();
  HANDLE handle = pipeHandle.exchange(INVALID_HANDLE_VALUE);
  if (handle != INVALID_HANDLE_VALUE)
    CloseHandle(handle);
  return 0;
}
