#!/usr/bin/env python3
import sys
import time
import argparse
import re
import os

def tail_file(filename, timeout=None, until_pattern=None, lines=100):
    if not os.path.exists(filename):
        print(f"Error: {filename} does not exist.")
        sys.exit(1)

    # First, if only lines are requested and no conditions, just print the tail
    if not timeout and not until_pattern:
        with open(filename, 'r') as f:
            content = f.readlines()
            for line in content[-lines:]:
                print(line, end='')
        return
        
    start_time = time.time()
    pattern = re.compile(until_pattern) if until_pattern else None
    
    with open(filename, 'r') as f:
        # By reading from the beginning of the current session's log file (which is recreated 
        # fresh via device-monitor.py after every flash), we ensure we do not miss fast boot logs.
        while True:
            line = f.readline()
            if line:
                print(line, end='')
                if pattern and pattern.search(line):
                    print(f"\n[*] Matched until condition: '{until_pattern}'. Exiting.")
                    break
            else:
                if timeout and (time.time() - start_time) > timeout:
                    print(f"\n[*] Timeout of {timeout} seconds reached. Exiting.")
                    break
                time.sleep(0.1)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Cleanly read hardware serial logs for AI agents.")
    parser.add_argument('file', nargs='?', default='logs/latest-monitor.log', help='Log file to read')
    parser.add_argument('--timeout', type=int, help='Stop tailing after X seconds')
    parser.add_argument('--until', type=str, help='Stop tailing when this regex matches a line')
    parser.add_argument('-n', '--lines', type=int, default=100, help='Number of lines to output if no streaming arguments are provided')
    
    args = parser.parse_args()
    tail_file(args.file, args.timeout, args.until, args.lines)
