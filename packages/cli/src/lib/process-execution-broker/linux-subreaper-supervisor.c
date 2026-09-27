#define _GNU_SOURCE
/*
 * Linux lifecycle owner for one pre-admitted Broker plan. This is not a
 * sandbox: it does not constrain filesystem/network access or prevent an
 * executable from attacking its supervisor. Only an intact, zero-child
 * receipt plus the supervisor's successful close proves cleanup.
 *
 * fd 3: private Unix socket. Request: CCSUBR01, then BE32 frame length,
 * argc, envc, grace-ms; then length-prefixed cwd, argv (including executable),
 * and KEY=VALUE environment strings. Subsequent bytes T/K request TERM/KILL.
 * Replies are bounded JSONL, never target stdout/stderr.
 */
#include <ctype.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define CONTROL_FD 3
#define MAX_FRAME (1024U * 1024U)
#define MAX_CHILDREN 65536U
#define HEADER_SIZE 24U

static volatile sig_atomic_t stop_level;
static int protocol_ok = 1;
static int control_closed;
static pid_t soft_pids[MAX_CHILDREN];
static size_t soft_count;

static void on_stop(int signal_number) {
  (void)signal_number;
  if (stop_level < 1) stop_level = 1;
}

static int64_t monotonic_ms(void) {
  struct timespec value;
  if (clock_gettime(CLOCK_MONOTONIC, &value) != 0) _exit(70);
  return (int64_t)value.tv_sec * 1000 + value.tv_nsec / 1000000;
}

static uint32_t be32(const unsigned char *bytes) {
  return ((uint32_t)bytes[0] << 24) | ((uint32_t)bytes[1] << 16) |
         ((uint32_t)bytes[2] << 8) | (uint32_t)bytes[3];
}

static void reply(const char *message) {
  size_t length = strlen(message);
  ssize_t count;
  do {
    count = send(CONTROL_FD, message, length, MSG_DONTWAIT | MSG_NOSIGNAL);
  } while (count < 0 && errno == EINTR);
  if (count != (ssize_t)length) protocol_ok = 0;
}

static int read_exact(unsigned char *bytes, size_t length, int64_t deadline) {
  size_t offset = 0;
  while (offset < length && !stop_level) {
    int64_t remaining = deadline - monotonic_ms();
    if (remaining <= 0) return -1;
    struct pollfd item = {CONTROL_FD, POLLIN, 0};
    int result = poll(&item, 1, remaining > 100 ? 100 : (int)remaining);
    if (result < 0 && errno == EINTR) continue;
    if (result < 0) return -1;
    if (result == 0) continue;
    ssize_t count = read(CONTROL_FD, bytes + offset, length - offset);
    if (count < 0 && (errno == EINTR || errno == EAGAIN)) continue;
    if (count <= 0) return -1;
    offset += (size_t)count;
  }
  return offset == length ? 0 : -1;
}

static char *next_string(unsigned char *body, size_t length, size_t *offset) {
  if (*offset > length || length - *offset < 4) return NULL;
  uint32_t size = be32(body + *offset);
  *offset += 4;
  if (size > length - *offset || memchr(body + *offset, 0, size)) return NULL;
  char *value = malloc((size_t)size + 1);
  if (!value) return NULL;
  memcpy(value, body + *offset, size);
  value[size] = 0;
  *offset += size;
  return value;
}

/* No automatic shell fallback for an executable with an invalid format. */
static void execute_target(char **args, char **environment) {
  if (strchr(args[0], '/')) {
    execve(args[0], args, environment);
    return;
  }
  const char *search = "/usr/bin:/bin";
  for (size_t i = 0; environment[i]; i++) {
    if (strncmp(environment[i], "PATH=", 5) == 0) search = environment[i] + 5;
  }
  int denied = 0;
  for (;;) {
    const char *end = strchr(search, ':');
    size_t directory_length = end ? (size_t)(end - search) : strlen(search);
    size_t command_length = strlen(args[0]);
    char *candidate = malloc(directory_length + command_length + 2);
    if (!candidate) { errno = ENOMEM; return; }
    if (directory_length) {
      memcpy(candidate, search, directory_length);
      candidate[directory_length] = '/';
      memcpy(candidate + directory_length + 1, args[0], command_length + 1);
    } else {
      memcpy(candidate, args[0], command_length + 1);
    }
    execve(candidate, args, environment);
    int error = errno;
    free(candidate);
    if (error == EACCES) denied = 1;
    else if (error != ENOENT && error != ENOTDIR) { errno = error; return; }
    if (!end) break;
    search = end + 1;
  }
  errno = denied ? EACCES : ENOENT;
}

static void remove_soft_pid(pid_t pid) {
  for (size_t i = 0; i < soft_count; i++) {
    if (soft_pids[i] == pid) { soft_pids[i] = soft_pids[--soft_count]; return; }
  }
}

static int signal_owned_pid(pid_t pid, int signal_number) {
  if (signal_number == SIGTERM) {
    for (size_t i = 0; i < soft_count; i++) if (soft_pids[i] == pid) return 0;
  }
  if (kill(pid, signal_number) != 0 && errno != ESRCH) return -1;
  if (signal_number == SIGTERM && soft_count < MAX_CHILDREN) soft_pids[soft_count++] = pid;
  return 0;
}

/* WSL1 implements subreapers but not /proc/<pid>/task/<tid>/children. */
static int signal_children_from_proc(int signal_number) {
  DIR *directory = opendir("/proc");
  if (!directory) return -1;
  int ok = 1;
  struct dirent *entry;
  while ((entry = readdir(directory)) != NULL) {
    char *end;
    errno = 0;
    long pid = strtol(entry->d_name, &end, 10);
    if (errno || *end || end == entry->d_name || pid <= 0 || pid > INT_MAX) continue;
    char pathname[96], data[8192];
    int size = snprintf(pathname, sizeof(pathname), "/proc/%ld/stat", pid);
    if (size <= 0 || (size_t)size >= sizeof(pathname)) { ok = 0; continue; }
    int descriptor = open(pathname, O_RDONLY | O_CLOEXEC);
    if (descriptor < 0) {
      if (errno != ENOENT && errno != ESRCH) ok = 0;
      continue;
    }
    ssize_t length;
    do { length = read(descriptor, data, sizeof(data) - 1); } while (length < 0 && errno == EINTR);
    int read_error = errno;
    close(descriptor);
    if (length <= 0) {
      if (length == 0 || (read_error != ENOENT && read_error != ESRCH)) ok = 0;
      continue;
    }
    data[length] = 0;
    char *tail = strrchr(data, ')');
    char state;
    long ppid;
    if (!tail || sscanf(tail + 1, " %c %ld", &state, &ppid) != 2) { ok = 0; continue; }
    if (ppid == (long)getpid() && signal_owned_pid((pid_t)pid, signal_number)) ok = 0;
  }
  closedir(directory);
  return ok ? 0 : -1;
}

/*
 * Only this single thread reaps children. Between the children snapshot and
 * kill(), no wait is performed: a child PID stays reserved even if it exits.
 * Adopted descendants are direct children too, including setsid/double-fork.
 * No saved original-root PID or process-group ID authorizes a delayed kill.
 */
static int signal_owned_children(int signal_number) {
  char pathname[96];
  int size = snprintf(pathname, sizeof(pathname), "/proc/self/task/%ld/children", (long)getpid());
  if (size <= 0 || (size_t)size >= sizeof(pathname)) return -1;
  int descriptor = open(pathname, O_RDONLY | O_CLOEXEC);
  if (descriptor < 0) return signal_children_from_proc(signal_number);
  char *data = malloc(MAX_FRAME + 1);
  if (!data) { close(descriptor); return -1; }
  size_t length = 0;
  int ok = 1;
  while (length < MAX_FRAME) {
    ssize_t count = read(descriptor, data + length, MAX_FRAME - length);
    if (count < 0 && errno == EINTR) continue;
    if (count < 0) { ok = 0; break; }
    if (count == 0) break;
    length += (size_t)count;
  }
  close(descriptor);
  if (length == MAX_FRAME) ok = 0;
  data[length] = 0;
  char *cursor = data;
  while (ok && *cursor) {
    while (isspace((unsigned char)*cursor)) cursor++;
    if (!*cursor) break;
    char *end;
    errno = 0;
    long number = strtol(cursor, &end, 10);
    if (errno || end == cursor || number <= 0 || number > INT_MAX ||
        (*end && !isspace((unsigned char)*end))) { ok = 0; break; }
    cursor = end;
    pid_t pid = (pid_t)number;
    if (signal_owned_pid(pid, signal_number)) ok = 0;
  }
  free(data);
  return ok ? 0 : -1;
}

static void read_control(void) {
  unsigned char buffer[64];
  ssize_t count = read(CONTROL_FD, buffer, sizeof(buffer));
  if (count < 0 && (errno == EAGAIN || errno == EINTR)) return;
  if (count <= 0) { protocol_ok = 0; control_closed = 1; if (!stop_level) stop_level = 1; return; }
  for (ssize_t i = 0; i < count; i++) {
    if (buffer[i] == 'K') stop_level = 2;
    else if (buffer[i] == 'T') { if (!stop_level) stop_level = 1; }
    else { protocol_ok = 0; stop_level = 2; }
  }
}

int main(void) {
  struct stat info;
  if (fstat(CONTROL_FD, &info) || !S_ISSOCK(info.st_mode)) return 70;
  if (fcntl(CONTROL_FD, F_SETFD, FD_CLOEXEC) ||
      fcntl(CONTROL_FD, F_SETFL, O_NONBLOCK)) return 70;
  struct sigaction action;
  memset(&action, 0, sizeof(action));
  sigemptyset(&action.sa_mask);
  action.sa_handler = on_stop;
  if (sigaction(SIGTERM, &action, NULL) || sigaction(SIGINT, &action, NULL)) return 70;
  action.sa_handler = SIG_IGN;
  if (sigaction(SIGPIPE, &action, NULL)) return 70;
  action.sa_handler = SIG_DFL;
  if (sigaction(SIGCHLD, &action, NULL)) return 70;
  int enabled = 0;
  if (prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) ||
      prctl(PR_GET_CHILD_SUBREAPER, &enabled, 0, 0, 0) || enabled != 1 ||
      prctl(PR_SET_DUMPABLE, 0, 0, 0, 0)) {
    reply("{\"type\":\"error\",\"code\":\"subreaper-unavailable\"}\n");
    return 70;
  }
  unsigned char header[HEADER_SIZE];
  int64_t startup_deadline = monotonic_ms() + 10000;
  if (read_exact(header, sizeof(header), startup_deadline)) return 70;
  uint32_t length = be32(header + 8), argc = be32(header + 12);
  uint32_t envc = be32(header + 16), grace_ms = be32(header + 20);
  if (memcmp(header, "CCSUBR01", 8) || length < HEADER_SIZE || length > MAX_FRAME ||
      argc < 1 || argc > 4096 || envc > 8192 || grace_ms < 1 || grace_ms > 5000) return 70;
  size_t body_length = length - HEADER_SIZE, offset = 0;
  unsigned char *body = malloc(body_length ? body_length : 1);
  char **args = calloc((size_t)argc + 1, sizeof(char *));
  char **environment = calloc((size_t)envc + 1, sizeof(char *));
  if (!body || !args || !environment || read_exact(body, body_length, startup_deadline)) return 70;
  char *cwd = next_string(body, body_length, &offset);
  if (!cwd || cwd[0] != '/') return 70;
  for (uint32_t i = 0; i < argc; i++) if (!(args[i] = next_string(body, body_length, &offset))) return 70;
  if (!args[0][0]) return 70;
  for (uint32_t i = 0; i < envc; i++) {
    environment[i] = next_string(body, body_length, &offset);
    if (!environment[i] || !strchr(environment[i], '=') || environment[i][0] == '=') return 70;
  }
  if (offset != body_length) return 70;
  free(body);
  int error_pipe[2];
  if (pipe2(error_pipe, O_CLOEXEC | O_NONBLOCK)) return 70;
  pid_t supervisor_pid = getpid();
  pid_t root_pid = fork();
  if (root_pid < 0) return 70;
  if (root_pid == 0) {
    close(error_pipe[0]);
    close(CONTROL_FD);
    /* Reset handlers inherited across fork, including SIGPIPE for the target. */
    action.sa_handler = SIG_DFL;
    if (sigaction(SIGTERM, &action, NULL) || sigaction(SIGINT, &action, NULL) ||
        sigaction(SIGPIPE, &action, NULL) || prctl(PR_SET_PDEATHSIG, SIGKILL) ||
        getppid() != supervisor_pid || chdir(cwd)) {
      int error = errno ? errno : ECHILD;
      if (write(error_pipe[1], &error, sizeof(error)) != sizeof(error)) _exit(126);
      _exit(127);
    }
    execute_target(args, environment);
    int error = errno;
    if (write(error_pipe[1], &error, sizeof(error)) != sizeof(error)) _exit(126);
    _exit(127);
  }
  close(error_pipe[1]);
  for (uint32_t i = 0; i < argc; i++) free(args[i]);
  for (uint32_t i = 0; i < envc; i++) free(environment[i]);
  free(args); free(environment); free(cwd);
  char message[256];
  snprintf(message, sizeof(message), "{\"type\":\"started\",\"pid\":%ld}\n", (long)root_pid);
  reply(message);
  int root_reaped = 0, warned = 0;
  unsigned long reaped = 0;
  int64_t stop_started = 0;
  for (;;) {
    int status;
    pid_t waited;
    while ((waited = waitpid(-1, &status, WNOHANG)) > 0) {
      reaped++;
      remove_soft_pid(waited);
      if (waited == root_pid && !root_reaped) {
        root_reaped = 1;
        int spawn_errno = 0;
        ssize_t bytes = read(error_pipe[0], &spawn_errno, sizeof(spawn_errno));
        if (bytes != 0 && bytes != sizeof(spawn_errno)) { protocol_ok = 0; spawn_errno = -1; }
        close(error_pipe[0]);
        snprintf(message, sizeof(message), "{\"type\":\"target-exit\",\"code\":%d,\"signal\":%d,\"spawnErrno\":%d}\n",
                 WIFEXITED(status) ? WEXITSTATUS(status) : -1,
                 WIFSIGNALED(status) ? WTERMSIG(status) : 0, spawn_errno);
        reply(message);
        if (!stop_level) stop_level = 1;
      }
    }
    if (waited < 0 && errno == ECHILD && root_reaped) {
      snprintf(message, sizeof(message), "{\"type\":\"cleanup\",\"confirmed\":%s,\"reaped\":%lu,\"rootReaped\":true}\n", protocol_ok ? "true" : "false", reaped);
      reply(message);
      return protocol_ok ? 0 : 70;
    }
    if (waited < 0 && errno != EINTR && errno != ECHILD) { protocol_ok = 0; stop_level = 2; }
    if (stop_level) {
      int64_t now = monotonic_ms();
      if (!stop_started) stop_started = now;
      int signal_number = stop_level == 2 || now - stop_started >= grace_ms ? SIGKILL : SIGTERM;
      if (signal_owned_children(signal_number)) protocol_ok = 0;
      if (!warned && now - stop_started > 10000) {
        warned = 1;
        reply("{\"type\":\"error\",\"code\":\"cleanup-unconfirmed\"}\n");
        /* Retain ownership and keep reaping; never exit with live children. */
      }
    }
    struct pollfd item = {control_closed ? -1 : CONTROL_FD, POLLIN, 0};
    int observed = poll(&item, 1, stop_level ? 10 : 100);
    if (observed > 0) read_control();
    if (observed < 0 && errno != EINTR) { protocol_ok = 0; stop_level = 2; }
  }
}
