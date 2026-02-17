import html
import os
import sys
import traceback
import urllib.parse
from datetime import datetime, timezone

# CFG
EXCLUDE_MARKER = "EXCLUDE_FOLDER"
IGNORED_FILETYPES = {"html", "php", "py", "sh", "js", "css", "htaccess", "tmp", "stignore"}
MIN_FILES_FOR_NAV = 20
MIN_FOLDERS_FOR_NAV = 30

# Mirror config (set by CLI args)
MIRROR_NAME = ""
MIRROR_TAG = ""
MIRROR_URL = ""

STYLE_CSS = """
body {
    background-color: rgb(105, 64, 83);
    font-family: monospace, sans-serif;
    color: rgb(255, 80, 164);
}
a {
    color: rgb(255, 80, 164);
    text-decoration: none;
}
a:hover {
    color: rgb(135, 1, 66);
    text-decoration: underline;
    background-color: rgb(255, 80, 164);
}
ul {
    list-style-type: none;
    padding-left: 20px;
}
li {
    display: flex;
    align-items: center;
    margin-bottom: 5px;
}
.file-size {
    display: inline-block;
    width: 100px;
    text-align: right;
    margin-right: 10px;
    color: fuchsia;
    white-space: pre;
}
.file-date {
    display: inline-block;
    width: 140px;
    text-align: right;
    margin-right: 10px;
    color: rgb(255, 150, 200);
    white-space: pre;
}
""".strip()

SEARCH_JS = """
function performSearch() {
    const query = document.getElementById("search").value.toLowerCase();
    const items = document.querySelectorAll("li");
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(query) ? "flex" : "none";
    });
}

document.getElementById("search").addEventListener("input", performSearch);

const urlParams = new URLSearchParams(window.location.search);
const searchTerm = urlParams.get('search');

if (searchTerm) {
    const search = document.getElementById("search");
    search.value = searchTerm;
    performSearch();
}
""".strip()


def generate_assets(base_dir):
    """Write style.css and search.js to the base directory."""
    css_path = os.path.join(base_dir, "style.css")
    js_path = os.path.join(base_dir, "search.js")
    try:
        with open(css_path, "w") as f:
            f.write(STYLE_CSS)
    except OSError as e:
        print(f"Error writing CSS file '{css_path}': {e}", file=sys.stderr)
    try:
        with open(js_path, "w") as f:
            f.write(SEARCH_JS)
    except OSError as e:
        print(f"Error writing JS file '{js_path}': {e}", file=sys.stderr)


def get_file_ext(filename):
    """Extract the lowercase file extension, handling dotfiles."""
    _, ext = os.path.splitext(filename)
    if ext == "" and filename.startswith("."):
        return filename[1:].lower()
    return ext.lstrip(".").lower()


def get_filetypes(directory):
    """Return sorted list of non-ignored file extensions found in directory."""
    filetypes = set()
    try:
        items = os.listdir(directory)
    except PermissionError as e:
        print(
            f"Permission denied accessing directory '{directory}': {e}", file=sys.stderr
        )
        return []
    except OSError as e:
        print(f"Error accessing directory '{directory}': {e}", file=sys.stderr)
        return []

    for item in items:
        item_path = os.path.join(directory, item)
        try:
            if os.path.isfile(item_path):
                ext = get_file_ext(item)
                if ext and ext not in IGNORED_FILETYPES:
                    filetypes.add(ext)
        except OSError as e:
            print(f"Error processing file '{item_path}': {e}", file=sys.stderr)
    return sorted(filetypes)


def format_file_size(bytes_size):
    """Format a file size in bytes to a human-readable string."""
    try:
        if bytes_size >= 1024 ** 3:
            return f"{bytes_size / (1024 ** 3):6.1f} GB"
        elif bytes_size >= 1024 ** 2:
            return f"{bytes_size / (1024 ** 2):6.1f} MB"
        elif bytes_size >= 1024:
            return f"{bytes_size / 1024:6.1f} KB"
        else:
            return f"{bytes_size:6d}  B"
    except TypeError:
        return "N/A  B"


def format_file_date(file_path):
    """Return the last-modified date of a file as a formatted string."""
    try:
        mtime = os.path.getmtime(file_path)
        dt = datetime.fromtimestamp(mtime, tz=timezone.utc)
        return dt.strftime("%Y-%m-%d %H:%M")
    except OSError:
        return "N/A"


def generate_page(directory, base_dir, all_filetypes, filetype=None):
    """Generate an HTML page for a directory.

    If filetype is None, generates an index page showing all non-ignored files.
    Otherwise, generates a page filtered to the given file extension.
    """
    try:
        is_index = filetype is None

        up_link = ""
        if os.path.abspath(directory) != os.path.abspath(base_dir):
            up_link = '<li><a href="../">[Go Back]</a></li>\n'

        relative_path = os.path.relpath(directory, base_dir).replace(os.path.sep, "/")
        mirror_link = (
            f"{MIRROR_URL}/{relative_path}/"
            if relative_path != "."
            else MIRROR_URL + "/"
        )

        assets_prefix = os.path.relpath(base_dir, directory).replace(os.path.sep, "/")
        dir_name = html.escape(os.path.basename(os.path.abspath(directory)))

        title = f"FKZ File Index - {html.escape(MIRROR_TAG)} - /{dir_name}/"
        if not is_index:
            title += f" - .{filetype.upper()}"

        # Sort items once
        items = sorted(
            os.listdir(directory),
            key=lambda x: (not os.path.isdir(os.path.join(directory, x)), x.lower()),
        )

        # Collect folders (excluding marked ones)
        folders = [
            item for item in items
            if os.path.isdir(os.path.join(directory, item))
            and not os.path.exists(
                os.path.join(os.path.join(directory, item), EXCLUDE_MARKER)
            )
        ]

        # Collect files
        files = []
        for item in items:
            item_path = os.path.join(directory, item)
            if not os.path.isfile(item_path):
                continue
            if is_index:
                ext = get_file_ext(item)
                if ext in IGNORED_FILETYPES:
                    continue
            else:
                if not item.lower().endswith(f".{filetype}"):
                    continue
            files.append(item)

        # Build nav links
        if is_index:
            nav_parts = [
                f'<a href="{ft}.html">[{ft.upper()}]</a>' for ft in all_filetypes
            ]
            nav_links = " | ".join(nav_parts)
        else:
            parts = ['<a href="./">[Home]</a>']
            for ft in all_filetypes:
                if ft != filetype:
                    parts.append(f'<a href="{ft}.html">[{ft.upper()}]</a>')
            nav_links = " | ".join(parts)

        # Build page
        page = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title}</title>
    <link rel="stylesheet" href="{assets_prefix}/style.css">
    <link rel="shortcut icon" href="https://files.femboy.kz/web/images/fucker.ico">
</head>
<body>
    <h1>{title}</h1>
    <nav>
        {nav_links}
    </nav>
    <br>
    <input type="text" id="search" placeholder="Search... :3" style="margin-bottom: 20px; padding: 5px;">
    <br>
    <nav>
        <a href="{html.escape(mirror_link)}">[{html.escape(MIRROR_NAME)}]</a>
    </nav>
    <br>
"""

        # Folders section
        if folders or up_link:
            page += f"    <h2>Folders - {len(folders)}</h2>\n    <ul>\n"
            if up_link:
                page += f"        {up_link}        <br>\n"
            for folder in folders:
                escaped = html.escape(folder)
                encoded = urllib.parse.quote(folder)
                page += f'        <li><a href="{encoded}/">[{escaped}]</a></li>\n'
            if is_index and len(folders) >= MIN_FOLDERS_FOR_NAV:
                if up_link:
                    page += f"        <br>\n        {up_link}"
                page += '        <nav>\n            <a href="#" onclick="window.scrollTo({top: 0, behavior: \'smooth\'}); return false;">[Back to Top]</a>\n        </nav>\n'
            page += "    </ul>\n"

        # Files section
        if files:
            page += f"    <h2>Files - {len(files)}</h2>\n    <ul>\n"
            for fname in files:
                item_path = os.path.join(directory, fname)
                file_size = os.path.getsize(item_path)
                formatted_size = format_file_size(file_size)
                formatted_date = format_file_date(item_path)
                escaped = html.escape(fname)
                encoded = urllib.parse.quote(fname)
                page += f'        <li><span class="file-size">[{formatted_size}]</span> <span class="file-date">{formatted_date}</span> <a href="{encoded}">{escaped}</a></li>\n'
            if len(files) >= MIN_FILES_FOR_NAV:
                if up_link:
                    page += f"        <br>\n        {up_link}"
                page += '        <nav>\n            <a href="#" onclick="window.scrollTo({top: 0, behavior: \'smooth\'}); return false;">[Back to Top]</a>\n        </nav>\n'
            page += "    </ul>\n"

        page += f"""    <script src="{assets_prefix}/search.js"></script>
</body>
</html>
"""

        output_name = f"{filetype}.html" if not is_index else "index.html"
        output_file = os.path.join(directory, output_name)
        try:
            with open(output_file, "w") as f:
                f.write(page)
        except OSError as e:
            print(f"Error writing file '{output_file}': {e}", file=sys.stderr)
    except Exception as e:
        page_type = filetype or "index"
        print(
            f"Error generating {page_type} page for {directory}: {e}\n{traceback.format_exc()}",
            file=sys.stderr,
        )
        raise


def process_directory(directory, base_dir):
    """Recursively generate HTML pages for a directory tree."""
    try:
        if os.path.exists(os.path.join(directory, EXCLUDE_MARKER)):
            print(f"Skipping excluded directory: {directory}")
            return

        all_filetypes = get_filetypes(directory)

        for filetype in all_filetypes:
            try:
                generate_page(directory, base_dir, all_filetypes, filetype=filetype)
            except Exception as e:
                print(
                    f"Skipping page generation for {filetype} in {directory} due to error",
                    file=sys.stderr,
                )

        try:
            generate_page(directory, base_dir, all_filetypes)
        except Exception as e:
            print(
                f"Skipping index generation for {directory} due to error",
                file=sys.stderr,
            )

        try:
            items = os.listdir(directory)
        except OSError as e:
            print(f"Error listing directory '{directory}': {e}", file=sys.stderr)
            return

        for item in items:
            item_path = os.path.join(directory, item)
            if os.path.isdir(item_path):
                try:
                    process_directory(item_path, base_dir)
                except Exception as e:
                    print(
                        f"Error processing subdirectory '{item_path}': {e}",
                        file=sys.stderr,
                    )
    except Exception as e:
        print(
            f"Critical error processing directory '{directory}': {e}\n{traceback.format_exc()}",
            file=sys.stderr,
        )
        raise


def main(directory="."):
    """Entry point: generate assets and process all directories."""
    base_dir = os.path.abspath(directory)
    try:
        generate_assets(base_dir)
        process_directory(directory, base_dir)
    except Exception as e:
        print(f"Fatal error: {e}\n{traceback.format_exc()}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python3 update_webserver.py <eu/na>")
        print("Valid options: 'eu' for European mirror, 'na' for North American mirror")
        sys.exit(1)

    site_ver = sys.argv[1].lower()

    if site_ver == "na":
        MIRROR_NAME = "EU site"
        MIRROR_TAG = "NA"
        MIRROR_URL = "https://files.femboy.kz"
    elif site_ver == "eu":
        MIRROR_NAME = "NA Site"
        MIRROR_TAG = "EU"
        MIRROR_URL = "https://files-na.femboy.kz"
    else:
        print("Invalid site version. Valid options: 'eu' or 'na'.")
        sys.exit(1)

    try:
        main()
    except KeyboardInterrupt:
        print("\nOperation cancelled by user.", file=sys.stderr)
        sys.exit(130)
