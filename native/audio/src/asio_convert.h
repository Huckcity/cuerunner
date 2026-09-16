// Turning the engine's f32 into whatever word the ASIO driver asked for.
//
// ASIO hands the host one buffer per channel, in the driver's own sample type, and the
// type is the driver's business rather than the host's: an interface that wants
// Int24LSB gets Int24LSB, and one that wants its data left-justified in a 32-bit word
// says so too. The arithmetic that writes those words is here, deliberately free of the
// SDK, so that it compiles — and is tested — on a machine that has no SDK: this is the
// part of the backend where a mistake is silent (a shifted bit is a level error, not a
// crash), which is the kind of mistake that gets blamed on the desk. `asio_backend.cpp`
// static_asserts these numbers against the SDK's own enum, so the two cannot drift.
#pragma once

#include <cmath>
#include <cstdint>
#include <cstring>

namespace ws {
namespace asio {

/**
 * The ASIO sample types this backend can write, by the numbers ASIO gives them. The
 * names are asio.h's own, spelled here so that a driver's refusal can say which word
 * the driver wants.
 */
enum class SampleType : int {
  Int16Msb = 0,
  Int24Msb = 1,
  Int32Msb = 2,
  Float32Msb = 3,
  Float64Msb = 4,
  Int32Msb16 = 8,
  Int32Msb18 = 9,
  Int32Msb20 = 10,
  Int32Msb24 = 11,
  Int16Lsb = 16,
  Int24Lsb = 17,
  Int32Lsb = 18,
  Float32Lsb = 19,
  Float64Lsb = 20,
  Int32Lsb16 = 24,
  Int32Lsb18 = 25,
  Int32Lsb20 = 26,
  Int32Lsb24 = 27,
};

/** The number of bytes one sample of this type occupies. */
inline int bytesPerSample(SampleType type) {
  switch (type) {
    case SampleType::Int16Msb:
    case SampleType::Int16Lsb:
      return 2;
    case SampleType::Int24Msb:
    case SampleType::Int24Lsb:
      return 3;
    case SampleType::Int32Msb:
    case SampleType::Int32Lsb:
    case SampleType::Int32Msb16:
    case SampleType::Int32Msb18:
    case SampleType::Int32Msb20:
    case SampleType::Int32Msb24:
    case SampleType::Int32Lsb16:
    case SampleType::Int32Lsb18:
    case SampleType::Int32Lsb20:
    case SampleType::Int32Lsb24:
    case SampleType::Float32Msb:
    case SampleType::Float32Lsb:
      return 4;
    case SampleType::Float64Msb:
    case SampleType::Float64Lsb:
      return 8;
  }
  return 0;
}

/** ASIO's own name for the type, or nullptr when this build does not know it (DSD). */
inline const char* sampleTypeName(int raw) {
  switch (raw) {
    case 0: return "ASIOSTInt16MSB";
    case 1: return "ASIOSTInt24MSB";
    case 2: return "ASIOSTInt32MSB";
    case 3: return "ASIOSTFloat32MSB";
    case 4: return "ASIOSTFloat64MSB";
    case 8: return "ASIOSTInt32MSB16";
    case 9: return "ASIOSTInt32MSB18";
    case 10: return "ASIOSTInt32MSB20";
    case 11: return "ASIOSTInt32MSB24";
    case 16: return "ASIOSTInt16LSB";
    case 17: return "ASIOSTInt24LSB";
    case 18: return "ASIOSTInt32LSB";
    case 19: return "ASIOSTFloat32LSB";
    case 20: return "ASIOSTFloat64LSB";
    case 24: return "ASIOSTInt32LSB16";
    case 25: return "ASIOSTInt32LSB18";
    case 26: return "ASIOSTInt32LSB20";
    case 27: return "ASIOSTInt32LSB24";
    default: return nullptr;
  }
}

/** True when `writeSample` knows what to do with this type. */
inline bool isWritableSampleType(int raw) { return sampleTypeName(raw) != nullptr; }

/**
 * The buffer size to ask a driver for, given what the driver said it takes.
 *
 * ASIO gives a minimum, a maximum, a preferred size and a granularity, and the size must
 * be one the driver accepts: `granularity == -1` means "the minimum, then doubled up to
 * the maximum" (the SDK's own wording) and anything positive is a step above the minimum.
 * A request outside the range is clamped rather than refused — buffer size is a latency
 * preference, and the engine's readout says what the driver actually did. A driver that
 * reports no usable range at all answers 0, which the caller refuses by name.
 *
 * Here rather than in the backend for the same reason as the conversion: it is a rule
 * about a driver, not a call to one, so it can be tested where no driver exists.
 */
inline long chooseBufferSize(long requested, long minSize, long maxSize, long preferred, long granularity) {
  if (minSize <= 0 || maxSize < minSize) return 0;
  long size = requested > 0 ? requested : (preferred > 0 ? preferred : minSize);
  if (size < minSize) size = minSize;
  if (size > maxSize) size = maxSize;
  if (granularity < 0) {
    long power = minSize;
    while (power * 2 <= size && power * 2 <= maxSize) power *= 2;
    size = power;
  } else if (granularity > 0) {
    size = minSize + ((size - minSize) / granularity) * granularity;
  }
  if (size < minSize) size = minSize;
  if (size > maxSize) size = maxSize;
  return size;
}

/**
 * The driver asked for this word; the bits below are how it is spelled. Unknown types
 * (DSD, anything added after this build) never reach here — the backend refuses those
 * by name before a buffer is created.
 */
inline SampleType toSampleType(int raw) { return static_cast<SampleType>(raw); }

/**
 * Rounds a sample to `fullScale` (which is (2^(n-1) - 1) for an n-bit word) as an integer
 * wide enough for the multiply.
 *
 * The multiply is done in double on purpose: at 32-bit full scale the float product of
 * 1.0 and 2147483647.0f rounds up to 2^31, which is one past what an int32 can hold, so
 * full scale came back as the most negative sample there is — a click at every peak. In
 * double the product is exact. It also means one rounding rather than two for every type.
 */
inline int32_t scaleInt(float sample, double fullScale) {
  return static_cast<int32_t>(std::lrint(static_cast<double>(sample) * fullScale));
}

/**
 * What one f32 sample may be before it is written.
 *
 * The engine's own renders are clipped by miniaudio before they reach the backend, and
 * this is the second belt: a wrap at the integer's edge is a full-scale click, where a
 * clamp is a level error nobody will hear. NaN is not a level at all and is written as
 * silence, because a driver handed one is entitled to make it our problem.
 */
inline float clampSample(float value) {
  if (value > 1.0f) return 1.0f;
  if (value < -1.0f) return -1.0f;
  if (!(value == value)) return 0.0f;
  return value;
}

/** An integer of `bytes` bytes, least- or most-significant byte first. */
inline void writeInt(void* destination, int bytes, bool bigEndian, int32_t value) {
  auto* out = static_cast<uint8_t*>(destination);
  const uint32_t raw = static_cast<uint32_t>(value);
  for (int i = 0; i < bytes; i++) {
    const int shift = bigEndian ? (bytes - 1 - i) * 8 : i * 8;
    out[i] = static_cast<uint8_t>((raw >> shift) & 0xFFu);
  }
}

/**
 * Writes one sample in a driver's type.
 *
 * Scaling is by (2^(n-1) - 1) rather than 2^(n-1) so that +1.0 and -1.0 are both exactly
 * representable and neither one wraps. The "32 bit data with n bit alignment" types are
 * the ASIO convention for a card that takes its n-bit words in full 32-bit slots with
 * the data in the top: the value is scaled to n bits and shifted up.
 */
inline void writeSample(void* destination, SampleType type, float value) {
  const float sample = clampSample(value);
  const bool bigEndian = type == SampleType::Int16Msb || type == SampleType::Int24Msb ||
                         type == SampleType::Int32Msb || type == SampleType::Float32Msb ||
                         type == SampleType::Float64Msb || type == SampleType::Int32Msb16 ||
                         type == SampleType::Int32Msb18 || type == SampleType::Int32Msb20 ||
                         type == SampleType::Int32Msb24;
  switch (type) {
    case SampleType::Int16Msb:
    case SampleType::Int16Lsb:
      writeInt(destination, 2, bigEndian, scaleInt(sample, 32767.0));
      return;
    case SampleType::Int24Msb:
    case SampleType::Int24Lsb:
      writeInt(destination, 3, bigEndian, scaleInt(sample, 8388607.0));
      return;
    case SampleType::Int32Msb:
    case SampleType::Int32Lsb:
      writeInt(destination, 4, bigEndian, scaleInt(sample, 2147483647.0));
      return;
    case SampleType::Int32Msb16:
    case SampleType::Int32Lsb16:
      writeInt(destination, 4, bigEndian, scaleInt(sample, 32767.0) << 16);
      return;
    case SampleType::Int32Msb18:
    case SampleType::Int32Lsb18:
      writeInt(destination, 4, bigEndian, scaleInt(sample, 131071.0) << 14);
      return;
    case SampleType::Int32Msb20:
    case SampleType::Int32Lsb20:
      writeInt(destination, 4, bigEndian, scaleInt(sample, 524287.0) << 12);
      return;
    case SampleType::Int32Msb24:
    case SampleType::Int32Lsb24:
      writeInt(destination, 4, bigEndian, scaleInt(sample, 8388607.0) << 8);
      return;
    case SampleType::Float32Msb:
    case SampleType::Float32Lsb: {
      uint32_t raw = 0;
      std::memcpy(&raw, &sample, sizeof(raw));
      writeInt(destination, 4, bigEndian, static_cast<int32_t>(raw));
      return;
    }
    case SampleType::Float64Msb:
    case SampleType::Float64Lsb: {
      const double widened = static_cast<double>(sample);
      uint64_t raw = 0;
      std::memcpy(&raw, &widened, sizeof(raw));
      auto* out = static_cast<uint8_t*>(destination);
      for (int i = 0; i < 8; i++) {
        const int shift = bigEndian ? (7 - i) * 8 : i * 8;
        out[i] = static_cast<uint8_t>((raw >> shift) & 0xFFu);
      }
      return;
    }
  }
}

}  // namespace asio
}  // namespace ws
