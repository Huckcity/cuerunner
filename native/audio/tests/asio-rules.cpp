// The ASIO backend's arithmetic, checked without an ASIO driver.
//
// Two things in the ASIO backend are rules rather than calls — how the engine's f32
// becomes the word the driver asked for, and which buffer size a driver will accept — and
// both are silent when they are wrong: a mis-scaled integer is a level error, a shifted
// one is a level error with the low bits missing, an over-scaled one wraps into a
// full-scale click, and none of them is a crash. They live in src/asio_convert.h with no
// SDK in sight precisely so that this file can exist: it is compiled and run by
// tests/asio-rules.mjs on any machine with a C++ compiler, including ones with no ASIO
// driver, no Windows and no SDK.
//
// The bytes are the assertion. Every type below is checked at its extremes and at one
// ordinary value, and the expected bytes are written out in full rather than derived —
// a table that agrees with the code because it was copied from it would prove nothing.
#include "asio_convert.h"

#include <cstdint>
#include <cstdio>
#include <string>

using ws::asio::bytesPerSample;
using ws::asio::chooseBufferSize;
using ws::asio::isWritableSampleType;
using ws::asio::sampleTypeName;
using ws::asio::SampleType;
using ws::asio::writeSample;

namespace {

int failures = 0;
int checks = 0;

std::string hex(const unsigned char* data, int bytes) {
  static const char* digits = "0123456789abcdef";
  std::string out;
  for (int i = 0; i < bytes; i++) {
    if (i > 0) out.push_back(' ');
    out.push_back(digits[data[i] >> 4]);
    out.push_back(digits[data[i] & 0x0F]);
  }
  return out;
}

void expectBytes(const char* what, SampleType type, float value, const char* expected) {
  checks++;
  unsigned char buffer[8] = {};
  writeSample(buffer, type, value);
  const std::string got = hex(buffer, bytesPerSample(type));
  if (got != expected) {
    failures++;
    std::printf("FAIL %-34s got %-24s want %s\n", what, got.c_str(), expected);
  }
}

void expectInt(const char* what, long got, long expected) {
  checks++;
  if (got != expected) {
    failures++;
    std::printf("FAIL %-34s got %ld want %ld\n", what, got, expected);
  }
}

void expectText(const char* what, const char* got, const char* expected) {
  checks++;
  const std::string g = got != nullptr ? std::string(got) : std::string("(null)");
  const std::string e = expected != nullptr ? std::string(expected) : std::string("(null)");
  if (g != e) {
    failures++;
    std::printf("FAIL %-34s got %-24s want %s\n", what, g.c_str(), e.c_str());
  }
}

/** The extremes of every type, in the driver's own byte order. */
void checkSampleWords() {
  expectBytes("Int16LSB +1", SampleType::Int16Lsb, 1.0f, "ff 7f");
  expectBytes("Int16LSB -1", SampleType::Int16Lsb, -1.0f, "01 80");
  expectBytes("Int16LSB 0", SampleType::Int16Lsb, 0.0f, "00 00");
  expectBytes("Int16LSB 0.25", SampleType::Int16Lsb, 0.25f, "00 20");
  expectBytes("Int16LSB above full scale", SampleType::Int16Lsb, 2.0f, "ff 7f");
  expectBytes("Int16LSB below full scale", SampleType::Int16Lsb, -2.0f, "01 80");
  expectBytes("Int16LSB NaN is silence", SampleType::Int16Lsb, 0.0f / 0.0f, "00 00");

  expectBytes("Int16MSB +1", SampleType::Int16Msb, 1.0f, "7f ff");
  expectBytes("Int16MSB -1", SampleType::Int16Msb, -1.0f, "80 01");
  expectBytes("Int16MSB 0.25", SampleType::Int16Msb, 0.25f, "20 00");

  expectBytes("Int24LSB +1", SampleType::Int24Lsb, 1.0f, "ff ff 7f");
  expectBytes("Int24LSB -1", SampleType::Int24Lsb, -1.0f, "01 00 80");
  expectBytes("Int24LSB 0", SampleType::Int24Lsb, 0.0f, "00 00 00");
  expectBytes("Int24MSB +1", SampleType::Int24Msb, 1.0f, "7f ff ff");
  expectBytes("Int24MSB -1", SampleType::Int24Msb, -1.0f, "80 00 01");

  expectBytes("Int32LSB +1", SampleType::Int32Lsb, 1.0f, "ff ff ff 7f");
  expectBytes("Int32LSB -1", SampleType::Int32Lsb, -1.0f, "01 00 00 80");
  expectBytes("Int32MSB +1", SampleType::Int32Msb, 1.0f, "7f ff ff ff");

  // "32 bit data with n bit alignment": the value scaled to n bits, in the top of the word.
  expectBytes("Int32LSB16 +1", SampleType::Int32Lsb16, 1.0f, "00 00 ff 7f");
  expectBytes("Int32LSB16 -1", SampleType::Int32Lsb16, -1.0f, "00 00 01 80");
  expectBytes("Int32LSB18 +1", SampleType::Int32Lsb18, 1.0f, "00 c0 ff 7f");
  expectBytes("Int32LSB20 +1", SampleType::Int32Lsb20, 1.0f, "00 f0 ff 7f");
  expectBytes("Int32LSB24 +1", SampleType::Int32Lsb24, 1.0f, "00 ff ff 7f");
  expectBytes("Int32LSB24 -1", SampleType::Int32Lsb24, -1.0f, "00 01 00 80");
  expectBytes("Int32MSB24 +1", SampleType::Int32Msb24, 1.0f, "7f ff ff 00");

  expectBytes("Float32LSB 0.5", SampleType::Float32Lsb, 0.5f, "00 00 00 3f");
  expectBytes("Float32LSB 1", SampleType::Float32Lsb, 1.0f, "00 00 80 3f");
  expectBytes("Float32LSB -1", SampleType::Float32Lsb, -1.0f, "00 00 80 bf");
  expectBytes("Float32MSB 0.5", SampleType::Float32Msb, 0.5f, "3f 00 00 00");
  expectBytes("Float64LSB 0.5", SampleType::Float64Lsb, 0.5f, "00 00 00 00 00 00 e0 3f");
  expectBytes("Float64MSB 0.5", SampleType::Float64Msb, 0.5f, "3f e0 00 00 00 00 00 00");
}

void checkTypeTable() {
  expectInt("bytes Int16LSB", bytesPerSample(SampleType::Int16Lsb), 2);
  expectInt("bytes Int24LSB", bytesPerSample(SampleType::Int24Lsb), 3);
  expectInt("bytes Int32LSB", bytesPerSample(SampleType::Int32Lsb), 4);
  expectInt("bytes Float32LSB", bytesPerSample(SampleType::Float32Lsb), 4);
  expectInt("bytes Float64LSB", bytesPerSample(SampleType::Float64Lsb), 8);

  expectText("name 0", sampleTypeName(0), "ASIOSTInt16MSB");
  expectText("name 17", sampleTypeName(17), "ASIOSTInt24LSB");
  expectText("name 27", sampleTypeName(27), "ASIOSTInt32LSB24");
  expectText("DSD is not writable", sampleTypeName(32), nullptr);
  expectInt("DSD writable?", isWritableSampleType(32) ? 1 : 0, 0);
  expectInt("unknown writable?", isWritableSampleType(999) ? 1 : 0, 0);
  expectInt("Int24LSB writable?", isWritableSampleType(17) ? 1 : 0, 1);
}

void checkBufferSizes() {
  // A power-of-two driver: granularity -1, sizes 64 upward by doubling.
  expectInt("power of two, as asked", chooseBufferSize(512, 64, 2048, 512, -1), 512);
  expectInt("power of two, rounded down", chooseBufferSize(300, 64, 2048, 512, -1), 256);
  expectInt("power of two, at the floor", chooseBufferSize(70, 64, 2048, 512, -1), 64);
  expectInt("power of two, above the ceiling", chooseBufferSize(8192, 64, 2048, 512, -1), 2048);
  expectInt("power of two, below the floor", chooseBufferSize(8, 64, 2048, 512, -1), 64);

  // A stepped driver: min + n * granularity.
  expectInt("stepped, as asked", chooseBufferSize(256, 64, 4096, 256, 64), 256);
  expectInt("stepped, rounded down", chooseBufferSize(300, 128, 4096, 256, 128), 256);
  expectInt("stepped, at the floor", chooseBufferSize(200, 128, 4096, 256, 128), 128);

  // Nothing asked for: the driver's preference, then its minimum.
  expectInt("no request prefers", chooseBufferSize(0, 64, 2048, 1024, -1), 1024);
  expectInt("no request, no preference", chooseBufferSize(0, 64, 2048, 0, -1), 64);

  // A driver with one size (min == max == preferred, granularity 0) is taken at its word.
  expectInt("single size", chooseBufferSize(256, 512, 512, 512, 0), 512);

  // Nothing usable at all: refused by the caller rather than guessed at here.
  expectInt("no minimum", chooseBufferSize(512, 0, 2048, 512, -1), 0);
  expectInt("maximum below minimum", chooseBufferSize(512, 1024, 512, 512, -1), 0);
}

}  // namespace

int main() {
  checkSampleWords();
  checkTypeTable();
  checkBufferSizes();
  std::printf("%d/%d checks passed\n", checks - failures, checks);
  return failures == 0 ? 0 : 1;
}
