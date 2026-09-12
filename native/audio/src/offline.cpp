#include "offline.h"

#include "protocol.h"
#include "util.h"
#include "wavwrite.h"

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "cJSON.h"

namespace ws {
namespace {

bool readWholeFile(const std::string& path, std::string& out) {
  std::FILE* file = std::fopen(path.c_str(), "rb");
  if (file == nullptr) return false;
  std::fseek(file, 0, SEEK_END);
  const long size = std::ftell(file);
  std::fseek(file, 0, SEEK_SET);
  if (size < 0) {
    std::fclose(file);
    return false;
  }
  out.resize(static_cast<size_t>(size));
  const size_t got = std::fread(out.data(), 1, out.size(), file);
  std::fclose(file);
  out.resize(got);
  return true;
}

std::string printJson(cJSON* object) {
  char* text = cJSON_PrintUnformatted(object);
  std::string out = text != nullptr ? std::string(text) : std::string("null");
  cJSON_free(text);
  return out;
}

struct ScriptCommand {
  double atMs = 0.0;
  int order = 0;
  std::string request;
};

}  // namespace

int runOfflineRender(EngineOptions engineOptions, const OfflineOptions& options) {
  std::string scriptText;
  if (!readWholeFile(options.scriptPath, scriptText)) {
    std::fprintf(stderr, "cannot read offline script %s\n", options.scriptPath.c_str());
    return 2;
  }
  cJSON* script = cJSON_Parse(scriptText.c_str());
  if (script == nullptr) {
    std::fprintf(stderr, "offline script is not valid JSON\n");
    return 2;
  }

  const cJSON* sampleRateItem = cJSON_GetObjectItemCaseSensitive(script, "sampleRate");
  const cJSON* channelsItem = cJSON_GetObjectItemCaseSensitive(script, "channels");
  const cJSON* blockItem = cJSON_GetObjectItemCaseSensitive(script, "blockFrames");
  const cJSON* framesItem = cJSON_GetObjectItemCaseSensitive(script, "frames");
  const cJSON* stopWhenIdleItem = cJSON_GetObjectItemCaseSensitive(script, "stopWhenIdle");
  if (cJSON_IsNumber(sampleRateItem)) engineOptions.sampleRate = static_cast<int>(sampleRateItem->valuedouble);
  if (cJSON_IsNumber(channelsItem)) engineOptions.channels = static_cast<int>(channelsItem->valuedouble);
  const int blockFrames = cJSON_IsNumber(blockItem) ? static_cast<int>(blockItem->valuedouble) : 512;
  int64_t totalFrames = cJSON_IsNumber(framesItem) ? static_cast<int64_t>(framesItem->valuedouble) : -1;
  const bool stopWhenIdle = stopWhenIdleItem == nullptr ? true : cJSON_IsTrue(stopWhenIdleItem) != 0;
  if (totalFrames <= 0 && options.maxFrames > 0) totalFrames = options.maxFrames;
  if (totalFrames <= 0) totalFrames = static_cast<int64_t>(engineOptions.sampleRate) * 60;  // safety cap

  std::vector<ScriptCommand> commands;
  const cJSON* commandArray = cJSON_GetObjectItemCaseSensitive(script, "commands");
  int order = 0;
  if (cJSON_IsArray(commandArray)) {
    const int count = cJSON_GetArraySize(commandArray);
    for (int i = 0; i < count; i++) {
      cJSON* command = cJSON_GetArrayItem(commandArray, i);
      if (!cJSON_IsObject(command)) continue;
      const cJSON* atItem = cJSON_GetObjectItemCaseSensitive(command, "atMs");
      ScriptCommand entry;
      entry.atMs = cJSON_IsNumber(atItem) ? atItem->valuedouble : 0.0;
      entry.order = order++;
      cJSON* idItem = cJSON_GetObjectItemCaseSensitive(command, "id");
      if (idItem == nullptr) cJSON_AddNumberToObject(command, "id", entry.order + 1);
      // The script's `atMs` is when the verb is issued. Verbs that take a `whenMs` get
      // it stamped from `atMs`, so the mixer places them on the exact frame instead of
      // the block boundary the runner happens to reach.
      const cJSON* verbItem = cJSON_GetObjectItemCaseSensitive(command, "verb");
      const bool takesWhen = cJSON_IsString(verbItem) &&
                             (std::strcmp(verbItem->valuestring, "start") == 0 ||
                              std::strcmp(verbItem->valuestring, "stop") == 0 ||
                              std::strcmp(verbItem->valuestring, "stopAll") == 0 ||
                              std::strcmp(verbItem->valuestring, "seek") == 0 ||
                              std::strcmp(verbItem->valuestring, "cancel") == 0 ||
                              std::strcmp(verbItem->valuestring, "fade") == 0 ||
                              std::strcmp(verbItem->valuestring, "panic") == 0);
      if (takesWhen && cJSON_GetObjectItemCaseSensitive(command, "whenMs") == nullptr) {
        cJSON_AddNumberToObject(command, "whenMs", entry.atMs);
      }
      entry.request = printJson(command);
      commands.push_back(entry);
    }
  }
  std::stable_sort(commands.begin(), commands.end(), [](const ScriptCommand& a, const ScriptCommand& b) {
    if (a.atMs != b.atMs) return a.atMs < b.atMs;
    return a.order < b.order;
  });

  engineOptions.backend = "offline";
  Engine engine;
  std::vector<std::string> eventLines;
  engine.setEventCallback([&](const Event& event) {
    const std::string line = eventLine(event);
    if (!line.empty()) eventLines.push_back(line);
  });
  EngineError error;
  if (!engine.start(engineOptions, error)) {
    std::fprintf(stderr, "cannot start offline engine: %s (%s)\n", error.message.c_str(), error.code.c_str());
    cJSON_Delete(script);
    return 2;
  }

  WavWriter writer;
  std::string writerError;
  if (!writer.open(options.outPath, engineOptions.sampleRate, engineOptions.channels, writerError)) {
    std::fprintf(stderr, "%s\n", writerError.c_str());
    engine.stop();
    cJSON_Delete(script);
    return 2;
  }

  std::vector<float> block(static_cast<size_t>(std::max(64, blockFrames)) *
                           static_cast<size_t>(engineOptions.channels));
  std::vector<std::string> results;
  size_t nextCommand = 0;
  int64_t rendered = 0;
  bool anyCommandRan = false;
  int idleBlocks = 0;

  while (rendered < totalFrames) {
    const double blockEndMs = static_cast<double>(rendered + block.size() / static_cast<size_t>(engineOptions.channels)) *
                              1000.0 / static_cast<double>(engineOptions.sampleRate);
    while (nextCommand < commands.size() && commands[nextCommand].atMs <= blockEndMs) {
      bool shutdown = false;
      const std::string reply = handleRequestLine(engine, commands[nextCommand].request, shutdown);
      cJSON* parsed = cJSON_Parse(reply.c_str());
      if (parsed != nullptr) {
        cJSON* stored = cJSON_CreateObject();
        cJSON_AddNumberToObject(stored, "atMs", commands[nextCommand].atMs);
        cJSON_AddItemToObject(stored, "reply", cJSON_Duplicate(parsed, 1));
        results.push_back(printJson(stored));
        cJSON_Delete(stored);
        cJSON_Delete(parsed);
      }
      anyCommandRan = true;
      nextCommand++;
    }
    engine.pump();
    const int framesThisBlock = static_cast<int>(block.size()) / engineOptions.channels;
    std::fill(block.begin(), block.end(), 0.0f);
    engine.renderOfflineBlock(block.data(), framesThisBlock);
    if (!writer.writeFrames(block.data(), framesThisBlock)) {
      std::fprintf(stderr, "cannot write output WAV\n");
      writer.finalize();
      engine.stop();
      cJSON_Delete(script);
      return 2;
    }
    rendered += framesThisBlock;

    if (stopWhenIdle) {
      const InfoDTO info = engine.info();
      if (!info.active) {
        idleBlocks++;
        if (idleBlocks > 8 && anyCommandRan && nextCommand >= commands.size()) break;
      } else {
        idleBlocks = 0;
      }
    }
  }
  if (nextCommand < commands.size()) {
    // Commands scheduled past the render window still get their say, so a script
    // mistake is visible rather than silently dropped.
    while (nextCommand < commands.size()) {
      bool shutdown = false;
      const std::string reply = handleRequestLine(engine, commands[nextCommand].request, shutdown);
      cJSON* parsed = cJSON_Parse(reply.c_str());
      if (parsed != nullptr) {
        cJSON* stored = cJSON_CreateObject();
        cJSON_AddNumberToObject(stored, "atMs", commands[nextCommand].atMs);
        cJSON_AddItemToObject(stored, "reply", cJSON_Duplicate(parsed, 1));
        results.push_back(printJson(stored));
        cJSON_Delete(stored);
        cJSON_Delete(parsed);
      }
      nextCommand++;
    }
  }

  const InfoDTO finalInfo = engine.info();
  writer.finalize();
  engine.stop();
  cJSON_Delete(script);

  cJSON* summary = cJSON_CreateObject();
  cJSON_AddBoolToObject(summary, "ok", 1);
  cJSON_AddStringToObject(summary, "backend", "offline");
  cJSON_AddNumberToObject(summary, "sampleRate", engineOptions.sampleRate);
  cJSON_AddNumberToObject(summary, "channels", engineOptions.channels);
  cJSON_AddNumberToObject(summary, "blockFrames", blockFrames);
  cJSON_AddNumberToObject(summary, "frames", static_cast<double>(rendered));
  cJSON_AddNumberToObject(summary, "durationMs",
                          static_cast<double>(rendered) * 1000.0 / static_cast<double>(engineOptions.sampleRate));
  cJSON* resultArray = cJSON_AddArrayToObject(summary, "results");
  for (const std::string& result : results) {
    cJSON* parsed = cJSON_Parse(result.c_str());
    if (parsed != nullptr) cJSON_AddItemToArray(resultArray, parsed);
  }
  cJSON* eventArray = cJSON_AddArrayToObject(summary, "events");
  for (const std::string& line : eventLines) {
    cJSON* parsed = cJSON_Parse(line.c_str());
    if (parsed == nullptr) continue;
    cJSON* body = cJSON_DetachItemFromObjectCaseSensitive(parsed, "event");
    if (body != nullptr) cJSON_AddItemToArray(eventArray, body);
    cJSON_Delete(parsed);
  }
  cJSON_AddItemToObject(summary, "info", cJSON_Parse(infoJson(finalInfo).c_str()));
  const std::string summaryText = printJson(summary);
  std::printf("%s\n", summaryText.c_str());
  std::fflush(stdout);
  if (!options.eventsPath.empty()) {
    std::FILE* file = std::fopen(options.eventsPath.c_str(), "wb");
    if (file != nullptr) {
      for (const std::string& line : eventLines) std::fprintf(file, "%s\n", line.c_str());
      std::fclose(file);
    }
  }
  cJSON_Delete(summary);
  return 0;
}

}  // namespace ws
