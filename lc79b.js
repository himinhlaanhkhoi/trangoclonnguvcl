const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

let gameHistory = [];
let currentPrediction = null;
let isUpdating = false;
let verifiedResults = [];
const HISTORY_FILE = './verified_results.json';
const MAX_HISTORY = 30000;

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

const sum = arr => arr.reduce((a, b) => a + b, 0);
const avg = arr => arr.length ? sum(arr) / arr.length : 0;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

class SuperBrainAI {
    constructor() {
        this.memory = { shortTerm: [], longTerm: new Map() };
        this.state = { totalPredictions: 0, streakCorrect: 0 };
    }

    predict(history) {
        if (!history || history.length < 8) return this._fallback('Cần ≥ 8 phiên');

        const bin = history.map(h => h.ket_qua === 1 ? 1 : 0);
        const totals = history.map(h => h.tong);
        const n = bin.length;
        const last = bin[n - 1];

        const allCaus = this._detectAllCaus(bin, totals, n, last);
        const house = this._analyzeHouse(bin, n, last);
        const trapOpp = this._detectTrap(bin, totals, n, last, allCaus, house);
        const final = this._makeDecision(allCaus, house, trapOpp, last);

        this.state.totalPredictions++;
        return final;
    }

    _detectAllCaus(bin, totals, n, last) {
        const caus = [];
        let streak = 0;
        for (let i = n - 1; i >= 0; i--) { if (bin[i] === last) streak++; else break; }
        let manh = 0;
        for (let i = n - 1; i >= n - streak && i >= 0; i--) manh += last === 1 ? Math.max(0, totals[i] - 11) : Math.max(0, 10 - totals[i]);
        const avgManh = streak > 0 ? manh / streak : 0;

        if (streak >= 12) caus.push({ t: 'SIÊU BỆT', p: avgManh < 1.5 ? (last ? 'X' : 'T') : (last ? 'T' : 'X'), c: avgManh < 1.5 ? 92 : 88 });
        else if (streak >= 8) caus.push({ t: 'ĐẠI BỆT', p: avgManh > 2 ? (last ? 'T' : 'X') : (last ? 'X' : 'T'), c: avgManh > 2 ? 83 : 88 });
        else if (streak >= 5) caus.push({ t: 'BỆT VỪA', p: last ? 'T' : 'X', c: 76 });
        else if (streak >= 2) caus.push({ t: 'BỆT NGẮN', p: last ? 'T' : 'X', c: 64 });

        if (n >= 8) { const l8 = bin.slice(-8).join(''); if (l8 === '11001100') caus.push({ t: 'KÉP 2-2 T', p: 'T', c: 90 }); if (l8 === '00110011') caus.push({ t: 'KÉP 2-2 X', p: 'X', c: 90 }); }
        if (n >= 12) { const l12 = bin.slice(-12).join(''); if (l12 === '111000111000') caus.push({ t: 'KÉP 3-3 T', p: 'T', c: 92 }); if (l12 === '000111000111') caus.push({ t: 'KÉP 3-3 X', p: 'X', c: 92 }); }

        for (let k = 10; k >= 6; k -= 2) {
            if (n >= k) { let hh = true; for (let i = n - 1; i > n - k; i--) if (bin[i] === bin[i - 1]) { hh = false; break; } if (hh) caus.push({ t: `1-1 HOÀN HẢO ${k}`, p: last ? 'X' : 'T', c: 88 + k / 2 }); }
        }

        if (n >= 6 && bin.slice(-6).join('') === '110110') caus.push({ t: '2-1 T', p: 'T', c: 91 });
        if (n >= 6 && bin.slice(-6).join('') === '001001') caus.push({ t: '2-1 X', p: 'X', c: 91 });
        if (n >= 8 && bin.slice(-8).join('') === '11101110') caus.push({ t: '3-1 T', p: 'T', c: 93 });
        if (n >= 8 && bin.slice(-8).join('') === '00010001') caus.push({ t: '3-1 X', p: 'X', c: 93 });
        if (n >= 8) { const f4 = bin.slice(-8, -4), l4 = [...bin.slice(-4)].reverse(); if (f4.every((v, i) => v === l4[i])) caus.push({ t: 'GƯƠNG', p: bin[n - 5] ? 'T' : 'X', c: 86 }); }
        if (n >= 9) { let zz = true; for (let i = n - 1; i > n - 7; i -= 2) if (bin[i] !== bin[i - 2]) { zz = false; break; } if (zz) caus.push({ t: 'ZICZAC', p: bin[n - 2] ? 'T' : 'X', c: 84 }); }
        if (n >= 8 && bin.slice(-8).every(v => v === 1)) caus.push({ t: 'RỒNG', p: 'T', c: 95 });
        if (n >= 8 && bin.slice(-8).every(v => v === 0)) caus.push({ t: 'RẮN', p: 'X', c: 95 });
        if (n >= 20) { const t20 = sum(bin.slice(-20)); if (t20 >= 17) caus.push({ t: 'VUA T', p: 'T', c: 92 }); if (t20 <= 3) caus.push({ t: 'VUA X', p: 'X', c: 92 }); }

        for (let ck = 2; ck <= 12; ck++) {
            if (n >= ck * 3) { const r = bin.slice(-ck), p1 = bin.slice(-ck * 2, -ck), p2 = bin.slice(-ck * 3, -ck * 2); if (r.every((v, i) => v === p1[i]) && r.every((v, i) => v === p2[i])) caus.push({ t: `CK ${ck} (3L)`, p: bin[n - ck] ? 'X' : 'T', c: Math.min(93, 73 + ck * 2) }); else if (r.every((v, i) => v === p1[i])) caus.push({ t: `CK ${ck}`, p: bin[n - ck] ? 'T' : 'X', c: Math.min(85, 66 + ck * 1.5) }); }
        }

        const fib = [2, 3, 5, 8, 13, 21];
        fib.forEach(f => { if (streak === f) caus.push({ t: `FIBO ${f}`, p: last ? 'X' : 'T', c: 73 + f }); });

        let vol = 0;
        for (let i = n - 9; i < n; i++) if (bin[i] !== bin[i - 1]) vol++;
        vol /= 9;
        if (vol >= 0.85) caus.push({ t: 'HOẢNG LOẠN', p: last ? 'X' : 'T', c: 69 });
        if (vol <= 0.15 && streak >= 3) caus.push({ t: 'TỰ TIN', p: last ? 'T' : 'X', c: 83 });
        if (streak >= 8 && avgManh > 3) caus.push({ t: 'THAM LAM', p: last ? 'T' : 'X', c: 85 });
        if (streak >= 7 && avgManh < 1) caus.push({ t: 'SỢ HÃI', p: last ? 'X' : 'T', c: 82 });

        caus.sort((a, b) => b.c - a.c);
        return caus;
    }

    _analyzeHouse(bin, n, last) {
        const tAll = sum(bin);
        const ratio = tAll / n;
        let mode, trapLevel, housePred;
        if (ratio > 0.65) { mode = 'FORCE_XIU'; trapLevel = Math.min(95, 70 + (ratio - 0.5) * 100); housePred = 'X'; }
        else if (ratio < 0.35) { mode = 'FORCE_TAI'; trapLevel = Math.min(95, 70 + (0.5 - ratio) * 100); housePred = 'T'; }
        else if (sum(bin.slice(-5)) >= 4 || sum(bin.slice(-5)) <= 1) { mode = 'TRAP'; trapLevel = 78; housePred = last ? 'X' : 'T'; }
        else { mode = 'NEUTRAL'; trapLevel = 35; housePred = last ? 'T' : 'X'; }
        return { mode, trapLevel, housePred };
    }

    _detectTrap(bin, totals, n, last, allCaus, house) {
        let trapScore = 0, oppScore = 0;
        const trapSigns = [], oppSigns = [];
        let streak = 0;
        for (let i = n - 1; i >= 0; i--) { if (bin[i] === last) streak++; else break; }
        if (streak >= 12) { trapScore += 40; trapSigns.push('Siêu bệt 12+'); }
        else if (streak >= 10) { trapScore += 30; trapSigns.push('Bệt 10+'); }
        else if (streak >= 8) { trapScore += 20; trapSigns.push('Bệt 8+'); }
        if (n >= 10) { let p = true; for (let i = n - 1; i > n - 10; i--) if (bin[i] === bin[i - 1]) { p = false; break; } if (p) { trapScore += 35; trapSigns.push('Pattern hoàn hảo'); } }
        if (totals[n - 1] >= 17 || totals[n - 1] <= 2) { trapScore += 25; trapSigns.push('Cực đoan'); }
        if (house.trapLevel >= 80) { trapScore += 20; trapSigns.push('Nhà cái thao túng'); }
        if (allCaus.length >= 5) { const top5 = allCaus.slice(0, 5); const same = top5.filter(c => c.p === top5[0].p).length; if (same >= 4) { oppScore += 35; oppSigns.push(`${same}/5 đồng thuận`); } }
        if (allCaus.length > 0 && allCaus[0].c >= 90) { oppScore += 30; oppSigns.push('Cầu siêu chuẩn'); }
        return { isTrap: trapScore >= 55, trapScore, trapSigns, isOpportunity: oppScore >= 40, oppScore, oppSigns };
    }

    _makeDecision(allCaus, house, trapOpp, last) {
        const bestCau = allCaus.length > 0 ? allCaus[0] : null;
        let finalPred, finalConf, finalReason, stars;

        if (trapOpp.isTrap && trapOpp.trapScore >= 70 && house.trapLevel >= 80) {
            finalPred = house.housePred === 'T' ? 'Tài' : 'Xỉu';
            finalConf = Math.min(94, house.trapLevel);
            finalReason = 'Theo nhà cái - Bẫy mạnh';
        } else if (trapOpp.isOpportunity && trapOpp.oppScore >= 60 && bestCau) {
            finalPred = bestCau.p === 'T' ? 'Tài' : 'Xỉu';
            finalConf = Math.min(96, bestCau.c + 3);
            finalReason = `Cơ hội: ${bestCau.t}`;
        } else if (bestCau && bestCau.c >= 92 && house.trapLevel < 70) {
            finalPred = bestCau.p === 'T' ? 'Tài' : 'Xỉu';
            finalConf = bestCau.c;
            finalReason = `Cầu chuẩn: ${bestCau.t}`;
        } else if (bestCau) {
            finalPred = bestCau.p === 'T' ? 'Tài' : 'Xỉu';
            finalConf = Math.max(bestCau.c, 72);
            finalReason = `Theo cầu: ${bestCau.t}`;
        } else {
            finalPred = last ? 'Tài' : 'Xỉu';
            finalConf = 55;
            finalReason = 'Không rõ cầu';
        }

        finalConf = Math.max(55, Math.min(98, finalConf));
        if (finalConf >= 92) stars = '⭐⭐⭐⭐⭐';
        else if (finalConf >= 84) stars = '⭐⭐⭐⭐';
        else if (finalConf >= 76) stars = '⭐⭐⭐';
        else if (finalConf >= 68) stars = '⭐⭐';
        else stars = '⭐';

        return { prediction: finalPred, confidence: finalConf, stars, reason: finalReason, bestCau: bestCau ? bestCau.t : 'Không rõ', totalCaus: allCaus.length };
    }

    _fallback(msg) {
        return { prediction: 'Tài', confidence: 50, stars: '⭐', reason: msg, bestCau: 'N/A', totalCaus: 0 };
    }
}

const AI = new SuperBrainAI();

async function fetchData() {
    for (let a = 1; a <= 5; a++) {
        try {
            const res = await axios.get(API_URL, { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
            const raw = res.data;
            let arr = null;
            if (Array.isArray(raw)) arr = raw;
            else if (raw && raw.data && Array.isArray(raw.data)) arr = raw.data;
            else if (raw && typeof raw === 'object') { for (const k of Object.keys(raw)) { if (Array.isArray(raw[k]) && raw[k].length > 5) { arr = raw[k]; break; } } }
            if (arr && arr.length >= 10) {
                const n = arr.map(normalize).sort((a, b) => a.phien - b.phien);
                return n;
            }
            await new Promise(r => setTimeout(r, 3000));
        } catch (e) { if (a < 5) await new Promise(r => setTimeout(r, 5000)); }
    }
    return null;
}

async function updatePrediction() {
    if (isUpdating) return;
    isUpdating = true;
    try {
        const data = await fetchData();
        if (!data || data.length < 10) { isUpdating = false; return; }

        const latest = data[data.length - 1];

        if (currentPrediction && currentPrediction.Phien_hien_tai > 0) {
            const predictedPhien = currentPrediction.Phien_hien_tai;
            const actual = data.find(s => s.phien === predictedPhien);
            if (actual) {
                const actualStr = actual.ket_qua === 1 ? 'Tài' : 'Xỉu';
                addToHistory(predictedPhien, currentPrediction.Du_doan, actualStr, currentPrediction.Do_tin_cay);
                console.log(`📝 ${predictedPhien}: ${currentPrediction.Du_doan} vs ${actualStr} | ${currentPrediction.Du_doan.toLowerCase() === actualStr.toLowerCase() ? '✅' : '❌'}`);
            }
        }

        gameHistory = data;
        const pred = AI.predict(data.slice(-200));

        let pattern = "";
        for (let i = Math.max(0, data.length - 10); i < data.length; i++) pattern += data[i].ket_qua === 1 ? "t" : "x";

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
            Xep_hang: pred.stars,
            Cau_chinh: pred.bestCau,
            Ly_do: pred.reason,
            So_cau: pred.totalCaus,
            timestamp: Date.now()
        };

        const wc = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const wr = verifiedResults.length > 0 ? (wc / verifiedResults.length * 100).toFixed(1) : '0.0';
        console.log(`✅ ${pred.prediction} (${pred.confidence}%) | ${pred.bestCau} | ${pred.totalCaus} cầu | Thắng: ${wc}/${verifiedResults.length} (${wr}%)`);
    } catch (e) { console.error('❌', e.message); }
    isUpdating = false;
}

app.get('/taixiu', async (req, res) => {
    if (!currentPrediction) await updatePrediction();
    if (currentPrediction) {
        const wc = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const wr = verifiedResults.length > 0 ? (wc / verifiedResults.length * 100).toFixed(1) : '0.0';
        return res.json({ ...currentPrediction, Lich_su: { Tong_phien: verifiedResults.length, Thang: wc, Thua: verifiedResults.length - wc, Ty_le_thang: wr + "%" }, Bang_thang_thua: verifiedResults.slice(0, 20) });
    }
    res.json({ id: "@anhkhoidzai102", Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "đang tải...", pattern: "", Phien_hien_tai: 0, Du_doan: "đang tải...", Do_tin_cay: "0%", Tong_du_doan: 0, Xep_hang: "", Cau_chinh: "", Ly_do: "", So_cau: 0, timestamp: Date.now(), Lich_su: { Tong_phien: verifiedResults.length, Thang: verifiedResults.filter(v => v.danh_gia === 'thang').length, Thua: verifiedResults.filter(v => v.danh_gia === 'thua').length, Ty_le_thang: verifiedResults.length > 0 ? (verifiedResults.filter(v => v.danh_gia === 'thang').length / verifiedResults.length * 100).toFixed(1) + "%" : "0%" }, Bang_thang_thua: verifiedResults.slice(0, 20) });
});

app.get('/', (req, res) => res.redirect('/taixiu'));

loadHistory();
console.log('='.repeat(70));
console.log('   🧠 SIÊU BỘ NÃO AI - WEBSITE READY 🧠');
console.log('   100+ Loại Cầu | API: wtxmd52.tele68.com');
console.log('   10 phiên | Lịch sử 30.000');
console.log('='.repeat(70));

(async () => { const d = await fetchData(); if (d && d.length >= 10) { gameHistory = d; await updatePrediction(); } })();
setInterval(updatePrediction, 300);

app.listen(PORT, () => { console.log(`🚀 Port: ${PORT} | /taixiu`); });
