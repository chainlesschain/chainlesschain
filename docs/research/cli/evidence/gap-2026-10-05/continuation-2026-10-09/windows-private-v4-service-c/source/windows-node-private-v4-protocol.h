// Experimental fixed service request. No PID, executable path, token, Job,
// process handle, environment block, or arbitrary command can be requested.
#pragma once
#include <stdint.h>
constexpr uint32_t kPrivateV4Magic = 0x43434234;
struct PrivateV4Request {
  uint32_t magic, version, bytes, operation;
  uint64_t sequence;
  uint64_t standardHandles[3];
  uint64_t reserved[2];
};
struct PrivateV4Response {
  uint32_t magic, version, bytes, error;
  uint64_t sequence, processHandle, threadHandle;
  uint32_t processId, threadId;
  uint64_t reserved[2];
};
static_assert(sizeof(PrivateV4Request) == 64, "Windows x64 fixed request ABI");
static_assert(sizeof(PrivateV4Response) == 64, "Windows x64 fixed response ABI");
