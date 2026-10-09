/* Synthetic child ONLY for process-root OS tests. Never queries another process. */
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <string.h>
#include <fcntl.h>
int main(int argc, char **argv) {
  if (argc == 3 && !strcmp(argv[1], "open-rollout")) {
    if (open(argv[2], O_RDONLY | O_NOFOLLOW | O_NONBLOCK) < 0) return 3;
  }
  if (argc == 2) {
    char *environment[7] = {"HOME=/fixture", "CODEX_HOME=/fixture", "CLAUDE_CONFIG_DIR=/fixture", "OPAQUE_PRIVATE_VALUE=\xffPRIVATE", NULL, NULL, NULL};
    if (!strcmp(argv[1], "duplicate")) environment[4] = "CODEX_HOME=/other";
    else if (!strcmp(argv[1], "invalid")) environment[0] = "HOME=/invalid\xff";
    else if (!strcmp(argv[1], "oversized")) {
      char *large = malloc(5000); if (!large) return 2;
      memcpy(large, "HOME=/", 6); memset(large + 6, 'x', 4993); large[4999] = 0;
      environment[0] = large;
    } else if (!strcmp(argv[1], "missing")) environment[0] = "OTHER_ROOT=/fixture";
    char *args[] = {argv[0], NULL};
    execve(argv[0], args, environment);
    return 2;
  }
  const char *a = getenv("CODEX_HOME");
  const char *b = getenv("CLAUDE_CONFIG_DIR");
  const char *c = getenv("HOME");
  /* Boolean receipt only: values and all unrelated keys remain private. */
  printf("{\"codexPresent\":%s,\"claudePresent\":%s,\"homePresent\":%s}\n",
    a && *a ? "true" : "false", b && *b ? "true" : "false", c && *c ? "true" : "false");
  fflush(stdout);
  for (;;) pause();
}
