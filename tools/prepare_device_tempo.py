"""Restore the integrity-pinned, single-thread local atempo runtime."""
import base64,hashlib,io,json,pathlib,tarfile,urllib.request

def prepare(download=False):
    root=pathlib.Path(__file__).resolve().parent.parent/'vendor/realtime-v3'
    pin=json.loads((root/'device-tempo.json').read_text())
    dest=root/'public/device-tempo'
    missing=any(not (dest/name).is_file() for name in pin['files'])
    if missing:
        if not download:raise ValueError('Missing device tempo runtime; run tools/build_realtime.py --download')
        data=urllib.request.urlopen('https://registry.npmjs.org/@ffmpeg/core/-/core-0.12.10.tgz',timeout=120).read()
        assert 'sha512-'+base64.b64encode(hashlib.sha512(data).digest()).decode()==pin['npmIntegrity']
        dest.mkdir(parents=True,exist_ok=True)
        with tarfile.open(fileobj=io.BytesIO(data)) as archive:
            for name in pin['files']:(dest/name).write_bytes(archive.extractfile('package/dist/umd/'+name).read())
    license=dest/pin['licenseFile']
    if not license.is_file():
        if not download:raise ValueError('Missing tempo license; run tools/build_realtime.py --download')
        license.write_bytes(urllib.request.urlopen('https://raw.githubusercontent.com/FFmpeg/FFmpeg/n5.1.6/COPYING.GPLv2',timeout=30).read())
    if hashlib.sha256(license.read_bytes()).hexdigest()!=pin['licenseSha256']:raise ValueError('Device tempo license changed')
    (dest/'NOTICE.txt').write_text('@ffmpeg/core 0.12.10, single-thread WebAssembly. GPL-2.0-or-later.\nSource and build instructions: https://github.com/ffmpegwasm/ffmpeg.wasm\nFFmpeg source: https://github.com/FFmpeg/FFmpeg\nUsed unmodified for device-side atempo; no cloud render.\n')
    for name,digest in pin['files'].items():
        if hashlib.sha256((dest/name).read_bytes()).hexdigest()!=digest:raise ValueError('Device tempo runtime changed: '+name)
    return pin
