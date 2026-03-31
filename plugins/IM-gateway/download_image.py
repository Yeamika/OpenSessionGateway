import argparse
import mimetypes
import re
import urllib.parse
import urllib.request
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download a file from URL.")
    parser.add_argument("url", help="File URL")
    parser.add_argument("dir", nargs="?", default=".tmp", help="Output directory, default: ./.tmp")
    return parser.parse_args()


def detect_suffix(response: urllib.response.addinfourl) -> str:
    disposition = response.headers.get("Content-Disposition", "")
    match = re.search(r'filename="?([^";]+)"?', disposition)
    if match:
        suffix = Path(match.group(1)).suffix
        if suffix:
            return suffix

    suffix = mimetypes.guess_extension(response.headers.get_content_type() or "") or ""
    if suffix == ".jpe":
        suffix = ".jpg"
    return suffix or ".bin"


def detect_name(url: str, suffix: str) -> str:
    name = Path(urllib.parse.urlparse(url).path).name or "download"
    return name if name.endswith(suffix) else f"{name}{suffix}"


def main() -> int:
    args = parse_args()
    output_dir = Path(args.dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    with urllib.request.urlopen(args.url, timeout=60) as response:
        suffix = detect_suffix(response)
        target = (output_dir / detect_name(args.url, suffix)).resolve()
        target.write_bytes(response.read())
        print(target)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
