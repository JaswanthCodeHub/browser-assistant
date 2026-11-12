import json
from pathlib import Path
import socket
import sys
from tempfile import TemporaryDirectory
from threading import Event, Thread
import time
import unittest
from urllib.request import urlopen

from workspace_server import run_workspace_server


class WorkspaceServerTests(unittest.TestCase):
    def test_terminal_supervisor_loads_new_backend_only_when_build_is_ready(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            extension = root / "extension"
            extension.mkdir()
            app_path = root / "main.py"
            manifest = extension / "manifest.json"
            marker = extension / "workspace-release.json"

            def write_app(version):
                app_path.write_text(
                    "from fastapi import FastAPI\napp = FastAPI()\n"
                    f"@app.get('/health')\ndef health(): return {{'version': {version!r}}}\n",
                    encoding="utf-8",
                )
                manifest.write_text(json.dumps({"version": version}), encoding="utf-8")

            def ready(version):
                marker.write_text(json.dumps({"version": version}), encoding="utf-8")

            def wait_for_version(version):
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline:
                    try:
                        with urlopen(url, timeout=0.5) as response:
                            if json.load(response).get("version") == version:
                                return
                    except OSError:
                        pass
                    time.sleep(0.15)
                self.fail(f"Backend did not report {version}")

            old, new = "1.0.0", "1.0.11"
            write_app(old)
            ready(old)
            with socket.socket() as port_reservation:
                port_reservation.bind(("127.0.0.1", 0))
                port = port_reservation.getsockname()[1]
            url = f"http://127.0.0.1:{port}/health"
            shutdown = Event()
            supervisor = Thread(target=run_workspace_server, args=("127.0.0.1", port, old),
                                kwargs={"root": root, "shutdown": shutdown}, daemon=True)
            sys.path.insert(0, directory)
            try:
                supervisor.start()
                wait_for_version(old)
                write_app(new)
                time.sleep(0.8)
                wait_for_version(old)
                ready(new)
                wait_for_version(new)
                self.assertTrue(supervisor.is_alive())
            finally:
                shutdown.set()
                supervisor.join(timeout=10)
                sys.path.remove(directory)
            self.assertFalse(supervisor.is_alive())
