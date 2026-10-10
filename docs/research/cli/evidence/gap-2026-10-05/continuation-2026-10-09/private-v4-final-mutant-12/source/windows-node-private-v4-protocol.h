// Bounded wire ABI. A dedicated pipe identifies the caller. Requests cannot
// nominate a PID, token, Job, or borrowed process handle.
#pragma once
#include <stdint.h>
constexpr uint32_t kPrivateV4Magic = 0x43434234;
constexpr uint32_t kPrivateV4MaxFrame = 65536;
struct PrivateV4Request {
  uint32_t magic, version, bytes, operation;
  uint64_t sequence;
  uint64_t standardHandles[4];
  uint32_t descriptorCount, commandChars, environmentChars, directoryChars;
  uint8_t descriptorFlags[4];
  uint32_t reserved;
};
struct PrivateV4Response {
  uint32_t magic, version, bytes, error;
  uint64_t sequence, processHandle, threadHandle;
  uint32_t processId, threadId;
  uint64_t reserved[2];
};
struct PrivateV4Registration {
  uint32_t magic, version, bytes, processId, role;
  char registrationId[37], parentRegistrationId[37], sessionId[37], generation[37];
  char appContainerSid[192];
};
static_assert(sizeof(PrivateV4Request) == 80, "Windows x64 request header ABI");
static_assert(sizeof(PrivateV4Response) == 64, "Windows x64 fixed response ABI");
static_assert(sizeof(PrivateV4Registration) == 360, "Windows registration ABI");
