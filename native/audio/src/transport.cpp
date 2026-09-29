#include "transport.h"

#include "protocol.h"
#include "util.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
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
  // Written by the connection's own thread when it ends and read by `broadcast` and
  // `close` under the clients' lock, which the thread does not take to write it.
  std::atomic<bool> alive{true};
  /**
   * File work handed to the server's worker threads that has not been answered yet —
   * a probe and a scan both count here. Their replies are written from those threads, so
   * this connection's handle may not close, nor this object be freed, until the count is
   * back to zero.
   */
  std::mutex workMutex;
  std::condition_variable workDone;
  int pendingFileWork = 0;
#if defined(_WIN32)
  void* handle = nullptr;
  /**
   * One event per direction. The pipe is opened for overlapped I/O because without it the
   * two directions serialize: a write from another thread — an event line the run just
   * produced — then waits behind the connection thread's blocking read, and does not
   * complete until the client happens to send its next request. Measured on the Windows
   * runner: 3.5 s for one ended event, released by the next verb.
   */
  void* readEvent = nullptr;
  void* writeEvent = nullptr;
#else
  int fd = -1;
#endif

  // The protocol is newline-delimited: one complete JSON document per line, always
  // terminated, so a reader can frame it without guessing at message boundaries.
  void send(const std::string& line) {
    if (line.empty()) return;
    // Terminated in the same write: a second, one-byte write for the newline is a second
    // chance to lose a line's framing for no gain.
    std::string payload = line;
    if (payload.back() != '\n') payload.push_back('\n');
    std::lock_guard<std::mutex> lock(writeMutex);
    const char* data = payload.data();
    size_t remaining = payload.size();
#if defined(_WIN32)
    OVERLAPPED overlapped{};
    overlapped.hEvent = static_cast<HANDLE>(writeEvent);
    while (remaining > 0) {
      ResetEvent(overlapped.hEvent);
      DWORD written = 0;
      if (!WriteFile(static_cast<HANDLE>(handle), data, static_cast<DWORD>(remaining), &written, &overlapped)) {
        const DWORD error = GetLastError();
        if (error != ERROR_IO_PENDING) {
          std::fprintf(stderr, "[cuerunner-audio] event line dropped (write failed, error %lu)\n",
                       static_cast<unsigned long>(error));
          return;
        }
        if (!GetOverlappedResult(static_cast<HANDLE>(handle), &overlapped, &written, TRUE)) {
          std::fprintf(stderr, "[cuerunner-audio] event line dropped (write did not complete, error %lu)\n",
                       static_cast<unsigned long>(GetLastError()));
          return;
        }
      }
      if (written == 0) return;
      data += written;
      remaining -= written;
    }
#else
    while (remaining > 0) {
      const ssize_t written = ::send(fd, data, remaining, socketSendFlags());
      if (written <= 0) return;
      data += written;
      remaining -= static_cast<size_t>(written);
    }
#endif
  }
};

SocketServer::SocketServer(Engine& engine) : engine_(engine) {}

SocketServer::~SocketServer() { drain(); }

void SocketServer::drain() {
  close();
  // A scan a long file is in the middle of stops here rather than being waited for: a
  // twelve-hour pass would hold the process open for minutes after the client that
  // asked for it is gone.
  engine_.cancelAnalysis();
  stopFileWork(scans_);
  stopFileWork(probes_);
  // Every connection was shut down above, so each thread is on its way out. The wait is
  // bounded: a verb stuck inside the engine must not be what keeps a quit from finishing.
  std::unique_lock<std::mutex> lock(threadsMutex_);
  if (!threadsDone_.wait_for(lock, std::chrono::seconds(5), [this] { return liveClientThreads_ == 0; })) {
    std::fprintf(stderr, "[cuerunner-audio] %d connection thread(s) still running at shutdown\n", liveClientThreads_);
  }
}

bool SocketServer::listen(const std::string& path, std::string& error) {
#if defined(_WIN32)
  // The first instance is created here so a bad name fails before the app is told the
  // engine is up. The accept loop takes it at the start of `serve()` and owns it from
  // then on: a connectable instance no thread is reading is exactly the trap — Windows
  // hands a connecting client the oldest waiting instance.
  const int bufferBytes = 1 << 20;
  HANDLE handle = CreateNamedPipeA(
      path.c_str(), PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED, PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
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
  probes_.thread = std::thread([this] { fileWorkLoop(probes_); });
  scans_.thread = std::thread([this] { fileWorkLoop(scans_); });
  logLine("listening on %s", path.c_str());
  return true;
}

void SocketServer::serve() {
  acceptLoop();
  drain();
}

void SocketServer::acceptLoop() {
#if defined(_WIN32)
  // `listen()` created this instance before any thread existed; from here the accept loop
  // owns it like every other one. Nothing else reads `listenHandle_`.
  HANDLE pendingInstance = static_cast<HANDLE>(listenHandle_);
  listenHandle_ = nullptr;
#endif
  while (!stopping_.load(std::memory_order_acquire)) {
#if defined(_WIN32)
    auto* client = new Client();
    if (pendingInstance != nullptr) {
      client->handle = pendingInstance;
      pendingInstance = nullptr;
    } else {
      client->handle = CreateNamedPipeA(path_.c_str(), PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED,
                                        PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT, PIPE_UNLIMITED_INSTANCES,
                                        1 << 20, 1 << 20, 0, nullptr);
    }
    if (client->handle == INVALID_HANDLE_VALUE) {
      delete client;
      Sleep(20);
      continue;
    }
    client->readEvent = CreateEventA(nullptr, TRUE, FALSE, nullptr);
    client->writeEvent = CreateEventA(nullptr, TRUE, FALSE, nullptr);
    if (client->readEvent == nullptr || client->writeEvent == nullptr) {
      if (client->readEvent != nullptr) CloseHandle(static_cast<HANDLE>(client->readEvent));
      if (client->writeEvent != nullptr) CloseHandle(static_cast<HANDLE>(client->writeEvent));
      CloseHandle(static_cast<HANDLE>(client->handle));
      delete client;
      Sleep(20);
      continue;
    }
    if (stopping_.load(std::memory_order_acquire)) {
      // Asked to stop while the instance was being created: let it go rather than block
      // in a ConnectNamedPipe nobody is left to wake.
      CloseHandle(static_cast<HANDLE>(client->readEvent));
      CloseHandle(static_cast<HANDLE>(client->writeEvent));
      CloseHandle(static_cast<HANDLE>(client->handle));
      delete client;
      continue;
    }
    // Overlapped like the instance it belongs to, and waited for here: a waiting connect
    // is what a stop wakes, by connecting to this pipe itself (see `requestStop`).
    OVERLAPPED connect{};
    connect.hEvent = static_cast<HANDLE>(client->readEvent);
    const BOOL connected = ConnectNamedPipe(static_cast<HANDLE>(client->handle), &connect);
    bool clientReady = connected != FALSE;
    if (!clientReady) {
      const DWORD connectError = GetLastError();
      if (connectError == ERROR_PIPE_CONNECTED) {
        // A client was already waiting on this instance when the connect was issued.
        clientReady = true;
      } else if (connectError == ERROR_IO_PENDING) {
        DWORD transferred = 0;
        clientReady = GetOverlappedResult(static_cast<HANDLE>(client->handle), &connect, &transferred, TRUE) != FALSE;
      }
    }
    if (!clientReady || stopping_.load(std::memory_order_acquire)) {
      CloseHandle(static_cast<HANDLE>(client->readEvent));
      CloseHandle(static_cast<HANDLE>(client->writeEvent));
      CloseHandle(static_cast<HANDLE>(client->handle));
      delete client;
      continue;
    }
    // The connect signalled the event the reads will use; they want it clear.
    ResetEvent(static_cast<HANDLE>(client->readEvent));
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
    // The connection opens with the engine's declaration, written before the client is
    // registered for broadcasts: an event emitted in between must not be the first line
    // the client reads, and the client must be able to refuse a build it does not speak
    // while the connection is still empty.
    client->send(greetingLine(kWireProtocolVersion));
    {
      std::lock_guard<std::mutex> lock(clientsMutex_);
      clients_.push_back(client);
    }
    {
      std::lock_guard<std::mutex> lock(threadsMutex_);
      liveClientThreads_++;
    }
    std::thread([this, client] {
      handleClient(client);
      // The last thing this thread does with `this`, and under the lock: `drain()` cannot
      // return, nor the server be destroyed, until the lock is let go.
      std::lock_guard<std::mutex> lock(threadsMutex_);
      if (--liveClientThreads_ == 0) threadsDone_.notify_all();
    }).detach();
    noteClientCount();
  }
#if defined(_WIN32)
  // A stop asked for before the first accept leaves the instance from `listen()`
  // unconsumed; the accept loop is its last owner, so it lets it go here.
  if (pendingInstance != nullptr) CloseHandle(pendingInstance);
#endif
}

void SocketServer::handleClient(Client* client) {
  std::string buffer;
  std::vector<char> chunk(64 * 1024);
  for (;;) {
#if defined(_WIN32)
    DWORD read = 0;
    OVERLAPPED overlapped{};
    overlapped.hEvent = static_cast<HANDLE>(client->readEvent);
    ResetEvent(overlapped.hEvent);
    if (!ReadFile(static_cast<HANDLE>(client->handle), chunk.data(), static_cast<DWORD>(chunk.size()), &read,
                  &overlapped)) {
      const DWORD error = GetLastError();
      if (error != ERROR_IO_PENDING) break;
      if (!GetOverlappedResult(static_cast<HANDLE>(client->handle), &overlapped, &read, TRUE)) break;
    }
    if (read == 0) break;
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
        // A whole-file read is handed to a worker thread: the connection's own thread has
        // the verbs that run the show to get to, and reading a long file is not their
        // business. The reply still comes back on this connection.
        const std::string verb = requestVerb(line);
        if (verb == "waveform" || verb == "onsets") {
          enqueueFileWork(scans_, client, std::move(line));
        } else if (verb == "probe") {
          enqueueFileWork(probes_, client, std::move(line));
        } else {
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
  // The reply to a request the analysis thread is holding is written from that thread, so
  // the handle stays open, and this object stays alive, until its work is done. The wait
  // is bounded by one file's scan.
  {
    std::unique_lock<std::mutex> lock(client->workMutex);
    client->workDone.wait(lock, [client] { return client->pendingFileWork == 0; });
  }
#if defined(_WIN32)
  if (client->handle != nullptr) {
    // The reply to a client's last verb must be out of the pipe before it is closed:
    // a disconnect discards whatever the client has not read yet, and a write only
    // completes when the kernel has the bytes. The flush blocks until the client reads,
    // which a client that is still there does — a client that has gone leaves a broken
    // pipe, where the flush fails at once rather than waiting.
    FlushFileBuffers(static_cast<HANDLE>(client->handle));
    DisconnectNamedPipe(static_cast<HANDLE>(client->handle));
    CloseHandle(static_cast<HANDLE>(client->handle));
  }
  if (client->readEvent != nullptr) CloseHandle(static_cast<HANDLE>(client->readEvent));
  if (client->writeEvent != nullptr) CloseHandle(static_cast<HANDLE>(client->writeEvent));
#else
  if (client->fd >= 0) ::close(client->fd);
#endif
  delete client;
  noteClientCount();
}

void SocketServer::enqueueFileWork(FileWork& worker, Client* client, std::string line) {
  {
    std::lock_guard<std::mutex> lock(client->workMutex);
    client->pendingFileWork++;
  }
  {
    std::lock_guard<std::mutex> lock(worker.mutex);
    if (!worker.stopping) {
      worker.queue.push_back(AnalysisJob{client, std::move(line)});
    } else {
      finishFileWork(client);
      return;
    }
  }
  worker.work.notify_one();
}

void SocketServer::fileWorkLoop(FileWork& worker) {
  for (;;) {
    AnalysisJob job;
    bool haveJob = false;
    std::vector<Client*> abandoned;
    {
      std::unique_lock<std::mutex> lock(worker.mutex);
      worker.work.wait(lock, [&worker] { return worker.stopping || !worker.queue.empty(); });
      if (worker.stopping) {
        // A stop leaves whatever is still queued unrun. Each waiting client is released
        // here rather than left waiting on a count that would never come back down.
        for (const AnalysisJob& queued : worker.queue) abandoned.push_back(queued.client);
        worker.queue.clear();
      } else {
        job = std::move(worker.queue.front());
        worker.queue.pop_front();
        haveJob = true;
      }
    }
    for (Client* client : abandoned) finishFileWork(client);
    if (!haveJob) return;

    bool shutdown = false;
    const std::string reply = handleRequestLine(engine_, job.line, shutdown);
    if (!reply.empty()) job.client->send(reply);
    finishFileWork(job.client);
  }
}

void SocketServer::finishFileWork(Client* client) {
  std::lock_guard<std::mutex> lock(client->workMutex);
  if (--client->pendingFileWork == 0) client->workDone.notify_all();
}

void SocketServer::stopFileWork(FileWork& worker) {
  {
    std::lock_guard<std::mutex> lock(worker.mutex);
    worker.stopping = true;
  }
  worker.work.notify_all();
  if (worker.thread.joinable()) worker.thread.join();
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
  // A blocked ConnectNamedPipe is woken by a client arriving, not by anything being
  // closed: connect to our own pipe and let the pending instance report
  // ERROR_PIPE_CONNECTED, which is what lets the accept loop notice it is stopping.
  if (!path_.empty()) {
    HANDLE wake = CreateFileA(path_.c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, 0, nullptr);
    if (wake != INVALID_HANDLE_VALUE) CloseHandle(wake);
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
  // `listen()` may have created the first instance and the accept loop never taken it
  // (a stop before the first accept, or a serve() that never ran). This runs on the same
  // thread that owns the lifecycle, so the handle is released here rather than leaking.
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
