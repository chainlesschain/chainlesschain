/*
 * ChainlessChain macOS MCP runtime launcher.
 *
 * This helper is intentionally useful only after a formal release installs a
 * Developer-ID-signed Mach-O at the fixed root:wheel path with mode 04555 and
 * installs the matching root-owned contract. It does not turn a pathname
 * recheck into an atomic claim. Instead, fd 3 supplies the already-approved
 * Node runtime bytes. A root watchdog copies and hashes those bytes into a
 * root-only namespace that the real caller may traverse and execute but may
 * not mutate. The actual Node image must run the compiled READY bootstrap;
 * fd 4 is copied into a root-owned read-only file, reopened, identity checked,
 * unlinked, and directory-fsynced before the target exists. Only that anonymous
 * snapshot is inherited by the target. After the watchdog unlinks the runtime,
 * removes its directory, fsyncs the fixed root, and observes both helper and
 * Broker lifelines, it releases the immutable entry snapshot through the gate.
 *
 * Generated build constants come solely from
 * macos-mcp-launcher-protocol.json and mcp-fd-entry-bootstrap.js.
 */

#define _DARWIN_C_SOURCE 1

#include "macos-mcp-launcher-generated.h"

#include <CommonCrypto/CommonDigest.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <limits.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/file.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;

#define CC_EXIT_USAGE 64
#define CC_EXIT_UNAVAILABLE 69
#define CC_EXIT_SECURITY 77
#define CC_EXIT_TEMPFAIL 75
#define CC_EXIT_INTERNAL 70
#define CC_NONCE_HEX_BYTES 64
#define CC_SHA256_HEX_BYTES 64
#define CC_COPY_CHUNK_BYTES (1024 * 1024)
#define CC_PROFILE_CAPACITY (PATH_MAX * 5 + 8192)

struct launch_request {
  char nonce[CC_NONCE_HEX_BYTES + 1];
  char runtime_sha256[CC_SHA256_HEX_BYTES + 1];
  off_t runtime_bytes;
  char entry_sha256[CC_SHA256_HEX_BYTES + 1];
  off_t entry_bytes;
  uid_t caller_uid;
  gid_t caller_gid;
  char policy_sha256[CC_SHA256_HEX_BYTES + 1];
  int passthrough_argc;
  char **passthrough_argv;
};

struct source_evidence {
  struct stat runtime_stat;
  struct stat entry_stat;
  struct stat entry_snapshot_stat;
  struct stat capsule_stat;
};

static volatile sig_atomic_t control_write_fd = -1;
static volatile sig_atomic_t pending_signal = 0;

static void relay_signal(int signal_number) {
  unsigned char value = (unsigned char)signal_number;
  int fd = (int)control_write_fd;
  int saved_errno = errno;
  ssize_t written = -1;
  pending_signal = (sig_atomic_t)signal_number;
  if (fd >= 0) {
    /* The write end is O_NONBLOCK. A single-byte write is async-signal-safe;
     * EAGAIN means an earlier abort signal is already queued for the watchdog. */
    written = write(fd, &value, sizeof(value));
  }
  if (written == 1) pending_signal = 0;
  errno = saved_errno;
}

static void flush_pending_signal(void) {
  sigset_t handled;
  sigset_t previous;
  sig_atomic_t signal_number;
  unsigned char value;
  ssize_t written;
  int saved_errno = errno;
  sigemptyset(&handled);
  sigaddset(&handled, SIGINT);
  sigaddset(&handled, SIGTERM);
  sigaddset(&handled, SIGHUP);
  sigaddset(&handled, SIGQUIT);
  if (sigprocmask(SIG_BLOCK, &handled, &previous) != 0) return;
  signal_number = pending_signal;
  if (signal_number > 0 && control_write_fd >= 0) {
    value = (unsigned char)signal_number;
    written = write((int)control_write_fd, &value, sizeof(value));
    if (written == 1 || (written < 0 && errno == EAGAIN)) {
      pending_signal = 0;
    }
  }
  (void)sigprocmask(SIG_SETMASK, &previous, NULL);
  errno = saved_errno;
}

static int is_lower_hex(const char *value, size_t length) {
  size_t index;
  if (value == NULL || strlen(value) != length) {
    return 0;
  }
  for (index = 0; index < length; index += 1) {
    char character = value[index];
    if (!((character >= '0' && character <= '9') ||
          (character >= 'a' && character <= 'f'))) {
      return 0;
    }
  }
  return 1;
}

static int parse_off_t(const char *value, off_t maximum, off_t *result) {
  char *end = NULL;
  unsigned long long parsed;
  if (value == NULL || value[0] == '\0' || value[0] == '-') {
    return -1;
  }
  errno = 0;
  parsed = strtoull(value, &end, 10);
  if (errno != 0 || end == value || *end != '\0' || parsed > (uint64_t)maximum) {
    return -1;
  }
  *result = (off_t)parsed;
  return 0;
}

static int parse_uid(const char *value, uid_t *result) {
  off_t parsed;
  if (parse_off_t(value, (off_t)UINT32_MAX, &parsed) != 0) {
    return -1;
  }
  *result = (uid_t)parsed;
  return 0;
}

static int parse_gid(const char *value, gid_t *result) {
  off_t parsed;
  if (parse_off_t(value, (off_t)UINT32_MAX, &parsed) != 0) {
    return -1;
  }
  *result = (gid_t)parsed;
  return 0;
}

static void sha256_hex(const unsigned char digest[CC_SHA256_DIGEST_LENGTH],
                       char output[CC_SHA256_HEX_BYTES + 1]) {
  static const char alphabet[] = "0123456789abcdef";
  size_t index;
  for (index = 0; index < CC_SHA256_DIGEST_LENGTH; index += 1) {
    output[index * 2] = alphabet[(digest[index] >> 4) & 0xf];
    output[index * 2 + 1] = alphabet[digest[index] & 0xf];
  }
  output[CC_SHA256_HEX_BYTES] = '\0';
}

static int same_file_stat(const struct stat *left, const struct stat *right) {
  return left->st_dev == right->st_dev && left->st_ino == right->st_ino &&
         left->st_mode == right->st_mode && left->st_nlink == right->st_nlink &&
         left->st_uid == right->st_uid && left->st_gid == right->st_gid &&
         left->st_size == right->st_size &&
         left->st_mtimespec.tv_sec == right->st_mtimespec.tv_sec &&
         left->st_mtimespec.tv_nsec == right->st_mtimespec.tv_nsec &&
         left->st_ctimespec.tv_sec == right->st_ctimespec.tv_sec &&
         left->st_ctimespec.tv_nsec == right->st_ctimespec.tv_nsec;
}

static int same_snapshot_identity(const struct stat *left,
                                  const struct stat *right) {
  return left->st_dev == right->st_dev && left->st_ino == right->st_ino &&
         left->st_mode == right->st_mode && left->st_uid == right->st_uid &&
         left->st_gid == right->st_gid && left->st_size == right->st_size &&
         left->st_mtimespec.tv_sec == right->st_mtimespec.tv_sec &&
         left->st_mtimespec.tv_nsec == right->st_mtimespec.tv_nsec;
}

static int hash_open_file(int fd, off_t expected_bytes,
                          char output[CC_SHA256_HEX_BYTES + 1],
                          struct stat *stable_stat) {
  unsigned char *buffer = NULL;
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256_CTX context;
  struct stat before;
  struct stat after;
  off_t offset = 0;
  int result = -1;

  if (fstat(fd, &before) != 0 || !S_ISREG(before.st_mode) ||
      before.st_size != expected_bytes || expected_bytes < 0) {
    return -1;
  }
  buffer = (unsigned char *)malloc(CC_COPY_CHUNK_BYTES);
  if (buffer == NULL || CC_SHA256_Init(&context) != 1) {
    goto done;
  }
  while (offset < expected_bytes) {
    size_t requested = (size_t)((expected_bytes - offset) > CC_COPY_CHUNK_BYTES
                                    ? CC_COPY_CHUNK_BYTES
                                    : (expected_bytes - offset));
    ssize_t count = pread(fd, buffer, requested, offset);
    if (count < 0 && errno == EINTR) {
      continue;
    }
    if (count <= 0 || CC_SHA256_Update(&context, buffer, (CC_LONG)count) != 1) {
      goto done;
    }
    offset += count;
  }
  if (CC_SHA256_Final(digest, &context) != 1 || fstat(fd, &after) != 0 ||
      !same_file_stat(&before, &after)) {
    goto done;
  }
  sha256_hex(digest, output);
  if (stable_stat != NULL) {
    *stable_stat = after;
  }
  result = 0;

done:
  free(buffer);
  return result;
}

static int hash_bytes(const char *bytes, size_t length,
                      char output[CC_SHA256_HEX_BYTES + 1]) {
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  if (CC_SHA256(bytes, (CC_LONG)length, digest) == NULL) {
    return -1;
  }
  sha256_hex(digest, output);
  return 0;
}

static int canonical_fixed_path(const char *path, char resolved[PATH_MAX]) {
  char *result = realpath(path, resolved);
  return result != NULL && strcmp(path, resolved) == 0 ? 0 : -1;
}

static int root_owned_directory(const char *path, mode_t exact_mode) {
  struct stat value;
  char resolved[PATH_MAX];
  if (lstat(path, &value) != 0 || !S_ISDIR(value.st_mode) ||
      S_ISLNK(value.st_mode) || value.st_uid != 0 || value.st_gid != 0 ||
      (value.st_mode & 07777) != exact_mode ||
      canonical_fixed_path(path, resolved) != 0) {
    return -1;
  }
  return 0;
}

static int validate_fixed_installation(void) {
  struct stat helper;
  struct stat sandbox;
  char resolved[PATH_MAX];
  if (root_owned_directory("/Library", 0755) != 0 ||
      root_owned_directory("/Library/PrivilegedHelperTools", 0755) != 0 ||
      lstat(CC_HELPER_INSTALL_PATH, &helper) != 0 ||
      !S_ISREG(helper.st_mode) || S_ISLNK(helper.st_mode) ||
      helper.st_uid != 0 || helper.st_gid != 0 ||
      (helper.st_mode & 07777) != 04555 || helper.st_nlink != 1 ||
      canonical_fixed_path(CC_HELPER_INSTALL_PATH, resolved) != 0 ||
      lstat(CC_SANDBOX_EXECUTABLE, &sandbox) != 0 ||
      !S_ISREG(sandbox.st_mode) || S_ISLNK(sandbox.st_mode) ||
      sandbox.st_uid != 0 || sandbox.st_gid != 0 ||
      (sandbox.st_mode & 0022) != 0 ||
      canonical_fixed_path(CC_SANDBOX_EXECUTABLE, resolved) != 0) {
    return -1;
  }
  return 0;
}

static int install_snapshot_lock(void) {
  struct stat root_before;
  struct stat root_after;
  struct stat lock;
  int root_fd = -1;
  int lock_fd = -1;
  int created = 0;
  int created_identity = 0;
  int result = CC_EXIT_SECURITY;

  /* Only the package installer, already running as real root, may create the
   * fixed lock. A setuid invocation by a non-root caller has no install-side
   * effect. Existing trusted locks are opened and verified, never replaced. */
  if (getuid() != 0 || geteuid() != 0 || getgid() != 0 || getegid() != 0) {
    return CC_EXIT_SECURITY;
  }
  closefrom(3);
  if (root_owned_directory("/Library", 0755) != 0 ||
      root_owned_directory("/Library/Application Support", 0755) != 0 ||
      root_owned_directory("/Library/Application Support/ChainlessChain", 0755) != 0 ||
      root_owned_directory("/Library/Application Support/ChainlessChain/McpLauncher", 0755) != 0 ||
      root_owned_directory(CC_SNAPSHOT_ROOT, 0711) != 0) {
    return CC_EXIT_SECURITY;
  }
  root_fd = open(CC_SNAPSHOT_ROOT,
                 O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (root_fd < 0 || fstat(root_fd, &root_before) != 0 ||
      !S_ISDIR(root_before.st_mode) || root_before.st_uid != 0 ||
      root_before.st_gid != 0 || (root_before.st_mode & 07777) != 0711) {
    goto done;
  }
  lock_fd = openat(root_fd, CC_SNAPSHOT_LOCK_NAME,
                   O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (lock_fd >= 0) {
    created = 1;
    if (fstat(lock_fd, &lock) != 0) {
      goto done;
    }
    created_identity = 1;
    if (fchown(lock_fd, 0, 0) != 0 || fchmod(lock_fd, 0600) != 0 ||
        fsync(lock_fd) != 0 || fsync(root_fd) != 0) {
      goto done;
    }
  } else {
    if (errno != EEXIST) {
      goto done;
    }
    lock_fd = openat(root_fd, CC_SNAPSHOT_LOCK_NAME,
                     O_RDWR | O_NOFOLLOW | O_CLOEXEC);
    if (lock_fd < 0) {
      goto done;
    }
  }
  if (fstat(lock_fd, &lock) != 0 || !S_ISREG(lock.st_mode) ||
      lock.st_uid != 0 || lock.st_gid != 0 ||
      (lock.st_mode & 07777) != 0600 || lock.st_nlink != 1 ||
      fstat(root_fd, &root_after) != 0 ||
      root_before.st_dev != root_after.st_dev ||
      root_before.st_ino != root_after.st_ino) {
    goto done;
  }
  result = 0;

done:
  if (result != 0 && created && created_identity && lock_fd >= 0) {
    struct stat path_lock;
    if (fstatat(root_fd, CC_SNAPSHOT_LOCK_NAME, &path_lock,
                AT_SYMLINK_NOFOLLOW) == 0 &&
        path_lock.st_dev == lock.st_dev && path_lock.st_ino == lock.st_ino) {
      (void)unlinkat(root_fd, CC_SNAPSHOT_LOCK_NAME, 0);
      (void)fsync(root_fd);
    }
  }
  if (lock_fd >= 0) close(lock_fd);
  if (root_fd >= 0) close(root_fd);
  return result;
}

static int validate_snapshot_root(int *root_fd, int *lock_fd) {
  struct stat root;
  struct stat lock;
  int opened_root = -1;
  int opened_lock = -1;
  char resolved[PATH_MAX];

  if (root_owned_directory("/Library/Application Support", 0755) != 0 ||
      root_owned_directory("/Library/Application Support/ChainlessChain", 0755) != 0 ||
      root_owned_directory("/Library/Application Support/ChainlessChain/McpLauncher", 0755) != 0 ||
      root_owned_directory(CC_SNAPSHOT_ROOT, 0711) != 0 ||
      canonical_fixed_path(CC_SNAPSHOT_ROOT, resolved) != 0) {
    return -1;
  }
  opened_root = open(CC_SNAPSHOT_ROOT, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (opened_root < 0 || fstat(opened_root, &root) != 0 ||
      !S_ISDIR(root.st_mode) || root.st_uid != 0 || root.st_gid != 0 ||
      (root.st_mode & 07777) != 0711) {
    goto failure;
  }
  opened_lock = openat(opened_root, CC_SNAPSHOT_LOCK_NAME,
                       O_RDWR | O_NOFOLLOW | O_CLOEXEC);
  if (opened_lock < 0 || fstat(opened_lock, &lock) != 0 ||
      !S_ISREG(lock.st_mode) || lock.st_uid != 0 || lock.st_gid != 0 ||
      (lock.st_mode & 07777) != 0600 || lock.st_nlink != 1 ||
      flock(opened_lock, LOCK_EX | LOCK_NB) != 0) {
    goto failure;
  }
  *root_fd = opened_root;
  *lock_fd = opened_lock;
  return 0;

failure:
  if (opened_lock >= 0) {
    close(opened_lock);
  }
  if (opened_root >= 0) {
    close(opened_root);
  }
  return -1;
}

static int secure_snapshot_entry(int directory_fd, const char *name,
                                 mode_t final_mode, mode_t partial_mode,
                                 int strict, int *present) {
  struct stat value;
  mode_t mode;
  if (fstatat(directory_fd, name, &value, AT_SYMLINK_NOFOLLOW) != 0) {
    if (errno == ENOENT) {
      *present = 0;
      return 0;
    }
    return -1;
  }
  *present = 1;
  mode = value.st_mode & 07777;
  if (!S_ISREG(value.st_mode) || S_ISLNK(value.st_mode) || value.st_uid != 0 ||
      value.st_gid != 0 || value.st_nlink != 1 ||
      (strict ? mode != final_mode
              : (mode != final_mode && mode != partial_mode))) {
    return -1;
  }
  return 0;
}

static int snapshot_directory_members_are_fixed(int directory_fd) {
  int scan_fd = dup(directory_fd);
  DIR *directory = NULL;
  struct dirent *entry;
  int result = -1;
  if (scan_fd < 0 || (directory = fdopendir(scan_fd)) == NULL) {
    if (scan_fd >= 0) close(scan_fd);
    return -1;
  }
  while ((entry = readdir(directory)) != NULL) {
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0 ||
        strcmp(entry->d_name, "node") == 0 ||
        strcmp(entry->d_name, "entry") == 0) {
      continue;
    }
    goto done;
  }
  result = 0;

done:
  closedir(directory);
  return result;
}

static int cleanup_snapshot_directory(int root_fd, const char *nonce,
                                      int require_runtime) {
  int directory_fd = -1;
  struct stat directory;
  int runtime_present = 0;
  int entry_present = 0;
  mode_t directory_mode;
  int result = -1;

  directory_fd = openat(root_fd, nonce,
                        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (directory_fd < 0 || fstat(directory_fd, &directory) != 0 ||
      !S_ISDIR(directory.st_mode) || directory.st_uid != 0 ||
      directory.st_gid != 0) {
    goto done;
  }
  directory_mode = directory.st_mode & 07777;
  if ((require_runtime ? directory_mode != 0711
                       : (directory_mode != 0700 && directory_mode != 0711)) ||
      snapshot_directory_members_are_fixed(directory_fd) != 0 ||
      secure_snapshot_entry(directory_fd, "node", 0555, 0500,
                            require_runtime, &runtime_present) != 0 ||
      secure_snapshot_entry(directory_fd, "entry", 0400, 0600,
                            require_runtime, &entry_present) != 0 ||
      (require_runtime && (!runtime_present || entry_present))) {
    goto done;
  }
  if (entry_present && unlinkat(directory_fd, "entry", 0) != 0) {
    goto done;
  }
  if (runtime_present && unlinkat(directory_fd, "node", 0) != 0) {
    goto done;
  }
  if (fsync(directory_fd) != 0) {
    goto done;
  }
  if (close(directory_fd) != 0) {
    directory_fd = -1;
    goto done;
  }
  directory_fd = -1;
  if (unlinkat(root_fd, nonce, AT_REMOVEDIR) != 0 || fsync(root_fd) != 0) {
    goto done;
  }
  result = 0;

done:
  if (directory_fd >= 0) {
    close(directory_fd);
  }
  return result;
}

static int cleanup_stale_snapshots(int root_fd) {
  int scan_fd = dup(root_fd);
  DIR *directory = NULL;
  struct dirent *entry;
  char names[CC_MAX_STALE_SNAPSHOTS][CC_NONCE_HEX_BYTES + 1];
  int seen = 0;
  int index;
  int result = -1;

  if (scan_fd < 0 || (directory = fdopendir(scan_fd)) == NULL) {
    if (scan_fd >= 0) {
      close(scan_fd);
    }
    return -1;
  }
  while ((entry = readdir(directory)) != NULL) {
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0 ||
        strcmp(entry->d_name, CC_SNAPSHOT_LOCK_NAME) == 0) {
      continue;
    }
    if (seen >= CC_MAX_STALE_SNAPSHOTS ||
        !is_lower_hex(entry->d_name, CC_NONCE_HEX_BYTES)) {
      goto done;
    }
    memcpy(names[seen], entry->d_name, CC_NONCE_HEX_BYTES + 1);
    seen += 1;
  }
  if (closedir(directory) != 0) {
    directory = NULL;
    return -1;
  }
  directory = NULL;
  for (index = 0; index < seen; index += 1) {
    if (cleanup_snapshot_directory(root_fd, names[index], 0) != 0) return -1;
  }
  result = fsync(root_fd) == 0 ? 0 : -1;

done:
  if (directory != NULL) closedir(directory);
  return result;
}

static int validate_caller_lifeline(void) {
  struct stat value;
  struct pollfd descriptor;
  int flags = fcntl(CC_CALLER_LIFELINE_FD, F_GETFL);
  descriptor.fd = CC_CALLER_LIFELINE_FD;
  descriptor.events = POLLIN | POLLHUP | POLLERR;
  descriptor.revents = 0;
  if (flags < 0 || (flags & O_ACCMODE) == O_WRONLY ||
      fstat(CC_CALLER_LIFELINE_FD, &value) != 0 ||
      (!S_ISFIFO(value.st_mode) && !S_ISSOCK(value.st_mode)) ||
      poll(&descriptor, 1, 0) < 0 || descriptor.revents != 0) {
    return -1;
  }
  return 0;
}

static int validate_descriptor_sources(const struct launch_request *request,
                                       struct source_evidence *evidence) {
  char digest[CC_SHA256_HEX_BYTES + 1];
  struct stat capsule_after;

  if (hash_open_file(CC_RUNTIME_FD, request->runtime_bytes, digest,
                     &evidence->runtime_stat) != 0 ||
      strcmp(digest, request->runtime_sha256) != 0 ||
      hash_open_file(CC_ENTRY_FD, request->entry_bytes, digest,
                     &evidence->entry_stat) != 0 ||
      strcmp(digest, request->entry_sha256) != 0 ||
      fstat(CC_CAPSULE_ROOT_FD, &evidence->capsule_stat) != 0 ||
      !S_ISDIR(evidence->capsule_stat.st_mode) ||
      fstat(CC_CAPSULE_ROOT_FD, &capsule_after) != 0 ||
      !same_file_stat(&evidence->capsule_stat, &capsule_after) ||
      validate_caller_lifeline() != 0) {
    return -1;
  }
  return 0;
}

static int parse_launch_request(int argc, char **argv,
                                struct launch_request *request) {
  uid_t caller_uid = getuid();
  gid_t caller_gid = getgid();
  if (argc < 11 || strcmp(argv[1], "--launch-v1") != 0 ||
      !is_lower_hex(argv[2], CC_NONCE_HEX_BYTES) ||
      strcmp(argv[3], CC_PROTOCOL_SHA256) != 0 ||
      !is_lower_hex(argv[4], CC_SHA256_HEX_BYTES) ||
      parse_off_t(argv[5], (off_t)CC_MAXIMUM_RUNTIME_BYTES,
                  &request->runtime_bytes) != 0 ||
      request->runtime_bytes <= 0 ||
      !is_lower_hex(argv[6], CC_SHA256_HEX_BYTES) ||
      parse_off_t(argv[7], (off_t)CC_MAXIMUM_ENTRY_BYTES,
                  &request->entry_bytes) != 0 ||
      parse_uid(argv[8], &request->caller_uid) != 0 ||
      parse_gid(argv[9], &request->caller_gid) != 0 ||
      request->caller_uid != caller_uid || request->caller_gid != caller_gid ||
      !is_lower_hex(argv[10], CC_SHA256_HEX_BYTES) ||
      argc - 11 > CC_MAXIMUM_PASSTHROUGH_ARGS) {
    return -1;
  }
  memcpy(request->nonce, argv[2], CC_NONCE_HEX_BYTES + 1);
  memcpy(request->runtime_sha256, argv[4], CC_SHA256_HEX_BYTES + 1);
  memcpy(request->entry_sha256, argv[6], CC_SHA256_HEX_BYTES + 1);
  memcpy(request->policy_sha256, argv[10], CC_SHA256_HEX_BYTES + 1);
  request->passthrough_argc = argc - 11;
  request->passthrough_argv = &argv[11];
  return 0;
}

static int copy_root_file_snapshot(
    int source_fd, off_t expected_bytes, const char *expected_sha256,
    const struct stat *expected_source_stat, int directory_fd,
    const char *snapshot_name, mode_t partial_mode, mode_t final_mode,
    int unlink_after_reopen, int *reader_result,
    struct stat *snapshot_result) {
  unsigned char *buffer = NULL;
  int writer_fd = -1;
  int reader_fd = -1;
  int reader_flags;
  struct stat source_before;
  struct stat source_after;
  struct stat writer_stat;
  struct stat reader_stat;
  struct stat unlinked_stat;
  char digest[CC_SHA256_HEX_BYTES + 1];
  off_t offset = 0;
  int result = -1;

  if (fstat(source_fd, &source_before) != 0 ||
      !same_file_stat(&source_before, expected_source_stat)) {
    goto done;
  }
  writer_fd = openat(directory_fd, snapshot_name,
                      O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
                      partial_mode);
  if (writer_fd < 0 || fchown(writer_fd, 0, 0) != 0 ||
      fchmod(writer_fd, partial_mode) != 0) {
    goto done;
  }
  buffer = (unsigned char *)malloc(CC_COPY_CHUNK_BYTES);
  if (buffer == NULL) {
    goto done;
  }
  while (offset < expected_bytes) {
    size_t requested = (size_t)((expected_bytes - offset) > CC_COPY_CHUNK_BYTES
                                    ? CC_COPY_CHUNK_BYTES
                                    : (expected_bytes - offset));
    ssize_t count = pread(source_fd, buffer, requested, offset);
    size_t written = 0;
    if (count < 0 && errno == EINTR) {
      continue;
    }
    if (count <= 0) {
      goto done;
    }
    while (written < (size_t)count) {
      ssize_t current = write(writer_fd, buffer + written,
                              (size_t)count - written);
      if (current < 0 && errno == EINTR) {
        continue;
      }
      if (current <= 0) {
        goto done;
      }
      written += (size_t)current;
    }
    offset += count;
  }
  if (fstat(source_fd, &source_after) != 0 ||
      !same_file_stat(&source_before, &source_after) ||
      fsync(writer_fd) != 0 || fchmod(writer_fd, final_mode) != 0 ||
      fsync(writer_fd) != 0 || fstat(writer_fd, &writer_stat) != 0 ||
      !S_ISREG(writer_stat.st_mode) || writer_stat.st_uid != 0 ||
      writer_stat.st_gid != 0 ||
      (writer_stat.st_mode & 07777) != final_mode ||
      writer_stat.st_nlink != 1 || writer_stat.st_size != expected_bytes) {
    goto done;
  }
  if (close(writer_fd) != 0) {
    writer_fd = -1;
    goto done;
  }
  writer_fd = -1;
  reader_fd = openat(directory_fd, snapshot_name,
                     O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  reader_flags = reader_fd >= 0 ? fcntl(reader_fd, F_GETFL) : -1;
  if (reader_fd < 0 || reader_flags < 0 ||
      (reader_flags & O_ACCMODE) != O_RDONLY ||
      hash_open_file(reader_fd, expected_bytes, digest, &reader_stat) != 0 ||
      strcmp(digest, expected_sha256) != 0 ||
      !same_file_stat(&writer_stat, &reader_stat) ||
      reader_stat.st_uid != 0 || reader_stat.st_gid != 0 ||
      (reader_stat.st_mode & 07777) != final_mode ||
      reader_stat.st_nlink != 1 || fsync(directory_fd) != 0) {
    goto done;
  }
  if (unlink_after_reopen) {
    if (unlinkat(directory_fd, snapshot_name, 0) != 0 ||
        fsync(directory_fd) != 0 || fstat(reader_fd, &unlinked_stat) != 0 ||
        !same_snapshot_identity(&reader_stat, &unlinked_stat) ||
        unlinked_stat.st_nlink != 0) {
      goto done;
    }
    reader_stat = unlinked_stat;
  }
  if (snapshot_result != NULL) *snapshot_result = reader_stat;
  if (reader_result != NULL) {
    *reader_result = reader_fd;
    reader_fd = -1;
  }
  result = 0;

done:
  free(buffer);
  if (reader_fd >= 0) {
    close(reader_fd);
  }
  if (writer_fd >= 0) {
    close(writer_fd);
  }
  return result;
}

static int create_root_snapshots(int root_fd,
                                 const struct launch_request *request,
                                 struct source_evidence *evidence,
                                 char snapshot_path[PATH_MAX],
                                 int *entry_snapshot_fd) {
  int directory_fd = -1;
  int entry_reader_fd = -1;
  struct stat directory_stat;
  int result = -1;

  if (mkdirat(root_fd, request->nonce, 0700) != 0) return -1;
  directory_fd = openat(root_fd, request->nonce,
                        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (directory_fd < 0 || fstat(directory_fd, &directory_stat) != 0 ||
      !S_ISDIR(directory_stat.st_mode) || directory_stat.st_uid != 0 ||
      directory_stat.st_gid != 0 ||
      (directory_stat.st_mode & 07777) != 0700 ||
      fchown(directory_fd, 0, 0) != 0 || fchmod(directory_fd, 0700) != 0 ||
      copy_root_file_snapshot(
          CC_RUNTIME_FD, request->runtime_bytes, request->runtime_sha256,
          &evidence->runtime_stat, directory_fd, "node", 0500, 0555, 0, NULL,
          NULL) != 0 ||
      copy_root_file_snapshot(
          CC_ENTRY_FD, request->entry_bytes, request->entry_sha256,
          &evidence->entry_stat, directory_fd, "entry", 0600, 0400, 1,
          &entry_reader_fd, &evidence->entry_snapshot_stat) != 0 ||
      fchmod(directory_fd, 0711) != 0 || fsync(directory_fd) != 0 ||
      fsync(root_fd) != 0 ||
      snprintf(snapshot_path, PATH_MAX, "%s/%s/node", CC_SNAPSHOT_ROOT,
               request->nonce) >= PATH_MAX) {
    goto done;
  }
  *entry_snapshot_fd = entry_reader_fd;
  entry_reader_fd = -1;
  result = 0;

done:
  if (entry_reader_fd >= 0) close(entry_reader_fd);
  if (directory_fd >= 0) close(directory_fd);
  if (result != 0) {
    (void)cleanup_snapshot_directory(root_fd, request->nonce, 0);
  }
  return result;
}

static int safe_profile_literal(const char *source, char *output,
                                size_t capacity) {
  size_t used = 0;
  const unsigned char *cursor = (const unsigned char *)source;
  while (*cursor != '\0') {
    unsigned char value = *cursor++;
    if (value < 0x20 || value == 0x7f) {
      return -1;
    }
    if (value == '\\' || value == '"') {
      if (used + 2 >= capacity) {
        return -1;
      }
      output[used++] = '\\';
    } else if (used + 1 >= capacity) {
      return -1;
    }
    output[used++] = (char)value;
  }
  output[used] = '\0';
  return 0;
}

static int build_fixed_profile(const char *snapshot_path,
                               const char *capsule_path, char **result) {
  char escaped_snapshot[PATH_MAX * 2];
  char escaped_capsule[PATH_MAX * 2];
  char *profile = NULL;
  int length;
  static const char format[] =
      "(version 1)\n"
      "(deny default)\n"
      "(import \"system.sb\")\n"
      "(allow signal (target self))\n"
      "(allow sysctl-read)\n"
      "(allow mach-lookup)\n"
      "(deny network*)\n"
      "(deny process-fork)\n"
      "(allow process-exec (literal \"%s\"))\n"
      "(allow file-read* (literal \"%s\"))\n"
      "(allow file-read* (subpath \"/bin\"))\n"
      "(allow file-read* (subpath \"/usr/bin\"))\n"
      "(allow file-read* (subpath \"/usr/lib\"))\n"
      "(allow file-read* (subpath \"/usr/libexec\"))\n"
      "(allow file-read* (subpath \"/System/Library\"))\n"
      "(allow file-read* (subpath \"/Library/Frameworks\"))\n"
      "(allow file-read* (subpath \"/usr/local/lib\"))\n"
      "(allow file-read* file-write* (subpath \"%s\"))\n"
      "(allow file-read* file-write* (literal \"/dev/null\") "
      "(literal \"/dev/stdin\") (literal \"/dev/stdout\") "
      "(literal \"/dev/stderr\"))\n"
      "(allow file-read* (literal \"/dev/urandom\"))\n"
      "(allow file-read* (literal \"/etc/passwd\"))";

  if (safe_profile_literal(snapshot_path, escaped_snapshot,
                           sizeof(escaped_snapshot)) != 0 ||
      safe_profile_literal(capsule_path, escaped_capsule,
                           sizeof(escaped_capsule)) != 0) {
    return -1;
  }
  profile = (char *)malloc(CC_PROFILE_CAPACITY);
  if (profile == NULL) {
    return -1;
  }
  length = snprintf(profile, CC_PROFILE_CAPACITY, format, escaped_snapshot,
                    escaped_snapshot, escaped_capsule);
  if (length < 0 || length >= CC_PROFILE_CAPACITY) {
    free(profile);
    return -1;
  }
  *result = profile;
  return 0;
}

static int unsafe_environment_key(const char *entry) {
  static const char *exact[] = {
      "CLASSPATH", "DOTNET_ADDITIONAL_DEPS", "DOTNET_ROOT",
      "JAVA_TOOL_OPTIONS", "LD_AUDIT", "LD_LIBRARY_PATH", "LD_PRELOAD",
      "NODE_OPTIONS", "NODE_PATH", "NPM_CONFIG_NODE_OPTIONS", "OPENSSL_CONF",
      "OPENSSL_CONF_INCLUDE", "OPENSSL_ENGINES", "OPENSSL_MODULES",
      "PERL5LIB", "PERL5OPT",
      "PYTHONHOME", "PYTHONPATH", "RUBYLIB", "RUBYOPT", "_JAVA_OPTIONS",
      NULL};
  const char *equals = strchr(entry, '=');
  size_t key_length;
  size_t index;
  if (equals == NULL || equals == entry) {
    return 1;
  }
  key_length = (size_t)(equals - entry);
  if ((key_length >= 5 && strncasecmp(entry, "DYLD_", 5) == 0) ||
      (key_length >= 8 && strncasecmp(entry, "COMPLUS_", 8) == 0) ||
      (key_length >= 8 && strncasecmp(entry, "CORECLR_", 8) == 0)) {
    return 1;
  }
  for (index = 0; exact[index] != NULL; index += 1) {
    if (strlen(exact[index]) == key_length &&
        strncasecmp(entry, exact[index], key_length) == 0) {
      return 1;
    }
  }
  return 0;
}

static char **sanitized_environment(void) {
  size_t count = 0;
  size_t kept = 0;
  char **result;
  while (environ[count] != NULL) {
    if (count >= 4096) {
      return NULL;
    }
    count += 1;
  }
  result = (char **)calloc(count + 1, sizeof(char *));
  if (result == NULL) {
    return NULL;
  }
  for (count = 0; environ[count] != NULL; count += 1) {
    if (!unsafe_environment_key(environ[count])) {
      result[kept++] = environ[count];
    }
  }
  result[kept] = NULL;
  return result;
}

static int validate_capsule_descriptor(const struct launch_request *request,
                                       const struct source_evidence *evidence,
                                       char capsule_path[PATH_MAX]) {
  struct stat current;
  struct stat named;
  char resolved[PATH_MAX];
  if (fstat(CC_CAPSULE_ROOT_FD, &current) != 0 ||
      !same_file_stat(&current, &evidence->capsule_stat) ||
      !S_ISDIR(current.st_mode) || current.st_uid != request->caller_uid ||
      (current.st_mode & 0022) != 0 ||
      fcntl(CC_CAPSULE_ROOT_FD, F_GETPATH, capsule_path) != 0 ||
      capsule_path[0] != '/' || realpath(capsule_path, resolved) == NULL ||
      strcmp(capsule_path, resolved) != 0 || lstat(capsule_path, &named) != 0 ||
      S_ISLNK(named.st_mode) || !same_file_stat(&current, &named)) {
    return -1;
  }
  return 0;
}

static int clear_close_on_exec(int fd) {
  int flags = fcntl(fd, F_GETFD);
  return flags >= 0 && fcntl(fd, F_SETFD, flags & ~FD_CLOEXEC) == 0 ? 0 : -1;
}

static int install_fixed_pipe_fd(int source, int destination) {
  if (source != destination && dup2(source, destination) < 0) {
    return -1;
  }
  return clear_close_on_exec(destination);
}

static int install_null_placeholders(void) {
  int null_fd = open("/dev/null", O_RDONLY | O_CLOEXEC);
  if (null_fd < 0 ||
      (null_fd != CC_RUNTIME_FD && dup2(null_fd, CC_RUNTIME_FD) < 0) ||
      (null_fd != CC_CAPSULE_ROOT_FD &&
       dup2(null_fd, CC_CAPSULE_ROOT_FD) < 0) ||
      clear_close_on_exec(CC_RUNTIME_FD) != 0 ||
      clear_close_on_exec(CC_CAPSULE_ROOT_FD) != 0) {
    if (null_fd >= 0 && null_fd != CC_RUNTIME_FD &&
        null_fd != CC_CAPSULE_ROOT_FD) {
      close(null_fd);
    }
    return -1;
  }
  if (null_fd != CC_RUNTIME_FD && null_fd != CC_CAPSULE_ROOT_FD) {
    close(null_fd);
  }
  return 0;
}

static int drop_to_caller(uid_t uid, gid_t gid) {
  if (setgroups(0, NULL) != 0 || setgid(gid) != 0 || setuid(uid) != 0 ||
      getuid() != uid || geteuid() != uid || getgid() != gid ||
      getegid() != gid || getgroups(0, NULL) != 0) {
    return -1;
  }
  /* Darwin does not expose getresuid/getresgid. A privileged setuid/setgid
   * changes all three IDs; attempts to regain root additionally prove no saved
   * root credential survived. Any unexpected success is fatal in this child. */
  if (seteuid(0) == 0 || setegid(0) == 0 || getuid() != uid ||
      geteuid() != uid || getgid() != gid || getegid() != gid) {
    return -1;
  }
  return 0;
}

static int target_exec(const struct launch_request *request,
                       const struct source_evidence *evidence,
                       const char *snapshot_path, int entry_snapshot_fd,
                       int gate_read_fd, int ready_write_fd) {
  char entry_digest[CC_SHA256_HEX_BYTES + 1];
  char profile_digest[CC_SHA256_HEX_BYTES + 1];
  char capsule_path[PATH_MAX];
  char *profile = NULL;
  char **safe_env = NULL;
  char **target_argv = NULL;
  struct stat entry_stat;
  int target_argc;
  int index;

  if (setpgid(0, 0) != 0 ||
      drop_to_caller(request->caller_uid, request->caller_gid) != 0) {
    return -1;
  }
  /* No user pathname, argv payload, environment, or profile is touched before
   * the irreversible credential drop above. */
  if (hash_open_file(entry_snapshot_fd, request->entry_bytes, entry_digest,
                     &entry_stat) != 0 ||
      !same_file_stat(&entry_stat, &evidence->entry_snapshot_stat) ||
      entry_stat.st_uid != 0 || entry_stat.st_gid != 0 ||
      (entry_stat.st_mode & 07777) != 0400 || entry_stat.st_nlink != 0 ||
      strcmp(entry_digest, request->entry_sha256) != 0 ||
      validate_capsule_descriptor(request, evidence, capsule_path) != 0 ||
      fchdir(CC_CAPSULE_ROOT_FD) != 0 ||
      build_fixed_profile(snapshot_path, capsule_path, &profile) != 0 ||
      hash_bytes(profile, strlen(profile), profile_digest) != 0 ||
      strcmp(profile_digest, request->policy_sha256) != 0) {
    goto failure;
  }
  safe_env = sanitized_environment();
  if (safe_env == NULL) {
    goto failure;
  }
  target_argc = 7 + request->passthrough_argc;
  target_argv = (char **)calloc((size_t)target_argc + 1, sizeof(char *));
  if (target_argv == NULL) {
    goto failure;
  }
  target_argv[0] = (char *)CC_SANDBOX_EXECUTABLE;
  target_argv[1] = (char *)"-p";
  target_argv[2] = profile;
  target_argv[3] = (char *)snapshot_path;
  target_argv[4] = (char *)"-e";
  target_argv[5] = (char *)CC_GATE_BOOTSTRAP;
  target_argv[6] = (char *)"--";
  for (index = 0; index < request->passthrough_argc; index += 1) {
    const char *argument = request->passthrough_argv[index];
    if (argument == NULL || strlen(argument) > 65536) {
      goto failure;
    }
    target_argv[7 + index] = request->passthrough_argv[index];
  }
  target_argv[target_argc] = NULL;

  if (install_fixed_pipe_fd(entry_snapshot_fd, CC_ENTRY_FD) != 0 ||
      install_fixed_pipe_fd(gate_read_fd, CC_GATE_FD) != 0 ||
      install_fixed_pipe_fd(ready_write_fd, CC_READY_FD) != 0 ||
      clear_close_on_exec(CC_ENTRY_FD) != 0 ||
      install_null_placeholders() != 0) {
    goto failure;
  }
  if (entry_snapshot_fd != CC_ENTRY_FD) close(entry_snapshot_fd);
  if (gate_read_fd != CC_GATE_FD) close(gate_read_fd);
  if (ready_write_fd != CC_READY_FD) close(ready_write_fd);
  /* fd 3 and fd 5 are harmless /dev/null placeholders across exec so Node
   * cannot reuse those numbers before the compiled bootstrap closes them. */
  closefrom(CC_CALLER_LIFELINE_FD);
  execve(CC_SANDBOX_EXECUTABLE, target_argv, safe_env);

failure:
  free(target_argv);
  free(safe_env);
  free(profile);
  return -1;
}

static int poll_ready_or_parent(int ready_fd, int control_fd, int lifeline_fd,
                                pid_t target_pid) {
  struct pollfd fds[3];
  int remaining = CC_READY_TIMEOUT_MS;
  fds[0].fd = ready_fd;
  fds[0].events = POLLIN | POLLHUP | POLLERR;
  fds[1].fd = control_fd;
  fds[1].events = POLLIN | POLLHUP | POLLERR;
  fds[2].fd = lifeline_fd;
  fds[2].events = POLLIN | POLLHUP | POLLERR;
  while (remaining > 0) {
    int slice = remaining > 250 ? 250 : remaining;
    int value = poll(fds, 3, slice);
    if (value < 0 && errno == EINTR) {
      continue;
    }
    if (value < 0) {
      return -1;
    }
    remaining -= slice;
    if ((fds[2].revents & (POLLIN | POLLHUP | POLLERR | POLLNVAL)) != 0 ||
        (fds[1].revents & (POLLHUP | POLLERR | POLLNVAL)) != 0) {
      return -1;
    }
    if ((fds[1].revents & POLLIN) != 0) {
      unsigned char signal_number;
      ssize_t count = read(control_fd, &signal_number, 1);
      if (count != 1) {
        return -1;
      }
      (void)kill(-target_pid, (int)signal_number);
      return -1;
    }
    if ((fds[0].revents & POLLIN) != 0) {
      unsigned char ready;
      return read(ready_fd, &ready, 1) == 1 && ready == 'R' ? 0 : -1;
    }
    if ((fds[0].revents & (POLLHUP | POLLERR)) != 0) {
      return -1;
    }
  }
  return -1;
}

static int translate_wait_status(int status) {
  if (WIFEXITED(status)) {
    return WEXITSTATUS(status);
  }
  if (WIFSIGNALED(status)) {
    return 128 + WTERMSIG(status);
  }
  return CC_EXIT_INTERNAL;
}

static void signal_target_tree(pid_t target_pid, int signal_number) {
  if (target_pid <= 0) return;
  (void)kill(-target_pid, signal_number);
  (void)kill(target_pid, signal_number);
}

static int supervise_target(pid_t target_pid, int control_fd,
                            int lifeline_fd) {
  struct pollfd descriptors[2];
  int status;
  descriptors[0].fd = control_fd;
  descriptors[0].events = POLLIN | POLLHUP | POLLERR;
  descriptors[1].fd = lifeline_fd;
  descriptors[1].events = POLLIN | POLLHUP | POLLERR;
  for (;;) {
    pid_t waited = waitpid(target_pid, &status, WNOHANG);
    if (waited == target_pid) {
      return translate_wait_status(status);
    }
    if (waited < 0 && errno != EINTR) {
      signal_target_tree(target_pid, SIGKILL);
      return CC_EXIT_INTERNAL;
    }
    if (poll(descriptors, 2, 100) < 0 && errno != EINTR) {
      signal_target_tree(target_pid, SIGKILL);
      (void)waitpid(target_pid, &status, 0);
      return CC_EXIT_INTERNAL;
    }
    if ((descriptors[1].revents &
         (POLLIN | POLLHUP | POLLERR | POLLNVAL)) != 0 ||
        (descriptors[0].revents & (POLLHUP | POLLERR | POLLNVAL)) != 0) {
      signal_target_tree(target_pid, SIGKILL);
      (void)waitpid(target_pid, &status, 0);
      return CC_EXIT_SECURITY;
    }
    if ((descriptors[0].revents & POLLIN) != 0) {
      unsigned char signal_number;
      ssize_t count = read(control_fd, &signal_number, 1);
      if (count != 1) {
        signal_target_tree(target_pid, SIGKILL);
      } else {
        signal_target_tree(target_pid, (int)signal_number);
      }
    }
    descriptors[0].revents = 0;
    descriptors[1].revents = 0;
  }
}

static int abort_channels_quiet(int control_fd, int lifeline_fd) {
  struct pollfd descriptors[2];
  descriptors[0].fd = control_fd;
  descriptors[0].events = POLLIN | POLLHUP | POLLERR;
  descriptors[0].revents = 0;
  descriptors[1].fd = lifeline_fd;
  descriptors[1].events = POLLIN | POLLHUP | POLLERR;
  descriptors[1].revents = 0;
  return poll(descriptors, 2, 0) == 0 ? 0 : -1;
}

static int watchdog_run(int root_fd, int lock_fd, int control_fd,
                        int lifeline_fd, const struct launch_request *request,
                        struct source_evidence *evidence) {
  char snapshot_path[PATH_MAX];
  int entry_snapshot_fd = -1;
  int gate_pipe[2] = {-1, -1};
  int ready_pipe[2] = {-1, -1};
  pid_t target_pid = -1;
  int status = CC_EXIT_SECURITY;
  int target_status;

  (void)lock_fd;
  if (setgid(0) != 0 || setuid(0) != 0 || getuid() != 0 || geteuid() != 0 ||
      getgid() != 0 || getegid() != 0 || cleanup_stale_snapshots(root_fd) != 0 ||
      abort_channels_quiet(control_fd, lifeline_fd) != 0 ||
      create_root_snapshots(root_fd, request, evidence, snapshot_path,
                            &entry_snapshot_fd) != 0 ||
      abort_channels_quiet(control_fd, lifeline_fd) != 0 ||
      pipe(gate_pipe) != 0 || pipe(ready_pipe) != 0) {
    goto done;
  }
  close(CC_RUNTIME_FD);
  close(CC_ENTRY_FD);
  target_pid = fork();
  if (target_pid < 0) {
    goto done;
  }
  if (target_pid == 0) {
    close(gate_pipe[1]);
    close(ready_pipe[0]);
    close(control_fd);
    close(lifeline_fd);
    close(root_fd);
    close(lock_fd);
    if (target_exec(request, evidence, snapshot_path, entry_snapshot_fd,
                    gate_pipe[0], ready_pipe[1]) != 0) {
      _exit(CC_EXIT_SECURITY);
    }
    _exit(CC_EXIT_INTERNAL);
  }
  (void)setpgid(target_pid, target_pid);
  close(CC_CAPSULE_ROOT_FD);
  close(entry_snapshot_fd);
  entry_snapshot_fd = -1;
  close(gate_pipe[0]);
  gate_pipe[0] = -1;
  close(ready_pipe[1]);
  ready_pipe[1] = -1;
  if (poll_ready_or_parent(ready_pipe[0], control_fd, lifeline_fd,
                           target_pid) != 0) {
    goto kill_target;
  }
  close(ready_pipe[0]);
  ready_pipe[0] = -1;

  /* READY can only be emitted by the exact compiled Node bootstrap. Keep the
   * entry blocked until the protected runtime pathname is gone durably. */
  if (cleanup_snapshot_directory(root_fd, request->nonce, 1) != 0 ||
      write(gate_pipe[1], "G", 1) != 1) {
    goto kill_target;
  }
  close(gate_pipe[1]);
  gate_pipe[1] = -1;
  status = supervise_target(target_pid, control_fd, lifeline_fd);
  target_pid = -1;
  goto done;

kill_target:
  if (gate_pipe[1] >= 0) {
    close(gate_pipe[1]);
    gate_pipe[1] = -1;
  }
  signal_target_tree(target_pid, SIGKILL);
  (void)waitpid(target_pid, &target_status, 0);
  target_pid = -1;
  status = CC_EXIT_SECURITY;

done:
  if (target_pid > 0) {
    signal_target_tree(target_pid, SIGKILL);
    (void)waitpid(target_pid, &target_status, 0);
  }
  if (gate_pipe[0] >= 0) close(gate_pipe[0]);
  if (gate_pipe[1] >= 0) close(gate_pipe[1]);
  if (ready_pipe[0] >= 0) close(ready_pipe[0]);
  if (ready_pipe[1] >= 0) close(ready_pipe[1]);
  if (entry_snapshot_fd >= 0) close(entry_snapshot_fd);
  /* Exact cleanup is safe even when creation failed before the directory
   * existed. A cleanup failure never releases entry bytes. */
  (void)cleanup_snapshot_directory(root_fd, request->nonce, 0);
  return status;
}

static int probe(const char *nonce) {
  char self_digest[CC_SHA256_HEX_BYTES + 1];
  struct stat self_stat;
  int self_fd = -1;
  int root_fd = -1;
  int lock_fd = -1;
  if (!is_lower_hex(nonce, CC_NONCE_HEX_BYTES) || geteuid() != 0 ||
      validate_fixed_installation() != 0 ||
      validate_snapshot_root(&root_fd, &lock_fd) != 0) {
    return CC_EXIT_SECURITY;
  }
  self_fd = open(CC_HELPER_INSTALL_PATH, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (self_fd < 0 || fstat(self_fd, &self_stat) != 0 ||
      hash_open_file(self_fd, self_stat.st_size, self_digest, NULL) != 0) {
    if (self_fd >= 0) close(self_fd);
    close(root_fd);
    close(lock_fd);
    return CC_EXIT_SECURITY;
  }
  close(self_fd);
  close(root_fd);
  close(lock_fd);
  printf("{\"schema\":\"chainlesschain.macos-mcp-launcher-probe.v1\","
         "\"nonce\":\"%s\",\"protocolVersion\":%d,"
         "\"protocolSha256\":\"%s\",\"sourceSha256\":\"%s\","
         "\"gateBootstrapSha256\":\"%s\",\"selfSha256\":\"%s\","
         "\"realUid\":%u,\"effectiveUid\":%u,\"realGid\":%u,"
         "\"effectiveGid\":%u,\"installedMode\":\"4555\","
         "\"snapshotRootMode\":\"0711\",\"readyGate\":true,"
         "\"rootWatchdog\":true,\"staleCleanupBounded\":true,"
         "\"maximumStaleSnapshots\":%d,\"globalLaunchLock\":true,"
         "\"callerLifelineFd\":%d,\"callerLifelineWatched\":true,"
          "\"signalRelayNonblocking\":true,"
          "\"relayParentCredentialsDropped\":true,"
         "\"entryRootOwnedAnonymousSnapshot\":true,"
         "\"entrySourcePrePostStat\":true,"
         "\"entryWriterClosedBeforeReadonlyReopen\":true,"
         "\"entryReadonlyIdentityRechecked\":true,"
          "\"entryUnlinkedAndDirectoryFsyncedBeforeTarget\":true,"
          "\"targetInheritedEntrySnapshotOnly\":true,"
          "\"runtimeAndCapsuleSlotsNullBeforeExec\":true,"
          "\"bootstrapClosesNullAndReadyDescriptors\":true,"
          "\"processForkExplicitlyDenied\":true}\n",
         nonce, CC_PROTOCOL_VERSION, CC_PROTOCOL_SHA256,
          CC_HELPER_SOURCE_SHA256, CC_GATE_BOOTSTRAP_SHA256, self_digest,
          (unsigned)getuid(), (unsigned)geteuid(), (unsigned)getgid(),
          (unsigned)getegid(), CC_MAX_STALE_SNAPSHOTS,
          CC_CALLER_LIFELINE_FD);
  return fflush(stdout) == 0 ? 0 : CC_EXIT_INTERNAL;
}

static int run_launch(int argc, char **argv) {
  struct launch_request request;
  struct source_evidence evidence;
  int root_fd = -1;
  int lock_fd = -1;
  int control_pipe[2] = {-1, -1};
  pid_t watchdog_pid;
  int watchdog_status;
  int control_flags;
  struct sigaction action;
  int result = CC_EXIT_SECURITY;

  (void)close(CC_GATE_FD);
  (void)close(CC_READY_FD);
  closefrom(CC_CALLER_LIFELINE_FD + 1);
  if (fcntl(CC_GATE_FD, F_GETFD) >= 0 || errno != EBADF ||
      fcntl(CC_READY_FD, F_GETFD) >= 0 || errno != EBADF) {
    return CC_EXIT_SECURITY;
  }
  memset(&request, 0, sizeof(request));
  memset(&evidence, 0, sizeof(evidence));
  if (geteuid() != 0 || getuid() == 0 || getgid() == 0 ||
      parse_launch_request(argc, argv, &request) != 0 ||
      validate_fixed_installation() != 0 ||
      validate_descriptor_sources(&request, &evidence) != 0 ||
      validate_snapshot_root(&root_fd, &lock_fd) != 0 || pipe(control_pipe) != 0) {
    goto done;
  }
  control_flags = fcntl(control_pipe[1], F_GETFL);
  if (control_flags < 0 ||
      fcntl(control_pipe[1], F_SETFL, control_flags | O_NONBLOCK) != 0) {
    goto done;
  }
  watchdog_pid = fork();
  if (watchdog_pid < 0) {
    goto done;
  }
  if (watchdog_pid == 0) {
    int watchdog_result;
    close(control_pipe[1]);
    watchdog_result =
        watchdog_run(root_fd, lock_fd, control_pipe[0],
                     CC_CALLER_LIFELINE_FD, &request, &evidence);
    close(control_pipe[0]);
    close(root_fd);
    close(lock_fd);
    _exit(watchdog_result);
  }
  close(control_pipe[0]);
  control_pipe[0] = -1;
  close(CC_RUNTIME_FD);
  close(CC_ENTRY_FD);
  close(CC_CAPSULE_ROOT_FD);
  close(CC_CALLER_LIFELINE_FD);
  close(root_fd);
  root_fd = -1;
  close(lock_fd);
  lock_fd = -1;
  if (drop_to_caller(request.caller_uid, request.caller_gid) != 0) {
    close(control_pipe[1]);
    control_pipe[1] = -1;
    (void)waitpid(watchdog_pid, &watchdog_status, 0);
    goto done;
  }
  control_write_fd = control_pipe[1];
  pending_signal = 0;
  memset(&action, 0, sizeof(action));
  action.sa_handler = relay_signal;
  sigemptyset(&action.sa_mask);
  sigaddset(&action.sa_mask, SIGINT);
  sigaddset(&action.sa_mask, SIGTERM);
  sigaddset(&action.sa_mask, SIGHUP);
  sigaddset(&action.sa_mask, SIGQUIT);
  action.sa_flags = 0;
  if (sigaction(SIGINT, &action, NULL) != 0 ||
      sigaction(SIGTERM, &action, NULL) != 0 ||
      sigaction(SIGHUP, &action, NULL) != 0 ||
      sigaction(SIGQUIT, &action, NULL) != 0) {
    close(control_pipe[1]);
    control_pipe[1] = -1;
    (void)waitpid(watchdog_pid, &watchdog_status, 0);
    goto done;
  }
  while (waitpid(watchdog_pid, &watchdog_status, 0) < 0) {
    if (errno != EINTR) {
      close(control_pipe[1]);
      control_pipe[1] = -1;
      result = CC_EXIT_INTERNAL;
      goto done;
    }
    flush_pending_signal();
  }
  result = translate_wait_status(watchdog_status);

done:
  control_write_fd = -1;
  if (control_pipe[0] >= 0) close(control_pipe[0]);
  if (control_pipe[1] >= 0) close(control_pipe[1]);
  if (root_fd >= 0) close(root_fd);
  if (lock_fd >= 0) close(lock_fd);
  return result;
}

int main(int argc, char **argv) {
  if (argc == 2 && strcmp(argv[1], "--install-lock-v1") == 0) {
    return install_snapshot_lock();
  }
  if (argc == 3 && strcmp(argv[1], "--probe-v1") == 0) {
    closefrom(3);
    return probe(argv[2]);
  }
  if (argc >= 2 && strcmp(argv[1], "--launch-v1") == 0) {
    return run_launch(argc, argv);
  }
  return CC_EXIT_USAGE;
}
