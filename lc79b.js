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
    verifiedResults.unshift({ phien, du_doan: duDoan, ket_qua: ketQua, danh_gia: isCorrect ? 'thang' : 'thua', do_tin_cay: doTinCay, timestamp: new Date().toISOString() });
    if (verifiedResults.length > MAX_HISTORY) verifiedResults = verifiedResults.slice(0, MAX_HISTORY);
    saveHistory();
    return isCorrect;
}

// ============ UTILS ============
const sum = arr => arr.reduce((a, b) => a + b, 0);
const avg = arr => arr.length ? sum(arr) / arr.length : 0;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// Màu xanh dương ANSI
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

// ============================================================
// ULTIMATE FINAL - 10 MODULE CHUYÊN SÂU
// ============================================================

class UltimateFinal {
    constructor() {
        this.memory = [];
        this.total = 0;
        this.correct = 0;
    }

    analyze(arr) {
        const n = arr.length;
        if (n < 20) return { result: 'WAIT', confidence: 0, msg: 'Cần ≥ 20 phiên' };

        const data = this._prepareData(arr);
        const { binary, values, strength, deviation } = data;

        const structure = this._analyzeStructure(binary, strength);
        const rhythm = this._analyzeRhythm(binary, deviation);
        const wave = this._analyzeWave(binary, strength);
        const energy = this._analyzeEnergy(strength, binary);
        const reversal = this._detectReversal(binary, strength, deviation);
        const probability = this._analyzeProbability(binary, strength);
        const anomaly = this._detectAnomaly(binary, values, deviation);
        const hiddenCycle = this._detectHiddenCycle(binary);
        const crowdPsychology = this._analyzeCrowdPsychology(binary, strength);
        const dynamics = this._analyzeDynamics(binary, deviation);

        const finalResult = this._synthesizeAll(
            structure, rhythm, wave, energy, reversal,
            probability, anomaly, hiddenCycle, crowdPsychology, dynamics
        );

        this.total++;
        this.memory.push({ result: finalResult, time: Date.now() });
        return finalResult;
    }

    _prepareData(arr) {
        const n = arr.length;
        const binary = arr.map(v => v.tong >= 11 ? 1 : 0);
        const values = arr.map(v => v.tong);
        const strength = arr.map(v => {
            const t = v.tong;
            if (t >= 15) return 5; if (t >= 13) return 4; if (t >= 11) return 3;
            if (t <= 4) return -5; if (t <= 6) return -4; if (t <= 8) return -3;
            return 0;
        });
        const deviation = arr.map(v => Math.abs(v.tong - 9.5));
        return { n, binary, values, strength, deviation };
    }

    _analyzeStructure(binary, strength) {
        const n = binary.length;
        const streaks = [];
        let cs = { value: binary[0], length: 1, totalS: Math.abs(strength[0]) };
        for (let i = 1; i < n; i++) {
            if (binary[i] === cs.value) { cs.length++; cs.totalS += Math.abs(strength[i]); }
            else { streaks.push({ ...cs, avgS: cs.totalS / cs.length }); cs = { value: binary[i], length: 1, totalS: Math.abs(strength[i]) }; }
        }
        streaks.push({ ...cs, avgS: cs.totalS / cs.length });
        const cur = streaks[streaks.length - 1];
        const maxS = Math.max(...streaks.map(s => s.length));
        let type;
        if (cur.length >= 8) type = 'LONG_STREAK';
        else if (cur.length >= 5) type = 'MEDIUM_STREAK';
        else if (cur.length >= 3) type = 'SHORT_STREAK';
        else type = 'ALTERNATING';

        let pred, conf;
        if (type === 'LONG_STREAK') {
            if (cur.length >= maxS) { pred = cur.value === 1 ? 'Xỉu' : 'Tài'; conf = 82; }
            else if (cur.avgS >= 3) { pred = cur.value === 1 ? 'Tài' : 'Xỉu'; conf = 88; }
            else { pred = cur.value === 1 ? 'Tài' : 'Xỉu'; conf = 78; }
        } else if (type === 'ALTERNATING') {
            pred = cur.value === 1 ? 'Xỉu' : 'Tài'; conf = 85;
        } else { pred = cur.value === 1 ? 'Tài' : 'Xỉu'; conf = 62; }
        return { prediction: pred, confidence: conf, structureType: type, currentStreak: cur.length };
    }

    _analyzeRhythm(binary, deviation) {
        const n = binary.length;
        let rev = 0;
        for (let i = 1; i < n; i++) if (binary[i] !== binary[i - 1]) rev++;
        const rate = rev / (n - 1);
        let type;
        if (rate >= 0.7) type = 'FAST';
        else if (rate >= 0.5) type = 'MODERATE';
        else if (rate >= 0.3) type = 'SLOW';
        else type = 'VERY_SLOW';
        const last = binary[n - 1];
        let pred, conf;
        if (type === 'FAST') { pred = last === 1 ? 'Xỉu' : 'Tài'; conf = rate * 100; }
        else if (type === 'VERY_SLOW') { pred = last === 1 ? 'Tài' : 'Xỉu'; conf = (1 - rate) * 100; }
        else { pred = last === 1 ? 'Tài' : 'Xỉu'; conf = 60; }
        return { prediction: pred, confidence: Math.min(90, conf), rhythmType: type };
    }

    _analyzeWave(binary, strength) {
        const n = binary.length;
        const peaks = [], troughs = [];
        for (let i = 2; i < n - 2; i++) {
            if (strength[i] > strength[i - 1] && strength[i] > strength[i + 1]) peaks.push(i);
            if (strength[i] < strength[i - 1] && strength[i] < strength[i + 1]) troughs.push(i);
        }
        let phase = 'NEUTRAL';
        if (peaks.length > troughs.length) phase = 'RISING';
        else if (troughs.length > peaks.length) phase = 'DECLINING';
        const last = binary[n - 1];
        let pred, conf;
        if (phase === 'RISING') { pred = last === 1 ? 'Tài' : 'Xỉu'; conf = 78; }
        else if (phase === 'DECLINING') { pred = last === 1 ? 'Xỉu' : 'Tài'; conf = 78; }
        else { pred = last === 1 ? 'Tài' : 'Xỉu'; conf = 58; }
        return { prediction: pred, confidence: conf, wavePhase: phase };
    }

    _analyzeEnergy(strength, binary) {
        const n = strength.length;
        const absS = strength.map(Math.abs);
        const avgE = avg(absS);
        const recentE = avg(absS.slice(-10));
        let state;
        if (recentE >= 3.5) state = 'EXPLOSIVE';
        else if (recentE >= 2.5) state = 'HIGH';
        else if (recentE >= 1.5) state = 'NORMAL';
        else state = 'LOW';
        const last = binary[n - 1];
        let pred, conf;
        if (state === 'EXPLOSIVE') { pred = last === 1 ? 'Tài' : 'Xỉu'; conf = 85; }
        else if (state === 'LOW') { pred = last === 1 ? 'Xỉu' : 'Tài'; conf = 72; }
        else { pred = last === 1 ? 'Tài' : 'Xỉu'; conf = 62; }
        return { prediction: pred, confidence: conf, energyState: state };
    }

    _detectReversal(binary, strength, deviation) {
        const n = binary.length;
        const last = binary[n - 1];
        let score = 0;
        const signals = [];
        if (n >= 10) {
            const pT = binary.slice(-5).reduce((a, b) => a + b, 0) - binary.slice(-10, -5).reduce((a, b) => a + b, 0);
            const sT = strength.slice(-5).reduce((a, b) => Math.abs(a) + Math.abs(b), 0) - strength.slice(-10, -5).reduce((a, b) => Math.abs(a) + Math.abs(b), 0);
            if (pT > 0 && sT < 0) { score += 30; signals.push('BEARISH_DIVERGENCE'); }
            if (pT < 0 && sT > 0) { score += 30; signals.push('BULLISH_DIVERGENCE'); }
        }
        const avgD = avg(deviation.slice(-5));
        if (avgD >= 4.5) { score += 25; signals.push('EXTREME_DEVIATION'); }
        let rc = 0;
        for (let i = n - 5; i < n - 1; i++) if (binary[i] !== binary[i + 1]) rc++;
        if (rc >= 3) { score += 20; signals.push('RAPID_CHANGES'); }
        const wr = score >= 40;
        return { prediction: wr ? (last === 1 ? 'Xỉu' : 'Tài') : (last === 1 ? 'Tài' : 'Xỉu'), confidence: Math.min(90, score + 25), willReverse: wr, reversalScore: score, signals, severity: score >= 60 ? 'STRONG' : score >= 40 ? 'MODERATE' : 'WEAK' };
    }

    _analyzeProbability(binary, strength) {
        const n = binary.length;
        const last = binary[n - 1];
        const ls = Math.abs(strength[n - 1]);
        let sc = 0, nt = 0;
        for (let i = 1; i < n - 1; i++) { if (binary[i] === last && Math.abs(Math.abs(strength[i]) - ls) <= 1) { sc++; if (binary[i + 1] === 1) nt++; } }
        const cp = sc > 0 ? nt / sc : 0.5;
        const prior = sum(binary) / n;
        const likelihood = sum(binary.slice(-10)) / 10;
        const posterior = likelihood * 0.6 + prior * 0.4;
        const combined = cp * 0.5 + posterior * 0.5;
        return { prediction: combined >= 0.5 ? 'Tài' : 'Xỉu', confidence: Math.abs(combined - 0.5) * 180 + 50 };
    }

    _detectAnomaly(binary, values, deviation) {
        const n = values.length;
        let score = 0;
        const anomalies = [];
        const mean = avg(values);
        const stdD = Math.sqrt(avg(values.map(v => Math.pow(v - mean, 2))));
        if (Math.abs(values[n - 1] - mean) > 3 * stdD) { score += 35; anomalies.push('OUTLIER'); }
        const last = binary[n - 1];
        let s = 0;
        for (let i = n - 1; i >= 0; i--) { if (binary[i] === last) s++; else break; }
        if (s >= 12) { score += 40; anomalies.push('EXTREME_STREAK'); }
        else if (s >= 9) { score += 25; anomalies.push('LONG_STREAK'); }
        const ia = score >= 50;
        return { prediction: ia ? (last === 1 ? 'Xỉu' : 'Tài') : (last === 1 ? 'Tài' : 'Xỉu'), confidence: Math.min(88, score + 20), isAnomaly: ia, anomalies, level: score >= 70 ? 'CRITICAL' : score >= 50 ? 'WARNING' : 'NORMAL' };
    }

    _detectHiddenCycle(binary) {
        const n = binary.length;
        const cycles = [];
        for (let lag = 2; lag <= Math.min(20, Math.floor(n / 2)); lag++) {
            let corr = 0;
            for (let i = n - 1; i >= lag; i--) if (binary[i] === binary[i - lag]) corr++;
            const rate = corr / (n - lag);
            if (rate >= 0.65) cycles.push({ length: lag, correlation: rate });
        }
        cycles.sort((a, b) => b.correlation - a.correlation);
        const best = cycles[0];
        if (best && best.correlation >= 0.75) return { prediction: binary[n - best.length] === 1 ? 'Tài' : 'Xỉu', confidence: Math.min(90, 55 + best.correlation * 40), bestCycle: best.length };
        return { prediction: binary[n - 1] === 1 ? 'Tài' : 'Xỉu', confidence: 50, bestCycle: null };
    }

    _analyzeCrowdPsychology(binary, strength) {
        const recentS = strength.slice(-10);
        const greed = recentS.filter(s => s >= 3).length;
        const fear = recentS.filter(s => s <= -3).length;
        let state;
        if (greed >= 6) state = 'EXTREME_GREED';
        else if (fear >= 6) state = 'EXTREME_FEAR';
        else if (greed >= 4) state = 'GREED';
        else if (fear >= 4) state = 'FEAR';
        else state = 'NEUTRAL';
        const last = binary[n - 1];
        let pred, conf;
        if (state === 'EXTREME_GREED') { pred = last === 1 ? 'Xỉu' : 'Tài'; conf = 82; }
        else if (state === 'EXTREME_FEAR') { pred = last === 1 ? 'Tài' : 'Xỉu'; conf = 82; }
        else { pred = last === 1 ? 'Tài' : 'Xỉu'; conf = 60; }
        return { prediction: pred, confidence: conf, psychologyState: state };
    }

    _analyzeDynamics(binary, deviation) {
        const n = binary.length;
        const m5 = sum(binary.slice(-5));
        const m10 = sum(binary.slice(-10));
        const acc = m5 / 5 - m10 / 10;
        let state;
        if (acc > 0.2) state = 'STRONG_BULL';
        else if (acc > 0.1) state = 'WEAK_BULL';
        else if (acc < -0.2) state = 'STRONG_BEAR';
        else if (acc < -0.1) state = 'WEAK_BEAR';
        else state = 'NEUTRAL';
        const last = binary[n - 1];
        let pred, conf;
        if (state.includes('STRONG')) { pred = state.includes('BULL') ? 'Tài' : 'Xỉu'; conf = 80; }
        else if (state.includes('WEAK')) { pred = state.includes('BULL') ? 'Tài' : 'Xỉu'; conf = 68; }
        else { pred = last === 1 ? 'Tài' : 'Xỉu'; conf = 58; }
        return { prediction: pred, confidence: conf, dynamicsState: state };
    }

    _synthesizeAll(structure, rhythm, wave, energy, reversal, probability, anomaly, hiddenCycle, crowd, dynamics) {
        const modules = [
            { ...structure, weight: 0.20 }, { ...rhythm, weight: 0.10 }, { ...wave, weight: 0.10 },
            { ...energy, weight: 0.15 }, { ...reversal, weight: 0.15 }, { ...probability, weight: 0.10 },
            { ...anomaly, weight: 0.10 }, { ...hiddenCycle, weight: 0.05 }, { ...crowd, weight: 0.03 }, { ...dynamics, weight: 0.02 }
        ];
        let tai = 0, xiu = 0, tw = 0;
        modules.forEach(m => { const w = m.weight * (m.confidence / 100); if (m.prediction === 'Tài') tai += w; else if (m.prediction === 'Xỉu') xiu += w; tw += w; });
        const taiP = tw > 0 ? (tai / tw) * 100 : 50;
        const xiuP = tw > 0 ? (xiu / tw) * 100 : 50;
        let final, conf, reason;
        if (reversal.willReverse && reversal.severity === 'STRONG') { final = reversal.prediction; conf = Math.min(95, reversal.confidence + 5); reason = `ĐẢO CHIỀU MẠNH: ${reversal.signals.join(', ')}`; }
        else if (anomaly.isAnomaly && anomaly.level === 'CRITICAL') { final = anomaly.prediction; conf = anomaly.confidence; reason = `DỊ THƯỜNG: ${anomaly.anomalies.join(', ')}`; }
        else { final = taiP >= xiuP ? 'Tài' : 'Xỉu'; conf = Math.max(taiP, xiuP); reason = 'TỔNG HỢP CÓ TRỌNG SỐ'; }
        let stars;
        if (conf >= 90) stars = '⭐⭐⭐⭐⭐';
        else if (conf >= 80) stars = '⭐⭐⭐⭐';
        else if (conf >= 70) stars = '⭐⭐⭐';
        else if (conf >= 60) stars = '⭐⭐';
        else stars = '⭐';
        return { result: final, confidence: parseFloat(conf.toFixed(1)), stars, reason, scores: { tai: parseFloat(taiP.toFixed(1)), xiu: parseFloat(xiuP.toFixed(1)) } };
    }
}

// ============ FETCH DATA ============
async function fetchData() {
    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            const res = await axios.get(API_URL, { timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0' } });
            const raw = res.data;
            let arr = null;
            if (Array.isArray(raw)) arr = raw;
            else if (raw && raw.data && Array.isArray(raw.data)) arr = raw.data;
            else if (raw && typeof raw === 'object') { for (const key of Object.keys(raw)) { if (Array.isArray(raw[key]) && raw[key].length > 10) { arr = raw[key]; break; } } }
            if (arr && arr.length >= 20) { const n = arr.map(normalize).sort((a, b) => a.phien - b.phien); return n; }
            await new Promise(r => setTimeout(r, 3000));
        } catch (e) { if (attempt < 5) await new Promise(r => setTimeout(r, 5000)); }
    }
    return gameHistory.length >= 20 ? gameHistory : null;
}

// ============ UPDATE ============
let engine = null;
async function updatePrediction() {
    if (isUpdating) return;
    isUpdating = true;
    try {
        const data = await fetchData();
        if (!data || data.length < 20) { isUpdating = false; return; }
        const latest = data[data.length - 1];
        const latestPhien = latest.phien;
        const oldPhien = gameHistory.length > 0 ? gameHistory[gameHistory.length - 1].phien : 0;

        if (currentPrediction && currentPrediction.Phien_hien_tai > 0) {
            const predictedPhien = currentPrediction.Phien_hien_tai;
            const actual = data.find(s => s.phien === predictedPhien);
            if (actual) {
                const actualStr = actual.ket_qua === 1 ? 'Tài' : 'Xỉu';
                addToHistory(predictedPhien, currentPrediction.Du_doan, actualStr, currentPrediction.Do_tin_cay);
                console.log(BLUE + `📝 Phiên ${predictedPhien}: ${currentPrediction.Du_doan} vs ${actualStr}` + RESET);
            }
        }
        if (latestPhien === oldPhien && currentPrediction) { isUpdating = false; return; }

        gameHistory = data;
        engine = new UltimateFinal();
        const pred = engine.analyze(data.slice(-100));

        let pattern = "";
        for (let i = Math.max(0, data.length - 20); i < data.length; i++) pattern += data[i].ket_qua === 1 ? "t" : "x";

        const last = data[data.length - 1];
        const recentTotals = data.slice(-10).map(p => p.tong);
        let predTotal = Math.round(avg(recentTotals));
        if (last.tong >= 15) predTotal = Math.min(predTotal, 12);
        if (last.tong <= 5) predTotal = Math.max(predTotal, 9);
        predTotal = clamp(predTotal, 3, 18);

        currentPrediction = {
            id: "@anhkhoidzai102",
            Phien: latest.phien,
            Xuc_xac_1: last.x1, Xuc_xac_2: last.x2, Xuc_xac_3: last.x3,
            Tong: last.tong, Ket_qua: last.ket_qua === 1 ? 'Tài' : 'Xỉu',
            pattern: pattern, Phien_hien_tai: latest.phien + 1,
            Du_doan: pred.result, Do_tin_cay: pred.confidence + "%",
            Tong_du_doan: predTotal, Xep_hang: pred.stars,
            Ly_do: pred.reason,
            Diem_Tai: pred.scores.tai + '%', Diem_Xiu: pred.scores.xiu + '%',
            timestamp: Date.now()
        };

        const winCount = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = verifiedResults.length > 0 ? (winCount / verifiedResults.length * 100).toFixed(1) : '0.0';
        console.log(BLUE + `✅ ${pred.result} (${pred.confidence}%) | ${pred.stars} | Thắng: ${winCount}/${verifiedResults.length} (${winRate}%)` + RESET);
    } catch (e) { console.error('\x1b[31m❌', e.message, RESET); }
    isUpdating = false;
}

// ============ ROUTES ============
app.get('/taixiu', async (req, res) => {
    if (!currentPrediction) await updatePrediction();
    if (currentPrediction) {
        const wc = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const wr = verifiedResults.length > 0 ? (wc / verifiedResults.length * 100).toFixed(1) : '0.0';
        return res.json({ ...currentPrediction, Lich_su: { Tong_phien: verifiedResults.length, Thang: wc, Thua: verifiedResults.length - wc, Ty_le_thang: wr + "%" }, Bang_thang_thua: verifiedResults.slice(0, 20) });
    }
    res.json({ id: "@anhkhoidzai102", Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "đang tải...", pattern: "", Phien_hien_tai: 0, Du_doan: "đang tải...", Do_tin_cay: "0%", Tong_du_doan: 0, Xep_hang: "", Ly_do: "", Diem_Tai: "0%", Diem_Xiu: "0%", timestamp: Date.now(), Lich_su: { Tong_phien: verifiedResults.length, Thang: verifiedResults.filter(v => v.danh_gia === 'thang').length, Thua: verifiedResults.filter(v => v.danh_gia === 'thua').length, Ty_le_thang: verifiedResults.length > 0 ? (verifiedResults.filter(v => v.danh_gia === 'thang').length / verifiedResults.length * 100).toFixed(1) + "%" : "0%" }, Bang_thang_thua: verifiedResults.slice(0, 20) });
});

app.get('/', (req, res) => res.redirect('/taixiu'));

// ============ KHỞI ĐỘNG ============
loadHistory();
console.log(BLUE + '='.repeat(70) + RESET);
console.log(BLUE + '   💎 ULTIMATE FINAL - 10 MODULE CHUYÊN SÂU 💎' + RESET);
console.log(BLUE + '   API: wtxmd52.tele68.com/v1/txmd5/sessions' + RESET);
console.log(BLUE + '='.repeat(70) + RESET);

(async () => { const data = await fetchData(); if (data && data.length >= 20) { gameHistory = data; await updatePrediction(); } })();
setInterval(updatePrediction, 300);

app.listen(PORT, () => { console.log(BLUE + `   🚀 Port: ${PORT} | /taixiu` + RESET); console.log(BLUE + `   📂 Lịch sử: ${verifiedResults.length} phiên` + RESET); console.log(BLUE + '='.repeat(70) + RESET); });
