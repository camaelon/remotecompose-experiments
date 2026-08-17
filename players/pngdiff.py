#!/usr/bin/env python3
"""Count differing pixels between two PNGs; -1 if the sizes disagree.

Factored out of 3d-parity.sh so the runner can call it from inside a case branch without
nesting a heredoc, which the shell mis-parses.
"""
import sys
from PIL import Image, ImageChops

a = Image.open(sys.argv[1]).convert("RGBA")
b = Image.open(sys.argv[2]).convert("RGBA")
print(-1 if a.size != b.size
      else sum(1 for p in ImageChops.difference(a, b).getdata() if any(p)))
