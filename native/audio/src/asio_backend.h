// The ASIO backend's face towards the engine.
//
// Compiled only when Steinberg's ASIO SDK was present at build time (the build defines
// WINSLAB_ASIO and adds this file plus the SDK's own host sources to the compile) — see
// scripts/asio-sdk.mjs and the ASIO section of the README. A build without the SDK has
// no ASIO devices, and says so rather than pretending: `--backend asio` is refused with
// the reason.
//
// Everything here takes the miniaudio context rather than a handle of its own, because
// the backend *is* miniaudio from the engine's side: ASIO is registered as a custom
// backend (`ma_backend_custom`), so the engine's device layer treats it exactly like
// WASAPI and Core Audio. These functions are the handful of things miniaudio has no
// vocabulary for: a driver that has stopped calling back, a driver that asks to be
// reset, and the two numbers only the driver knows.
#pragma once

#if defined(WINSLAB_ASIO)

#include "miniaudio_setup.h"

#include <cstdint>
#include <string>

namespace ws {
namespace asio {

/** The callbacks that make ASIO a backend for `ma_context_config::custom`. */
ma_backend_callbacks backendCallbacks();

/**
 * Whether the driver has stopped calling back.
 *
 * ASIO has no "the device went away" notification: a driver whose hardware is unplugged
 * either keeps calling back or stops, and only the second one is audible from here. The
 * engine's device-health check asks this and treats a true answer as a lost device.
 * Latched: it stays true until the next device is opened.
 */
bool contextStalled(const ma_context& context);

/**
 * Takes a pending "the driver wants to be reset" request, if there is one, with the
 * sentence an operator should read. One-shot: the flag is cleared.
 *
 * A driver asks to be reset when its own settings changed — its control panel, its
 * external clock — which means the buffer size or rate the stream was created with is no
 * longer what the driver will use. The engine reopens the device on this, and the
 * sentence is what it tells the operator.
 */
bool takeRestartRequest(const ma_context& context, std::string& reason);

/** Driver-reported dropouts (overloads, resync requests) since the last call. */
uint64_t takeDropouts(const ma_context& context);

/** The driver's own output latency, in ms; negative when the driver did not say. */
double contextLatencyMs(const ma_context& context);

/** Something the backend has to say that is neither a failure nor a warning: the
 *  channel cap, for instance. Empty when there is nothing to say. */
std::string contextNote(const ma_context& context);

/** Why the last open, start or buffer change failed, in the backend's own words. */
std::string contextMessage(const ma_context& context);

}  // namespace asio
}  // namespace ws

#endif  // WINSLAB_ASIO
