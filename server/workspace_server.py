"""Keep the local backend terminal running across completed workspace builds."""
import json
import multiprocessing
from pathlib import Path
from threading import Event, Thread

import uvicorn


def workspace_build(root):
    try:
        extension = root / "extension"
        ready = json.loads((extension / "workspace-release.json").read_text(encoding="utf-8"))["version"]
        manifest = json.loads((extension / "manifest.json").read_text(encoding="utf-8"))["version"]
        return ready if isinstance(ready, str) and ready == manifest else None
    except (OSError, ValueError, KeyError, TypeError):
        return None


def serve(host, port, stop):
    server = uvicorn.Server(uvicorn.Config("main:app", host=host, port=port))

    def shutdown():
        stop.wait()
        server.should_exit = True

    Thread(target=shutdown, daemon=True).start()
    server.run()


def run_workspace_server(host, port, version, *, root=None, shutdown=None):
    root = root or Path(__file__).resolve().parent.parent
    shutdown = shutdown or Event()
    context = multiprocessing.get_context("spawn")
    while not shutdown.is_set():
        stop = context.Event()
        process = context.Process(target=serve, args=(host, port, stop))
        process.start()
        next_version = None
        try:
            while process.is_alive() and not shutdown.wait(0.5):
                ready = workspace_build(root)
                if ready and ready != version:
                    next_version = ready
                    print(f"Updating Browser Assistant backend from {version} to {ready}. Finishing active requests.",
                          flush=True)
                    break
        except KeyboardInterrupt:
            shutdown.set()
        finally:
            stop.set()
            process.join()
            exit_code = process.exitcode
            process.close()
        if not next_version:
            return 0 if shutdown.is_set() else exit_code
        version = next_version
    return 0
