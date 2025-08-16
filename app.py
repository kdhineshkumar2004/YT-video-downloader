# app.py
import os
import re
import tempfile
import logging
from flask import Flask, render_template, request, jsonify, send_file, after_this_request
import yt_dlp

logging.basicConfig(level=logging.INFO)
app = Flask(__name__, static_folder='static', template_folder='templates')

def sanitize_filename(name: str) -> str:
    if not name:
        return "video"
    # replace banned filename chars
    return re.sub(r'[\\/:*?"<>|]', '_', name).strip()

def human_readable_size(size):
    if not size:
        return ''
    size = float(size)
    for unit in ['B','KB','MB','GB','TB']:
        if size < 1024.0:
            return f"{size:.1f}{unit}"
        size /= 1024.0
    return f"{size:.1f}PB"

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/get_info', methods=['POST'])
def get_info():
    payload = request.get_json() or {}
    url = payload.get('url')
    if not url:
        return jsonify({'error': 'URL is required.'}), 400

    ydl_opts = {'skip_download': True, 'quiet': True, 'no_warnings': True}
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except yt_dlp.utils.DownloadError as e:
        app.logger.error("yt-dlp download error: %s", e)
        return jsonify({'error': 'Invalid URL or video unavailable.'}), 400
    except Exception as e:
        app.logger.exception("Unexpected error during get_info")
        return jsonify({'error': 'Server error while fetching info.'}), 500

    formats = []
    seen = set()
    for f in info.get('formats', []):
        fid = f.get('format_id')
        if not fid or fid in seen:
            continue
        seen.add(fid)

        height = f.get('height') or f.get('resolution') or ''
        ext = f.get('ext') or ''
        vcodec = f.get('vcodec') or ''
        acodec = f.get('acodec') or ''
        filesize = f.get('filesize') or f.get('filesize_approx')
        filesize_label = human_readable_size(filesize) if filesize else ''

        type_label = 'audio' if vcodec == 'none' else ('video' if acodec == 'none' else 'video+audio')
        note = f.get('format_note') or ''
        label_parts = []
        if height:
            label_parts.append(f"{height}p")
        if ext:
            label_parts.append(ext)
        label_parts.append(type_label)
        if note:
            label_parts.append(note)
        if filesize_label:
            label_parts.append(filesize_label)

        label = " • ".join(label_parts)
        formats.append({
            'id': fid,
            'label': label,
            'ext': ext or 'mp4'
        })

    # sort: attempt to put higher-res first by numeric height in label
    def sort_key(x):
        m = re.search(r'(\d+)p', x['label'])
        return int(m.group(1)) if m else 0
    formats.sort(key=sort_key, reverse=True)

    return jsonify({
        'title': info.get('title', 'Unknown title'),
        'thumbnail': info.get('thumbnail', ''),
        'formats': formats
    })


@app.route('/download', methods=['POST'])
def download():
    payload = request.get_json() or {}
    url = payload.get('url')
    format_id = payload.get('format_id')

    if not url or not format_id:
        return jsonify({'error': 'URL and format_id are required.'}), 400

    # First: try to get a direct URL from yt-dlp without downloading
    try:
        ydl_opts = {'quiet': True, 'no_warnings': True, 'format': format_id}
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            # top-level url sometimes points to requested format
            direct_url = info.get('url')
            if direct_url:
                return jsonify({'download_url': direct_url, 'title': info.get('title', ''), 'ext': info.get('ext', 'mp4')})

            # otherwise scan formats
            for f in info.get('formats', []):
                if f.get('format_id') == format_id and f.get('url'):
                    return jsonify({'download_url': f.get('url'), 'title': info.get('title', ''), 'ext': f.get('ext', 'mp4')})
    except yt_dlp.utils.DownloadError as e:
        app.logger.error("yt-dlp error while probing for direct URL: %s", e)
        return jsonify({'error': 'Invalid URL or video unavailable.'}), 400
    except Exception as e:
        app.logger.exception("Unexpected error while probing for direct URL")
        return jsonify({'error': 'Server error while preparing download.'}), 500

    # Fallback: server-side download + merge (requires ffmpeg on PATH for some formats)
    tempdir = tempfile.mkdtemp(prefix='yt_dl_')
    try:
        # Get metadata (title) first for filename
        meta_opts = {'quiet': True, 'no_warnings': True}
        with yt_dlp.YoutubeDL(meta_opts) as ydl:
            meta = ydl.extract_info(url, download=False)

        safe_title = sanitize_filename(meta.get('title') or 'video')
        outtmpl = os.path.join(tempdir, safe_title + '.%(ext)s')

        download_opts = {
            'outtmpl': outtmpl,
            'format': format_id,
            'merge_output_format': 'mp4',  # if merging required
            'quiet': True,
            'no_warnings': True,
        }

        with yt_dlp.YoutubeDL(download_opts) as ydl:
            ydl.download([url])

        files = [os.path.join(tempdir, f) for f in os.listdir(tempdir)]
        if not files:
            app.logger.error("No file found after yt-dlp download in %s", tempdir)
            return jsonify({'error': 'Download failed on server.'}), 500

        # choose largest file found (safest)
        file_path = max(files, key=os.path.getsize)

        @after_this_request
        def cleanup(response):
            try:
                if os.path.exists(file_path):
                    os.remove(file_path)
                # attempt to remove directory if empty
                try:
                    os.rmdir(tempdir)
                except OSError:
                    pass
            except Exception as ex:
                app.logger.error("Could not cleanup temporary files: %s", ex)
            return response

        return send_file(file_path, as_attachment=True)
    except yt_dlp.utils.DownloadError as e:
        app.logger.error("yt-dlp download error: %s", e)
        return jsonify({'error': 'Failed to download/merge on server (maybe ffmpeg is missing or format not supported).'}), 500
    except Exception as e:
        app.logger.exception("Unexpected server error during download")
        return jsonify({'error': 'Server error while downloading.'}), 500
