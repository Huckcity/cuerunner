#include "transport.h"

#include "protocol.h"
#include "util.h"

#include <algorithm>
#include <cstring>

#if defined(_WIN32)
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#else
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#endif

namespace ws {
namespace {

constexpr size_t kMaxLineBytes = 4 * 1024 * 1024;

#if !defined(_WIN32)
// MSG_NOSIGNAL does not exist on macOS; there SO_NOSIGPIPE is set on the socket, and
// the flag is plain 0.
int socketSendFlags() {
#if defined(MSG_NOSIGNAL)
  return MSG_NOSIGNAL;
#else
  return 0;
#endif
}
#endif

}  // namespace

struct SocketServer::Client {
  std::mutex writeMutex;
  std::thread thread;
  bool alive = true;
#if defined(_WIN32)
  void* handle = nullptr;
#else
  int fd = -1;
#endif

  // The protocol is newline-delimited: one complete JSON document per line, always
  // terminated, so a reader can frame it without guessing at message boundaries.
  void send(const std::string& line) {
    if (line.empty()) return;
    const bool needsTerminator = line.back() != '\n';
    std::lock_guard<std::mutex> lock(writeMutex);
    const char* data = line.data();
    size_t remaining = line.size();
    const char terminator = '\n';
#if defined(_WIN32)
    while (remaining > 0) {
      DWORD written = 0;
      if (!WriteFile(static_cast<HANDLE>(handle), data, static_cast<DWORD>(remaining), &written, nullptr)) return;
      if (written == 0) return;
      data += written;
      remaining -= written;
    }
    if (needsTerminator) WriteFile(static_cast<HANDLE>(handle), &terminator, 1, nullptr, nullptr);
#else
    while (remaining > 0) {
      const ssize_t written = ::send(fd, data, remaining, socketSendFlags());
      if (written <= 0) return;
      data += written;
      remaining -= static_cast<size_t>(written);
    }
    if (needsTerminator) ::send(fd, &terminator, 1, socketSendFlags());
#endif
  }
};

SocketServer::SocketServer(Engine& engine) : engine_(engine) {}

SocketServer::~SocketServer() { close(); }

bool SocketServer::listen(const std::string& path, std::string& error) {
#if defined(_WIN32)
  const int bufferBytes = 1 << 20;
  HANDLE handle = CreateNamedPipeA(
      path.c_str(), PIPE_ACCESS_DUPLEX, PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
      PIPE_UNLIMITED_INSTANCES, static_cast<DWORD>(bufferBytes), static_cast<DWORD>(bufferBytes), 0, nullptr);
  if (handle == INVALID_HANDLE_VALUE) {
    error = "cannot create named pipe " + path + " (error " + std::to_string(GetLastError()) + ")";
    return false;
  }
  listenHandle_ = handle;
#else
  const int fd = ::socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0) {
    error = "cannot create audio socket";
    return false;
  }
  sockaddr_un address{};
  address.sun_family = AF_UNIX;
  if (path.size() >= sizeof(address.sun_path)) {
    ::close(fd);
    error = "audio socket path is too long";
    return false;
  }
  std::strncpy(address.sun_path, path.c_str(), sizeof(address.sun_path) - 1);
  ::unlink(path.c_str());
  if (::bind(fd, reinterpret_cast<sockaddr*>(&address), sizeof(address)) != 0) {
    ::close(fd);
    error = "cannot bind audio socket " + path;
    return false;
  }
  if (::listen(fd, 8) != 0) {
    ::close(fd);
    ::unlink(path.c_str());
    error = "cannot listen on audio socket " + path;
    return false;
  }
  listenFd_ = fd;
#endif
  path_ = path;
  listening_.store(true, std::memory_order_release);
  logLine("listening on %s", path.c_str());
  return true;
}

void SocketServer::serve() {
  acceptLoop();
  close();
}

void SocketServer::acceptLoop() {
  while (!stopping_.load(std::memory_order_acquire)) {
#if defined(_WIN32)
    auto* client = new Client();
    client->handle = CreateNamedPipeA(path_.c_str(), PIPE_ACCESS_DUPLEX,
                                      PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT, PIPE_UNLIMITED_INSTANCES,
                                      1 << 20, 1 << 20, 0, nullptr);
    if (client->handle == INVALID_HANDLE_VALUE) {
      delete client;
      Sleep(20);
      continue;
    }
    const BOOL connected = ConnectNamedPipe(static_cast<HANDLE>(client->handle), nullptr);
    const DWORD connectError = GetLastError();
    if ((!connected && connectError != ERROR_PIPE_CONNECTED) || stopping_.load()) {
      CloseHandle(static_cast<HANDLE>(client->handle));
      delete client;
      continue;
    }
#else
    const int fd = ::accept(listenFd_, nullptr, nullptr);
    if (fd < 0) {
      if (stopping_.load(std::memory_order_acquire)) break;
      continue;
    }
    auto* client = new Client();
    client->fd = fd;
#if defined(__APPLE__)
    int one = 1;
    ::setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof(one));
#endif
#endif
    {
      std::lock_guard<std::mutex> lock(clientsMutex_);
      clients_.push_back(client);
    }
    client->thread = std::thread([this, client] { handleClient(client); });
    client->thread.detach();
    noteClientCount();
  }
}

void SocketServer::handleClient(Client* client) {
  std::string buffer;
  std::vector<char> chunk(64 * 1024);
  for (;;) {
#if defined(_WIN32)
    DWORD read = 0;
    if (!ReadFile(static_cast<HANDLE>(client->handle), chunk.data(), static_cast<DWORD>(chunk.size()), &read, nullptr) ||
        read == 0) {
      break;
    }
#else
    const ssize_t read = ::recv(client->fd, chunk.data(), chunk.size(), 0);
    if (read <= 0) break;
#endif
    buffer.append(chunk.data(), static_cast<size_t>(read));
    if (buffer.size() > kMaxLineBytes) {
      client->send(R"({"id":0,"ok":false,"error":{"code":"invalid","message":"request too large"}})");
      buffer.clear();
      continue;
    }
    size_t newline = buffer.find('\n');
    while (newline != std::string::npos) {
      std::string line = buffer.substr(0, newline);
      buffer.erase(0, newline + 1);
      while (!line.empty() && (line.back() == '\r' || line.back() == ' ')) line.pop_back();
      if (!line.empty()) {
        bool shutdown = false;
        const std::string reply = handleRequestLine(engine_, line, shutdown);
        if (!reply.empty()) client->send(reply);
        if (shutdown) {
          stopping_.store(true, std::memory_order_release);
          client->alive = false;
          removeClient(client);
          return;
        }
      }
      newline = buffer.find('\n');
    }
  }
  client->alive = false;
  removeClient(client);
}

void SocketServer::removeClient(Client* client) {
  {
    std::lock_guard<std::mutex> lock(clientsMutex_);
    clients_.erase(std::remove(clients_.begin(), clients_.end(), client), clients_.end());
  }
#if defined(_WIN32)
  if (client->handle != nullptr) {
    DisconnectNamedPipe(static_cast<HANDLE>(client->handle));
    CloseHandle(static_cast<HANDLE>(client->handle));
  }
#else
  if (client->fd >= 0) ::close(client->fd);
#endif
  delete client;
  noteClientCount();
}

void SocketServer::noteClientCount() {
  if (!clientCountCallback_) return;
  clientCountCallback_(clientCount());
}

int SocketServer::clientCount() const {
  std::lock_guard<std::mutex> lock(clientsMutex_);
  return static_cast<int>(clients_.size());
}

void SocketServer::broadcast(const std::string& line) {
  if (line.empty()) return;
  std::lock_guard<std::mutex> lock(clientsMutex_);
  for (Client* client : clients_) {
    if (client->alive) client->send(line);
  }
}

void SocketServer::requestStop() {
  stopping_.store(true, std::memory_order_release);
#if defined(_WIN32)
  if (listenHandle_ != nullptr) {
    // Wake a blocked ConnectNamedPipe by connecting to our own instance.
    CloseHandle(static_cast<HANDLE>(listenHandle_));
    listenHandle_ = nullptr;
  }
#else
  if (listenFd_ >= 0) {
    ::shutdown(listenFd_, SHUT_RDWR);
    ::close(listenFd_);
    listenFd_ = -1;
  }
#endif
}

void SocketServer::close() {
  stopping_.store(true, std::memory_order_release);
  {
    std::lock_guard<std::mutex> lock(clientsMutex_);
    for (Client* client : clients_) {
      client->alive = false;
#if defined(_WIN32)
      if (client->handle != nullptr) CloseHandle(static_cast<HANDLE>(client->handle));
#else
      if (client->fd >= 0) ::shutdown(client->fd, SHUT_RDWR);
#endif
    }
  }
#if defined(_WIN32)
  if (listenHandle_ != nullptr) {
    CloseHandle(static_cast<HANDLE>(listenHandle_));
    listenHandle_ = nullptr;
  }
#else
  if (listenFd_ >= 0) {
    ::shutdown(listenFd_, SHUT_RDWR);
    ::close(listenFd_);
    listenFd_ = -1;
    if (!path_.empty()) ::unlink(path_.c_str());
  }
#endif
  listening_.store(false, std::memory_order_release);
}

}  // namespace ws
