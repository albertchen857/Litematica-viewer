"""打印 APP_VERSION=<版本号>，CI 用它给产物命名（版本号只在 script/lv/config.py 写一处）。

    python tools/print_version.py          # -> APP_VERSION=0.9.6
"""

import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(ROOT, "script", "lv", "config.py"), encoding="utf-8") as f:
    print("APP_VERSION=" + re.search(r'APP_VERSION = "([^"]+)"', f.read()).group(1))
