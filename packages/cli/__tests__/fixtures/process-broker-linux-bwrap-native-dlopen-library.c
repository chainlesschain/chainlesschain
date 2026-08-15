#ifndef CHAINLESS_DLOPEN_VARIANT
#define CHAINLESS_DLOPEN_VARIANT 0
#endif

#if CHAINLESS_DLOPEN_VARIANT == 0
#define CHAINLESS_DLOPEN_VALUE "approved-original"
#elif CHAINLESS_DLOPEN_VARIANT == 1
#define CHAINLESS_DLOPEN_VALUE "replacement-host"
#elif CHAINLESS_DLOPEN_VARIANT == 2
#define CHAINLESS_DLOPEN_VALUE "unmounted-same-soname"
#elif CHAINLESS_DLOPEN_VARIANT == 3
#define CHAINLESS_DLOPEN_VALUE "unmounted-different-soname"
#else
#error "unsupported CHAINLESS_DLOPEN_VARIANT"
#endif

const char *chainless_dlopen_value(void) { return CHAINLESS_DLOPEN_VALUE; }
