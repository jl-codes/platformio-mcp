"""Local-only fixture for the OTA bridge; sends no firmware and contacts no board."""
import argparse
import logging
import socket

parser = argparse.ArgumentParser()
parser.add_argument("--ip")
parser.add_argument("--port", type=int)
parser.add_argument("--file")
parser.add_argument("--auth")
parser.add_argument("--progress", action="store_true")
args = parser.parse_args()
assert args.ip == "127.0.0.1"
with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as receiver, socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as selected, socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as other:
    receiver.bind(("127.0.0.1", 0))
    receiver.settimeout(2)
    selected.bind(("127.0.0.1", args.port))
    other.bind(("127.0.0.1", 0))
    other.sendto(b"wrong-peer", receiver.getsockname())
    selected.sendto(b"selected-peer", receiver.getsockname())
    assert receiver.recv(64) == b"selected-peer"
with socket.socket() as server, socket.socket() as other, socket.socket() as selected:
    server.bind(("127.0.0.1", 0))
    server.listen(2)
    server.settimeout(2)
    other.bind(("127.0.0.2", 0))
    other.connect(server.getsockname())
    selected.bind(("127.0.0.1", 0))
    selected.connect(server.getsockname())
    connection, peer = server.accept()
    assert peer[0] == "127.0.0.1"
    connection.close()
print(args.auth)
logging.info("Success")
print("udp-peer-filter=passed tcp-peer-filter=passed")
