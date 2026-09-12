// Local IPC transport: a Unix domain socket on Unix, a named pipe on Windows. One
// client (the app's main process) is expected, but each connection is served on its
// own thread so a slow writer cannot stall the engine.
#pragma once

#include "engine.h"

#include <atomic>
#include <cstdint>
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

  void acceptLoop();
  void handleClient(Client* client);
  void removeClient(Client* client);
  void noteClientCount();

  Engine& engine_;
  std::string path_;
  std::atomic<bool> stopping_{false};
  std::atomic<bool> listening_{false};
  mutable std::mutex clientsMutex_;
  std::vector<Client*> clients_;
  std::function<void(int)> clientCountCallback_;
#if defined(_WIN32)
  void* listenHandle_ = nullptr;
#else
  int listenFd_ = -1;
#endif
};

}  // namespace ws
