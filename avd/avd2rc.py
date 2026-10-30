#!/usr/bin/env python3
"""avd2rc — convert Android animated vector drawables (and <vector>s) to RemoteCompose JSON.

    python3 avd2rc.py in.xml -o out.json [--rc out.rc] [--loop|--once] [--trigger VAR]
    python3 avd2rc.py corpus_dir/ -o out_dir/ [--rc rc_dir/]

The implementation is the `avdrc` package next to this file; see CONVERT.md.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from avdrc.convert import main  # noqa: E402

if __name__ == '__main__':
    sys.exit(main())
