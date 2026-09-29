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
  /**
   * A thread for requests that read a whole file, with its own queue.
   *
   * They run off the connection's thread because everything the show is run with goes
   * through that one: a GO's prepare and start, the clock read behind every timer in the
   * window, the progress read behind every row. None of it may wait for a file to be
   * read — that wait is the delay between the press and the sound.
   *
   * There are two of them, not one, because a probe and a scan are different kinds of
   * long: a probe is what the workspace's durations wait on and a scan of a long file
   * runs for minutes, and neither may hold the other up.
   */
  struct FileWork {
    std::deque<AnalysisJob> queue;
    std::mutex mutex;
    std::condition_variable work;
    std::thread thread;
    bool stopping = false;
  };

  void acceptLoop();
  void handleClient(Client* client);
  void removeClient(Client* client);
  void noteClientCount();
  /**
   * Ends every connection and waits for the threads that served them. Those threads run
   * the engine's verbs, so none of them may outlive the engine or this object: a request
   * in flight when the process was told to stop would otherwise be a use-after-free.
   */
  void drain();

  void enqueueFileWork(FileWork& worker, Client* client, std::string line);
  void fileWorkLoop(FileWork& worker);
  void stopFileWork(FileWork& worker);
  static void finishFileWork(Client* client);

  Engine& engine_;
  std::string path_;
  std::atomic<bool> stopping_{false};
  std::atomic<bool> listening_{false};
  mutable std::mutex clientsMutex_;
  std::vector<Client*> clients_;
  /** Connection threads still running, counted from before one starts to after its last touch of `this`. */
  std::mutex threadsMutex_;
  std::condition_variable threadsDone_;
  int liveClientThreads_ = 0;
  std::function<void(int)> clientCountCallback_;
  /** `probe` reads a file to measure it; `waveform` and `onsets` read it end to end. */
  FileWork probes_;
  FileWork scans_;
#if defined(_WIN32)
  /** The first pipe instance, created before any thread exists and taken by the accept loop. */
  void* listenHandle_ = nullptr;
#else
  int listenFd_ = -1;
#endif
};

}  // namespace ws
