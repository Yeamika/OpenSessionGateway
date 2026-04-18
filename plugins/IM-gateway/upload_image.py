import json
import sys
import urllib.request
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: python upload_image.py <file> [port] [host]", file=sys.stderr)
        return 1

    file_path = Path(sys.argv[1]).expanduser().resolve()
    port = sys.argv[2] if len(sys.argv) > 2 else "4090"
    host = sys.argv[3] if len(sys.argv) > 3 else "127.0.0.1"

    if not file_path.is_file():
        print(f"File not found: {file_path}", file=sys.stderr)
        return 1

    request = urllib.request.Request(
        f"http://{host}:{port}/imgw/uploads/images",
        data=file_path.read_bytes(),
        headers={"content-type": "application/octet-stream", "x-file-name": file_path.name},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        data = json.loads(response.read().decode("utf-8"))

    upload_id = str(((data.get("data") or {}).get("uploadID") or "")).strip()
    if not data.get("ok") or not upload_id:
        print(json.dumps(data, ensure_ascii=False), file=sys.stderr)
        return 1

    print(upload_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
