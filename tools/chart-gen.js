/* Sinh bố cục nốt cho karaoke: mở một trang cùng origin với /songs (vd. http://127.0.0.1:8123/tools/), nạp file này, rồi:
     const A = await analyze('Tên bài.mp3'); const chart = mkChart(A);   // chart = [[giây, làn, độ dài giữ], ...]
   Phát hiện điểm bật tiếng bằng spectral flux (FFT 1024, hop 256); làn theo trọng tâm phổ (trầm → làn 0, cao → làn 2);
   nốt dài chỉ đặt ở chỗ nhạc còn ngân. Kết quả dán vào tools/song-charts.json rồi chạy tools/build-songs-data.py. */
window.analyze = async (name) => {
  const ab = await (await fetch('/songs/' + encodeURIComponent(name))).arrayBuffer();
  const off = new OfflineAudioContext(1, 16000, 16000);
  const buf = await off.decodeAudioData(ab), sr = buf.sampleRate, x = buf.getChannelData(0), dur = buf.duration;
  const N = 1024, H = 256, nb = N / 2, nf = Math.floor((x.length - N) / H), fps = sr / H;
  const win = new Float64Array(N).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
  const re = new Float64Array(N), im = new Float64Array(N);
  const rev = new Uint16Array(N); for (let i = 0, b = Math.log2(N); i < N; i++) { let r = 0; for (let k = 0; k < b; k++) if (i & (1 << k)) r |= 1 << (b - 1 - k); rev[i] = r; }
  const fft = () => {
    for (let i = 0; i < N; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= N; len <<= 1) { const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
      for (let i = 0; i < N; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const u = i + k, v = u + len / 2;
        const tr = re[v] * cr - im[v] * ci, ti = re[v] * ci + im[v] * cr; re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti; const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr; } } }
  };
  const binHz = sr / N, lo = Math.floor(80 / binHz), hi = Math.floor(Math.min(7000, sr / 2 - 100) / binHz);
  let prev = new Float64Array(nb); const flux = new Float64Array(nf), cen = new Float64Array(nf), rms = new Float64Array(nf);
  for (let f = 0; f < nf; f++) {
    let e = 0; for (let i = 0; i < N; i++) { const v = x[f * H + i]; re[i] = v * win[i]; im[i] = 0; e += v * v; } rms[f] = Math.sqrt(e / N);
    fft(); let s = 0, cw = 0; const cur = new Float64Array(nb);
    for (let b = lo; b < hi; b++) { cur[b] = Math.log1p(8 * Math.hypot(re[b], im[b]) / 32); const d = cur[b] - prev[b]; if (d > 0) { s += d; cw += d * b * binHz; } }
    flux[f] = s; cen[f] = s > 0 ? cw / s : 0; prev = cur;
  }
  const sm = new Float64Array(nf); for (let i = 0; i < nf; i++) sm[i] = (flux[Math.max(0, i - 1)] + 2 * flux[i] + flux[Math.min(nf - 1, i + 1)]) / 4;
  const on = new Float64Array(nf), W = 16; for (let i = 0; i < nf; i++) { let m = 0, c = 0; for (let j = Math.max(0, i - W); j <= Math.min(nf - 1, i + W); j++) { m += sm[j]; c++; } on[i] = Math.max(0, sm[i] - m / c); }
  const sorted = Array.from(on).sort((a, b) => a - b), p95 = sorted[Math.floor(nf * 0.95)] || 1; for (let i = 0; i < nf; i++) on[i] /= p95;
  const peaks = []; for (let i = 1; i < nf - 1; i++) if (on[i] > 0.3 && on[i] > on[i - 1] && on[i] >= on[i + 1]) peaks.push({ t: +((i * H + N / 2) / sr).toFixed(3), s: +on[i].toFixed(2), hz: Math.round(cen[i]) });
  // nhịp: tự tương quan của đường onset
  const cands = []; for (let bpm = 60; bpm <= 200; bpm += 0.5) { const lag = fps * 60 / bpm; let ac = 0, c = 0; for (let i = 0; i + Math.round(lag) < nf; i++) { const a = on[i], b = on[i + Math.round(lag)]; ac += a * b; c++; }
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 100) / 0.7, 2)); cands.push({ bpm, sc: ac / c * prior }); }
  cands.sort((a, b) => b.sc - a.sc); const top = []; for (const c of cands) if (!top.some(t => Math.abs(t.bpm - c.bpm) < 4)) top.push({ bpm: c.bpm, sc: +c.sc.toFixed(4) }); 
  const bpm = top[0].bpm, per = 60 / bpm; let bo = 0, bs = -1;
  for (let o = 0; o < per; o += 0.01) { let sc = 0; for (const p of peaks) { let d = ((p.t - o) % per + per) % per; if (d > per / 2) d -= per; sc += p.s * Math.exp(-d * d / (2 * 0.035 * 0.035)); } if (sc > bs) { bs = sc; bo = o; } }
  const r10 = []; for (let t = 0; t < dur; t += 0.1) { let m = 0, c = 0; for (let f = Math.floor(t * fps); f < Math.min(nf, Math.floor((t + 0.1) * fps)); f++) { m += rms[f]; c++; } r10.push(c ? m / c : 0); }
  const mx = Math.max(...r10); return { name, dur: +dur.toFixed(2), sr, top: top.slice(0, 5), bpm, phase: +bo.toFixed(2), npeaks: peaks.length, peaks, rms10: r10.map(v => +(v / mx).toFixed(2)) };
};

window.mkChart = (A, opt) => {
  const { minGap = 0.62, thr = 0.6, holdGap = 1.4 } = opt || {};
  const cand = A.peaks.filter(p => p.s >= thr && p.t > 0.7 && p.t < A.dur - 1.0).sort((a, b) => b.s - a.s);
  const taken = []; for (const p of cand) if (!taken.some(q => Math.abs(q.t - p.t) < minGap)) taken.push(p);
  taken.sort((a, b) => a.t - b.t);
  const hz = taken.map(p => p.hz).sort((a, b) => a - b), t1 = hz[Math.floor(hz.length / 3)], t2 = hz[Math.floor(hz.length * 2 / 3)];
  const out = []; let last = -1, run = 0;
  taken.forEach((p, i) => {
    let lane = p.hz < t1 ? 0 : p.hz < t2 ? 1 : 2;
    if (lane === last && run >= 2) lane = (lane + 1 + (i % 2)) % 3;          // không để cùng làn quá 3 nốt liền
    run = lane === last ? run + 1 : 1; last = lane;
    const nxt = taken[i + 1] ? taken[i + 1].t : A.dur, gap = nxt - p.t;
    let dur = 0;
    if (gap >= holdGap) {                                                    // chỉ làm nốt dài nếu nhạc còn ngân (RMS giữ được so với lúc bắt đầu)
      const a = Math.floor((p.t + 0.25) * 10), b = Math.floor((nxt - 0.45) * 10); let m = 0, c = 0; for (let k = a; k < b; k++) { m += A.rms10[k] || 0; c++; }
      const at = A.rms10[Math.floor(p.t * 10)] || 0.01; if (c && m / c >= 0.45 * Math.max(at, 0.2)) dur = +Math.min(gap - 0.55, 2.0).toFixed(2);
    }
    out.push([+(p.t - 0.03).toFixed(2), lane, dur]);
  });
  return out;
};

