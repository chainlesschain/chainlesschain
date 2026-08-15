#define _GNU_SOURCE

#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <limits.h>
#include <sched.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <unistd.h>

#ifdef CHAINLESS_DLOPEN_PROBE
#include <dlfcn.h>
#endif

#define FD_SCAN_UPPER_BOUND 1024

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

static int count_matching_fds(uintmax_t expected_dev, uintmax_t expected_ino,
                              int *open_fds, int *regular_fds,
                              int *scan_errno) {
  int matches = 0;
  *open_fds = 0;
  *regular_fds = 0;
  *scan_errno = 0;
  for (int descriptor = 3; descriptor <= FD_SCAN_UPPER_BOUND; descriptor++) {
    struct stat descriptor_stat = {0};
    if (fstat(descriptor, &descriptor_stat) != 0) continue;
    *open_fds += 1;
    if (S_ISREG(descriptor_stat.st_mode)) *regular_fds += 1;
    if ((uintmax_t)descriptor_stat.st_dev == expected_dev &&
        (uintmax_t)descriptor_stat.st_ino == expected_ino) {
      matches += 1;
    }
  }
  return matches;
}

#ifdef CHAINLESS_DLOPEN_PROBE
typedef const char *(*chainless_dlopen_value_fn)(void);

static int dlopen_value_is(const char *path, const char *expected) {
  void *handle = dlopen(path, RTLD_NOW | RTLD_LOCAL);
  if (handle == NULL) return 0;
  dlerror();
  chainless_dlopen_value_fn value =
      (chainless_dlopen_value_fn)dlsym(handle, "chainless_dlopen_value");
  const char *symbol_error = dlerror();
  int ok = symbol_error == NULL && value != NULL &&
           strcmp(value(), expected) == 0;
  dlclose(handle);
  return ok;
}

static int dlopen_succeeds(const char *path) {
  void *handle = dlopen(path, RTLD_NOW | RTLD_LOCAL);
  if (handle == NULL) return 0;
  dlclose(handle);
  return 1;
}

static int copy_file(const char *source, const char *destination) {
  int source_fd = open(source, O_RDONLY | O_CLOEXEC);
  if (source_fd < 0) return 0;
  int destination_fd =
      open(destination, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0700);
  if (destination_fd < 0) {
    close(source_fd);
    return 0;
  }
  char buffer[16384];
  int ok = 1;
  for (;;) {
    ssize_t bytes = read(source_fd, buffer, sizeof(buffer));
    if (bytes == 0) break;
    if (bytes < 0) {
      ok = 0;
      break;
    }
    ssize_t offset = 0;
    while (offset < bytes) {
      ssize_t written = write(destination_fd, buffer + offset,
                              (size_t)(bytes - offset));
      if (written <= 0) {
        ok = 0;
        break;
      }
      offset += written;
    }
    if (!ok) break;
  }
  if (close(destination_fd) != 0) ok = 0;
  close(source_fd);
  return ok;
}

static int path_missing(const char *path, int *path_errno) {
  struct stat value = {0};
  if (lstat(path, &value) == 0) {
    *path_errno = 0;
    return 0;
  }
  *path_errno = errno;
  return errno == ENOENT;
}

static int dlopen_fd_path_succeeds(const char *library_path,
                                   const char *fd_root) {
  int fd = open(library_path, O_RDONLY | O_CLOEXEC);
  if (fd < 0) return 0;
  char path[128];
  int formatted = snprintf(path, sizeof(path), "%s/%d", fd_root, fd);
  int result =
      formatted > 0 && (size_t)formatted < sizeof(path) && dlopen_succeeds(path);
  close(fd);
  return result;
}

static int recvmsg_errno(void) {
  char byte = 0;
  struct iovec iov = {.iov_base = &byte, .iov_len = sizeof(byte)};
  struct msghdr message = {0};
  message.msg_iov = &iov;
  message.msg_iovlen = 1;
  errno = 0;
  ssize_t result = recvmsg(STDIN_FILENO, &message, MSG_DONTWAIT);
  return result < 0 ? errno : 0;
}

static int recvmmsg_errno(void) {
  char byte = 0;
  struct iovec iov = {.iov_base = &byte, .iov_len = sizeof(byte)};
  struct mmsghdr messages[1] = {0};
  messages[0].msg_hdr.msg_iov = &iov;
  messages[0].msg_hdr.msg_iovlen = 1;
  errno = 0;
  int result = recvmmsg(STDIN_FILENO, messages, 1, MSG_DONTWAIT, NULL);
  return result < 0 ? errno : 0;
}

static void scan_pidfd_regular_fds(int *pidfd_opened, int *duplicated_fds,
                                   int *regular_fds, int *pidfd_errno) {
  *pidfd_opened = 0;
  *duplicated_fds = 0;
  *regular_fds = 0;
  *pidfd_errno = ENOSYS;
#if defined(SYS_pidfd_open) && defined(SYS_pidfd_getfd)
  int pidfd = (int)syscall(SYS_pidfd_open, getppid(), 0);
  if (pidfd < 0) {
    *pidfd_errno = errno;
    return;
  }
  *pidfd_opened = 1;
  for (int target_fd = 3; target_fd <= FD_SCAN_UPPER_BOUND; target_fd++) {
    int duplicate = (int)syscall(SYS_pidfd_getfd, pidfd, target_fd, 0);
    if (duplicate < 0) {
      *pidfd_errno = errno;
      continue;
    }
    *duplicated_fds += 1;
    struct stat value = {0};
    if (fstat(duplicate, &value) == 0 && S_ISREG(value.st_mode)) {
      *regular_fds += 1;
    }
    close(duplicate);
  }
  close(pidfd);
#endif
}

static int open_by_handle_succeeds(const char *path,
                                   int *name_to_handle_succeeded,
                                   int *mount_fd_succeeded,
                                   int *handle_errno) {
  *name_to_handle_succeeded = 0;
  *mount_fd_succeeded = 0;
  const unsigned int capacity = 128;
  struct file_handle *handle =
      (struct file_handle *)calloc(1, sizeof(*handle) + capacity);
  if (handle == NULL) {
    *handle_errno = ENOMEM;
    return 0;
  }
  handle->handle_bytes = capacity;
  int mount_id = 0;
  if (name_to_handle_at(AT_FDCWD, path, handle, &mount_id, 0) != 0) {
    *handle_errno = errno;
    free(handle);
    return 0;
  }
  *name_to_handle_succeeded = 1;
  // argv[8] is itself a single-file bind mount. An O_PATH descriptor for that
  // same object therefore belongs to the handle's returned mount rather than
  // the synthetic root mount, avoiding an EXDEV-only false positive.
  int mount_fd = open(path, O_PATH | O_CLOEXEC);
  if (mount_fd < 0) {
    *handle_errno = errno;
    free(handle);
    return 0;
  }
  *mount_fd_succeeded = 1;
  int reopened = open_by_handle_at(mount_fd, handle, O_RDONLY | O_CLOEXEC);
  *handle_errno = reopened < 0 ? errno : 0;
  if (reopened >= 0) close(reopened);
  close(mount_fd);
  free(handle);
  return reopened >= 0;
}

struct chainless_clone_args {
  uint64_t flags;
  uint64_t pidfd;
  uint64_t child_tid;
  uint64_t parent_tid;
  uint64_t exit_signal;
  uint64_t stack;
  uint64_t stack_size;
  uint64_t tls;
  uint64_t set_tid;
  uint64_t set_tid_size;
  uint64_t cgroup;
};

struct namespace_probe_report {
  int probe_errno;
  int unshare_errno;
  int clone_errno;
  int clone3_errno;
  int setns_errno;
  int mount_errno;
  int umount2_errno;
  int pivot_root_errno;
  int open_tree_errno;
  int move_mount_errno;
  int fsopen_errno;
  int fsconfig_errno;
  int fsmount_errno;
  int fspick_errno;
  int mount_setattr_errno;
  int dropin_written;
  int dropin_dlopen;
};

static int syscall_result_errno(long result) {
  return result < 0 ? errno : 0;
}

static int namespace_clone_errno(void) {
#if defined(SYS_clone)
  errno = 0;
  long child = syscall(SYS_clone,
                       (unsigned long)(CLONE_NEWUSER | CLONE_NEWNS | SIGCHLD),
                       NULL, NULL, NULL, 0UL);
  if (child == 0) _exit(0);
  if (child > 0) {
    int status = 0;
    while (waitpid((pid_t)child, &status, 0) < 0 && errno == EINTR) {
    }
    return 0;
  }
  return errno;
#else
  return ENOSYS;
#endif
}

static int namespace_clone3_errno(void) {
#if defined(SYS_clone3)
  struct chainless_clone_args args = {0};
  args.flags = (uint64_t)(CLONE_NEWUSER | CLONE_NEWNS);
  args.exit_signal = SIGCHLD;
  errno = 0;
  long child = syscall(SYS_clone3, &args, sizeof(args));
  if (child == 0) _exit(0);
  if (child > 0) {
    int status = 0;
    while (waitpid((pid_t)child, &status, 0) < 0 && errno == EINTR) {
    }
    return 0;
  }
  return errno;
#else
  return ENOSYS;
#endif
}

static int fd_syscall_errno(long result) {
  int result_errno = syscall_result_errno(result);
  if (result >= 0) close((int)result);
  return result_errno;
}

static void collect_namespace_probe(const char *approved_library,
                                    struct namespace_probe_report *report) {
  memset(report, 0, sizeof(*report));
#if defined(SYS_unshare)
  errno = 0;
  report->unshare_errno = syscall_result_errno(
      syscall(SYS_unshare, CLONE_NEWUSER | CLONE_NEWNS));
#else
  report->unshare_errno = ENOSYS;
#endif
  report->clone_errno = namespace_clone_errno();
  report->clone3_errno = namespace_clone3_errno();
#if defined(SYS_setns)
  errno = 0;
  report->setns_errno =
      syscall_result_errno(syscall(SYS_setns, -1, CLONE_NEWNS));
#else
  report->setns_errno = ENOSYS;
#endif
#if defined(SYS_umount2)
  errno = 0;
  report->umount2_errno =
      syscall_result_errno(syscall(SYS_umount2, "/run", MNT_DETACH));
#else
  report->umount2_errno = ENOSYS;
#endif
#if defined(SYS_pivot_root)
  errno = 0;
  report->pivot_root_errno =
      syscall_result_errno(syscall(SYS_pivot_root, "/", "/"));
#else
  report->pivot_root_errno = ENOSYS;
#endif
#if defined(SYS_open_tree)
  errno = 0;
  report->open_tree_errno =
      fd_syscall_errno(syscall(SYS_open_tree, AT_FDCWD, "/", 1U));
#else
  report->open_tree_errno = ENOSYS;
#endif
#if defined(SYS_move_mount)
  errno = 0;
  report->move_mount_errno = syscall_result_errno(
      syscall(SYS_move_mount, -1, "", -1, "", 0U));
#else
  report->move_mount_errno = ENOSYS;
#endif
#if defined(SYS_fsopen)
  errno = 0;
  report->fsopen_errno =
      fd_syscall_errno(syscall(SYS_fsopen, "tmpfs", 1U));
#else
  report->fsopen_errno = ENOSYS;
#endif
#if defined(SYS_fsconfig)
  errno = 0;
  report->fsconfig_errno =
      syscall_result_errno(syscall(SYS_fsconfig, -1, 1U, "source", "none", 0));
#else
  report->fsconfig_errno = ENOSYS;
#endif
#if defined(SYS_fsmount)
  errno = 0;
  report->fsmount_errno =
      fd_syscall_errno(syscall(SYS_fsmount, -1, 1U, 0U));
#else
  report->fsmount_errno = ENOSYS;
#endif
#if defined(SYS_fspick)
  errno = 0;
  report->fspick_errno =
      fd_syscall_errno(syscall(SYS_fspick, AT_FDCWD, "/", 1U));
#else
  report->fspick_errno = ENOSYS;
#endif
#if defined(SYS_mount_setattr)
  errno = 0;
  report->mount_setattr_errno = syscall_result_errno(
      syscall(SYS_mount_setattr, AT_FDCWD, "/", 0U, NULL, 0U));
#else
  report->mount_setattr_errno = ENOSYS;
#endif
#if defined(SYS_mount)
  errno = 0;
  report->mount_errno = syscall_result_errno(
      syscall(SYS_mount, "tmpfs", "/run", "tmpfs", MS_NOSUID | MS_NODEV,
              "size=1048576"));
#else
  report->mount_errno = ENOSYS;
#endif
  if (report->mount_errno == 0) {
    const char *dropin = "/run/chainless-nested-namespace.so";
    report->dropin_written = copy_file(approved_library, dropin);
    report->dropin_dlopen = dlopen_succeeds(dropin);
  }
}

static struct namespace_probe_report run_namespace_probe(
    const char *approved_library) {
  struct namespace_probe_report report = {0};
  int descriptors[2] = {-1, -1};
  if (pipe(descriptors) != 0) {
    report.probe_errno = errno;
    return report;
  }
  pid_t child = fork();
  if (child < 0) {
    report.probe_errno = errno;
    close(descriptors[0]);
    close(descriptors[1]);
    return report;
  }
  if (child == 0) {
    close(descriptors[0]);
    struct namespace_probe_report child_report = {0};
    collect_namespace_probe(approved_library, &child_report);
    const unsigned char *cursor = (const unsigned char *)&child_report;
    size_t remaining = sizeof(child_report);
    while (remaining > 0) {
      ssize_t written = write(descriptors[1], cursor, remaining);
      if (written < 0 && errno == EINTR) continue;
      if (written <= 0) _exit(72);
      cursor += written;
      remaining -= (size_t)written;
    }
    close(descriptors[1]);
    _exit(0);
  }
  close(descriptors[1]);
  unsigned char *cursor = (unsigned char *)&report;
  size_t remaining = sizeof(report);
  while (remaining > 0) {
    ssize_t bytes = read(descriptors[0], cursor, remaining);
    if (bytes < 0 && errno == EINTR) continue;
    if (bytes <= 0) {
      report.probe_errno = bytes == 0 ? EPIPE : errno;
      break;
    }
    cursor += bytes;
    remaining -= (size_t)bytes;
  }
  close(descriptors[0]);
  int status = 0;
  while (waitpid(child, &status, 0) < 0 && errno == EINTR) {
  }
  if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
    report.probe_errno = ECHILD;
  }
  return report;
}

static int write_control_file(const char *path, const char *value) {
  int fd = open(path, O_WRONLY | O_CLOEXEC);
  if (fd < 0) return 0;
  size_t remaining = strlen(value);
  const char *cursor = value;
  while (remaining > 0) {
    ssize_t written = write(fd, cursor, remaining);
    if (written < 0 && errno == EINTR) continue;
    if (written <= 0) {
      close(fd);
      return 0;
    }
    cursor += written;
    remaining -= (size_t)written;
  }
  return close(fd) == 0;
}

static int nested_namespace_control(const char *approved_library) {
  uid_t caller_uid = getuid();
  gid_t caller_gid = getgid();
  if (unshare(CLONE_NEWUSER | CLONE_NEWNS) != 0) {
    int failure = errno;
    printf("{\"nestedNamespaceControlSupported\":false,"
           "\"stage\":\"unshare\",\"errno\":%d}",
           failure);
    return 0;
  }
  char mapping[128];
  int formatted = snprintf(mapping, sizeof(mapping), "0 %ju 1\n",
                           (uintmax_t)caller_uid);
  int maps_ready = formatted > 0 && (size_t)formatted < sizeof(mapping) &&
                   write_control_file("/proc/self/uid_map", mapping);
  int setgroups = open("/proc/self/setgroups", O_WRONLY | O_CLOEXEC);
  if (setgroups >= 0) {
    const char deny[] = "deny";
    maps_ready = maps_ready &&
                 write(setgroups, deny, sizeof(deny) - 1) ==
                     (ssize_t)(sizeof(deny) - 1);
    close(setgroups);
  }
  formatted = snprintf(mapping, sizeof(mapping), "0 %ju 1\n",
                       (uintmax_t)caller_gid);
  maps_ready = maps_ready && formatted > 0 &&
               (size_t)formatted < sizeof(mapping) &&
               write_control_file("/proc/self/gid_map", mapping);
  if (!maps_ready || setresgid(0, 0, 0) != 0 || setresuid(0, 0, 0) != 0) {
    int failure = errno;
    printf("{\"nestedNamespaceControlSupported\":false,"
           "\"stage\":\"id-map\",\"errno\":%d}",
           failure);
    return 0;
  }
  // Create the host-visible mountpoint only after the caller identity is
  // mapped. If host policy allows userns creation but rejects uid/gid maps,
  // the unsupported positive control therefore cannot leave a sticky-/tmp
  // directory owned by an unmapped credential.
  char directory[] = "/tmp/chainless-nested-control-XXXXXX";
  if (mkdtemp(directory) == NULL) {
    printf("{\"nestedNamespaceControlSupported\":false,"
           "\"stage\":\"mkdtemp\",\"errno\":%d}",
           errno);
    return 0;
  }
  if (mount("tmpfs", directory, "tmpfs", MS_NOSUID | MS_NODEV,
            "size=1048576") != 0) {
    int failure = errno;
    rmdir(directory);
    printf("{\"nestedNamespaceControlSupported\":false,"
           "\"stage\":\"mount\",\"errno\":%d}",
           failure);
    return 0;
  }
  char dropin[PATH_MAX];
  formatted = snprintf(dropin, sizeof(dropin), "%s/evil.so", directory);
  int written = formatted > 0 && (size_t)formatted < sizeof(dropin) &&
                copy_file(approved_library, dropin);
  int loaded = written && dlopen_value_is(dropin, "approved-original");
  umount2(directory, MNT_DETACH);
  rmdir(directory);
  printf("{\"nestedNamespaceControlSupported\":true,"
         "\"stage\":\"complete\",\"errno\":0,"
         "\"dropinWritten\":%s,\"dropinDlopen\":%s}",
         written ? "true" : "false", loaded ? "true" : "false");
  return 0;
}
#endif

int main(int argc, char **argv) {
#ifdef CHAINLESS_DLOPEN_PROBE
  if (argc == 3 && strcmp(argv[1], "--nested-namespace-control") == 0) {
    return nested_namespace_control(argv[2]);
  }
  if (argc != 11) return 64;
#else
  if (argc != 8) return 64;
#endif

  char *expected_dev_end = NULL;
  char *expected_ino_end = NULL;
  errno = 0;
  uintmax_t expected_dev = strtoumax(argv[6], &expected_dev_end, 10);
  if (errno != 0 || expected_dev_end == argv[6] ||
      *expected_dev_end != '\0') {
    return 64;
  }
  errno = 0;
  uintmax_t expected_ino = strtoumax(argv[7], &expected_ino_end, 10);
  if (errno != 0 || expected_ino_end == argv[7] ||
      *expected_ino_end != '\0') {
    return 64;
  }

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

#ifdef CHAINLESS_DLOPEN_PROBE
  const char *tmp_dropin = "/tmp/chainless-unapproved.so";
  const char *var_tmp_dropin = "/var/tmp/chainless-unapproved.so";
  const char *run_dropin = "/run/chainless-unapproved.so";
  const char *home_dropin = "/home/sandbox/chainless-unapproved.so";
  const char *home_plugin_dropin =
      "/home/sandbox/plugin/chainless-unapproved.so";
  const char *plugin_dropin =
      "/opt/chainless/plugin/chainless-unapproved.so";
  int approved_dlopen_original =
      dlopen_value_is(argv[8], "approved-original");
  int host_same_soname_dlopen = dlopen_succeeds(argv[9]);
  int host_different_soname_dlopen = dlopen_succeeds(argv[10]);
  int tmp_dropin_written = copy_file(argv[8], tmp_dropin);
  int var_tmp_dropin_written = copy_file(argv[8], var_tmp_dropin);
  int run_dropin_written = copy_file(argv[8], run_dropin);
  int home_dropin_written = copy_file(argv[8], home_dropin);
  int home_plugin_directory_writable =
      mkdir("/home/sandbox/plugin", 0700) == 0;
  int home_plugin_dropin_written = copy_file(argv[8], home_plugin_dropin);
  int plugin_dropin_written = copy_file(argv[8], plugin_dropin);
  int tmp_dropin_dlopen = dlopen_succeeds(tmp_dropin);
  int var_tmp_dropin_dlopen = dlopen_succeeds(var_tmp_dropin);
  int run_dropin_dlopen = dlopen_succeeds(run_dropin);
  int home_dropin_dlopen = dlopen_succeeds(home_dropin);
  int home_plugin_dropin_dlopen = dlopen_succeeds(home_plugin_dropin);
  int plugin_dropin_dlopen = dlopen_succeeds(plugin_dropin);
  int proc_fd_path_errno = 0;
  int dev_fd_path_errno = 0;
  int proc_fd_path_missing =
      path_missing("/proc/self/fd", &proc_fd_path_errno);
  int dev_fd_path_missing = path_missing("/dev/fd", &dev_fd_path_errno);
  int proc_fd_dlopen = dlopen_fd_path_succeeds(argv[8], "/proc/self/fd");
  int dev_fd_dlopen = dlopen_fd_path_succeeds(argv[8], "/dev/fd");
  int unix_socket_pair[2] = {-1, -1};
  int unix_socketpair_created =
      socketpair(AF_UNIX, SOCK_STREAM, 0, unix_socket_pair) == 0;
  int unix_socketpair_errno = unix_socketpair_created ? 0 : errno;
  if (unix_socket_pair[0] >= 0) close(unix_socket_pair[0]);
  if (unix_socket_pair[1] >= 0) close(unix_socket_pair[1]);
  int recvmsg_block_errno = recvmsg_errno();
  int recvmmsg_block_errno = recvmmsg_errno();
  int pidfd_opened = 0;
  int pidfd_duplicated_fds = 0;
  int pidfd_regular_fds = 0;
  int pidfd_errno = 0;
  scan_pidfd_regular_fds(&pidfd_opened, &pidfd_duplicated_fds,
                         &pidfd_regular_fds, &pidfd_errno);
  int open_by_handle_errno = 0;
  int name_to_handle_succeeded = 0;
  int open_by_handle_mount_fd_succeeded = 0;
  int open_by_handle_succeeded =
      open_by_handle_succeeds(argv[8], &name_to_handle_succeeded,
                              &open_by_handle_mount_fd_succeeded,
                              &open_by_handle_errno);
  struct namespace_probe_report namespace_probe =
      run_namespace_probe(argv[8]);
#endif

  int supervisor_fd_scan_errno = 0;
  int non_stdio_open_fds = 0;
  int non_stdio_regular_fds = 0;
  int supervisor_fd_matches =
      count_matching_fds(expected_dev, expected_ino, &non_stdio_open_fds,
                         &non_stdio_regular_fds, &supervisor_fd_scan_errno);
  struct stat supervisor_staging_stat = {0};
  int supervisor_staging_visible =
      lstat("/run/.chainless-bwrap-supervisor", &supervisor_staging_stat) == 0;
  int supervisor_staging_errno = supervisor_staging_visible ? 0 : errno;
  struct stat pid1_executable_stat = {0};
  int pid1_executable_stat_ok =
      stat("/proc/1/exe", &pid1_executable_stat) == 0;
  int pid1_executable_errno = pid1_executable_stat_ok ? 0 : errno;
  int pid1_executable_matches =
      pid1_executable_stat_ok &&
      (uintmax_t)pid1_executable_stat.st_dev == expected_dev &&
      (uintmax_t)pid1_executable_stat.st_ino == expected_ino;

  if (!getcwd(cwd, sizeof(cwd))) strcpy(cwd, "unavailable");
  printf(
      "{\"allowedReadable\":%s,\"allowed\":\"%s\",\"cwd\":\"%s\","
      "\"chainlessSandboxed\":%s,\"sensitiveEnv\":%s,\"ldLibraryPath\":%s,"
      "\"entryMode\":\"%04o\",\"entryWritable\":%s,"
      "\"entryChmodWritable\":%s,"
      "\"secretReadable\":%s,\"hostRootReadable\":%s,\"pluginWritable\":%s,"
      "\"hostWritable\":%s,\"tmpWritable\":%s,\"networkErrno\":%d,"
      "\"supervisorFdScanOk\":%s,\"supervisorFdMatches\":%d,"
      "\"supervisorFdScanErrno\":%d,"
      "\"nonStdioOpenFds\":%d,\"nonStdioRegularFds\":%d,"
      "\"fdScanUpperBound\":%d,"
      "\"supervisorStagingPathVisible\":%s,"
      "\"supervisorStagingPathErrno\":%d,"
      "\"pid1ExecutableStatOk\":%s,"
      "\"pid1ExecutableMatchesSupervisor\":%s,"
      "\"pid1ExecutableErrno\":%d",
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
      network_errno, supervisor_fd_matches >= 0 ? "true" : "false",
      supervisor_fd_matches, supervisor_fd_scan_errno,
      non_stdio_open_fds, non_stdio_regular_fds, FD_SCAN_UPPER_BOUND,
      supervisor_staging_visible ? "true" : "false",
      supervisor_staging_errno, pid1_executable_stat_ok ? "true" : "false",
      pid1_executable_matches ? "true" : "false", pid1_executable_errno);
#ifdef CHAINLESS_DLOPEN_PROBE
  printf(
      ",\"approvedDlopenOriginal\":%s,"
      "\"hostSameSonameDlopen\":%s,\"hostDifferentSonameDlopen\":%s,"
      "\"tmpDropinWritten\":%s,\"tmpDropinDlopen\":%s,"
      "\"varTmpDropinWritten\":%s,\"varTmpDropinDlopen\":%s,"
      "\"runDropinWritten\":%s,\"runDropinDlopen\":%s,"
      "\"homeDropinWritten\":%s,\"homeDropinDlopen\":%s,"
      "\"homePluginDirectoryWritable\":%s,"
      "\"homePluginDropinWritten\":%s,\"homePluginDropinDlopen\":%s,"
      "\"pluginDropinWritten\":%s,\"pluginDropinDlopen\":%s,"
      "\"procFdPathMissing\":%s,\"procFdPathErrno\":%d,"
      "\"devFdPathMissing\":%s,\"devFdPathErrno\":%d,"
      "\"procFdDlopen\":%s,\"devFdDlopen\":%s,"
      "\"unixSocketpairCreated\":%s,\"unixSocketpairErrno\":%d,"
      "\"recvmsgErrno\":%d,\"recvmmsgErrno\":%d,"
      "\"pidfdOpened\":%s,\"pidfdDuplicatedFds\":%d,"
      "\"pidfdRegularFds\":%d,\"pidfdErrno\":%d,"
      "\"nameToHandleSucceeded\":%s,"
      "\"openByHandleMountFdSucceeded\":%s,"
      "\"openByHandleSucceeded\":%s,\"openByHandleErrno\":%d,"
      "\"namespaceProbeErrno\":%d,\"unshareErrno\":%d,"
      "\"namespaceCloneErrno\":%d,\"clone3Errno\":%d,"
      "\"setnsErrno\":%d,\"mountErrno\":%d,\"umount2Errno\":%d,"
      "\"pivotRootErrno\":%d,\"openTreeErrno\":%d,"
      "\"moveMountErrno\":%d,\"fsopenErrno\":%d,"
      "\"fsconfigErrno\":%d,\"fsmountErrno\":%d,"
      "\"fspickErrno\":%d,\"mountSetattrErrno\":%d,"
      "\"nestedNamespaceDropinWritten\":%s,"
      "\"nestedNamespaceDropinDlopen\":%s",
      approved_dlopen_original ? "true" : "false",
      host_same_soname_dlopen ? "true" : "false",
      host_different_soname_dlopen ? "true" : "false",
      tmp_dropin_written ? "true" : "false",
      tmp_dropin_dlopen ? "true" : "false",
      var_tmp_dropin_written ? "true" : "false",
      var_tmp_dropin_dlopen ? "true" : "false",
      run_dropin_written ? "true" : "false",
      run_dropin_dlopen ? "true" : "false",
      home_dropin_written ? "true" : "false",
      home_dropin_dlopen ? "true" : "false",
      home_plugin_directory_writable ? "true" : "false",
      home_plugin_dropin_written ? "true" : "false",
      home_plugin_dropin_dlopen ? "true" : "false",
      plugin_dropin_written ? "true" : "false",
      plugin_dropin_dlopen ? "true" : "false",
      proc_fd_path_missing ? "true" : "false", proc_fd_path_errno,
      dev_fd_path_missing ? "true" : "false", dev_fd_path_errno,
      proc_fd_dlopen ? "true" : "false",
      dev_fd_dlopen ? "true" : "false",
      unix_socketpair_created ? "true" : "false", unix_socketpair_errno,
      recvmsg_block_errno, recvmmsg_block_errno,
      pidfd_opened ? "true" : "false", pidfd_duplicated_fds,
      pidfd_regular_fds, pidfd_errno,
      name_to_handle_succeeded ? "true" : "false",
      open_by_handle_mount_fd_succeeded ? "true" : "false",
      open_by_handle_succeeded ? "true" : "false", open_by_handle_errno,
      namespace_probe.probe_errno, namespace_probe.unshare_errno,
      namespace_probe.clone_errno, namespace_probe.clone3_errno,
      namespace_probe.setns_errno, namespace_probe.mount_errno,
      namespace_probe.umount2_errno, namespace_probe.pivot_root_errno,
      namespace_probe.open_tree_errno, namespace_probe.move_mount_errno,
      namespace_probe.fsopen_errno, namespace_probe.fsconfig_errno,
      namespace_probe.fsmount_errno, namespace_probe.fspick_errno,
      namespace_probe.mount_setattr_errno,
      namespace_probe.dropin_written ? "true" : "false",
      namespace_probe.dropin_dlopen ? "true" : "false");
#endif
  printf("}");
  return 0;
}
