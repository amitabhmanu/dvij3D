"""Pipeline steps import their siblings flat (`from common import ...`), so the
tests need pipeline/ itself on the path, as it is when a step runs directly."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
