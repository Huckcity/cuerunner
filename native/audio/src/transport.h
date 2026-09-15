// Local IPC transport: a Unix domain socket on Unix, a named pipe on Windows. One
// client (the app's main process) is expected, but each connection is served on its
// own thread so a slow writer cannot stall the engine.
#pragma once

#include "engine.h"

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <functional>
#include <mutex>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace ws {

class SocketServer {
 public:
  explicit SocketServer(Engine& engine);
  ~SocketServer();

  bool listen(const std::string& path, std::string& error);
  /** Called whenever the number of connected clients changes (0 means nobody is left). */
  void setClientCountCallback(std::function<void(int)> callback) { clientCountCallback_ = std::move(callback); }
  int clientCount() const;
  // Blocks until shutdown is requested through the protocol.
  void serve();
  void broadcast(const std::string& line);
  // Async-signal-tolerant stop: closes the listening endpoint so accept() returns.
  void requestStop();
  void close();

 private:
  struct Client;
  struct AnalysisJob {
    Client* client = nullptr;
    std::string line;
  };

  void acceptLoop();
  void handleClient(Client* client);
  void removeClient(Client* client);
  void noteClientCount();

  // Requests that read a whole file — the waveform envelope and the onset scan — run on
  // this thread instead of the connection's. On a long file one of them takes a second
  // or more, and everything the show is run with goes through the same connection: a
  // GO's prepare and start, the clock read behind every timer in the window, the
  // progress read behind every row. None of it may wait for a file to be scanned — that
  // wait is the delay between the press and the sound.
  void enqueueAnalysis(Client* client, std::string line);
  void analysisLoop();
  static void finishAnalysis(Client* client);
  void stopAnalysis();

  Engine& engine_;
  std::string path_;
  std::atomic<bool> stopping_{false};
  std::atomic<bool> listening_{false};
  mutable std::mutex clientsMutex_;
  std::vector<Client*> clients_;
  std::function<void(int)> clientCountCallback_;
  std::deque<AnalysisJob> analysisQueue_;
  std::mutex analysisMutex_;
  std::condition_variable analysisWork_;
  std::thread analysis_;
  bool analysisStopping_ = false;
#if defined(_WIN32)
  /** The first pipe instance, created before any thread exists and taken by the accept loop. */
  void* listenHandle_ = nullptr;
#else
  int listenFd_ = -1;
#endif
};

}  // namespace ws
