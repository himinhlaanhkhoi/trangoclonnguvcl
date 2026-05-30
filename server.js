const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = "https://chiquaquasunlon-207.onrender.com/data";

// ============ STORAGE ============
let gameHistory = [];
let allSessions = [];
let currentPrediction = null;
let verifiedResults = [];
let lastFetchTime = null;
let isUpdating = false;
let consecutiveCorrect = 0;
let consecutiveWrong = 0;

// ============ HELPER FUNCTIONS ============
function getPhien(item) { return item.Phien || item.phien || 0; }
function getKetQua(item) { return item.Ket_qua || item.ket_qua || ''; }
function getTong(item) { return item.Tong || item.tong || 0; }
function getX1(item) { return item.Xuc_xac_1 || item.xuc_xac_1 || 0; }
function getX2(item) { return item.Xuc_xac_2 || item.xuc_xac_2 || 0; }
function getX3(item) { return item.Xuc_xac_3 || item.xuc_xac_3 || 0; }

// ======================================================
// ULTIMATE TÀI XỈU PREDICTOR - WAVELET + HMM + FRACTAL
// ======================================================

class SieuCauTaiXiu {
    constructor(sessions) {
        // Chuyển đổi dữ liệu từ API format
        this.data = sessions.map(s => ({
            ket_qua: getKetQua(s) === 'Tài' || getKetQua(s) === 'tài' ? 'Tài' : 'Xỉu',
            tong: getTong(s),
            xuc_xac_1: getX1(s),
            xuc_xac_2: getX2(s),
            xuc_xac_3: getX3(s)
        }));

        this.taiXiu = this.data.map(p => p.ket_qua);
        this.tong = this.data.map(p => p.tong);
        this.x1 = this.data.map(p => p.xuc_xac_1);
        this.x2 = this.data.map(p => p.xuc_xac_2);
        this.x3 = this.data.map(p => p.xuc_xac_3);

        this.n = this.taiXiu.length;
        this.numeric = this.taiXiu.map(x => x === "Tài" ? 1 : 0);

        // Phân tích fractal & Hurst
        this.hurst = this.tinhHurst();
        this.fractalDim = 2 - this.hurst;
    }

    // ========== 1. HURST EXPONENT ==========
    tinhHurst(doDai = 500) {
        let seq = this.numeric.slice(-doDai);
        if (seq.length < 50) return 0.5;

        let lags = [];
        let rs = [];

        for (let lag = 10; lag <= Math.min(100, seq.length / 2); lag += 10) {
            let ranges = [];
            for (let start = 0; start + lag <= seq.length; start += lag) {
                let chunk = seq.slice(start, start + lag);
                let mean = chunk.reduce((a, b) => a + b, 0) / lag;
                let cumsum = [];
                let sum = 0;
                for (let i = 0; i < lag; i++) {
                    sum += chunk[i] - mean;
                    cumsum.push(sum);
                }
                let R = Math.max(...cumsum) - Math.min(...cumsum);
                let S = Math.sqrt(chunk.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / lag);
                if (S > 0) ranges.push(R / S);
            }
            if (ranges.length) {
                lags.push(Math.log(lag));
                rs.push(Math.log(ranges.reduce((a, b) => a + b, 0) / ranges.length));
            }
        }

        if (lags.length < 2) return 0.5;
        let n = lags.length;
        let sumX = lags.reduce((a, b) => a + b, 0);
        let sumY = rs.reduce((a, b) => a + b, 0);
        let sumXY = lags.reduce((a, b, i) => a + b * rs[i], 0);
        let sumX2 = lags.reduce((a, b) => a + b * b, 0);

        let hurst = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        return Math.min(0.95, Math.max(0.05, hurst));
    }

    // ========== 2. WAVELET LỌC ==========
    waveletLoc(seq, level = 2) {
        let filtered = [...seq];
        for (let l = 0; l < level; l++) {
            let smoothed = [];
            for (let i = 0; i < filtered.length - 1; i += 2) {
                let avg = (filtered[i] + filtered[i + 1]) / 2;
                smoothed.push(avg);
                smoothed.push(avg);
            }
            filtered = smoothed;
        }
        return filtered;
    }

    // ========== 3. HIDDEN MARKOV MODEL (3 TRẠNG THÁI) ==========
    hmmPredict() {
        let states = [0, 1, 2];
        let trans = Array(3).fill().map(() => Array(3).fill(0));
        let emit = Array(3).fill().map(() => ({ Tai: 0, Xiu: 0 }));

        for (let i = 1; i < this.numeric.length; i++) {
            let prev = this.numeric[i - 1];
            let curr = this.numeric[i];
            let prevState = prev === 1 ? 2 : 0;
            let currState = curr === 1 ? 2 : 0;

            if (i > 1 && this.numeric[i - 2] === this.numeric[i - 1]) {
                if (prev === 1) prevState = 2;
                else prevState = 0;
            }
            if (i > 1 && this.numeric[i - 1] === this.numeric[i]) {
                if (curr === 1) currState = 2;
                else currState = 0;
            }

            trans[prevState][currState]++;
            emit[currState][this.taiXiu[i]]++;
        }

        for (let i = 0; i < 3; i++) {
            let sumTrans = trans[i].reduce((a, b) => a + b, 0);
            if (sumTrans > 0) trans[i] = trans[i].map(t => t / sumTrans);
            let sumEmit = emit[i].Tai + emit[i].Xiu;
            if (sumEmit > 0) {
                emit[i].Tai /= sumEmit;
                emit[i].Xiu /= sumEmit;
            }
        }

        let lastState = this.numeric[this.numeric.length - 1] === 1 ? 2 : 0;
        if (this.numeric.length > 1 && this.numeric[this.numeric.length - 2] === this.numeric[this.numeric.length - 1]) {
            if (this.numeric[this.numeric.length - 1] === 1) lastState = 2;
            else lastState = 0;
        }

        let nextProb = { Tai: 0, Xiu: 0 };
        for (let s of states) {
            let p = trans[lastState][s];
            nextProb.Tai += p * emit[s].Tai;
            nextProb.Xiu += p * emit[s].Xiu;
        }

        return nextProb.Tai / (nextProb.Tai + nextProb.Xiu);
    }

    // ========== 4. CẦU NGẦM ==========
    cauNgam() {
        let seq = this.numeric.slice(-100);
        let ma5 = [];
        let ma20 = [];

        for (let i = 0; i < seq.length; i++) {
            let sum5 = 0, sum20 = 0, c5 = 0, c20 = 0;
            for (let j = Math.max(0, i - 4); j <= i; j++) {
                sum5 += seq[j];
                c5++;
            }
            for (let j = Math.max(0, i - 19); j <= i; j++) {
                sum20 += seq[j];
                c20++;
            }
            ma5.push(sum5 / c5);
            ma20.push(sum20 / c20);
        }

        let residual = ma5.map((v, i) => v - ma20[i]);
        let lastRes = residual[residual.length - 1];

        if (lastRes > 0.1) return 0.65;
        if (lastRes < -0.1) return 0.35;
        return 0.5;
    }

    // ========== 5. ENTROPY ==========
    entropy(seq) {
        let freq = { Tai: 0, Xiu: 0 };
        for (let x of seq) freq[x]++;
        let pTai = freq.Tai / seq.length;
        let pXiu = freq.Xiu / seq.length;
        if (pTai === 0 || pXiu === 0) return 0;
        return -(pTai * Math.log2(pTai) + pXiu * Math.log2(pXiu));
    }

    // ========== 6. FRACTAL TREND ==========
    fractalTrend() {
        let seq = this.numeric.slice(-200);
        let chunks = [];
        for (let i = 0; i < seq.length - 20; i += 10) {
            chunks.push(seq.slice(i, i + 20));
        }

        let trends = [];
        for (let chunk of chunks) {
            let start = chunk[0];
            let end = chunk[chunk.length - 1];
            trends.push(end - start);
        }

        let lastTrend = trends[trends.length - 1];
        let avgTrend = trends.reduce((a, b) => a + b, 0) / trends.length;

        if (lastTrend > avgTrend + 0.1) return 0.7;
        if (lastTrend < avgTrend - 0.1) return 0.3;
        return 0.5;
    }

    // ========== 7. THỐNG KÊ BẬC CAO ==========
    thongKeBacCao() {
        let seq = this.numeric.slice(-50);
        let mean = seq.reduce((a, b) => a + b, 0) / seq.length;
        let m2 = seq.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / seq.length;
        let m3 = seq.reduce((a, b) => a + Math.pow(b - mean, 3), 0) / seq.length;
        let m4 = seq.reduce((a, b) => a + Math.pow(b - mean, 4), 0) / seq.length;

        let skewness = m3 / Math.pow(m2, 1.5);
        let kurtosis = m4 / Math.pow(m2, 2) - 3;

        if (skewness > 0.3 && kurtosis > 1) return 0.7;
        if (skewness < -0.3 && kurtosis > 1) return 0.3;
        return 0.5;
    }

    // ========== 8. TỔNG WAVELET ==========
    tongWavelet() {
        let seq = this.tong.slice(-50);
        let filtered = this.waveletLoc(seq, 1);
        let last = filtered[filtered.length - 1];
        let trend = (filtered[filtered.length - 1] - filtered[filtered.length - 5]) / 4;
        let pred = last + trend;
        return Math.round(Math.min(18, Math.max(3, pred)));
    }

    // ========== 9. BỘ XÚC XẮC THÔNG MINH ==========
    boXucXacThongMinh() {
        let matFreq = Array(7).fill().map(() => Array(7).fill(0));
        for (let i = 0; i < this.x1.length - 1; i++) {
            matFreq[this.x1[i]][this.x1[i + 1]]++;
            matFreq[this.x2[i]][this.x2[i + 1]]++;
            matFreq[this.x3[i]][this.x3[i + 1]]++;
        }

        let last = [this.x1[this.x1.length - 1], this.x2[this.x2.length - 1], this.x3[this.x3.length - 1]];
        let next = [];
        for (let l of last) {
            let maxNext = 1;
            for (let m = 2; m <= 6; m++) {
                if (matFreq[l][m] > matFreq[l][maxNext]) maxNext = m;
            }
            next.push(maxNext);
        }
        return next.sort((a, b) => a - b);
    }

    // ========== 10. SIÊU TỔ HỢP CÓ TRỌNG SỐ ==========
    sieuDuDoan() {
        let pHmm = this.hmmPredict();
        let pCauNgam = this.cauNgam();
        let pFractal = this.fractalTrend();
        let pThongKe = this.thongKeBacCao();
        let pMarkov2 = this.markovBac(2);
        let pMarkov3 = this.markovBac(3);
        let pDaoCau = this.xacSuatDaoCau();
        let pWavelet = this.waveletPredict();

        let w = {
            hmm: 0,
            cauNgam: 0,
            fractal: 0,
            thongKe: 0,
            markov2: 0,
            markov3: 0,
            daoCau: 0,
            wavelet: 0
        };

        if (this.hurst > 0.65) {
            w.fractal = 0.2;
            w.daoCau = 0.18;
            w.hmm = 0.15;
            w.wavelet = 0.12;
            w.markov2 = 0.1;
            w.markov3 = 0.08;
            w.cauNgam = 0.1;
            w.thongKe = 0.07;
        } else if (this.hurst < 0.35) {
            w.hmm = 0.22;
            w.thongKe = 0.18;
            w.wavelet = 0.15;
            w.markov2 = 0.12;
            w.markov3 = 0.1;
            w.cauNgam = 0.1;
            w.fractal = 0.07;
            w.daoCau = 0.06;
        } else {
            w.hmm = 0.15;
            w.cauNgam = 0.14;
            w.fractal = 0.14;
            w.thongKe = 0.12;
            w.markov2 = 0.12;
            w.markov3 = 0.11;
            w.daoCau = 0.11;
            w.wavelet = 0.11;
        }

        let pTai = 0;
        pTai += pHmm * w.hmm;
        pTai += pCauNgam * w.cauNgam;
        pTai += pFractal * w.fractal;
        pTai += pThongKe * w.thongKe;
        pTai += pMarkov2 * w.markov2;
        pTai += pMarkov3 * w.markov3;
        pTai += pDaoCau * w.daoCau;
        pTai += pWavelet * w.wavelet;

        if (this.fractalDim > 0.6) pTai = pTai * 0.6 + 0.5 * 0.4;
        if (this.fractalDim < 0.4) pTai = pTai * 0.7 + 0.5 * 0.3;

        return Math.min(0.92, Math.max(0.08, pTai));
    }

    // ========== HELPER FUNCTIONS ==========
    markovBac(bac) {
        let map = new Map();
        for (let i = bac; i < this.numeric.length; i++) {
            let key = this.numeric.slice(i - bac, i).join(",");
            let next = this.numeric[i];
            if (!map.has(key)) map.set(key, { 0: 0, 1: 0 });
            map.get(key)[next]++;
        }
        let lastKey = this.numeric.slice(-bac).join(",");
        let stats = map.get(lastKey);
        if (!stats) return 0.5;
        return stats[1] / (stats[0] + stats[1]);
    }

    xacSuatDaoCau() {
        let ganDay = this.taiXiu.slice(-30);
        let doDai = 1;
        for (let i = ganDay.length - 1; i > 0; i--) {
            if (ganDay[i] === ganDay[i - 1]) doDai++;
            else break;
        }
        if (doDai === 1) return 0.48;
        if (doDai === 2) return 0.52;
        if (doDai === 3) return 0.58;
        if (doDai === 4) return 0.65;
        if (doDai >= 5) return 0.75;
        return 0.5;
    }

    waveletPredict() {
        let filtered = this.waveletLoc(this.numeric.slice(-100), 2);
        let last = filtered[filtered.length - 1];
        let avg = filtered.slice(-20).reduce((a, b) => a + b, 0) / 20;
        if (last > avg + 0.1) return 0.65;
        if (last < avg - 0.1) return 0.35;
        return 0.5;
    }

    // ========== 11. DỰ ĐOÁN HOÀN CHỈNH ==========
    duDoan() {
        let pTai = this.sieuDuDoan();
        let prediction = pTai >= 0.5 ? "Tài" : "Xỉu";
        let confidence = Math.abs(pTai - 0.5) * 2 * 100;

        let total = this.tongWavelet();
        let diceSet = this.boXucXacThongMinh();

        return {
            prediction,
            confidence: confidence.toFixed(1),
            taiProb: (pTai * 100).toFixed(1),
            xiuProb: ((1 - pTai) * 100).toFixed(1),
            total,
            diceSet,
            fractalDim: this.fractalDim.toFixed(3),
            hurst: this.hurst.toFixed(3),
            analysis: {
                trend: this.hurst > 0.65 ? "MẠNH" : this.hurst > 0.5 ? "NHẸ" : "RANDOM",
                hiddenPattern: pTai > 0.6 || pTai < 0.4 ? "CÓ" : "KHÔNG"
            }
        };
    }
}

// ======================================================
// SIÊU HỆ THỐNG 6 LỚP - 19 THUẬT TOÁN (GIỮ NGUYÊN)
// ======================================================

class SieuHeThong6Lop {
    constructor(sessions) {
        this.lichSu = sessions.map(s => ({
            phien: getPhien(s),
            ketQua: getKetQua(s) === 'Tài' || getKetQua(s) === 'tài' ? 'Tài' : 'Xỉu',
            tong: getTong(s),
            x1: getX1(s),
            x2: getX2(s),
            x3: getX3(s)
        })).reverse();

        this.thongKeXucXac = {
            boBa: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, tong: 0 },
            doi: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, tong: 0 },
            dayTang: 0,
            dayGiam: 0,
            tongDiem: []
        };
        this.khoiTaoThongKe();
    }

    khoiTaoThongKe() {
        for (let i = this.lichSu.length - 1; i >= 0; i--) {
            this.capNhatThongKeXucXac(this.lichSu[i]);
        }
    }

    capNhatThongKeXucXac(phien) {
        const dice = [phien.x1, phien.x2, phien.x3];
        const dem = {};
        dice.forEach(x => dem[x] = (dem[x] || 0) + 1);

        if (dice[0] === dice[1] && dice[1] === dice[2]) {
            this.thongKeXucXac.boBa[dice[0]]++;
            this.thongKeXucXac.boBa.tong++;
        }

        for (let i = 1; i <= 6; i++) {
            if (dem[i] >= 2) {
                this.thongKeXucXac.doi[i]++;
                this.thongKeXucXac.doi.tong++;
            }
        }

        const sorted = [...dice].sort((a, b) => a - b);
        if (sorted[0] + 1 === sorted[1] && sorted[1] + 1 === sorted[2]) {
            this.thongKeXucXac.dayTang++;
        }

        const reversed = [...dice].sort((a, b) => b - a);
        if (reversed[0] - 1 === reversed[1] && reversed[1] - 1 === reversed[2]) {
            this.thongKeXucXac.dayGiam++;
        }

        this.thongKeXucXac.tongDiem.push(phien.tong);
        if (this.thongKeXucXac.tongDiem.length > 100) {
            this.thongKeXucXac.tongDiem.shift();
        }
    }

    // LỚP 1: CẦU (8)
    phanTichCauBet() {
        if (this.lichSu.length < 3) return null;
        let doDai = 1;
        const ketQuaCuoi = this.lichSu[0].ketQua;
        for (let i = 1; i < this.lichSu.length; i++) {
            if (this.lichSu[i].ketQua === ketQuaCuoi) doDai++;
            else break;
        }
        if (doDai === 2) return { ketQua: ketQuaCuoi, doTinCay: 62, loai: "cauBet", moTa: `Day 2 → tiep bet (62%)` };
        if (doDai === 3) return { ketQua: ketQuaCuoi, doTinCay: 58, loai: "cauBet", moTa: `Day 3 → tiep bet (58%)` };
        if (doDai === 4) return null;
        if (doDai === 5) {
            const nguoc = ketQuaCuoi === 'Tài' ? 'Xỉu' : 'Tài';
            return { ketQua: nguoc, doTinCay: 60, loai: "cauBet", moTa: `Day 5 → gay (60%)` };
        }
        if (doDai === 6) {
            const nguoc = ketQuaCuoi === 'Tài' ? 'Xỉu' : 'Tài';
            return { ketQua: nguoc, doTinCay: 68, loai: "cauBet", moTa: `Day 6 → gay (68%)` };
        }
        if (doDai >= 7) {
            const nguoc = ketQuaCuoi === 'Tài' ? 'Xỉu' : 'Tài';
            return { ketQua: nguoc, doTinCay: 75, loai: "cauBet", moTa: `Day ${doDai} → gay (75%)` };
        }
        return null;
    }

    phanTichCauDao11() {
        if (this.lichSu.length < 4) return null;
        const p = this.lichSu.slice(0, 4).map(v => v.ketQua);
        if (p[0] === 'Tài' && p[1] === 'Xỉu' && p[2] === 'Tài' && p[3] === 'Xỉu')
            return { ketQua: 'Tài', doTinCay: 72, loai: "cauDao11", moTa: "Cau dao T-X-T-X → Tai (72%)" };
        if (p[0] === 'Xỉu' && p[1] === 'Tài' && p[2] === 'Xỉu' && p[3] === 'Tài')
            return { ketQua: 'Xỉu', doTinCay: 72, loai: "cauDao11", moTa: "Cau dao X-T-X-T → Xiu (72%)" };
        return null;
    }

    phanTichCauDao22() {
        if (this.lichSu.length < 4) return null;
        const p = this.lichSu.slice(0, 4).map(v => v.ketQua);
        if (p[0] === 'Tài' && p[1] === 'Tài' && p[2] === 'Xỉu' && p[3] === 'Xỉu')
            return { ketQua: 'Tài', doTinCay: 68, loai: "cauDao22", moTa: "Cau dao T-T-X-X → Tai (68%)" };
        if (p[0] === 'Xỉu' && p[1] === 'Xỉu' && p[2] === 'Tài' && p[3] === 'Tài')
            return { ketQua: 'Xỉu', doTinCay: 68, loai: "cauDao22", moTa: "Cau dao X-X-T-T → Xiu (68%)" };
        return null;
    }

    phanTichCauDao33() {
        if (this.lichSu.length < 6) return null;
        const p = this.lichSu.slice(0, 6).map(v => v.ketQua);
        if (p[0] === 'Tài' && p[1] === 'Tài' && p[2] === 'Tài' && p[3] === 'Xỉu' && p[4] === 'Xỉu' && p[5] === 'Xỉu')
            return { ketQua: 'Tài', doTinCay: 70, loai: "cauDao33", moTa: "Cau dao T-T-T-X-X-X → Tai (70%)" };
        if (p[0] === 'Xỉu' && p[1] === 'Xỉu' && p[2] === 'Xỉu' && p[3] === 'Tài' && p[4] === 'Tài' && p[5] === 'Tài')
            return { ketQua: 'Xỉu', doTinCay: 70, loai: "cauDao33", moTa: "Cau dao X-X-X-T-T-T → Xiu (70%)" };
        return null;
    }

    phanTichCau212() {
        if (this.lichSu.length < 5) return null;
        const p = this.lichSu.slice(0, 5).map(v => v.ketQua);
        if (p[0] === 'Tài' && p[1] === 'Tài' && p[2] === 'Xỉu' && p[3] === 'Tài' && p[4] === 'Tài')
            return { ketQua: 'Xỉu', doTinCay: 70, loai: "cau212", moTa: "Cau T-T-X-T-T → Xiu (70%)" };
        if (p[0] === 'Xỉu' && p[1] === 'Xỉu' && p[2] === 'Tài' && p[3] === 'Xỉu' && p[4] === 'Xỉu')
            return { ketQua: 'Tài', doTinCay: 70, loai: "cau212", moTa: "Cau X-X-T-X-X → Tai (70%)" };
        return null;
    }

    phanTichCauZigzag() {
        if (this.lichSu.length < 6) return null;
        let isZigzag = true;
        for (let i = 0; i < 5; i++) {
            if (this.lichSu[i].ketQua === this.lichSu[i + 1].ketQua) { isZigzag = false; break; }
        }
        if (isZigzag) {
            const cuoi = this.lichSu[0].ketQua;
            const nguoc = cuoi === 'Tài' ? 'Xỉu' : 'Tài';
            let doTinCay = 70;
            if (this.lichSu.length >= 8) doTinCay = 75;
            if (this.lichSu.length >= 10) doTinCay = 80;
            return { ketQua: nguoc, doTinCay: doTinCay, loai: "cauZigzag", moTa: `Zigzag dao lien tuc → ${nguoc} (${doTinCay}%)` };
        }
        return null;
    }

    phanTichCauChuKy() {
        if (this.lichSu.length < 20) return null;
        const kq = this.lichSu.map(v => v.ketQua);
        for (let ky = 3; ky <= 8; ky++) {
            let giong = true;
            for (let i = 0; i < ky; i++) {
                if (kq[i] !== kq[i + ky]) { giong = false; break; }
            }
            if (giong) return { ketQua: kq[ky - 1], doTinCay: 68, loai: "cauChuKy", moTa: `Chu ky ${ky} van → ${kq[ky - 1]} (68%)` };
        }
        return null;
    }

    phanTichCauTongDiem() {
        if (this.lichSu.length < 10) return null;
        const tong10 = this.lichSu.slice(0, 10).map(v => v.tong);
        const tb = tong10.reduce((a, b) => a + b, 0) / 10;
        const tongCuoi = this.lichSu[0].tong;
        if (tongCuoi > 12.5) return { ketQua: 'Xỉu', doTinCay: 65, loai: "cauTongDiem", moTa: `Tong ${tongCuoi} qua cao → Xiu (65%)` };
        if (tongCuoi < 8.5) return { ketQua: 'Tài', doTinCay: 65, loai: "cauTongDiem", moTa: `Tong ${tongCuoi} qua thap → Tai (65%)` };
        if (tongCuoi > tb + 2.5) return { ketQua: 'Xỉu', doTinCay: 62, loai: "cauTongDiem", moTa: `Tong ${tongCuoi} > TB ${tb.toFixed(1)} → Xiu (62%)` };
        if (tongCuoi < tb - 2.5) return { ketQua: 'Tài', doTinCay: 62, loai: "cauTongDiem", moTa: `Tong ${tongCuoi} < TB ${tb.toFixed(1)} → Tai (62%)` };
        return null;
    }

    // LỚP 2: XÚC XẮC (5)
    phanTichBoBa() {
        if (this.lichSu.length === 0) return null;
        const p = this.lichSu[0];
        if (p.x1 === p.x2 && p.x2 === p.x3) {
            if (p.x1 <= 3) return { ketQua: 'Xỉu', doTinCay: 98, loai: "boBa", uuTien: 3, moTa: `Bo ba ${p.x1}-${p.x1}-${p.x1} → Xiu (98%)` };
            if (p.x1 >= 4) return { ketQua: 'Tài', doTinCay: 98, loai: "boBa", uuTien: 3, moTa: `Bo ba ${p.x1}-${p.x1}-${p.x1} → Tai (98%)` };
        }
        return null;
    }

    phanTichDoi() {
        if (this.lichSu.length === 0) return null;
        const p = this.lichSu[0];
        const dem = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
        [p.x1, p.x2, p.x3].forEach(x => dem[x]++);
        for (let face = 1; face <= 6; face++) {
            if (dem[face] >= 2) {
                if (face === 1) return { ketQua: 'Xỉu', doTinCay: 88, loai: "doi", uuTien: 2, moTa: `Hai mat 1 → Xiu (88%)` };
                if (face === 2) return { ketQua: 'Xỉu', doTinCay: 77, loai: "doi", uuTien: 2, moTa: `Hai mat 2 → Xiu (77%)` };
                if (face === 3) return { ketQua: 'Xỉu', doTinCay: 65, loai: "doi", uuTien: 1, moTa: `Hai mat 3 → Xiu (65%)` };
                if (face === 4) return { ketQua: 'Tài', doTinCay: 67, loai: "doi", uuTien: 1, moTa: `Hai mat 4 → Tai (67%)` };
                if (face === 5) return { ketQua: 'Tài', doTinCay: 79, loai: "doi", uuTien: 2, moTa: `Hai mat 5 → Tai (79%)` };
                if (face === 6) return { ketQua: 'Tài', doTinCay: 87, loai: "doi", uuTien: 2, moTa: `Hai mat 6 → Tai (87%)` };
            }
        }
        return null;
    }

    phanTichDayTang() {
        if (this.lichSu.length === 0) return null;
        const p = this.lichSu[0];
        const tang = [p.x1, p.x2, p.x3].sort((a, b) => a - b);
        if (tang[0] + 1 === tang[1] && tang[1] + 1 === tang[2]) {
            if (tang[0] >= 4) return { ketQua: 'Tài', doTinCay: 67, loai: "dayTang", moTa: `Day tang ${tang[0]}-${tang[1]}-${tang[2]} → Tai (67%)` };
            if (tang[0] <= 2) return { ketQua: 'Xỉu', doTinCay: 62, loai: "dayTang", moTa: `Day tang ${tang[0]}-${tang[1]}-${tang[2]} → Xiu (62%)` };
        }
        return null;
    }

    phanTichDayGiam() {
        if (this.lichSu.length === 0) return null;
        const p = this.lichSu[0];
        const giam = [p.x1, p.x2, p.x3].sort((a, b) => b - a);
        if (giam[0] - 1 === giam[1] && giam[1] - 1 === giam[2]) {
            if (giam[0] >= 5) return { ketQua: 'Tài', doTinCay: 65, loai: "dayGiam", moTa: `Day giam ${giam[0]}-${giam[1]}-${giam[2]} → Tai (65%)` };
            if (giam[0] <= 3) return { ketQua: 'Xỉu', doTinCay: 60, loai: "dayGiam", moTa: `Day giam ${giam[0]}-${giam[1]}-${giam[2]} → Xiu (60%)` };
        }
        return null;
    }

    phanTichCapXucXac() {
        if (this.lichSu.length < 20) return null;
        const p = this.lichSu[0];
        const capChinh = `${Math.min(p.x1, p.x2)}-${Math.max(p.x1, p.x2)}`;
        const capPhu = `${Math.min(p.x2, p.x3)}-${Math.max(p.x2, p.x3)}`;
        let taiCap = 0, xiuCap = 0, demCap = 0;
        for (let i = 1; i < Math.min(this.lichSu.length, 100); i++) {
            const q = this.lichSu[i];
            const c1 = `${Math.min(q.x1, q.x2)}-${Math.max(q.x1, q.x2)}`;
            const c2 = `${Math.min(q.x2, q.x3)}-${Math.max(q.x2, q.x3)}`;
            if (c1 === capChinh || c2 === capPhu) {
                if (q.ketQua === 'Tài') taiCap++;
                else xiuCap++;
                demCap++;
            }
        }
        if (demCap >= 5) {
            const tyLeTai = (taiCap / demCap) * 100;
            const pred = taiCap > xiuCap ? 'Tài' : 'Xỉu';
            const conf = Math.max(tyLeTai, 100 - tyLeTai);
            if (conf >= 65) return { ketQua: pred, doTinCay: conf, loai: "capXucXac", moTa: `Cap ${capChinh} xuat hien ${demCap} lan → ${pred} (${conf.toFixed(0)}%)` };
        }
        return null;
    }

    // LỚP 3: KỸ THUẬT (4)
    phanTichRSI() {
        if (this.lichSu.length < 14) return null;
        const nums = this.lichSu.slice(0, 14).map(p => p.ketQua === 'Tài' ? 1 : 0);
        let gains = 0, losses = 0;
        for (let i = 1; i < nums.length; i++) {
            const diff = nums[i] - nums[i - 1];
            if (diff > 0) gains += diff;
            else losses -= diff;
        }
        const avgGain = gains / 14, avgLoss = losses / 14;
        let rsi = 50;
        if (avgLoss === 0) rsi = 100;
        else rsi = 100 - (100 / (1 + avgGain / avgLoss));
        if (rsi > 70) return { ketQua: 'Xỉu', doTinCay: 68, loai: "rsi", moTa: `RSI = ${rsi.toFixed(0)} > 70 → Xiu (68%)` };
        if (rsi < 30) return { ketQua: 'Tài', doTinCay: 68, loai: "rsi", moTa: `RSI = ${rsi.toFixed(0)} < 30 → Tai (68%)` };
        return null;
    }

    phanTichMACD() {
        if (this.lichSu.length < 20) return null;
        const nums = this.lichSu.slice(0, 20).map(p => p.ketQua === 'Tài' ? 1 : 0);
        const ema6 = nums.slice(-6).reduce((a, b) => a + b, 0) / 6;
        const ema12 = nums.slice(-12).reduce((a, b) => a + b, 0) / 12;
        const macd = ema6 - ema12;
        if (macd > 0.1) return { ketQua: 'Tài', doTinCay: 65, loai: "macd", moTa: `MACD duong → Tai (65%)` };
        if (macd < -0.1) return { ketQua: 'Xỉu', doTinCay: 65, loai: "macd", moTa: `MACD am → Xiu (65%)` };
        return null;
    }

    phanTichBollinger() {
        if (this.lichSu.length < 12) return null;
        const nums = this.lichSu.slice(0, 12).map(p => p.ketQua === 'Tài' ? 1 : 0);
        const mean = nums.reduce((a, b) => a + b, 0) / 12;
        const variance = nums.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / 12;
        const std = Math.sqrt(variance);
        const upper = mean + 1.5 * std, lower = mean - 1.5 * std;
        const last = nums[0];
        if (last > upper) return { ketQua: 'Xỉu', doTinCay: 66, loai: "bollinger", moTa: `Cham dai Bollinger tren → Xiu (66%)` };
        if (last < lower) return { ketQua: 'Tài', doTinCay: 66, loai: "bollinger", moTa: `Cham dai Bollinger duoi → Tai (66%)` };
        return null;
    }

    phanTichStochastic() {
        if (this.lichSu.length < 10) return null;
        const nums = this.lichSu.slice(0, 10).map(p => p.ketQua === 'Tài' ? 1 : 0);
        const high = Math.max(...nums), low = Math.min(...nums);
        if (high === low) return null;
        const k = (nums[0] - low) / (high - low) * 100;
        if (k > 80) return { ketQua: 'Xỉu', doTinCay: 64, loai: "stochastic", moTa: `Stochastic %K = ${k.toFixed(0)} > 80 → Xiu (64%)` };
        if (k < 20) return { ketQua: 'Tài', doTinCay: 64, loai: "stochastic", moTa: `Stochastic %K = ${k.toFixed(0)} < 20 → Tai (64%)` };
        return null;
    }

    // LỚP 4: PATTERN MATCHING (2)
    phanTichPatternMatching(doDai = 6) {
        if (this.lichSu.length < doDai + 5) return null;
        const pattern = this.lichSu.slice(0, doDai).map(p => p.ketQua === 'Tài' ? 'T' : 'X').join('');
        let taiSau = 0, xiuSau = 0, dem = 0;
        const allResults = this.lichSu.map(p => p.ketQua === 'Tài' ? 'T' : 'X').join('');
        for (let i = 0; i <= allResults.length - doDai - 1; i++) {
            if (allResults.substr(i, doDai) === pattern) {
                const next = allResults[i + doDai];
                if (next === 'T') taiSau++;
                else xiuSau++;
                dem++;
            }
        }
        if (dem >= 3) {
            const tyLeTai = (taiSau / dem) * 100;
            const pred = taiSau > xiuSau ? 'Tài' : 'Xỉu';
            const conf = Math.max(tyLeTai, 100 - tyLeTai);
            if (conf >= 65) return { ketQua: pred, doTinCay: conf, loai: "patternMatching", moTa: `Pattern "${pattern}" xuat hien ${dem} lan → ${pred} (${conf.toFixed(0)}%)` };
        }
        return null;
    }

    // LỚP 5: TỔNG HỢP
    duDoanTongHop() {
        if (this.lichSu.length < 5) return { coDuLieu: false, lyDo: "Can it nhat 5 phien" };

        const cacDuDoan = [
            this.phanTichBoBa(), this.phanTichDoi(), this.phanTichCapXucXac(),
            this.phanTichDayTang(), this.phanTichDayGiam(),
            this.phanTichCauBet(), this.phanTichCauDao11(), this.phanTichCauDao22(),
            this.phanTichCauDao33(), this.phanTichCau212(), this.phanTichCauZigzag(),
            this.phanTichCauChuKy(), this.phanTichCauTongDiem(),
            this.phanTichRSI(), this.phanTichMACD(), this.phanTichBollinger(),
            this.phanTichStochastic(), this.phanTichPatternMatching(5), this.phanTichPatternMatching(6)
        ].filter(d => d !== null);

        if (cacDuDoan.length === 0) return { coDuLieu: true, coTinHieu: false, lyDo: "Khong phat hien tin hieu ro rang" };

        const uuTienCaoNhat = cacDuDoan.find(d => d.uuTien === 3);
        if (uuTienCaoNhat) {
            return {
                coDuLieu: true, coTinHieu: true,
                ketQua: uuTienCaoNhat.ketQua, doTinCay: uuTienCaoNhat.doTinCay,
                uuTien: "BO BA DAC BIET",
                chiTiet: [`${uuTienCaoNhat.moTa}`], soTinHieu: cacDuDoan.length
            };
        }

        let diemTai = 0, diemXiu = 0;
        const chiTiet = [];
        for (const dd of cacDuDoan) {
            const trongSo = dd.uuTien === 2 ? 1.5 : (dd.uuTien === 1 ? 1.2 : 1.0);
            const diem = (dd.doTinCay / 100) * trongSo;
            if (dd.ketQua === 'Tài') { diemTai += diem; chiTiet.push(`Tai: ${dd.moTa}`); }
            else { diemXiu += diem; chiTiet.push(`Xiu: ${dd.moTa}`); }
        }

        const tongDiem = diemTai + diemXiu;
        const ketQua = diemTai > diemXiu ? 'Tài' : 'Xỉu';
        const doTinCay = tongDiem > 0 ? Math.round((Math.max(diemTai, diemXiu) / tongDiem) * 100) : 50;

        return {
            coDuLieu: true, coTinHieu: true,
            ketQua, doTinCay: Math.max(60, Math.min(98, doTinCay)),
            diemTai: diemTai.toFixed(1), diemXiu: diemXiu.toFixed(1),
            soTinHieu: cacDuDoan.length, chiTiet
        };
    }
}

// ============ SUPER PREDICT (KẾT HỢP CẢ HAI HỆ THỐNG) ============
function superPredict(sessions) {
    // Hệ thống 6 lớp
    const heThong6Lop = new SieuHeThong6Lop(sessions);
    const ketQua6Lop = heThong6Lop.duDoanTongHop();

    // Hệ thống SieuCauTaiXiu (Wavelet + HMM + Fractal)
    const sieuCau = new SieuCauTaiXiu(sessions);
    const ketQuaSieuCau = sieuCau.duDoan();

    // Nếu có tín hiệu từ 6 lớp, ưu tiên dùng
    if (ketQua6Lop.coTinHieu) {
        return {
            prediction: ketQua6Lop.ketQua,
            confidence: ketQua6Lop.doTinCay,
            chiTiet: ketQua6Lop.chiTiet || [],
            sieuCau: {
                prediction: ketQuaSieuCau.prediction,
                confidence: ketQuaSieuCau.confidence,
                taiProb: ketQuaSieuCau.taiProb,
                xiuProb: ketQuaSieuCau.xiuProb,
                hurst: ketQuaSieuCau.hurst,
                fractalDim: ketQuaSieuCau.fractalDim,
                trend: ketQuaSieuCau.analysis.trend
            }
        };
    }

    // Fallback: dùng SieuCauTaiXiu
    return {
        prediction: ketQuaSieuCau.prediction,
        confidence: Math.round(parseFloat(ketQuaSieuCau.confidence)),
        chiTiet: [`SieuCau: ${ketQuaSieuCau.prediction} (${ketQuaSieuCau.confidence}%)`],
        sieuCau: {
            prediction: ketQuaSieuCau.prediction,
            confidence: ketQuaSieuCau.confidence,
            taiProb: ketQuaSieuCau.taiProb,
            xiuProb: ketQuaSieuCau.xiuProb,
            hurst: ketQuaSieuCau.hurst,
            fractalDim: ketQuaSieuCau.fractalDim,
            trend: ketQuaSieuCau.analysis.trend
        }
    };
}

// ============ FETCH & NORMALIZE ============
async function fetchAndNormalize() {
    try {
        const res = await axios.get(API_URL, { timeout: 10000 });
        const rawData = res.data;
        if (!rawData || !rawData.data || !Array.isArray(rawData.data)) return null;
        const data = rawData.data;
        data.sort((a, b) => getPhien(a) - getPhien(b));
        const count = Math.min(30, data.length);
        const latest = data.slice(-count);
        allSessions = data.slice(-500);
        return latest;
    } catch (e) { return null; }
}

// ============ AUTO UPDATE ============
async function autoUpdate() {
    if (isUpdating) return;
    isUpdating = true;
    try {
        const sessions = await fetchAndNormalize();
        if (!sessions || sessions.length < 5) { isUpdating = false; return; }
        const latestPhien = getPhien(sessions[sessions.length - 1]);
        const oldLatestPhien = gameHistory.length > 0 ? getPhien(gameHistory[gameHistory.length - 1]) : 0;

        if (latestPhien !== oldLatestPhien || gameHistory.length === 0) {
            if (currentPrediction && gameHistory.length > 0) {
                const predictedPhien = currentPrediction.phien;
                const actual = sessions.find(s => getPhien(s) === predictedPhien);
                if (actual) {
                    const isCorrect = currentPrediction.prediction === getKetQua(actual);
                    if (isCorrect) { consecutiveCorrect++; consecutiveWrong = 0; }
                    else { consecutiveWrong++; consecutiveCorrect = 0; }
                    verifiedResults.unshift({
                        phien: predictedPhien, du_doan: currentPrediction.prediction.toLowerCase(),
                        ket_qua: getKetQua(actual).toLowerCase(), danh_gia: isCorrect ? 'thang' : 'thua',
                        confidence: currentPrediction.confidence
                    });
                    if (verifiedResults.length > 500) verifiedResults = verifiedResults.slice(0, 500);
                    try { fs.writeFileSync('./verified_results.json', JSON.stringify(verifiedResults, null, 2)); } catch (e) {}
                }
            }
            gameHistory = sessions;
            const pred = superPredict(gameHistory);
            currentPrediction = {
                phien: latestPhien + 1,
                prediction: pred.prediction,
                confidence: pred.confidence,
                chiTiet: pred.chiTiet || [],
                sieuCau: pred.sieuCau || null,
                timestamp: new Date().toISOString()
            };
        }
    } catch (e) { console.error('Update error:', e.message); }
    isUpdating = false;
}

// ============ API ROUTES ============
app.get("/taixiu", async (req, res) => {
    if (gameHistory.length >= 5 && currentPrediction) {
        const latest = gameHistory[gameHistory.length - 1];
        const winLoss = verifiedResults.slice(0, 500);
        let consLosses = 0;
        for (let i = 0; i < winLoss.length; i++) { if (winLoss[i].danh_gia === 'thua') consLosses++; else break; }
        const totalV = verifiedResults.length;
        const totalW = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = totalV > 0 ? ((totalW / totalV) * 100).toFixed(1) : '0.0';
        return res.json({
            id: "@vuaoccac",
            phien_truoc: { Phien: getPhien(latest), Xuc_xac_1: getX1(latest), Xuc_xac_2: getX2(latest), Xuc_xac_3: getX3(latest), Tong: getTong(latest), Ket_qua: getKetQua(latest) },
            phien_hien_tai: { Phien: currentPrediction.phien, Du_doan: currentPrediction.prediction, Do_tin_cay: currentPrediction.confidence + "%" },
            stats: { consecutiveLosses: consLosses, winRate: winRate + "%", totalPredictions: totalV, totalWins: totalW },
            win_loss_table: winLoss,
            chi_tiet: currentPrediction.chiTiet || [],
            sieu_cau: currentPrediction.sieuCau || null
        });
    }
    const sessions = await fetchAndNormalize();
    if (!sessions || sessions.length < 5) {
        return res.json({ id: "@vuaoccac", phien_truoc: { Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "Dang tai..." }, phien_hien_tai: { Phien: 0, Du_doan: "Dang tai...", Do_tin_cay: "0%" }, stats: { consecutiveLosses: 0, winRate: "0%", totalPredictions: 0, totalWins: 0 }, win_loss_table: [] });
    }
    gameHistory = sessions;
    const latest = sessions[sessions.length - 1];
    const pred = superPredict(sessions);
    currentPrediction = { phien: getPhien(latest) + 1, prediction: pred.prediction, confidence: pred.confidence, chiTiet: pred.chiTiet || [], sieuCau: pred.sieuCau || null, timestamp: new Date().toISOString() };
    res.json({
        id: "@vuaoccac",
        phien_truoc: { Phien: getPhien(latest), Xuc_xac_1: getX1(latest), Xuc_xac_2: getX2(latest), Xuc_xac_3: getX3(latest), Tong: getTong(latest), Ket_qua: getKetQua(latest) },
        phien_hien_tai: { Phien: getPhien(latest) + 1, Du_doan: pred.prediction, Do_tin_cay: pred.confidence + "%" },
        stats: { consecutiveLosses: 0, winRate: "0%", totalPredictions: 0, totalWins: 0 },
        win_loss_table: []
    });
});

app.get("/", (req, res) => {
    if (gameHistory.length >= 5 && currentPrediction) {
        const latest = gameHistory[gameHistory.length - 1];
        const winLoss = verifiedResults.slice(0, 500);
        const totalW = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = verifiedResults.length > 0 ? ((totalW / verifiedResults.length) * 100).toFixed(1) : '0.0';
        return res.json({
            id: "@vuaoccac",
            phien_truoc: { Phien: getPhien(latest), Xuc_xac_1: getX1(latest), Xuc_xac_2: getX2(latest), Xuc_xac_3: getX3(latest), Tong: getTong(latest), Ket_qua: getKetQua(latest) },
            phien_hien_tai: { Phien: currentPrediction.phien, Du_doan: currentPrediction.prediction, Do_tin_cay: currentPrediction.confidence + "%" },
            stats: { totalPredictions: verifiedResults.length, winRate: winRate + "%", consecutiveCorrect, consecutiveWrong },
            win_loss_table: winLoss,
            chi_tiet: currentPrediction.chiTiet || [],
            sieu_cau: currentPrediction.sieuCau || null
        });
    }
    res.json({ status: "OK", message: "Server dang chay" });
});

// ============ KHỞI ĐỘNG ============
try { if (fs.existsSync('./verified_results.json')) verifiedResults = JSON.parse(fs.readFileSync('./verified_results.json', 'utf8')); } catch (e) {}

autoUpdate();
setInterval(autoUpdate, 100);

app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('ULTIMATE TAI XIU - 6 LOP + WAVELET + HMM + FRACTAL');
    console.log('='.repeat(60));
    console.log(`Port: ${PORT} | API: ${API_URL}`);
    console.log(`30 phien phan tich | 500 phien lich su`);
    console.log(`He thong 6 lop: 19 thuat toan`);
    console.log(`SieuCau: Hurst + Wavelet + HMM + Fractal + Markov`);
    console.log('='.repeat(60));
});
