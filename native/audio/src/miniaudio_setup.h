// The miniaudio build flags, in one place.
//
// These are not free choices: they decide what the library compiles, and a translation
// unit that sees a different set than the implementation does disagrees with it about
// struct layouts. engine.cpp owns the implementation and defines
// MINIAUDIO_IMPLEMENTATION before including this; the ASIO backend includes it for the
// types (`ma_context`, `ma_device`, `ma_backend_callbacks`) alone.
#pragma once

#define MA_NO_DECODING
#define MA_NO_ENCODING
#define MA_NO_RESOURCE_MANAGER
#define MA_NO_GENERATION
#include "miniaudio.h"
