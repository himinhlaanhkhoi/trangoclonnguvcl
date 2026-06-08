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
    verifiedResults.unshift({
        phien, du_doan: duDoan, ket_qua: ketQua,
        danh_gia: isCorrect ? 'thang' : 'thua', do_tin_cay: doTinCay,
        timestamp: new Date().toISOString()
    });
    if (verifiedResults.length > MAX_HISTORY) verifiedResults = verifiedResults.slice(0, MAX_HISTORY);
    saveHistory();
    return isCorrect;
}

const sum = arr => arr.reduce((a, b) => a + b, 0);
const avg = arr => arr.length ? sum(arr) / arr.length : 0;

class SuperAI {
    constructor() {
        this.wins = 0;
        this.losses = 0;
    }

    predict(arr) {
        if (arr.length < 8) return { bet: 'Tài', confidence: 50, shouldBet: false, totalSignals: 0 };

        const bin = arr.map(v => v.tong >= 11 ? 1 : 0);
        const totals = arr.map(v => v.tong);
        const n = bin.length;
        const last = bin[n - 1];
        const lastTotal = totals[n - 1];

        let streak = 0;
        for (let i = n - 1; i >= 0; i--) { if (bin[i] === last) streak++; else break; }

        const t3 = sum(bin.slice(-3));
        const t5 = sum(bin.slice(-5));
        const t10 = sum(bin.slice(-10));
        const tAll = sum(bin);
        const ratio = tAll / n;

        const runs = [];
        let cur = bin[0], len = 1;
        for (let i = 1; i < n; i++) {
            if (bin[i] === cur) len++;
            else { runs.push({ val: cur, len }); cur = bin[i]; len = 1; }
        }
        runs.push({ val: cur, len });

        const C = [];

        if (streak >= 10) {
            let manh = 0;
            for (let i = n - 1; i >= n - streak && i >= 0; i--) {
                manh += last === 1 ? Math.max(0, totals[i] - 11) : Math.max(0, 10 - totals[i]);
            }
            const avgM = manh / streak;
            if (avgM < 1) C.push({ p: last === 1 ? 'X' : 'T', c: 93 });
            else C.push({ p: last === 1 ? 'T' : 'X', c: 86 });
        } else if (streak >= 7) {
            C.push({ p: last === 1 ? 'T' : 'X', c: 80 });
        } else if (streak >= 4) {
            C.push({ p: last === 1 ? 'T' : 'X', c: 72 });
        } else if (streak >= 2) {
            C.push({ p: last === 1 ? 'T' : 'X', c: 62 });
        } else {
            C.push({ p: last === 1 ? 'X' : 'T', c: 56 });
        }

        if (n >= 10) {
            let hh = true;
            for (let i = n - 1; i > n - 10; i--) if (bin[i] === bin[i - 1]) { hh = false; break; }
            if (hh) C.push({ p: last === 1 ? 'X' : 'T', c: 96 });
        } else if (n >= 8) {
            let hh = true;
            for (let i = n - 1; i > n - 8; i--) if (bin[i] === bin[i - 1]) { hh = false; break; }
            if (hh) C.push({ p: last === 1 ? 'X' : 'T', c: 93 });
        }

        if (n >= 6) {
            const l6 = bin.slice(-6).join('');
            if (l6 === '110110') C.push({ p: 'T', c: 91 });
            if (l6 === '001001') C.push({ p: 'X', c: 91 });
        }

        if (n >= 8) {
            const l8 = bin.slice(-8).join('');
            if (l8 === '11101110') C.push({ p: 'T', c: 93 });
            if (l8 === '00010001') C.push({ p: 'X', c: 93 });
        }

        if (n >= 8) {
            const f4 = bin.slice(-8, -4), l4 = [...bin.slice(-4)].reverse();
            if (f4.every((v, i) => v === l4[i])) C.push({ p: bin[n - 5] === 1 ? 'T' : 'X', c: 86 });
        }

        if (n >= 8) {
            const l8 = bin.slice(-8).join('');
            if (l8 === '11001100') C.push({ p: 'T', c: 89 });
            if (l8 === '00110011') C.push({ p: 'X', c: 89 });
        }

        if (n >= 12) {
            const l12 = bin.slice(-12).join('');
            if (l12 === '111000111000') C.push({ p: 'T', c: 91 });
            if (l12 === '000111000111') C.push({ p: 'X', c: 91 });
        }

        if (n >= 8 && bin.slice(-8).every(v => v === 1)) C.push({ p: 'T', c: 96 });
        if (n >= 8 && bin.slice(-8).every(v => v === 0)) C.push({ p: 'X', c: 96 });

        if (n >= 5 && bin.slice(-5).join('') === '10101') C.push({ p: 'X', c: 87 });
        if (n >= 5 && bin.slice(-5).join('') === '01010') C.push({ p: 'T', c: 87 });

        if (n >= 6) {
            const l6 = bin.slice(-6);
            if (l6.slice(0, 5).every(v => v === 0) && l6[5] === 1) C.push({ p: 'T', c: 83 });
            if (l6.slice(0, 5).every(v => v === 1) && l6[5] === 0) C.push({ p: 'X', c: 83 });
        }

        if (n >= 7 && bin.slice(-7).join('') === '1001001') C.push({ p: 'T', c: 85 });
        if (n >= 7 && bin.slice(-7).join('') === '0110110') C.push({ p: 'X', c: 85 });

        for (let ck = 2; ck <= 8; ck++) {
            if (n >= ck * 3) {
                const r1 = bin.slice(-ck), r2 = bin.slice(-ck * 2, -ck), r3 = bin.slice(-ck * 3, -ck * 2);
                const m1 = r1.every((v, i) => v === r2[i]);
                const m2 = r1.every((v, i) => v === r3[i]);
                if (m1 && m2) C.push({ p: bin[n - ck] === 1 ? 'X' : 'T', c: Math.min(90, 74 + ck * 2) });
                else if (m1) C.push({ p: bin[n - ck] === 1 ? 'T' : 'X', c: Math.min(82, 67 + ck) });
            }
        }

        if (t3 === 3) C.push({ p: 'X', c: 77 });
        if (t3 === 0) C.push({ p: 'T', c: 77 });
        if (t5 >= 4) C.push({ p: 'X', c: 74 });
        if (t5 <= 1) C.push({ p: 'T', c: 74 });
        if (t10 >= 7) C.push({ p: 'X', c: 70 });
        if (t10 <= 3) C.push({ p: 'T', c: 70 });
        if (ratio >= 0.6) C.push({ p: 'X', c: 66 });
        if (ratio <= 0.4) C.push({ p: 'T', c: 66 });

        if (lastTotal >= 17) C.push({ p: 'X', c: 88 });
        else if (lastTotal >= 15) C.push({ p: 'X', c: 81 });
        else if (lastTotal <= 2) C.push({ p: 'T', c: 88 });
        else if (lastTotal <= 4) C.push({ p: 'T', c: 81 });

        const fib = [3, 5, 8, 13];
        fib.forEach(f => { if (streak === f) C.push({ p: last === 1 ? 'X' : 'T', c: 75 + f }); });

        let changes = 0;
        for (let i = n - 9; i < n; i++) if (bin[i] !== bin[i - 1]) changes++;
        const vol = changes / 9;
        if (vol <= 0.2 && streak >= 3) C.push({ p: last === 1 ? 'T' : 'X', c: 81 });
        if (vol >= 0.8) C.push({ p: last === 1 ? 'X' : 'T', c: 67 });

        const runLens = runs.slice(-5).map(r => r.len);
        if (runLens.length >= 3) {
            let tang = true, giam = true;
            for (let i = 1; i < runLens.length; i++) {
                if (runLens[i] <= runLens[i - 1]) tang = false;
                if (runLens[i] >= runLens[i - 1]) giam = false;
            }
            if (tang && streak >= 2) C.push({ p: last === 1 ? 'T' : 'X', c: 79 });
            if (giam && streak >= 3) C.push({ p: last === 1 ? 'X' : 'T', c: 76 });
        }

        if (runs.length >= 3) {
            const l3 = runs.slice(-3);
            if (l3[0].val === l3[2].val && l3[0].val !== l3[1].val) C.push({ p: last === 1 ? 'T' : 'X', c: 73 });
        }

        const nhom3 = [];
        for (let i = Math.max(0, n - 12); i < n; i += 3) {
            nhom3.push(bin.slice(i, Math.min(i + 3, n)).reduce((a, b) => a + b, 0));
        }
        if (nhom3.length >= 4) {
            if (nhom3[0] <= nhom3[1] && nhom3[1] <= nhom3[2] && nhom3[2] <= nhom3[3]) C.push({ p: 'T', c: 82 });
            if (nhom3[0] >= nhom3[1] && nhom3[1] >= nhom3[2] && nhom3[2] >= nhom3[3]) C.push({ p: 'X', c: 82 });
        }

        if (n >= 20) {
            const t20 = sum(bin.slice(-20));
            if (t20 >= 16) C.push({ p: 'T', c: 90 });
            if (t20 <= 4) C.push({ p: 'X', c: 90 });
        }

        C.sort((a, b) => b.c - a.c);

        let tScore = 0, xScore = 0;
        C.forEach(s => { const w = s.c / 100; if (s.p === 'T') tScore += w; else xScore += w; });

        const total = tScore + xScore;
        const tPct = total > 0 ? (tScore / total) * 100 : 50;
        const xPct = total > 0 ? (xScore / total) * 100 : 50;

        const bet = tPct >= xPct ? 'Tài' : 'Xỉu';
        const conf = Math.min(98, Math.max(tPct, xPct));
        const shouldBet = conf >= 72;
        const bestSignal = C[0];

        return {
            bet,
            confidence: parseFloat(conf.toFixed(1)),
            shouldBet,
            totalSignals: C.length,
            bestSignal: bestSignal ? { p: bestSignal.p === 'T' ? 'Tài' : 'Xỉu', c: bestSignal.c } : null,
            scores: { T: tPct.toFixed(1), X: xPct.toFixed(1) }
        };
    }

    update(correct) {
        if (correct) this.wins++;
        else this.losses++;
    }

    stats() {
        const total = this.wins + this.losses;
        return { wins: this.wins, losses: this.losses, rate: total > 0 ? (this.wins / total * 100).toFixed(1) + '%' : '0%' };
    }
}

const AI = new SuperAI();

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
                const correct = currentPrediction.Du_doan.toLowerCase() === actualStr.toLowerCase();
                AI.update(correct);
                console.log(`📝 ${predictedPhien}: ${currentPrediction.Du_doan} vs ${actualStr} | ${correct ? '✅' : '❌'}`);
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

        const stats = AI.stats();

        currentPrediction = {
            id: "@anhkhoidzai102",
            Phien: latest.phien,
            Xuc_xac_1: latest.x1, Xuc_xac_2: latest.x2, Xuc_xac_3: latest.x3,
            Tong: latest.tong,
            Ket_qua: latest.ket_qua === 1 ? 'Tài' : 'Xỉu',
            pattern: pattern,
            Phien_hien_tai: latest.phien + 1,
            Du_doan: pred.bet,
            Do_tin_cay: pred.confidence + "%",
            Tong_du_doan: Math.min(18, Math.max(3, predTotal)),
            Nen_danh: pred.shouldBet ? 'CÓ' : 'KHÔNG',
            So_tin_hieu: pred.totalSignals,
            Diem_Tai: pred.scores.T + '%',
            Diem_Xiu: pred.scores.X + '%',
            Thong_ke_AI: stats,
            timestamp: Date.now()
        };

        const wc = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const wr = verifiedResults.length > 0 ? (wc / verifiedResults.length * 100).toFixed(1) : '0.0';
        console.log(`✅ ${pred.bet} (${pred.confidence}%) | ${pred.totalSignals} tín hiệu | ${pred.shouldBet ? 'NÊN ĐÁNH' : 'BỎ QUA'} | AI: ${stats.rate} | Thắng: ${wc}/${verifiedResults.length} (${wr}%)`);
    } catch (e) { console.error('❌', e.message); }
    isUpdating = false;
}

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
        Nen_danh: "KHÔNG", So_tin_hieu: 0, Diem_Tai: "0%", Diem_Xiu: "0%",
        Thong_ke_AI: { wins: 0, losses: 0, rate: '0%' }, timestamp: Date.now(),
        Lich_su: { Tong_phien: verifiedResults.length, Thang: verifiedResults.filter(v => v.danh_gia === 'thang').length, Thua: verifiedResults.filter(v => v.danh_gia === 'thua').length, Ty_le_thang: verifiedResults.length > 0 ? (verifiedResults.filter(v => v.danh_gia === 'thang').length / verifiedResults.length * 100).toFixed(1) + "%" : "0%" },
        Bang_thang_thua: verifiedResults.slice(0, 20)
    });
});

app.get('/', (req, res) => res.redirect('/taixiu'));

loadHistory();
console.log('='.repeat(70));
console.log('   🧠 SUPER AI - DỰ ĐOÁN CHUẨN XÁC 🧠');
console.log('   50+ Tín Hiệu | API: wtxmd52.tele68.com');
console.log('   10 phiên | Lịch sử 30.000');
console.log('='.repeat(70));

(async () => { const d = await fetchData(); if (d && d.length >= 10) { gameHistory = d; await updatePrediction(); } })();
setInterval(updatePrediction, 300);

app.listen(PORT, () => { console.log(`🚀 Port: ${PORT} | /taixiu`); });
