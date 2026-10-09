/* Private macOS process-root authority. No general environment interface.
 * KERN_PROCARGS2 briefly contains argv and OTHER environment bytes. Only fixed
 * root-key spans are decoded. The raw buffer is zeroed before free, never logged.
 */
#include <errno.h>
#include <libproc.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/sysctl.h>
#include <unistd.h>

#define MAX_ARGS_BYTES (1024 * 1024)
#define MAX_ROOT_BYTES 4096
static void wipe(void *p, size_t n) {
  volatile unsigned char *b = p;
  while (n--) *b++ = 0;
}
static int utf8(const unsigned char *s, size_t n) {
  for (size_t i = 0; i < n;) {
    uint32_t c = s[i++];
    if (c < 0x80) { if (c < 0x20 || c == 0x7f) return 0; continue; }
    unsigned more; uint32_t min;
    if (c >= 0xc2 && c <= 0xdf) { more = 1; min = 0x80; c &= 0x1f; }
    else if (c >= 0xe0 && c <= 0xef) { more = 2; min = 0x800; c &= 0x0f; }
    else if (c >= 0xf0 && c <= 0xf4) { more = 3; min = 0x10000; c &= 7; }
    else return 0;
    if (n - i < more) return 0;
    while (more--) { unsigned b = s[i++]; if ((b & 0xc0) != 0x80) return 0; c = (c << 6) | (b & 0x3f); }
    if (c < min || c > 0x10ffff || (c >= 0xd800 && c <= 0xdfff)) return 0;
  }
  return 1;
}
static int identity(pid_t pid, struct proc_bsdinfo *info, char *exe) {
  memset(info, 0, sizeof(*info));
  memset(exe, 0, PROC_PIDPATHINFO_MAXSIZE);
  return proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, info, sizeof(*info)) == sizeof(*info)
    && info->pbi_uid == geteuid() && info->pbi_ruid == getuid()
    && proc_pidpath(pid, exe, PROC_PIDPATHINFO_MAXSIZE) > 0;
}
static void json(const unsigned char *value, size_t n) {
  putchar('"');
  for (size_t i = 0; i < n; i++) {
    if (value[i] == '"' || value[i] == '\\') putchar('\\');
    putchar(value[i]);
  }
  putchar('"');
}
int main(int argc, char **argv) {
  int result = 1;
  unsigned char *raw = NULL; size_t allocated = 0;
  unsigned char roots[7][MAX_ROOT_BYTES + 1] = {{0}};
  size_t lengths[7] = {0}; int seen[7] = {0};
  const char *keys[7] = {"CODEX_HOME", "CLAUDE_CONFIG_DIR", "HOME", "PI_CODING_AGENT_DIR", "PI_CODING_AGENT_SESSION_DIR", "OMO_CODING_AGENT_DIR", "SENPI_CODING_AGENT_DIR"};
  if ((argc != 2 && argc != 3) || !argv[1][0] || (argc == 3 && strcmp(argv[2], "family"))) goto done;
  int key_count = argc == 3 ? 7 : 3;
  for (const char *p = argv[1]; *p; p++) if (*p < '0' || *p > '9') goto done;
  errno = 0; char *end = NULL; long number = strtol(argv[1], &end, 10);
  if (errno || !end || *end || number <= 0 || number > INT32_MAX) goto done;
  pid_t pid = (pid_t)number;
  struct proc_bsdinfo before, after;
  char executable[PROC_PIDPATHINFO_MAXSIZE], postexe[PROC_PIDPATHINFO_MAXSIZE];
  if (!identity(pid, &before, executable)) goto done;
  int argmax = 0; size_t argmax_size = sizeof(argmax); int maxmib[2] = {CTL_KERN, KERN_ARGMAX};
  if (sysctl(maxmib, 2, &argmax, &argmax_size, NULL, 0) || argmax <= 0 || argmax > MAX_ARGS_BYTES) goto done;
  allocated = (size_t)argmax; raw = calloc(1, allocated);
  if (!raw) goto done;
  size_t size = allocated; int mib[3] = {CTL_KERN, KERN_PROCARGS2, pid};
  if (sysctl(mib, 3, raw, &size, NULL, 0) || size < sizeof(int) || size > allocated) goto done;
  int nargs = 0; memcpy(&nargs, raw, sizeof(nargs));
  if (nargs <= 0 || nargs > 32768) goto done;
  size_t at = sizeof(int);
  unsigned char *nul = memchr(raw + at, 0, size - at);
  if (!nul) goto done;
  at = (size_t)(nul - raw) + 1;
  while (at < size && raw[at] == 0) at++;
  for (int i = 0; i < nargs; i++) {
    if (at >= size) goto done;
    nul = memchr(raw + at, 0, size - at); if (!nul) goto done;
    at = (size_t)(nul - raw) + 1;
  }
  while (at < size && raw[at] == 0) at++;
  while (at < size && raw[at]) {
    nul = memchr(raw + at, 0, size - at); if (!nul) goto done;
    size_t length = (size_t)(nul - raw) - at;
    /* Compare fixed key bytes only. Unknown values stay opaque. */
    for (int k = 0; k < key_count; k++) {
      size_t keylen = strlen(keys[k]);
      if (length > keylen && !memcmp(raw + at, keys[k], keylen) && raw[at + keylen] == '=') {
        if (seen[k]++) goto done;
        size_t len = length - keylen - 1;
        const unsigned char *value = raw + at + keylen + 1;
        if (!len || len > MAX_ROOT_BYTES || (k < 3 && value[0] != '/') || !utf8(value, len)) goto done;
        memcpy(roots[k], value, len); lengths[k] = len;
      }
    }
    at = (size_t)(nul - raw) + 1;
  }
  if (!identity(pid, &after, postexe)
    || before.pbi_start_tvsec != after.pbi_start_tvsec
    || before.pbi_start_tvusec != after.pbi_start_tvusec
    || strcmp(executable, postexe)) goto done;
  wipe(raw, allocated); free(raw); raw = NULL;
  printf("{\"pid\":%d,\"start\":\"%llu:%llu\",\"source\":\"kern-procargs2\",\"keys\":{", pid,
    (unsigned long long)before.pbi_start_tvsec, (unsigned long long)before.pbi_start_tvusec);
  for (int k = 0; k < key_count; k++) {
    if (k) putchar(','); json((const unsigned char *)keys[k], strlen(keys[k])); putchar(':');
    if (seen[k]) json(roots[k], lengths[k]); else fputs("null", stdout);
  }
  fputs("}}\n", stdout); result = 0;
done:
  if (raw) { wipe(raw, allocated); free(raw); }
  wipe(roots, sizeof(roots));
  if (result) fputs("process_root_unavailable\n", stderr);
  return result;
}
