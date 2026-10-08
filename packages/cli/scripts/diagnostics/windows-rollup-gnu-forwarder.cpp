// Independent experimental N-API forwarding DLL. Frozen Rollup bytes stay intact.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <sddl.h>
#include <node_api.h>
#include <cstdio>

static HMODULE ownModule = nullptr;
BOOL WINAPI DllMain(HINSTANCE module, DWORD reason, LPVOID) {
  if (reason == DLL_PROCESS_ATTACH) ownModule = module;
  return TRUE;
}

NAPI_MODULE_INIT() {
  (void)exports;
  HMODULE host = GetModuleHandleW(nullptr);
  const char* symbols[] = {
    "napi_call_function",
    "napi_cancel_async_work",
    "napi_coerce_to_string",
    "napi_create_async_work",
    "napi_create_buffer_copy",
    "napi_create_error",
    "napi_create_external_buffer",
    "napi_create_function",
    "napi_create_object",
    "napi_create_promise",
    "napi_create_reference",
    "napi_create_string_utf8",
    "napi_create_threadsafe_function",
    "napi_define_class",
    "napi_delete_async_work",
    "napi_delete_reference",
    "napi_get_and_clear_last_exception",
    "napi_get_cb_info",
    "napi_get_global",
    "napi_get_named_property",
    "napi_get_prototype",
    "napi_get_reference_value",
    "napi_get_typedarray_info",
    "napi_get_undefined",
    "napi_get_value_bool",
    "napi_get_value_string_utf8",
    "napi_is_error",
    "napi_is_exception_pending",
    "napi_queue_async_work",
    "napi_reference_unref",
    "napi_reject_deferred",
    "napi_remove_wrap",
    "napi_resolve_deferred",
    "napi_set_named_property",
    "napi_strict_equals",
    "napi_throw",
    "napi_throw_error",
    "napi_typeof",
    "napi_unref_threadsafe_function",
    "napi_unwrap",
    "napi_wrap",
  };
  for (const char* symbol : symbols) {
    FARPROC expected = GetProcAddress(host, symbol);
    if (!expected || GetProcAddress(ownModule, symbol) != expected) return nullptr;
  }
  HANDLE token = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) return nullptr;
  DWORD used = 0, appContainer = 0;
  alignas(void*) BYTE sidBuffer[256] = {}, capabilityBuffer[4096] = {};
  BOOL inJob = FALSE;
  bool valid = GetTokenInformation(token, TokenIsAppContainer, &appContainer, sizeof(appContainer), &used) &&
      appContainer == 1 && GetTokenInformation(token, TokenAppContainerSid, sidBuffer, sizeof(sidBuffer), &used) &&
      GetTokenInformation(token, TokenCapabilities, capabilityBuffer, sizeof(capabilityBuffer), &used) &&
      reinterpret_cast<TOKEN_GROUPS*>(capabilityBuffer)->GroupCount == 0 &&
      IsProcessInJob(GetCurrentProcess(), nullptr, &inJob) && inJob;
  LPSTR sid = nullptr;
  if (valid) valid = ConvertSidToStringSidA(reinterpret_cast<TOKEN_APPCONTAINER_INFORMATION*>(sidBuffer)->TokenAppContainer, &sid);
  CloseHandle(token);
  if (!valid) { if (sid) LocalFree(sid); return nullptr; }
  char json[1024];
  int length = std::snprintf(json, sizeof(json),
      "{\"pid\":%lu,\"appContainerSid\":\"%s\",\"capabilityCount\":0,\"inJob\":true,\"forwardedSymbols\":41,\"sameFunctionAddresses\":true}",
      GetCurrentProcessId(), sid);
  LocalFree(sid);
  if (length < 1 || static_cast<size_t>(length) >= sizeof(json)) return nullptr;
  auto makeString = reinterpret_cast<decltype(&napi_create_string_utf8)>(GetProcAddress(host, "napi_create_string_utf8"));
  napi_value proof = nullptr;
  if (!makeString || makeString(env, json, static_cast<size_t>(length), &proof) != napi_ok) return nullptr;
  return proof;
}
