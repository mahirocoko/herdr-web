/* Private selected-process native rollout descriptor authority. Only paths under
 * the server-owned Codex root and native rollout filename grammar are returned.
 * No argv/environment or unrelated descriptor metadata leaves this helper.
 */
#include <libproc.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#define MAX_FDS 4096
#define MAX_MATCHES 64
static void wipe(void *p, size_t n) { volatile unsigned char *b = p; while (n--) *b++ = 0; }
static int identity(pid_t pid, struct proc_bsdinfo *info, char *exe) {
  memset(info, 0, sizeof(*info)); memset(exe, 0, PROC_PIDPATHINFO_MAXSIZE);
  return proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, info, sizeof(*info)) == sizeof(*info)
    && info->pbi_uid == geteuid() && info->pbi_ruid == getuid()
    && proc_pidpath(pid, exe, PROC_PIDPATHINFO_MAXSIZE) > 0;
}
static int native(const char *file, const char *root, int family) {
  size_t prefix = strlen(root), size = strnlen(file, MAXPATHLEN);
  if (size == MAXPATHLEN || size <= prefix || strncmp(file, root, prefix) || file[prefix] != '/') return 0;
  if (family) {
    if (size < 6 || strcmp(file + size - 6, ".jsonl")) return 0;
    for (const unsigned char *p = (const unsigned char *)file; *p; p++) if (*p < 0x20 || *p == 0x7f) return 0;
    return 1;
  }
  if (strncmp(file + prefix, "/sessions/", 10) && strncmp(file + prefix, "/archived_sessions/", 19)) return 0;
  const char *name = strrchr(file, '/'); if (!name) return 0; name++;
  size_t length = strlen(name);
  if (length < 15 || strncmp(name, "rollout-", 8) || strcmp(name + length - 6, ".jsonl")) return 0;
  /* Everything after the already UTF8-validated root is a native ASCII path. */
  for (const unsigned char *p = (const unsigned char *)(file + prefix); *p; p++)
    if (!((*p >= 'a' && *p <= 'z') || (*p >= 'A' && *p <= 'Z') || (*p >= '0' && *p <= '9') || *p == '/' || *p == '-' || *p == '_' || *p == '.' || *p == ':')) return 0;
  return 1;
}
static void json(const char *value) {
  putchar('"'); for (const char *p = value; *p; p++) { if (*p == '"' || *p == '\\') putchar('\\'); putchar(*p); } putchar('"');
}
int main(int argc, char **argv) {
  int result = 1, matches = 0;
  struct proc_fdinfo *fds = NULL;
  char paths[MAX_MATCHES][MAXPATHLEN] = {{0}};
  if ((argc != 4 && argc != 5) || (argc == 5 && strcmp(argv[4], "family")) || argv[2][0] != '/' || strlen(argv[2]) >= MAXPATHLEN) goto done;
  int family = argc == 5;
  for (const char *p = argv[1]; *p; p++) if (*p < '0' || *p > '9') goto done;
  char *end; long number = strtol(argv[1], &end, 10); if (*end || number <= 0 || number > INT32_MAX) goto done;
  pid_t pid = (pid_t)number;
  struct proc_bsdinfo before, after;
  char exe[PROC_PIDPATHINFO_MAXSIZE], postexe[PROC_PIDPATHINFO_MAXSIZE], start[64];
  if (!identity(pid, &before, exe)) goto done;
  snprintf(start, sizeof(start), "%llu:%llu", (unsigned long long)before.pbi_start_tvsec, (unsigned long long)before.pbi_start_tvusec);
  if (strcmp(start, argv[3])) goto done;
  int size = proc_pidinfo(pid, PROC_PIDLISTFDS, 0, NULL, 0);
  if (size < 0 || size > (int)(MAX_FDS * sizeof(struct proc_fdinfo))) goto done;
  fds = calloc(MAX_FDS, sizeof(*fds)); if (!fds) goto done;
  int bytes = proc_pidinfo(pid, PROC_PIDLISTFDS, 0, fds, MAX_FDS * sizeof(*fds));
  if (bytes < 0 || bytes > (int)(MAX_FDS * sizeof(*fds)) || bytes % sizeof(*fds)) goto done;
  for (size_t i = 0; i < (size_t)bytes / sizeof(*fds); i++) {
    if (fds[i].proc_fdtype != PROX_FDTYPE_VNODE) continue;
    struct vnode_fdinfowithpath info; memset(&info, 0, sizeof(info));
    int read = proc_pidfdinfo(pid, fds[i].proc_fd, PROC_PIDFDVNODEPATHINFO, &info, sizeof(info));
    if (read == sizeof(info) && native(info.pvip.vip_path, argv[2], family)) {
      int duplicate = 0; for (int k = 0; k < matches; k++) if (!strcmp(paths[k], info.pvip.vip_path)) duplicate = 1;
      if (!duplicate) { if (matches >= MAX_MATCHES) { wipe(&info, sizeof(info)); goto done; } strcpy(paths[matches++], info.pvip.vip_path); }
    }
    wipe(&info, sizeof(info));
  }
  if (!identity(pid, &after, postexe) || before.pbi_start_tvsec != after.pbi_start_tvsec || before.pbi_start_tvusec != after.pbi_start_tvusec || strcmp(exe, postexe)) goto done;
  printf("{\"pid\":%d,\"start\":", pid); json(start); fputs(",\"source\":\"native-rollout-fd\",\"files\":[", stdout);
  for (int k = 0; k < matches; k++) { if (k) putchar(','); json(paths[k]); }
  fputs("]}\n", stdout); result = 0;
done:
  if (fds) { wipe(fds, MAX_FDS * sizeof(*fds)); free(fds); }
  wipe(paths, sizeof(paths));
  if (result) fputs("native_rollout_authority_unavailable\n", stderr);
  return result;
}
