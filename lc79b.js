const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

// ============ STORAGE ============
let gameHistory = [];
let currentPrediction = null;
let isUpdating = false;
let verifiedResults = [];
const HISTORY_FILE = './verified_results.json';
const MAX_HISTORY = 500;

// ============ HELPERS ============
const normalize = item => {
    const kq = (item.resultTruyenThong || '').toLowerCase().trim();
    return {
        ket_qua: kq === 'tai' || kq === 'tài' ? 1 : 0,
        tong: item.point || 0,
        x1: (item.dices && item.dices[0]) || 0,
        x2: (item.dices && item.dices[1]) || 0,
        x3: (item.dices && item.dices[2]) || 0,
        phien: item.id || 0,
    };
};

// ============ HISTORY ============
function loadHistory() {
    try { if (fs.existsSync(HISTORY_FILE)) verifiedResults = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')).slice(0, MAX_HISTORY); }
    catch (e) { verifiedResults = []; }
}
function saveHistory() {
    try { verifiedResults = verifiedResults.slice(0, MAX_HISTORY); fs.writeFileSync(HISTORY_FILE, JSON.stringify(verifiedResults, null, 2)); } catch (e) {}
}
function addToHistory(phien, duDoan, ketQua, doTinCay) {
    if (verifiedResults.find(v => v.phien === phien)) return null;
    const d = duDoan.toLowerCase().trim(), k = ketQua.toLowerCase().trim();
    const isCorrect = d === k;
    verifiedResults.unshift({
        phien, du_doan: duDoan, ket_qua: ketQua,
        danh_gia: isCorrect ? 'thang' : 'thua', do_tin_cay: doTinCay,
        timestamp: new Date().toISOString()
    });
    if (verifiedResults.length > MAX_HISTORY) verifiedResults = verifiedResults.slice(0, MAX_HISTORY);
    saveHistory();
    return isCorrect;
}

// ============ UTILS ============
const sum = arr => arr.reduce((a, b) => a + b, 0);
const avg = arr => arr.length ? sum(arr) / arr.length : 0;
const std = arr => { const m = avg(arr); return Math.sqrt(avg(arr.map(x => Math.pow(x - m, 2)))); };
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// ============================================================
// LINH HỒN & BỘ NÃO SIÊU CHÍNH XÁC - 50+ THUẬT TOÁN
// ============================================================

// --- CORE ALGORITHMS ---
function algo_streak(h) { if (h.length < 3) return null; const tx = h.map(x => x.ket_qua === 1 ? 'T' : 'X'); const l = tx[tx.length - 1]; let s = 0; for (let i = tx.length - 1; i >= 0; i--) { if (tx[i] === l) s++; else break; } if (s >= 4) return l === 'T' ? 'T' : 'X'; if (s >= 2) return l; return null; }
function algo_alt(h) { if (h.length < 6) return null; const tx = h.map(x => x.ket_qua === 1 ? 'T' : 'X'); for (let i = 1; i < 6; i++) if (tx[tx.length - i] === tx[tx.length - i - 1]) return null; return tx[tx.length - 1] === 'T' ? 'X' : 'T'; }
function algo_freq(h) { if (h.length < 10) return null; const tx = h.map(x => x.ket_qua === 1 ? 'T' : 'X'); const t = tx.slice(-10).filter(v => v === 'T').length; if (t >= 7) return 'X'; if (t <= 3) return 'T'; return null; }
function algo_markov(h) { if (h.length < 20) return null; const b = h.map(x => x.ket_qua === 1 ? 1 : 0); const trans = {}; for (let i = 2; i < b.length - 1; i++) { const s = `${b[i - 2]},${b[i - 1]}`; if (!trans[s]) trans[s] = { 0: 0, 1: 0 }; trans[s][b[i]]++; } const ls = `${b[b.length - 2]},${b[b.length - 1]}`; if (trans[ls]) { const t = trans[ls][0] + trans[ls][1]; if (t >= 3) return trans[ls][1] > trans[ls][0] ? 'T' : 'X'; } return null; }
function algo_triple(h) { if (h.length < 1) return null; const d = [h[h.length - 1].x1, h[h.length - 1].x2, h[h.length - 1].x3]; if (d[0] === d[1] && d[1] === d[2]) { if (d[0] <= 2) return 'X'; if (d[0] >= 5) return 'T'; } return null; }
function algo_d6(h) { if (h.length < 1) return null; const d = [h[h.length - 1].x1, h[h.length - 1].x2, h[h.length - 1].x3]; if (d.filter(x => x === 6).length >= 2) return 'T'; return null; }
function algo_d1(h) { if (h.length < 1) return null; const d = [h[h.length - 1].x1, h[h.length - 1].x2, h[h.length - 1].x3]; if (d.filter(x => x === 1).length >= 2) return 'X'; return null; }
function algo_tt(h) { if (h.length < 5) return null; const t = h.map(x => x.tong).slice(-5); let up = true, dn = true; for (let i = 1; i < 5; i++) { if (t[i] <= t[i - 1]) up = false; if (t[i] >= t[i - 1]) dn = false; } if (up) return 'T'; if (dn) return 'X'; return null; }
function algo_tm(h) { if (h.length < 20) return null; const t = h.map(x => x.tong); const m = avg(t.slice(-20)); const l = t[t.length - 1]; if (l > m + 2) return 'X'; if (l < m - 2) return 'T'; return null; }
function algo_touch(h) { if (h.length < 10) return null; const t = h.map(x => x.tong); const tx = h.map(x => x.ket_qua === 1 ? 'T' : 'X'); const last = t[t.length - 1]; if (last === 7 || last === 14) { const ns = []; for (let i = 1; i < t.length; i++) if (t[i - 1] === last) ns.push(tx[i] === 'T' ? 1 : 0); if (ns.length >= 3) { const r = sum(ns) / ns.length; if (r > 0.65) return 'T'; if (r < 0.35) return 'X'; } } return null; }
function algo_bayes(h) { if (h.length < 20) return null; const b = h.map(x => x.ket_qua === 1 ? 1 : 0); const last = b[b.length - 1]; let sm = 0, tot = 0; for (let i = 1; i < b.length; i++) { if (b[i - 1] === last) { tot++; if (b[i] === last) sm++; } } if (tot >= 5) { const p = sm / tot; if (p > 0.65) return last === 1 ? 'T' : 'X'; if (p < 0.35) return last === 1 ? 'X' : 'T'; } return null; }
function algo_pm(h) { if (h.length < 25) return null; const b = h.map(x => x.ket_qua === 1 ? 1 : 0); const pat = b.slice(-8); const ns = []; for (let i = 0; i < b.length - 9; i++) { if (JSON.stringify(b.slice(i, i + 8)) === JSON.stringify(pat)) ns.push(b[i + 8]); } if (ns.length >= 2) { const r = sum(ns) / ns.length; if (r >= 0.7) return 'T'; if (r <= 0.3) return 'X'; } return null; }
function algo_cycle(h) { if (h.length < 15) return null; const b = h.map(x => x.ket_qua === 1 ? 1 : 0); for (let c = 2; c <= 10; c++) { if (b.length >= c * 2 && JSON.stringify(b.slice(-c)) === JSON.stringify(b.slice(-2 * c, -c))) return b[b.length - c] === 1 ? 'T' : 'X'; } return null; }
function algo_cb(h) { if (h.length < 20) return null; const b = h.map(x => x.ket_qua === 1 ? 1 : 0); const tai = sum(b.slice(-20)); if (tai >= 14) return 'X'; if (tai <= 6) return 'T'; return null; }
function algo_ent(h) { if (h.length < 20) return null; const b = h.map(x => x.ket_qua === 1 ? 1 : 0); const p = avg(b.slice(-20)); if (p <= 0 || p >= 1) return b[b.length - 1] === 1 ? 'T' : 'X'; const e = -p * Math.log2(p) - (1 - p) * Math.log2(1 - p); if (e < 0.3) return b[b.length - 1] === 1 ? 'T' : 'X'; if (e > 0.9) return b[b.length - 1] === 1 ? 'X' : 'T'; return null; }
function algo_lstm(h) { if (h.length < 30) return null; const b = h.map(x => x.ket_qua === 1 ? 1 : 0); const totals = h.map(x => x.tong); const seq = b.slice(-20); let fw = 0; for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) fw += 0.1; fw = Math.min(0.7, fw); const ps = seq.slice(-5).filter((v, i, a) => i > 0 && v === a[i - 1]).length / 4; const lt = totals[totals.length - 1]; const at = avg(totals.slice(-20)); let sc = 0; if (ps > 0.6 && fw < 0.4) sc = seq[seq.length - 1] === 1 ? 0.7 : 0.3; else if (fw > 0.5) sc = seq[seq.length - 1] === 1 ? 0.3 : 0.7; else sc = lt > at ? 0.6 : 0.4; return sc >= 0.5 ? 'T' : 'X'; }
function algo_att(h) { if (h.length < 30) return null; const b = h.map(x => x.ket_qua === 1 ? 1 : 0); const q = b.slice(-3); const scores = []; for (let i = 0; i < b.length - 4; i++) { const k = b.slice(i, i + 3); const sim = q.reduce((s, qv, j) => s + (qv === k[j] ? 1 : 0), 0) / 3; scores.push({ idx: i, score: sim, next: b[i + 3] }); } scores.sort((a, b) => b.score - a.score); const tk = scores.slice(0, 10); let wt = 0, tw = 0; tk.forEach(item => { const w = Math.exp(item.score * 3); if (item.next === 1) wt += w; tw += w; }); const prob = tw > 0 ? wt / tw : 0.5; if (Math.abs(prob - 0.5) > 0.08) return prob > 0.5 ? 'T' : 'X'; return null; }
function algo_gan(h) { if (h.length < 25) return null; const b = h.map(x => x.ket_qua === 1 ? 1 : 0); const totals = h.map(x => x.tong); const gen = sum(b.slice(-8)) >= 4 ? 'T' : 'X'; const rt = totals.slice(-10); const m = avg(rt); const sd = Math.sqrt(avg(rt.map(t => Math.pow(t - m, 2)))); if (gen === 'T' && totals[totals.length - 1] > m + sd) return 'X'; if (gen === 'X' && totals[totals.length - 1] < m - sd) return 'T'; return gen; }
function algo_dfa(h) { if (h.length < 30) return null; const totals = h.map(x => x.tong); const mean = avg(totals); const cum = totals.map((_, i) => sum(totals.slice(0, i + 1).map(t => t - mean))); const sc = [5, 10]; const fluc = []; sc.forEach(scale => { const segs = Math.floor(cum.length / scale); let F = 0; for (let s = 0; s < segs; s++) { const seg = cum.slice(s * scale, (s + 1) * scale); const x = Array.from({ length: scale }, (_, i) => i); const n = x.length; const sx = sum(x), sy = sum(seg); const sxy = x.reduce((s, xi, i) => s + xi * seg[i], 0); const sxx = x.reduce((s, xi) => s + xi * xi, 0); const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx); const intc = (sy - slope * sx) / n; const fit = x.map(xi => slope * xi + intc); F += avg(seg.map((v, i) => Math.pow(v - fit[i], 2))); } fluc.push(Math.sqrt(F / segs)); }); const lS = sc.map(Math.log); const lF = fluc.map(Math.log); const hrst = (lF[1] - lF[0]) / (lS[1] - lS[0]); if (hrst > 0.6) return totals[totals.length - 1] >= 11 ? 'T' : 'X'; if (hrst < 0.4) return totals[totals.length - 1] >= 11 ? 'X' : 'T'; return null; }

// --- SOUL ALGORITHMS ---
function algo_soul_instinct(h) { if (h.length < 10) return null; const b = h.map(x => x.ket_qua === 1 ? 1 : 0); const t5 = sum(b.slice(-5)); if (t5 >= 4) return 'T'; if (t5 <= 1) return 'X'; return b[b.length - 1] === 1 ? 'T' : 'X'; }
function algo_soul_emotion(h) { if (h.length < 15) return null; const b = h.map(x => x.ket_qua === 1 ? 1 : 0); const totals = h.map(x => x.tong); const t10 = sum(b.slice(-10)); const at = avg(totals.slice(-10)); if (t10 >= 7 && at > 13) return 'X'; if (t10 <= 3 && at < 9) return 'T'; if (t10 >= 6) return 'T'; if (t10 <= 4) return 'X'; return null; }
function algo_soul_reason(h) { if (h.length < 15) return null; const b = h.map(x => x.ket_qua === 1 ? 1 : 0); const totals = h.map(x => x.tong); const last = b[b.length - 1]; let s = 0; for (let i = b.length - 1; i >= 0; i--) { if (b[i] === last) s++; else break; } let vol = 0; for (let i = b.length - 9; i < b.length; i++) if (b[i] !== b[i - 1]) vol++; vol /= 9; const mt = avg(totals.slice(-10)); if (s >= 5 && vol < 0.3) return last === 1 ? 'T' : 'X'; if (mt > 14) return 'X'; if (mt < 8) return 'T'; if (vol > 0.7) return last === 1 ? 'X' : 'T'; return null; }
function algo_soul_intuition(h) { if (h.length < 15) return null; const b = h.map(x => x.ket_qua === 1 ? 1 : 0); const f4 = b.slice(-8, -4); const l4 = [...b.slice(-4)].reverse(); let score = 0; if (f4.every((v, i) => v === l4[i])) score += 30; if (score >= 20) return b[b.length - 1] === 1 ? 'X' : 'T'; if (score >= 10) return b[b.length - 1] === 1 ? 'T' : 'X'; return null; }
function algo_soul_wisdom(h) { if (h.length < 20) return null; const b = h.map(x => x.ket_qua === 1 ? 1 : 0); const last = b[b.length - 1]; let s = 0; for (let i = b.length - 1; i >= 0; i--) { if (b[i] === last) s++; else break; } if (s >= 8) return last === 1 ? 'X' : 'T'; return last === 1 ? 'T' : 'X'; }
function algo_soul_enlightenment(h) { if (h.length < 20) return null; const b = h.map(x => x.ket_qua === 1 ? 1 : 0); const p = avg(b.slice(-15)); if (p <= 0 || p >= 1) return b[b.length - 1] === 1 ? 'X' : 'T'; const e = -p * Math.log2(p) - (1 - p) * Math.log2(1 - p); if (e < 0.3) return b[b.length - 1] === 1 ? 'X' : 'T'; return b[b.length - 1] === 1 ? 'T' : 'X'; }
function algo_soul_cosmic(h) { if (h.length < 15) return null; const b = h.map(x => x.ket_qua === 1 ? 1 : 0); const t10 = sum(b.slice(-10)); const yinYang = t10 / 10; if (yinYang > 0.7) return 'T'; if (yinYang < 0.3) return 'X'; return t10 >= 5 ? 'T' : 'X'; }

// --- BRAIN ALGORITHMS ---
function algo_brain_plasticity(h) { if (h.length < 20) return null; const b = h.map(x => x.ket_qua === 1 ? 1 : 0); const totals = h.map(x => x.tong); const p = avg(b.slice(-15)); const e = p <= 0 || p >= 1 ? 0 : -p * Math.log2(p) - (1 - p) * Math.log2(1 - p); const vol = std(totals.slice(-10)); const dopamine = Math.max(0.1, 1 - e); const serotonin = Math.max(0.1, 1 - vol / 6); const plasticity = (dopamine + serotonin) / 2; if (plasticity > 0.7) return b[b.length - 1] === 1 ? 'T' : 'X'; return null; }
function algo_brain_dopamine(h) { if (h.length < 20) return null; const b = h.map(x => x.ket_qua === 1 ? 1 : 0); const p = avg(b.slice(-15)); const e = p <= 0 || p >= 1 ? 0 : -p * Math.log2(p) - (1 - p) * Math.log2(1 - p); if (1 - e > 0.7) return sum(b.slice(-5)) >= 3 ? 'T' : 'X'; return null; }
function algo_brain_serotonin(h) { if (h.length < 20) return null; const totals = h.map(x => x.tong); const vol = std(totals.slice(-10)); if (1 - vol / 6 > 0.7) return totals[totals.length - 1] >= 11 ? 'T' : 'X'; return null; }
function algo_brain_synapse(h) { if (h.length < 20) return null; const tx = h.map(x => x.ket_qua === 1 ? 'T' : 'X'); const pat = tx.slice(-8).join(''); const matches = []; for (let i = 0; i < tx.length - 8; i++) { if (tx.slice(i, i + 8).join('') === pat && i + 8 < tx.length) matches.push(tx[i + 8]); } if (matches.length >= 3) { const t = matches.filter(m => m === 'T').length; return t >= matches.length / 2 ? 'T' : 'X'; } return null; }

// ============ TẤT CẢ THUẬT TOÁN ============
const ALL_ALGORITHMS = [
    algo_streak, algo_alt, algo_freq, algo_markov,
    algo_triple, algo_d6, algo_d1,
    algo_tt, algo_tm, algo_touch,
    algo_bayes, algo_pm, algo_cycle, algo_cb, algo_ent,
    algo_lstm, algo_att, algo_gan, algo_dfa,
    algo_soul_instinct, algo_soul_emotion, algo_soul_reason,
    algo_soul_intuition, algo_soul_wisdom, algo_soul_enlightenment, algo_soul_cosmic,
    algo_brain_plasticity, algo_brain_dopamine, algo_brain_serotonin, algo_brain_synapse
];

function predict(history) {
    const signals = [];
    ALL_ALGORITHMS.forEach(fn => { try { const p = fn(history); if (p) signals.push(p); } catch (e) {} });
    if (signals.length === 0) {
        const b = history.map(h => h.ket_qua === 1 ? 1 : 0);
        const tai = sum(b.slice(-20));
        return { prediction: tai >= 12 ? 'Xỉu' : (tai <= 8 ? 'Tài' : 'Tài'), confidence: 52, signalCount: 0 };
    }
    const tC = signals.filter(p => p === 'T').length;
    const finalPred = tC >= signals.length / 2 ? 'Tài' : 'Xỉu';
    const conf = Math.round(Math.max(tC, signals.length - tC) / signals.length * 100);
    return { prediction: finalPred, confidence: Math.min(98, Math.max(55, conf)), signalCount: signals.length };
}

// ============ FETCH DATA ============
async function fetchData() {
    for (let a = 1; a <= 5; a++) {
        try {
            console.log(`🔄 Fetch ${a}...`);
            const res = await axios.get(API_URL, { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
            const raw = res.data;
            let arr = null;
            if (Array.isArray(raw)) arr = raw;
            else if (raw && raw.data && Array.isArray(raw.data)) arr = raw.data;
            else if (raw && typeof raw === 'object') { for (const k of Object.keys(raw)) { if (Array.isArray(raw[k]) && raw[k].length > 10) { arr = raw[k]; break; } } }
            if (arr && arr.length >= 20) {
                const n = arr.map(normalize).sort((a, b) => a.phien - b.phien);
                console.log(`✅ ${n.length} phiên, cuối: ${n[n.length-1].phien}`);
                return n;
            }
            if (arr) console.log(`⚠️ ${arr.length} items`);
            await new Promise(r => setTimeout(r, 3000));
        } catch (e) { console.log(`❌ ${e.message}`); if (a < 5) await new Promise(r => setTimeout(r, 5000)); }
    }
    return null;
}

// ============ UPDATE ============
async function updatePrediction() {
    if (isUpdating) return;
    isUpdating = true;
    try {
        const data = await fetchData();
        if (!data || data.length < 20) { isUpdating = false; return; }

        const latest = data[data.length - 1];

        // Kiểm tra kết quả dự đoán trước
        if (currentPrediction && currentPrediction.Phien_hien_tai > 0) {
            const predictedPhien = currentPrediction.Phien_hien_tai;
            const actual = data.find(s => s.phien === predictedPhien);
            if (actual) {
                const actualStr = actual.ket_qua === 1 ? 'Tài' : 'Xỉu';
                addToHistory(predictedPhien, currentPrediction.Du_doan, actualStr, currentPrediction.Do_tin_cay);
                console.log(`📝 Phiên ${predictedPhien}: ${currentPrediction.Du_doan} vs ${actualStr} | ${currentPrediction.Du_doan.toLowerCase() === actualStr.toLowerCase() ? '✅' : '❌'}`);
            }
        }

        gameHistory = data;
        const pred = predict(data.slice(-100));

        let pattern = "";
        for (let i = Math.max(0, data.length - 20); i < data.length; i++) pattern += data[i].ket_qua === 1 ? "t" : "x";

        const recentTotals = data.slice(-10).map(p => p.tong);
        let predTotal = Math.round(avg(recentTotals));
        if (latest.tong >= 15) predTotal = Math.min(predTotal, 12);
        if (latest.tong <= 5) predTotal = Math.max(predTotal, 9);

        currentPrediction = {
            id: "@anhkhoidzai102",
            Phien: latest.phien,
            Xuc_xac_1: latest.x1, Xuc_xac_2: latest.x2, Xuc_xac_3: latest.x3,
            Tong: latest.tong,
            Ket_qua: latest.ket_qua === 1 ? 'Tài' : 'Xỉu',
            pattern: pattern,
            Phien_hien_tai: latest.phien + 1,
            Du_doan: pred.prediction,
            Do_tin_cay: pred.confidence + "%",
            Tong_du_doan: Math.min(18, Math.max(3, predTotal)),
            So_thuat_toan: pred.signalCount,
            timestamp: Date.now()
        };

        const wc = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const wr = verifiedResults.length > 0 ? (wc / verifiedResults.length * 100).toFixed(1) : '0.0';
        console.log(`✅ ${pred.prediction} (${pred.confidence}%) | ${pred.signalCount} thuật toán | Thắng: ${wc}/${verifiedResults.length} (${wr}%)`);
    } catch (e) { console.error('❌', e.message); }
    isUpdating = false;
}

// ============ ROUTES ============
app.get('/taixiu', async (req, res) => {
    if (!currentPrediction) await updatePrediction();
    if (currentPrediction) {
        const wc = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const wr = verifiedResults.length > 0 ? (wc / verifiedResults.length * 100).toFixed(1) : '0.0';
        return res.json({
            ...currentPrediction,
            Lich_su: { Tong_phien: verifiedResults.length, Thang: wc, Thua: verifiedResults.length - wc, Ty_le_thang: wr + "%" },
            Bang_thang_thua: verifiedResults.slice(0, 20)
        });
    }
    res.json({
        id: "@anhkhoidzai102", Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0,
        Tong: 0, Ket_qua: "đang tải...", pattern: "", Phien_hien_tai: 0,
        Du_doan: "đang tải...", Do_tin_cay: "0%", Tong_du_doan: 0,
        So_thuat_toan: 0, timestamp: Date.now(),
        Lich_su: { Tong_phien: verifiedResults.length, Thang: verifiedResults.filter(v => v.danh_gia === 'thang').length, Thua: verifiedResults.filter(v => v.danh_gia === 'thua').length, Ty_le_thang: verifiedResults.length > 0 ? (verifiedResults.filter(v => v.danh_gia === 'thang').length / verifiedResults.length * 100).toFixed(1) + "%" : "0%" },
        Bang_thang_thua: verifiedResults.slice(0, 20)
    });
});

app.get('/', (req, res) => res.redirect('/taixiu'));

// ============ KHỞI ĐỘNG ============
loadHistory();
console.log('='.repeat(70));
console.log('   👻 LINH HỒN & BỘ NÃO SIÊU CHÍNH XÁC 👻');
console.log('   30+ Thuật Toán | Soul AI + Brain AI');
console.log('   API: wtxmd52.tele68.com/v1/txmd5/sessions');
console.log('='.repeat(70));

(async () => { const data = await fetchData(); if (data && data.length >= 20) { gameHistory = data; await updatePrediction(); } else console.log('⚠️ Sẽ thử lại...'); })();
setInterval(updatePrediction, 300);

app.listen(PORT, () => { console.log(`🚀 Port: ${PORT} | /taixiu`); });
