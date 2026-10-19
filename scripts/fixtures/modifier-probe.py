"""Owned test pane: capture actual terminal stdin without shell/TUI interpretation."""
import os
import sys
import termios
import tty

path, mode = sys.argv[1:]
before = termios.tcgetattr(0)
try:
    tty.setraw(0)
    # Disambiguation + report all keys; no release/repeat reporting in this probe.
    if mode == "kitty":
        os.write(1, b"\x1b[>9u")
    os.write(1, ("PROBE READY " + mode + "\r\n").encode())
    with open(path, "a", buffering=1) as output:
        while True:
            data = os.read(0, 4096)
            if not data:
                break
            output.write(data.hex())
            output.flush()
finally:
    if mode == "kitty":
        os.write(1, b"\x1b[<u")
    termios.tcsetattr(0, termios.TCSANOW, before)
