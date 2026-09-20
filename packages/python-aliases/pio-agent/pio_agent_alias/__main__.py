"""Delegate arguments, stdio and exit status to the canonical bundled engine."""
import sys
from pio_agent_launcher.__main__ import main

if __name__ == "__main__":
    sys.exit(main())
