#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>

static int can_read(const char *path, char *buffer, size_t capacity) {
  int fd = open(path, O_RDONLY);
  if (fd < 0) return 0;
  ssize_t bytes = read(fd, buffer, capacity - 1);
  close(fd);
  if (bytes < 0) return 0;
  buffer[bytes] = '\0';
  return 1;
}

static int can_write(const char *path) {
  int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0600);
  if (fd < 0) return 0;
  const char value[] = "sandbox-write";
  int ok = write(fd, value, sizeof(value) - 1) == (ssize_t)(sizeof(value) - 1);
  close(fd);
  return ok;
}

int main(int argc, char **argv) {
  if (argc != 6) return 64;

  char allowed[128] = {0};
  char ignored[128] = {0};
  char cwd[PATH_MAX] = {0};
  struct stat entry_stat = {0};
  int entry_stat_ok = stat(argv[0], &entry_stat) == 0;
  int entry_fd = open(argv[0], O_WRONLY);
  int entry_writable = entry_fd >= 0;
  if (entry_fd >= 0) close(entry_fd);
  int entry_chmod_writable = chmod(argv[0], 0700) == 0;
  int allowed_readable = can_read(argv[1], allowed, sizeof(allowed));
  int secret_readable = can_read(argv[2], ignored, sizeof(ignored));
  int host_root_readable = can_read("/etc/passwd", ignored, sizeof(ignored));
  int plugin_writable = can_write(argv[3]);
  int host_writable = can_write(argv[4]);
  int tmp_writable = can_write(argv[5]);
  int socket_fd = socket(AF_INET, SOCK_STREAM, 0);
  int network_errno = socket_fd < 0 ? errno : 0;
  if (socket_fd >= 0) close(socket_fd);

  if (!getcwd(cwd, sizeof(cwd))) strcpy(cwd, "unavailable");
  printf(
      "{\"allowedReadable\":%s,\"allowed\":\"%s\",\"cwd\":\"%s\","
      "\"chainlessSandboxed\":%s,\"sensitiveEnv\":%s,\"ldLibraryPath\":%s,"
      "\"entryMode\":\"%04o\",\"entryWritable\":%s,"
      "\"entryChmodWritable\":%s,"
      "\"secretReadable\":%s,\"hostRootReadable\":%s,\"pluginWritable\":%s,"
      "\"hostWritable\":%s,\"tmpWritable\":%s,\"networkErrno\":%d}",
      allowed_readable ? "true" : "false", allowed, cwd,
      getenv("CHAINLESS_SANDBOXED") ? "true" : "false",
      getenv("CC_TEST_SENSITIVE_ENV") ? "true" : "false",
      getenv("LD_LIBRARY_PATH") ? "true" : "false",
      entry_stat_ok ? (unsigned int)(entry_stat.st_mode & 0777) : 0,
      entry_writable ? "true" : "false",
      entry_chmod_writable ? "true" : "false",
      secret_readable ? "true" : "false",
      host_root_readable ? "true" : "false",
      plugin_writable ? "true" : "false",
      host_writable ? "true" : "false", tmp_writable ? "true" : "false",
      network_errno);
  return 0;
}
