#!/usr/bin/env python3
"""Serve Diamond Days and relay phone-controller WebSocket messages (standard library only)."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import mimetypes
import os
import socket
import ssl
import struct
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
CLIENTS: dict[socket.socket, dict] = {}
CLIENT_LOCK = threading.Lock()
GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


class GameHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self) -> None:
        if urlsplit(self.path).path == "/ws":
            self.handle_websocket()
            return
        if urlsplit(self.path).path == "/health":
            self.send_bytes(200, b"ok\n", "text/plain; charset=utf-8")
            return
        if urlsplit(self.path).path == "/connect-info":
            body = json.dumps({
                "addresses": local_addresses(),
                "port": self.server.server_port,
                "scheme": getattr(self.server, "scheme", "http"),
            }).encode()
            self.send_bytes(200, body, "application/json; charset=utf-8")
            return
        relative = unquote(urlsplit(self.path).path).lstrip("/") or "index.html"
        requested = (ROOT / relative).resolve()
        if ROOT not in requested.parents and requested != ROOT:
            self.send_error(403)
            return
        if not requested.is_file():
            self.send_error(404, "File not found")
            return
        content_type = mimetypes.guess_type(requested.name)[0] or "application/octet-stream"
        if requested.suffix in {".js", ".mjs"}:
            content_type = "text/javascript; charset=utf-8"
        elif requested.suffix == ".css":
            content_type = "text/css; charset=utf-8"
        elif requested.suffix == ".html":
            content_type = "text/html; charset=utf-8"
        self.send_bytes(200, requested.read_bytes(), content_type)

    def do_HEAD(self) -> None:
        if urlsplit(self.path).path == "/health":
            self.send_bytes(200, b"", "text/plain; charset=utf-8")
            return
        super().do_HEAD()

    def send_bytes(self, status: int, content: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if content:
            self.wfile.write(content)

    def handle_websocket(self) -> None:
        if self.headers.get("Upgrade", "").lower() != "websocket":
            self.send_error(426, "WebSocket upgrade required")
            return
        key = self.headers.get("Sec-WebSocket-Key")
        if not key:
            self.send_error(400, "Missing WebSocket key")
            return
        accept = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
        self.send_response(101, "Switching Protocols")
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()
        client = self.connection
        with CLIENT_LOCK:
            CLIENTS[client] = {"role": None, "send_lock": threading.Lock()}
        try:
            while True:
                frame = read_frame(self.rfile)
                if frame is None:
                    break
                opcode, payload = frame
                if opcode == 8:
                    break
                if opcode == 9:
                    safe_send(client, encode_frame(payload, 10))
                elif opcode == 1:
                    relay(client, payload)
        except (OSError, ValueError, TimeoutError):
            pass
        finally:
            with CLIENT_LOCK:
                removed = CLIENTS.pop(client, None)
                role = removed["role"] if removed else None
                same_role_remains = any(info["role"] == role for info in CLIENTS.values()) if role else False
                peers = [peer for peer, info in CLIENTS.items() if info["role"] == ("game" if role == "phone" else "phone")]
            if role in {"game", "phone"} and not same_role_remains:
                left = json.dumps({"type": "peer-left", "role": role}).encode()
                for peer in peers:
                    safe_send(peer, encode_frame(left))
            try:
                client.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                client.close()
            except OSError:
                pass

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"{self.address_string()} - {fmt % args}")


def read_exact(stream, length: int) -> bytes:
    data = stream.read(length)
    if data is None or len(data) != length:
        raise OSError("Incomplete WebSocket frame")
    return data


def read_frame(stream):
    header = stream.read(2)
    if not header:
        return None
    if len(header) != 2:
        raise OSError("Incomplete WebSocket header")
    first, second = header
    opcode = first & 0x0F
    length = second & 0x7F
    if length == 126:
        length = struct.unpack("!H", read_exact(stream, 2))[0]
    elif length == 127:
        length = struct.unpack("!Q", read_exact(stream, 8))[0]
    if length > 1_000_000:
        raise ValueError("WebSocket frame is too large")
    masked = bool(second & 0x80)
    mask = read_exact(stream, 4) if masked else b""
    payload = read_exact(stream, length)
    if masked:
        payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
    return opcode, payload


def encode_frame(payload: bytes, opcode: int = 1) -> bytes:
    size = len(payload)
    if size < 126:
        header = bytes([0x80 | opcode, size])
    elif size <= 65535:
        header = bytes([0x80 | opcode, 126]) + struct.pack("!H", size)
    else:
        header = bytes([0x80 | opcode, 127]) + struct.pack("!Q", size)
    return header + payload


def safe_send(client: socket.socket, frame: bytes) -> None:
    with CLIENT_LOCK:
        info = CLIENTS.get(client)
        lock = info["send_lock"] if info else None
    if lock:
        try:
            with lock:
                client.sendall(frame)
        except OSError:
            pass


def relay(sender: socket.socket, payload: bytes) -> None:
    try:
        message = json.loads(payload.decode())
    except (UnicodeDecodeError, json.JSONDecodeError):
        return
    with CLIENT_LOCK:
        sender_info = CLIENTS.get(sender)
        if not sender_info:
            return
        role = sender_info["role"]
        if message.get("type") == "hello" and message.get("role") in {"game", "phone"}:
            role = message["role"]
            sender_info["role"] = role
            peers = [(peer, info) for peer, info in CLIENTS.items() if peer is not sender]
        else:
            peers = []
    if message.get("type") == "hello" and message.get("role") in {"game", "phone"}:
        for _peer, info in peers:
            if info["role"] in {"game", "phone"}:
                hello = json.dumps({"type": "hello", "role": info["role"]}).encode()
                safe_send(sender, encode_frame(hello))
        for peer, info in peers:
            if info["role"] and info["role"] != role:
                safe_send(peer, encode_frame(payload))
        return
    target_role = "game" if role == "phone" else "phone" if role == "game" else None
    if not target_role:
        return
    with CLIENT_LOCK:
        peers = [peer for peer, info in CLIENTS.items() if peer is not sender and info["role"] == target_role]
    for peer in peers:
        safe_send(peer, encode_frame(payload))


def local_addresses() -> list[str]:
    found = set()
    preferred = None
    probe = None
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(("192.0.2.1", 80))
        preferred = probe.getsockname()[0]
        if preferred.startswith("127."):
            preferred = None
    except OSError:
        pass
    finally:
        if probe:
            probe.close()
    try:
        for result in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = result[4][0]
            if not ip.startswith("127."):
                found.add(ip)
    except OSError:
        pass
    if preferred:
        found.add(preferred)
    return ([preferred] if preferred else []) + sorted(found - ({preferred} if preferred else set()))


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Diamond Days locally with optional phone-controller relay.")
    parser.add_argument("--host", default="0.0.0.0", help="Interface to serve on (default: all local interfaces)")
    parser.add_argument("--port", type=int, default=8765, help="Web and WebSocket port (default: 8765)")
    parser.add_argument("--cert", help="Optional TLS certificate chain for HTTPS/WSS")
    parser.add_argument("--key", help="Optional TLS private key for HTTPS/WSS")
    args = parser.parse_args()
    if bool(args.cert) != bool(args.key):
        parser.error("--cert and --key must be used together")

    server = ThreadingHTTPServer((args.host, args.port), GameHandler)
    server.daemon_threads = True
    scheme = "http"
    if args.cert and args.key:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(args.cert, args.key)
        server.socket = context.wrap_socket(server.socket, server_side=True)
        scheme = "https"
    server.scheme = scheme

    print("Diamond Days is running. Keep this terminal open.")
    print(f"Game: {scheme}://localhost:{args.port}/")
    print(f"Phone: {scheme}://localhost:{args.port}/phone.html")
    for address in local_addresses():
        print(f"Same-Wi-Fi phone: {scheme}://{address}:{args.port}/phone.html")
    print("Stop the server with Ctrl+C.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Diamond Days.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
