#include <node_api.h>
#include <windows.h>
#include <commctrl.h>
#include <cmath>
#include <cstring>
#include <unordered_map>

namespace {
struct ButtonRect { double x, y, width, height; };
struct Overlay { HWND child; ButtonRect bounds; bool hasBounds; bool hovered; };
std::unordered_map<HWND, Overlay> overlays;
constexpr UINT_PTR kSubclassId = 0x4c757473;
constexpr wchar_t kClassName[] = L"LutstraSnapButtonOverlay";
ATOM overlayClass = 0;

bool ReadHandle(napi_env env, napi_value value, HWND* result) {
  void* data = nullptr;
  size_t length = 0;
  bool isBuffer = false;
  if (napi_is_buffer(env, value, &isBuffer) != napi_ok || !isBuffer ||
      napi_get_buffer_info(env, value, &data, &length) != napi_ok || length < sizeof(HWND)) {
    napi_throw_type_error(env, nullptr, "Expected an Electron HWND buffer");
    return false;
  }
  std::memcpy(result, data, sizeof(HWND));
  return *result != nullptr;
}

void PositionOverlay(HWND parent) {
  auto entry = overlays.find(parent);
  if (entry == overlays.end() || !entry->second.hasBounds) return;
  if (IsIconic(parent)) {
    ShowWindow(entry->second.child, SW_HIDE);
    return;
  }
  const auto& bounds = entry->second.bounds;
  const UINT dpi = GetDpiForWindow(parent);
  const double scale = dpi ? static_cast<double>(dpi) / 96.0 : 1.0;
  SetWindowPos(entry->second.child, HWND_TOP,
               static_cast<int>(std::lround(bounds.x * scale)),
               static_cast<int>(std::lround(bounds.y * scale)),
               static_cast<int>(std::lround(bounds.width * scale)),
               static_cast<int>(std::lround(bounds.height * scale)),
               SWP_NOACTIVATE | SWP_SHOWWINDOW);
}

LRESULT CALLBACK OverlayProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
  if (message == WM_NCHITTEST) return HTMAXBUTTON;
  if (message == WM_ERASEBKGND) return 1;
  if (message == WM_NCMOUSEMOVE) {
    HWND parent = GetParent(hwnd);
    auto entry = overlays.find(parent);
    if (entry != overlays.end() && !entry->second.hovered) {
      entry->second.hovered = true;
      TRACKMOUSEEVENT track{sizeof(track), TME_LEAVE | TME_NONCLIENT, hwnd, 0};
      TrackMouseEvent(&track);
    }
    return 0;
  }
  if (message == WM_NCMOUSELEAVE) {
    auto entry = overlays.find(GetParent(hwnd));
    if (entry != overlays.end()) entry->second.hovered = false;
    return 0;
  }
  if (message == WM_NCLBUTTONDOWN) {
    SetCapture(hwnd);
    return 0;
  }
  if (message == WM_LBUTTONUP || message == WM_NCLBUTTONUP) {
    if (GetCapture() == hwnd) {
      ReleaseCapture();
      POINT point{};
      GetCursorPos(&point);
      RECT rect{};
      GetWindowRect(hwnd, &rect);
      if (PtInRect(&rect, point)) {
        HWND parent = GetParent(hwnd);
        PostMessageW(parent, WM_SYSCOMMAND, IsZoomed(parent) ? SC_RESTORE : SC_MAXIMIZE, 0);
      }
    }
    return 0;
  }
  return DefWindowProcW(hwnd, message, wParam, lParam);
}

LRESULT CALLBACK ParentProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam,
                            UINT_PTR subclassId, DWORD_PTR) {
  if (message == WM_SIZE || message == WM_DPICHANGED) PositionOverlay(hwnd);
  if (message == WM_NCDESTROY) {
    overlays.erase(hwnd);
    RemoveWindowSubclass(hwnd, ParentProc, subclassId);
  }
  return DefSubclassProc(hwnd, message, wParam, lParam);
}

napi_value Install(napi_env env, napi_callback_info info) {
  size_t count = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  HWND parent = nullptr;
  if (count != 1 || !ReadHandle(env, args[0], &parent)) return nullptr;
  if (!IsWindow(parent)) {
    napi_value result;
    napi_get_boolean(env, false, &result);
    return result;
  }
  if (!overlayClass) {
    WNDCLASSEXW windowClass{sizeof(windowClass)};
    windowClass.lpfnWndProc = OverlayProc;
    windowClass.hInstance = GetModuleHandleW(nullptr);
    windowClass.hbrBackground = static_cast<HBRUSH>(GetStockObject(NULL_BRUSH));
    windowClass.lpszClassName = kClassName;
    overlayClass = RegisterClassExW(&windowClass);
  }
  HWND child = overlayClass ? CreateWindowExW(0, kClassName, L"", WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS,
                                               0, 0, 0, 0, parent, nullptr, GetModuleHandleW(nullptr), nullptr) : nullptr;
  bool installed = child && SetWindowSubclass(parent, ParentProc, kSubclassId, 0);
  if (installed) overlays[parent] = {child, {}, false, false};
  else if (child) DestroyWindow(child);
  napi_value result;
  napi_get_boolean(env, installed, &result);
  return result;
}

napi_value Update(napi_env env, napi_callback_info info) {
  size_t count = 5;
  napi_value args[5];
  napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  HWND parent = nullptr;
  if (count != 5 || !ReadHandle(env, args[0], &parent)) return nullptr;
  double values[4];
  for (int index = 0; index < 4; ++index) {
    if (napi_get_value_double(env, args[index + 1], &values[index]) != napi_ok || !std::isfinite(values[index])) {
      napi_throw_type_error(env, nullptr, "Expected finite button coordinates");
      return nullptr;
    }
  }
  if (values[0] < 0 || values[1] < 0 || values[2] < 8 || values[3] < 8 ||
      values[0] > 16384 || values[1] > 16384 || values[2] > 256 || values[3] > 256) {
    napi_throw_range_error(env, nullptr, "Button coordinates out of range");
    return nullptr;
  }
  auto entry = overlays.find(parent);
  if (entry != overlays.end()) {
    entry->second.bounds = {values[0], values[1], values[2], values[3]};
    entry->second.hasBounds = true;
    PositionOverlay(parent);
  }
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

napi_value IsHovered(napi_env env, napi_callback_info info) {
  size_t count = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  HWND parent = nullptr;
  if (count != 1 || !ReadHandle(env, args[0], &parent)) return nullptr;
  auto entry = overlays.find(parent);
  napi_value result;
  napi_get_boolean(env, entry != overlays.end() && entry->second.hovered, &result);
  return result;
}

napi_value Remove(napi_env env, napi_callback_info info) {
  size_t count = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  HWND parent = nullptr;
  if (count != 1 || !ReadHandle(env, args[0], &parent)) return nullptr;
  auto entry = overlays.find(parent);
  if (entry != overlays.end()) {
    HWND child = entry->second.child;
    overlays.erase(entry);
    if (IsWindow(parent)) RemoveWindowSubclass(parent, ParentProc, kSubclassId);
    if (IsWindow(child)) DestroyWindow(child);
  }
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor methods[] = {
    {"install", nullptr, Install, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"update", nullptr, Update, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"isHovered", nullptr, IsHovered, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"remove", nullptr, Remove, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, 4, methods);
  return exports;
}
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
