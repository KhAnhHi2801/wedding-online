#!/usr/bin/env python3
"""Đóng gói songs/*.mp3 + bố cục nốt (tools/song-charts.json) thành songs-data.js.
Chạy: python3 tools/build-songs-data.py   (từ thư mục gốc dự án)
index.html nạp songs-data.js bằng thẻ <script>; bước gộp một file cuối sẽ nhúng nội dung này vào index.html.
Thời lượng đọc từ header mp3 (không cần ffmpeg)."""
import base64, json, os, struct, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BR = {(1, 3): [0,32,64,96,128,160,192,224,256,288,320,352,384,416,448], (1, 2): [0,32,48,56,64,80,96,112,128,160,192,224,256,320,384],
      (1, 1): [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320], (2, 3): [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160]}
SR = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}

def mp3_duration(d):
    i = 0
    if d[:3] == b'ID3':
        i = 10 + (((d[6] & 0x7f) << 21) | ((d[7] & 0x7f) << 14) | ((d[8] & 0x7f) << 7) | (d[9] & 0x7f))
    dur = 0.0
    while i + 4 <= len(d):
        h = struct.unpack('>I', d[i:i + 4])[0]
        if (h >> 21) & 0x7ff != 0x7ff: i += 1; continue
        ver, layer, br, sr, pad = (h >> 19) & 3, (h >> 17) & 3, (h >> 12) & 15, (h >> 10) & 3, (h >> 9) & 1
        if ver == 1 or layer == 0 or br in (0, 15) or sr == 3: i += 1; continue
        v = 1 if ver == 3 else 2; L = {3: 1, 2: 2, 1: 3}[layer]
        bitrate = BR[(v, L)][br] if (v, L) in BR else BR[(2, 3)][br]; srate = SR[ver][sr]
        spf = 384 if L == 1 else (1152 if (L == 2 or v == 1) else 576)
        flen = (12 * bitrate * 1000 // srate + pad) * 4 if L == 1 else (144 if (v == 1 or L == 2) else 72) * bitrate * 1000 // srate + pad
        dur += spf / srate; i += flen
    return dur

charts = json.load(open(os.path.join(ROOT, 'tools', 'song-charts.json'), encoding='utf-8'))
songs = []
for fname, info in charts.items():
    path = os.path.join(ROOT, 'songs', fname)
    if not os.path.exists(path): sys.exit('Thiếu file: ' + path)
    data = open(path, 'rb').read()
    songs.append({'id': 'song' + str(len(songs) + 1), 'title': info['title'], 'dur': round(mp3_duration(data), 2),
                  'src': 'data:audio/mpeg;base64,' + base64.b64encode(data).decode('ascii'), 'chart': info['chart']})
# Hiệu ứng âm thanh hoạt động Bắt hoa: khoá → file (index.html gọi audio.playSfx(khoá))
SFX = {'bouquetWait': 'Chờ để bắt hoa.mp3', 'bouquetCatch': 'Bắt được hoa.mp3', 'bouquetMiss': 'Bắt hụt.mp3'}
sfx = {}
for key, fname in SFX.items():
    path = os.path.join(ROOT, 'songs', fname)
    if not os.path.exists(path): sys.exit('Thiếu file: ' + path)
    sfx[key] = 'data:audio/mpeg;base64,' + base64.b64encode(open(path, 'rb').read()).decode('ascii')
out = os.path.join(ROOT, 'songs-data.js')
dump = lambda o: json.dumps(o, ensure_ascii=False, separators=(',', ':'))
open(out, 'w', encoding='utf-8').write('/* Sinh bởi tools/build-songs-data.py — đừng sửa tay */\nwindow.SONG_DATA = ' + dump(songs) + ';\nwindow.SFX_DATA = ' + dump(sfx) + ';\n')
print('ghi', out, os.path.getsize(out) // 1024, 'KB;', len(songs), 'bài:', [(s['title'], s['dur'], len(s['chart'])) for s in songs])
