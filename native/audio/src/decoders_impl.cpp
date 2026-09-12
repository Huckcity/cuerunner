// One translation unit compiles the vendored decoder implementations (dr_libs:
// WAV/MP3/FLAC, public domain or MIT-0). Keeping them here means the rest of the
// engine only sees declarations, and the link stays predictable.
//
// Ogg Vorbis is compiled separately as C (third_party/stb_vorbis.c); the AAC/M4A
// decoders are the platform codecs (Media Foundation / AudioToolbox) with the
// packaged LGPL-only FFmpeg helper as the fallback on Linux.
#define DR_WAV_IMPLEMENTATION
#define DR_MP3_IMPLEMENTATION
#define DR_FLAC_IMPLEMENTATION
#include "dr_flac.h"
#include "dr_mp3.h"
#include "dr_wav.h"
