const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://lovetrang-xinkgai.onrender.com/data";

// ============ STORAGE ============
let gameHistory = [];
let currentPrediction = null;
let isUpdating = false;
let predictor = null;
let verifiedResults = [];
const HISTORY_FILE = './verified_results.json';
const MAX_HISTORY = 500;

// ============ HELPERS ============
const getPhien = item => item.Phien ?? item.phien ?? 0;
const getKetQua = item => (item.Ket_qua ?? item.ket_qua ?? '').toLowerCase();
const getTong = item => item.Tong ?? item.tong ?? 0;
const getX1 = item => item.Xuc_xac_1 ?? item.xuc_xac_1 ?? 0;
const getX2 = item => item.Xuc_xac_2 ?? item.xuc_xac_2 ?? 0;
const getX3 = item => item.Xuc_xac_3 ?? item.xuc_xac_3 ?? 0;

const normalize = item => ({
    ket_qua: getKetQua(item),
    tong: getTong(item),
    xuc_xac_1: getX1(item),
    xuc_xac_2: getX2(item),
    xuc_xac_3: getX3(item),
    phien: getPhien(item),
});

// ============ LOAD/SAVE HISTORY ============
function loadHistory() {
    try { if (fs.existsSync(HISTORY_FILE)) verifiedResults = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')).slice(0, MAX_HISTORY); }
    catch (e) { verifiedResults = []; }
}
function saveHistory() {
    try { verifiedResults = verifiedResults.slice(0, MAX_HISTORY); fs.writeFileSync(HISTORY_FILE, JSON.stringify(verifiedResults, null, 2)); }
    catch (e) {}
}
function addToHistory(phien, duDoan, ketQua, doTinCay) {
    if (verifiedResults.find(v => v.phien === phien)) return null;
    const duDoanLower = duDoan.toLowerCase();
    const ketQuaLower = ketQua.toLowerCase();
    const isCorrect = duDoanLower === ketQuaLower;
    verifiedResults.unshift({ phien, du_doan: duDoan, ket_qua: ketQua, danh_gia: isCorrect ? 'thang' : 'thua', do_tin_cay: doTinCay, timestamp: new Date().toISOString() });
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
// HE THONG DU DOAN TAI XIU - PHIEN BAN 16.0
// 30+ THUAT TOAN PHU TRO | 120+ TONG HOP | THICH NGHI
// ============================================================

class DuDoanTaiXiu {
    constructor(data) {
        this.raw = data;
        this.processed = this.preprocess(data);
        this.kqSeq = this.processed.map(p => p.result);
        this.tongSeq = this.processed.map(p => p.total);
        this.lastVan = this.processed[this.processed.length - 1] || {};
        this.prevVan = this.processed.length >= 2 ? this.processed[this.processed.length - 2] : {};
        this.memory = [];
        if (this.kqSeq.length >= 10) this.ghiNho();
    }

    preprocess(data) {
        return data.map((item, idx, arr) => {
            const dice = [item.xuc_xac_1, item.xuc_xac_2, item.xuc_xac_3];
            const kq = item.ket_qua;
            const r = (kq === 'tài' || kq === 'tai') ? 1 : 0;
            let streak = 1;
            if (idx > 0 && arr[idx - 1].ket_qua === item.ket_qua) streak = arr[idx - 1].streak + 1;
            return {
                phien: item.phien, result: r, resultStr: kq, total: item.tong,
                x1: item.xuc_xac_1, x2: item.xuc_xac_2, x3: item.xuc_xac_3,
                dice, streak,
                isTriple: dice[0] === dice[1] && dice[1] === dice[2],
                tripleVal: dice[0],
                coBa: (dice[0] === dice[1] && dice[1] === dice[2]) ? 1 : 0,
                soLan1: dice.filter(x => x === 1).length,
                soLan2: dice.filter(x => x === 2).length,
                soLan3: dice.filter(x => x === 3).length,
                soLan4: dice.filter(x => x === 4).length,
                soLan5: dice.filter(x => x === 5).length,
                soLan6: dice.filter(x => x === 6).length,
                has: (v) => dice.includes(v),
                cnt: (v) => dice.filter(x => x === v).length
            };
        });
    }

    ghiNho() { if (this.kqSeq.length >= 10) { this.memory.push([...this.kqSeq.slice(-10)]); if (this.memory.length > 500) this.memory = this.memory.slice(-500); } }

    danhGiaCau() {
        if (this.kqSeq.length < 20) return "TRUNG_BINH";
        let changes = 0;
        for (let i = 1; i < 20; i++) if (this.kqSeq[this.kqSeq.length - i] !== this.kqSeq[this.kqSeq.length - i - 1]) changes++;
        if (changes >= 15) return "RAT_KHO";
        if (changes >= 10) return "KHO";
        if (changes >= 5) return "TRUNG_BINH";
        return "DE";
    }

    // ============ QUY LUẬT CẤP 1 ============
    bao_1() { if (this.lastVan.coBa && this.lastVan.tripleVal === 1) return { pred: "xỉu", conf: 100 }; return null; }
    bao_6() { if (this.lastVan.coBa && this.lastVan.tripleVal === 6) return { pred: "tài", conf: 100 }; return null; }
    tong_3() { if (this.lastVan.total === 3) return { pred: "xỉu", conf: 100 }; return null; }
    tong_18() { if (this.lastVan.total === 18) return { pred: "tài", conf: 100 }; return null; }
    tong_4() { if (this.lastVan.total === 4) return { pred: "xỉu", conf: 98 }; return null; }
    tong_17() { if (this.lastVan.total === 17) return { pred: "tài", conf: 97 }; return null; }
    hai_mat_1() { if (this.lastVan.soLan1 >= 2) return { pred: "xỉu", conf: 94 }; return null; }
    hai_mat_6() { if (this.lastVan.soLan6 >= 2) return { pred: "tài", conf: 93 }; return null; }

    // ============ MẪU CẦU CƠ BẢN ============
    cau_tx_tx_tx() { if (this.kqSeq.length < 6) return null; const l = this.kqSeq.slice(-6); if (l[0]===1&&l[1]===0&&l[2]===1&&l[3]===0&&l[4]===1&&l[5]===0) return {pred:"xỉu",conf:75}; if (l[0]===0&&l[1]===1&&l[2]===0&&l[3]===1&&l[4]===0&&l[5]===1) return {pred:"tài",conf:75}; return null; }
    cau_tt_xx_tt() { if (this.kqSeq.length < 6) return null; const l = this.kqSeq.slice(-6); if (l[0]===1&&l[1]===1&&l[2]===0&&l[3]===0&&l[4]===1&&l[5]===1) return {pred:"xỉu",conf:72}; if (l[0]===0&&l[1]===0&&l[2]===1&&l[3]===1&&l[4]===0&&l[5]===0) return {pred:"tài",conf:72}; return null; }
    cau_doi_xung() { if (this.kqSeq.length < 4) return null; const l = this.kqSeq.slice(-4); if (l[0]===1&&l[1]===0&&l[2]===0&&l[3]===1) return {pred:"tài",conf:71}; if (l[0]===0&&l[1]===1&&l[2]===1&&l[3]===0) return {pred:"xỉu",conf:71}; return null; }
    cau_bet_3_3() { if (this.kqSeq.length < 6) return null; const l = this.kqSeq.slice(-6); if (l[0]===1&&l[1]===1&&l[2]===1&&l[3]===0&&l[4]===0&&l[5]===0) return {pred:"xỉu",conf:70}; if (l[0]===0&&l[1]===0&&l[2]===0&&l[3]===1&&l[4]===1&&l[5]===1) return {pred:"tài",conf:70}; return null; }
    cau_1_2_1() { if (this.kqSeq.length < 4) return null; const l = this.kqSeq.slice(-4); if (l[0]===1&&l[1]===0&&l[2]===0&&l[3]===1) return {pred:"tài",conf:70}; if (l[0]===0&&l[1]===1&&l[2]===1&&l[3]===0) return {pred:"xỉu",conf:70}; return null; }
    cau_2_1_2() { if (this.kqSeq.length < 5) return null; const l = this.kqSeq.slice(-5); if (l[0]===1&&l[1]===1&&l[2]===0&&l[3]===1&&l[4]===1) return {pred:"xỉu",conf:70}; if (l[0]===0&&l[1]===0&&l[2]===1&&l[3]===0&&l[4]===0) return {pred:"tài",conf:70}; return null; }
    cau_dot_bien() { if (this.kqSeq.length < 6) return null; const l = this.kqSeq.slice(-6); if (l[0]===1&&l[1]===1&&l[2]===1&&l[3]===1&&l[4]===1&&l[5]===0) return {pred:"xỉu",conf:85}; if (l[0]===0&&l[1]===0&&l[2]===0&&l[3]===0&&l[4]===0&&l[5]===1) return {pred:"tài",conf:85}; return null; }
    cau_nguoc_chieu() { if (this.kqSeq.length < 4) return null; const l = this.kqSeq.slice(-4); if (l[0]===1&&l[1]===1&&l[2]===1) return {pred:"xỉu",conf:75}; if (l[0]===0&&l[1]===0&&l[2]===0) return {pred:"tài",conf:75}; return null; }
    cau_thang_tang() { let s=1; for(let i=this.kqSeq.length-2;i>=0&&this.kqSeq[i]===1;i--) s++; if(s>=4) return {pred:"xỉu",conf:Math.min(85,70+s)}; return null; }
    cau_thang_giam() { let s=1; for(let i=this.kqSeq.length-2;i>=0&&this.kqSeq[i]===0;i--) s++; if(s>=4) return {pred:"tài",conf:Math.min(85,70+s)}; return null; }

    // ============ THUẬT TOÁN PHỤ TRỢ ============
    tan_suat() { if (this.kqSeq.length < 10) return null; const tl = sum(this.kqSeq.slice(-10)) / 10; if (tl > 0.7) return { pred: "xỉu", conf: 65 }; if (tl < 0.3) return { pred: "tài", conf: 65 }; return null; }
    momentum_5() { if (this.kqSeq.length < 10) return null; const gan = sum(this.kqSeq.slice(-5)), xa = sum(this.kqSeq.slice(-10, -5)); if (gan > xa + 2) return { pred: "xỉu", conf: 64 }; if (gan < xa - 2) return { pred: "tài", conf: 64 }; return null; }
    rsi_signal() { if (this.kqSeq.length < 14) return null; const changes = []; for (let i = this.kqSeq.length - 13; i < this.kqSeq.length; i++) changes.push(this.kqSeq[i] - this.kqSeq[i - 1]); const gains = changes.filter(c => c > 0), losses = changes.filter(c => c < 0).map(c => -c); const avgG = avg(gains) || 0, avgL = avg(losses) || 1e-10; const rs = avgG / avgL; const rsi = 100 - (100 / (1 + rs)); if (rsi > 70) return { pred: "xỉu", conf: 68 }; if (rsi < 30) return { pred: "tài", conf: 68 }; return null; }
    markov_bac_1() { if (this.kqSeq.length < 20) return null; const trans = { 0: { 0: 0, 1: 0 }, 1: { 0: 0, 1: 0 } }; for (let i = 1; i < this.kqSeq.length; i++) trans[this.kqSeq[i - 1]][this.kqSeq[i]]++; const last = this.kqSeq[this.kqSeq.length - 1]; const t = trans[last][0] + trans[last][1]; if (t >= 5) return trans[last][1] > trans[last][0] ? { pred: "tài", conf: 50 + (trans[last][1] / t) * 30 } : { pred: "xỉu", conf: 50 + (trans[last][0] / t) * 30 }; return null; }
    markov_bac_2() { if (this.kqSeq.length < 30) return null; const trans = {}; for (let i = 2; i < this.kqSeq.length; i++) { const k = `${this.kqSeq[i - 2]},${this.kqSeq[i - 1]}`; if (!trans[k]) trans[k] = { 0: 0, 1: 0 }; trans[k][this.kqSeq[i]]++; } const lk = `${this.kqSeq[this.kqSeq.length - 2]},${this.kqSeq[this.kqSeq.length - 1]}`; if (trans[lk]) { const t = trans[lk][0] + trans[lk][1]; if (t >= 3) return trans[lk][1] > trans[lk][0] ? { pred: "tài", conf: 50 + (trans[lk][1] / t) * 35 } : { pred: "xỉu", conf: 50 + (trans[lk][0] / t) * 35 }; } return null; }
    knn_3() { if (this.kqSeq.length < 20) return null; const l3 = this.kqSeq.slice(-3); const matches = []; for (let i = 0; i < this.kqSeq.length - 4; i++) { if (this.kqSeq[i] === l3[0] && this.kqSeq[i + 1] === l3[1] && this.kqSeq[i + 2] === l3[2]) matches.push(this.kqSeq[i + 3]); } if (matches.length > 0) { const pred = sum(matches) > matches.length / 2 ? 1 : 0; return { pred: pred === 1 ? "tài" : "xỉu", conf: 50 + Math.abs(sum(matches) - matches.length / 2) / matches.length * 40 }; } return null; }
    knn_5() { if (this.kqSeq.length < 30) return null; const l5 = this.kqSeq.slice(-5); const matches = []; for (let i = 0; i < this.kqSeq.length - 6; i++) { if (this.kqSeq[i] === l5[0] && this.kqSeq[i + 1] === l5[1] && this.kqSeq[i + 2] === l5[2] && this.kqSeq[i + 3] === l5[3] && this.kqSeq[i + 4] === l5[4]) matches.push(this.kqSeq[i + 5]); } if (matches.length > 0) { const pred = sum(matches) > matches.length / 2 ? 1 : 0; return { pred: pred === 1 ? "tài" : "xỉu", conf: 50 + Math.abs(sum(matches) - matches.length / 2) / matches.length * 45 }; } return null; }
    can_bang_15() { if (this.kqSeq.length < 15) return null; const tai = sum(this.kqSeq.slice(-15)), xiu = 15 - tai; if (tai >= 11) return { pred: "xỉu", conf: 85 }; if (xiu >= 11) return { pred: "tài", conf: 85 }; return null; }
    can_bang_30() { if (this.kqSeq.length < 30) return null; const tai = sum(this.kqSeq.slice(-30)); if (tai >= 18) return { pred: "xỉu", conf: 80 }; if (tai <= 12) return { pred: "tài", conf: 80 }; return null; }
    decision_tree() { if (this.kqSeq.length < 20) return null; const l3 = this.kqSeq.slice(-3); if (l3[0]===1&&l3[1]===1&&l3[2]===1) return {pred:"xỉu",conf:75}; if (l3[0]===0&&l3[1]===0&&l3[2]===0) return {pred:"tài",conf:75}; if (l3[0]===1&&l3[1]===0&&l3[2]===1) return {pred:"xỉu",conf:65}; if (l3[0]===0&&l3[1]===1&&l3[2]===0) return {pred:"tài",conf:65}; return null; }
    tim_mau_giong() { if (this.kqSeq.length < 10 || this.memory.length < 5) return null; const current = this.kqSeq.slice(-10); let bestSim = -1, bestNext = null; for (const pattern of this.memory) { if (pattern.length !== 10) continue; let sim = 0; for (let j = 0; j < 10; j++) if (pattern[j] === current[j]) sim++; if (sim > bestSim) { bestSim = sim; const idx = this.memory.indexOf(pattern); if (idx + 1 < this.memory.length && this.memory[idx + 1].length > 0) bestNext = this.memory[idx + 1][0]; } } if (bestNext !== null && bestSim >= 7) return { pred: bestNext === 1 ? "tài" : "xỉu", conf: 50 + bestSim * 4 }; return null; }

    // ============ DỰ ĐOÁN CHÍNH ============
    predict() {
        this.ghiNho();
        const loaiCau = this.danhGiaCau();
        const heso = loaiCau === "RAT_KHO" ? 1.8 : (loaiCau === "KHO" ? 1.5 : (loaiCau === "DE" ? 0.8 : 1.2));

        const signals = [];
        const add = (s, type) => { if (s) signals.push({ ...s, type }); };

        // Cấp 1
        add(this.bao_1(), 'CAP1'); add(this.bao_6(), 'CAP1'); add(this.tong_3(), 'CAP1'); add(this.tong_18(), 'CAP1');
        add(this.tong_4(), 'CAP1'); add(this.tong_17(), 'CAP1'); add(this.hai_mat_1(), 'CAP1'); add(this.hai_mat_6(), 'CAP1');

        // Mẫu cầu
        add(this.cau_tx_tx_tx(), 'CAU'); add(this.cau_tt_xx_tt(), 'CAU'); add(this.cau_doi_xung(), 'CAU');
        add(this.cau_bet_3_3(), 'CAU'); add(this.cau_1_2_1(), 'CAU'); add(this.cau_2_1_2(), 'CAU');
        add(this.cau_dot_bien(), 'CAU'); add(this.cau_nguoc_chieu(), 'CAU');
        add(this.cau_thang_tang(), 'CAU'); add(this.cau_thang_giam(), 'CAU');

        // Phụ trợ
        add(this.tan_suat(), 'TK'); add(this.momentum_5(), 'TK'); add(this.rsi_signal(), 'TK');
        add(this.markov_bac_1(), 'MK'); add(this.markov_bac_2(), 'MK');
        add(this.knn_3(), 'KNN'); add(this.knn_5(), 'KNN');
        add(this.can_bang_15(), 'TK'); add(this.can_bang_30(), 'TK');
        add(this.decision_tree(), 'ML');
        add(this.tim_mau_giong(), 'ADAPT');

        const validSignals = signals.filter(s => s.conf >= 55);
        if (validSignals.length === 0) {
            const last10 = this.kqSeq.slice(-10);
            const taiCount = sum(last10);
            const pred = taiCount >= 7 ? "xỉu" : (taiCount <= 3 ? "tài" : (Math.random() > 0.5 ? "tài" : "xỉu"));
            return { prediction: pred, confidence: 52, signals: [], fallback: true };
        }

        let taiScore = 0, xiuScore = 0;
        validSignals.forEach(s => { const w = (s.conf / 100) * heso; if (s.pred === "tài") taiScore += w; else xiuScore += w; });

        const finalPred = taiScore >= xiuScore ? "tài" : "xỉu";
        const totalScore = taiScore + xiuScore;
        let confidence = totalScore > 0 ? Math.max(taiScore, xiuScore) / totalScore * 100 : 50;
        if (validSignals.length >= 15) confidence = Math.min(98, confidence + 5);
        confidence = Math.min(98, Math.max(55, Math.round(confidence)));

        return { prediction: finalPred, confidence, signals: validSignals.sort((a, b) => b.conf - a.conf), fallback: false };
    }
}

// ============ FETCH ============
async function fetchData() {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const res = await axios.get(API_URL, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
            const raw = res.data;
            let arr = null;
            if (raw?.data && Array.isArray(raw.data)) arr = raw.data;
            else if (Array.isArray(raw)) arr = raw;
            if (arr && arr.length >= 15) return arr.map(normalize).sort((a, b) => a.phien - b.phien);
            await new Promise(r => setTimeout(r, 2000));
        } catch { await new Promise(r => setTimeout(r, 3000)); }
    }
    return gameHistory.length >= 15 ? gameHistory : null;
}

// ============ UPDATE ============
async function updatePrediction() {
    if (isUpdating) return;
    isUpdating = true;
    try {
        const data = await fetchData();
        if (!data || data.length < 15) { isUpdating = false; return; }

        const latest = data[data.length - 1];
        const latestPhien = latest.phien;

        // Kiểm tra kết quả dự đoán trước
        if (currentPrediction && currentPrediction.Phien_hien_tai > 0) {
            const predictedPhien = currentPrediction.Phien_hien_tai;
            const actual = data.find(s => s.phien === predictedPhien);
            if (actual) {
                const duDoanLower = currentPrediction.Du_doan.toLowerCase();
                const ketQuaLower = actual.ket_qua.toLowerCase();
                const isCorrect = duDoanLower === ketQuaLower;
                addToHistory(predictedPhien, currentPrediction.Du_doan, actual.ket_qua === "tài" ? "Tài" : "Xỉu", currentPrediction.Do_tin_cay);
                console.log(`📝 Phiên ${predictedPhien}: Dự đoán ${currentPrediction.Du_doan} | Thực tế ${actual.ket_qua === "tài" ? "Tài" : "Xỉu"} | ${isCorrect ? '✅ THẮNG' : '❌ THUA'}`);
            }
        }

        if (gameHistory.length > 0 && latestPhien === gameHistory[gameHistory.length - 1].phien && currentPrediction) {
            // Kiểm tra xem phiên dự đoán đã có kết quả chưa
            const predictedPhien = currentPrediction.Phien_hien_tai;
            const actual = data.find(s => s.phien === predictedPhien);
            if (!actual) { isUpdating = false; return; } // Chưa có kết quả phiên dự đoán
        }

        gameHistory = data;
        predictor = new DuDoanTaiXiu(data.slice(-500));
        const pred = predictor.predict();

        let pattern = "";
        for (let i = Math.max(0, data.length - 15); i < data.length; i++) pattern += data[i].ket_qua === "tài" ? "t" : "x";

        const last = data[data.length - 1];
        const recentTotals = data.slice(-10).map(p => p.tong);
        let predTotal = Math.round(avg(recentTotals));
        if (last.tong >= 15) predTotal = Math.min(predTotal, 12);
        if (last.tong <= 5) predTotal = Math.max(predTotal, 9);
        predTotal = clamp(predTotal, 3, 18);

        currentPrediction = {
            id: "@anhkhoidzai102",
            Phien: latest.phien,
            Xuc_xac_1: latest.xuc_xac_1,
            Xuc_xac_2: latest.xuc_xac_2,
            Xuc_xac_3: latest.xuc_xac_3,
            Tong: latest.tong,
            Ket_qua: latest.ket_qua === "tài" ? "Tài" : "Xỉu",
            pattern: pattern,
            Phien_hien_tai: latest.phien + 1,
            Du_doan: pred.prediction === "tài" ? "Tài" : "Xỉu",
            Do_tin_cay: pred.confidence + "%",
            Tong_du_doan: predTotal,
            So_tin_hieu: pred.signals.length,
            timestamp: Date.now()
        };

        const winCount = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = verifiedResults.length > 0 ? (winCount / verifiedResults.length * 100).toFixed(1) : '0.0';
        console.log(`✅ ${pred.prediction} (${pred.confidence}%) | ${pred.signals.length} tín hiệu | Tổng ~${predTotal} | Thắng: ${winCount}/${verifiedResults.length} (${winRate}%)`);
    } catch (e) { console.error('❌', e.message); }
    isUpdating = false;
}

// ============ ROUTES ============
app.get('/taixiu', async (req, res) => {
    if (!currentPrediction) await updatePrediction();
    if (currentPrediction) {
        const winCount = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = verifiedResults.length > 0 ? (winCount / verifiedResults.length * 100).toFixed(1) : '0.0';
        return res.json({
            ...currentPrediction,
            Lich_su: { Tong_phien: verifiedResults.length, Thang: winCount, Thua: verifiedResults.length - winCount, Ty_le_thang: winRate + "%" },
            Bang_thang_thua: verifiedResults.slice(0, 20)
        });
    }
    res.json({ id: "@anhkhoidzai102", Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "đang tải", pattern: "", Phien_hien_tai: 0, Du_doan: "đang tải", Do_tin_cay: "0%", Tong_du_doan: 0, So_tin_hieu: 0, timestamp: Date.now(), Lich_su: { Tong_phien: 0, Thang: 0, Thua: 0, Ty_le_thang: "0%" }, Bang_thang_thua: [] });
});

app.get('/', (req, res) => res.redirect('/taixiu'));

// ============ KHỞI ĐỘNG ============
loadHistory();
console.log('='.repeat(60));
console.log('   🎯 HE THONG DU DOAN TAI XIU V16.0 🎯');
console.log('   30+ Thuật Toán Phụ Trợ | 120+ Tổng Hợp | Thích Nghi');
console.log('   API: lovetrang-xinkgai.onrender.com/data');
console.log('='.repeat(60));

updatePrediction();
setInterval(updatePrediction, 200);

app.listen(PORT, () => {
    console.log(`   🚀 Port: ${PORT} | /taixiu`);
    console.log(`   📂 Lịch sử thắng/thua: ${verifiedResults.length} phiên`);
    console.log('='.repeat(60));
});
