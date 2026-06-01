const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const HISTORY_FILE = 'lichsu_du_doan.json';
const SESSIONS_FILE = 'sessions_data.json';
const KETQUA_FILE = 'ketqua_thang_thua.json';

// ===== CẤU HÌNH =====
const MAX_HISTORY = 500;
const FETCH_PER_REQUEST = 30;
const FETCH_INTERVAL = 3000;
const AUTO_SAVE_INTERVAL = 10000;

let winLossHistory = { hu: [], md5: [] };
let predictionHistory = { hu: [], md5: [] };
let lastProcessedPhien = { hu: null, md5: null };
let sessionsStore = { hu: [], md5: [] };
let isReady = { hu: false, md5: false };
let predictors = { hu: null, md5: null };

// ==================== GOD PREDICTOR ALGORITHMS ====================

class GodPredictorAlgorithms {
    constructor(history) {
        this.history = history;
    }

    // -------------------- NHÓM 1: CẦU KẾT QUẢ (12) --------------------
    
    streak_basic() {
        if (this.history.length < 3) return [null, 0];
        const last = this.history[this.history.length - 1].ket_qua;
        let streak = 1;
        for (let i = this.history.length - 2; i >= 0; i--) {
            if (this.history[i].ket_qua === last) streak++;
            else break;
        }
        if (streak >= 2) {
            const conf = Math.min(85, 55 + streak * 4);
            return [last === 1 ? "Tài" : "Xỉu", conf];
        }
        return [null, 0];
    }
    
    streak_advanced() {
        if (this.history.length < 3) return [null, 0];
        const last = this.history[this.history.length - 1].ket_qua;
        let streak = 1;
        for (let i = this.history.length - 2; i >= 0; i--) {
            if (this.history[i].ket_qua === last) streak++;
            else break;
        }
        if (streak >= 3) {
            const conf = Math.max(60, 85 - streak * 5);
            return [last === 1 ? "Tài" : "Xỉu", conf];
        }
        return [null, 0];
    }
    
    alternating_1_1() {
        if (this.history.length < 4) return [null, 0];
        const last4 = this.history.slice(-4).map(h => h.ket_qua);
        if (last4[0] === 1 && last4[1] === 0 && last4[2] === 1 && last4[3] === 0) return ["Tài", 72];
        if (last4[0] === 0 && last4[1] === 1 && last4[2] === 0 && last4[3] === 1) return ["Xỉu", 72];
        return [null, 0];
    }
    
    alternating_2_2() {
        if (this.history.length < 4) return [null, 0];
        const last4 = this.history.slice(-4).map(h => h.ket_qua);
        if (last4[0] === 1 && last4[1] === 1 && last4[2] === 0 && last4[3] === 0) return ["Tài", 68];
        if (last4[0] === 0 && last4[1] === 0 && last4[2] === 1 && last4[3] === 1) return ["Xỉu", 68];
        return [null, 0];
    }
    
    alternating_3_3() {
        if (this.history.length < 6) return [null, 0];
        const last6 = this.history.slice(-6).map(h => h.ket_qua);
        if (last6[0] === 1 && last6[1] === 1 && last6[2] === 1 && last6[3] === 0 && last6[4] === 0 && last6[5] === 0) return ["Tài", 70];
        if (last6[0] === 0 && last6[1] === 0 && last6[2] === 0 && last6[3] === 1 && last6[4] === 1 && last6[5] === 1) return ["Xỉu", 70];
        return [null, 0];
    }
    
    pattern_2_1_2() {
        if (this.history.length < 5) return [null, 0];
        const last5 = this.history.slice(-5).map(h => h.ket_qua);
        if (last5[0] === 1 && last5[1] === 1 && last5[2] === 0 && last5[3] === 1 && last5[4] === 1) return ["Xỉu", 70];
        if (last5[0] === 0 && last5[1] === 0 && last5[2] === 1 && last5[3] === 0 && last5[4] === 0) return ["Tài", 70];
        return [null, 0];
    }
    
    pattern_3_2_1() {
        if (this.history.length < 6) return [null, 0];
        const last6 = this.history.slice(-6).map(h => h.ket_qua);
        if (last6[0] === 1 && last6[1] === 1 && last6[2] === 1 && last6[3] === 0 && last6[4] === 0 && last6[5] === 0) return ["Xỉu", 68];
        if (last6[0] === 0 && last6[1] === 0 && last6[2] === 0 && last6[3] === 1 && last6[4] === 1 && last6[5] === 1) return ["Tài", 68];
        return [null, 0];
    }
    
    pattern_1_2_3() {
        if (this.history.length < 6) return [null, 0];
        const last6 = this.history.slice(-6).map(h => h.ket_qua);
        if (last6[0] === 1 && last6[1] === 0 && last6[2] === 0 && last6[3] === 1 && last6[4] === 1 && last6[5] === 1) return ["Xỉu", 65];
        if (last6[0] === 0 && last6[1] === 1 && last6[2] === 1 && last6[3] === 0 && last6[4] === 0 && last6[5] === 0) return ["Tài", 65];
        return [null, 0];
    }
    
    zigzag_long() {
        if (this.history.length < 7) return [null, 0];
        const last7 = this.history.slice(-7).map(h => h.ket_qua);
        let isZigzag = true;
        for (let i = 0; i < 6; i++) {
            if (last7[i] === last7[i + 1]) { isZigzag = false; break; }
        }
        if (isZigzag) return [last7[6] === 0 ? "Tài" : "Xỉu", 70];
        return [null, 0];
    }
    
    pattern_2_nhip() {
        if (this.history.length < 4) return [null, 0];
        const last4 = this.history.slice(-4).map(h => h.ket_qua);
        if (last4[0] === 1 && last4[1] === 0 && last4[2] === 1 && last4[3] === 0) return ["Tài", 65];
        if (last4[0] === 0 && last4[1] === 1 && last4[2] === 0 && last4[3] === 1) return ["Xỉu", 65];
        return [null, 0];
    }
    
    pattern_3_nhip() {
        if (this.history.length < 6) return [null, 0];
        const last6 = this.history.slice(-6).map(h => h.ket_qua);
        if (last6[0] === 1 && last6[1] === 0 && last6[2] === 1 && last6[3] === 0 && last6[4] === 1 && last6[5] === 0) return ["Xỉu", 68];
        if (last6[0] === 0 && last6[1] === 1 && last6[2] === 0 && last6[3] === 1 && last6[4] === 0 && last6[5] === 1) return ["Tài", 68];
        return [null, 0];
    }
    
    frequency_10_hands() {
        if (this.history.length < 10) return [null, 0];
        const recent = this.history.slice(-10).map(h => h.ket_qua);
        const taiCount = recent.reduce((a, b) => a + b, 0);
        if (taiCount >= 7) return ["Xỉu", 65];
        if (taiCount <= 3) return ["Tài", 65];
        return [null, 0];
    }
    
    // -------------------- NHÓM 2: CẦU XÚC XẮC (8) --------------------
    
    triple_special() {
        if (this.history.length < 1) return [null, 0];
        const last = this.history[this.history.length - 1];
        if (last.co_ba) {
            if (last.x1 === 1) return ["Xỉu", 95];
            if (last.x1 === 6) return ["Tài", 92];
        }
        return [null, 0];
    }
    
    double_face_6() {
        if (this.history.length < 1) return [null, 0];
        const dice = [this.history[this.history.length - 1].x1, this.history[this.history.length - 1].x2, this.history[this.history.length - 1].x3];
        if (dice.filter(v => v === 6).length >= 2) return ["Tài", 78];
        return [null, 0];
    }
    
    double_face_1() {
        if (this.history.length < 1) return [null, 0];
        const dice = [this.history[this.history.length - 1].x1, this.history[this.history.length - 1].x2, this.history[this.history.length - 1].x3];
        if (dice.filter(v => v === 1).length >= 2) return ["Xỉu", 82];
        return [null, 0];
    }
    
    double_face_5() {
        if (this.history.length < 1) return [null, 0];
        const dice = [this.history[this.history.length - 1].x1, this.history[this.history.length - 1].x2, this.history[this.history.length - 1].x3];
        if (dice.filter(v => v === 5).length >= 2) return ["Tài", 68];
        return [null, 0];
    }
    
    double_face_2() {
        if (this.history.length < 1) return [null, 0];
        const dice = [this.history[this.history.length - 1].x1, this.history[this.history.length - 1].x2, this.history[this.history.length - 1].x3];
        if (dice.filter(v => v === 2).length >= 2) return ["Xỉu", 65];
        return [null, 0];
    }
    
    increasing_sequence() {
        if (this.history.length < 1) return [null, 0];
        const dice = [this.history[this.history.length - 1].x1, this.history[this.history.length - 1].x2, this.history[this.history.length - 1].x3];
        const sorted = [...dice].sort((a, b) => a - b);
        if (sorted[0] + 1 === sorted[1] && sorted[1] + 1 === sorted[2]) {
            if (sorted[0] >= 4) return ["Tài", 67];
            if (sorted[0] <= 2) return ["Xỉu", 62];
        }
        return [null, 0];
    }
    
    decreasing_sequence() {
        if (this.history.length < 1) return [null, 0];
        const dice = [this.history[this.history.length - 1].x1, this.history[this.history.length - 1].x2, this.history[this.history.length - 1].x3];
        if (dice[0] - 1 === dice[1] && dice[1] - 1 === dice[2]) {
            if (dice[0] >= 5) return ["Tài", 65];
            if (dice[0] <= 3) return ["Xỉu", 60];
        }
        return [null, 0];
    }
    
    has_1_and_6() {
        if (this.history.length < 1) return [null, 0];
        const dice = [this.history[this.history.length - 1].x1, this.history[this.history.length - 1].x2, this.history[this.history.length - 1].x3];
        if (dice.includes(1) && dice.includes(6)) return ["Tài", 62];
        return [null, 0];
    }
    
    // -------------------- NHÓM 3: THỐNG KÊ & XÁC SUẤT (5) --------------------
    
    frequency_5() {
        if (this.history.length < 5) return [null, 0];
        const recent = this.history.slice(-5).map(h => h.ket_qua);
        const taiCount = recent.reduce((a, b) => a + b, 0);
        if (taiCount >= 4) return ["Xỉu", 60];
        if (taiCount <= 1) return ["Tài", 60];
        return [null, 0];
    }
    
    frequency_20() {
        if (this.history.length < 20) return [null, 0];
        const recent = this.history.slice(-20).map(h => h.ket_qua);
        const taiCount = recent.reduce((a, b) => a + b, 0);
        if (taiCount >= 14) return ["Xỉu", 65];
        if (taiCount <= 6) return ["Tài", 65];
        return [null, 0];
    }
    
    bayesian() {
        if (this.history.length < 20) return [null, 0];
        const prior = this.history.slice(-20).reduce((a, b) => a + b.ket_qua, 0) / 20;
        const last = this.history[this.history.length - 1].ket_qua;
        let taiSauTai = 0, count = 0;
        for (let i = 1; i < this.history.length; i++) {
            if (this.history[i - 1].ket_qua === last) {
                count++;
                if (this.history[i].ket_qua === last) taiSauTai++;
            }
        }
        if (count > 0) {
            const likelihood = taiSauTai / count;
            const posterior = likelihood * prior;
            if (posterior > 0.6) return ["Tài", 62];
            if (posterior < 0.4) return ["Xỉu", 62];
        }
        return [null, 0];
    }
    
    cycle_detection() {
        if (this.history.length < 30) return [null, 0];
        const seq = this.history.slice(-30).map(h => h.ket_qua);
        for (let cycle = 3; cycle <= 10; cycle++) {
            if (seq.length >= cycle * 2) {
                let match = true;
                for (let i = 0; i < cycle; i++) {
                    if (seq[seq.length - cycle + i] !== seq[seq.length - 2 * cycle + i]) {
                        match = false;
                        break;
                    }
                }
                if (match) return [seq[seq.length - 1] === 1 ? "Tài" : "Xỉu", 70];
            }
        }
        return [null, 0];
    }
    
    mean_reversion() {
        if (this.history.length < 20) return [null, 0];
        const meanTotal = this.history.slice(-20).reduce((a, b) => a + b.tong, 0) / 20;
        const lastTotal = this.history[this.history.length - 1].tong;
        if (lastTotal > meanTotal + 2) return ["Xỉu", 65];
        if (lastTotal < meanTotal - 2) return ["Tài", 65];
        return [null, 0];
    }
    
    // -------------------- NHÓM 4: ĐẶC BIỆT (4) --------------------
    
    pattern_matching() {
        if (this.history.length < 50) return [null, 0];
        const last10 = this.history.slice(-10).map(h => h.ket_qua);
        let bestMatch = null, bestMatchCount = 0;
        for (let i = 0; i < this.history.length - 11; i++) {
            const window = [];
            for (let j = i; j < i + 10; j++) window.push(this.history[j].ket_qua);
            let match = true;
            for (let j = 0; j < 10; j++) {
                if (window[j] !== last10[j]) { match = false; break; }
            }
            if (match && i + 10 < this.history.length) {
                const nextResult = this.history[i + 10].ket_qua;
                if (bestMatch === null) {
                    bestMatch = nextResult;
                    bestMatchCount = 1;
                } else if (nextResult === bestMatch) {
                    bestMatchCount++;
                }
            }
        }
        if (bestMatchCount >= 2) return [bestMatch === 1 ? "Tài" : "Xỉu", 75];
        return [null, 0];
    }
    
    trend_line() {
        if (this.history.length < 10) return [null, 0];
        const totals = this.history.slice(-10).map(h => h.tong);
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
        for (let i = 0; i < 10; i++) {
            sumX += i;
            sumY += totals[i];
            sumXY += i * totals[i];
            sumX2 += i * i;
        }
        const slope = (10 * sumXY - sumX * sumY) / (10 * sumX2 - sumX * sumX);
        if (slope > 0.2) return ["Tài", 60];
        if (slope < -0.2) return ["Xỉu", 60];
        return [null, 0];
    }
    
    momentum() {
        if (this.history.length < 10) return [null, 0];
        const recent5 = this.history.slice(-5).map(h => h.ket_qua).reduce((a, b) => a + b, 0);
        const prev5 = this.history.slice(-10, -5).map(h => h.ket_qua).reduce((a, b) => a + b, 0);
        const momentumVal = recent5 - prev5;
        if (momentumVal > 2) return ["Xỉu", 60];
        if (momentumVal < -2) return ["Tài", 60];
        return [null, 0];
    }
    
    pattern_3_2_special() {
        if (this.history.length < 5) return [null, 0];
        const last5 = this.history.slice(-5).map(h => h.ket_qua);
        if (last5[0] === 1 && last5[1] === 1 && last5[2] === 1 && last5[3] === 0 && last5[4] === 0) return ["Xỉu", 73];
        if (last5[0] === 0 && last5[1] === 0 && last5[2] === 0 && last5[3] === 1 && last5[4] === 1) return ["Tài", 73];
        return [null, 0];
    }
}

// ==================== GOD PREDICTOR CHÍNH ====================

class GodPredictor {
    constructor(rawData) {
        this.rawData = rawData;
        this.fullData = this.addAllFeatures(rawData);
        this.algo = new GodPredictorAlgorithms(this.fullData);
        this.weights = this.initWeights();
    }

    addAllFeatures(data) {
        for (let i = 0; i < data.length; i++) {
            const d = data[i];
            const dice = [d.x1, d.x2, d.x3];
            const uniqueDice = [...new Set(dice)];
            
            d.co_doi = uniqueDice.length <= 2 ? 1 : 0;
            d.co_ba = uniqueDice.length === 1 ? 1 : 0;
            
            if (d.co_doi && !d.co_ba) {
                const counts = {};
                dice.forEach(v => counts[v] = (counts[v] || 0) + 1);
                let maxCount = 0, maxVal = 0;
                for (const [val, cnt] of Object.entries(counts)) {
                    if (cnt > maxCount) { maxCount = cnt; maxVal = parseInt(val); }
                }
                d.mat_trung = maxVal;
                d.so_lan_trung = maxCount;
            } else {
                d.mat_trung = 0;
                d.so_lan_trung = 0;
            }
            
            d.tong_chan = d.tong % 2 === 0 ? 1 : 0;
            d.khoang_tong = d.tong <= 7 ? 0 : (d.tong <= 13 ? 1 : 2);
            d.hieu_max_min = Math.max(...dice) - Math.min(...dice);
            d.tong_xuc_xac = dice[0] + dice[1] + dice[2];
            d.tich_xuc_xac = dice[0] * dice[1] * dice[2];
            
            if (i > 0) {
                d.chenh_tong = d.tong - data[i-1].tong;
                d.chenh_x1 = d.x1 - data[i-1].x1;
                d.chenh_x2 = d.x2 - data[i-1].x2;
                d.chenh_x3 = d.x3 - data[i-1].x3;
                d.ket_qua_giong_truoc = d.ket_qua === data[i-1].ket_qua ? 1 : 0;
            } else {
                d.chenh_tong = 0;
                d.chenh_x1 = d.chenh_x2 = d.chenh_x3 = 0;
                d.ket_qua_giong_truoc = 0;
            }
        }
        return data;
    }

    initWeights() {
        return {
            streak_basic: 1.0, streak_advanced: 1.2, alternating_1_1: 1.0,
            alternating_2_2: 1.0, alternating_3_3: 1.0, pattern_2_1_2: 1.0,
            pattern_3_2_1: 1.0, pattern_1_2_3: 1.0, zigzag_long: 1.1,
            pattern_2_nhip: 0.9, pattern_3_nhip: 1.0, frequency_10_hands: 1.0,
            triple_special: 1.5, double_face_6: 1.3, double_face_1: 1.3,
            double_face_5: 1.0, double_face_2: 1.0, increasing_sequence: 1.0,
            decreasing_sequence: 1.0, has_1_and_6: 1.0,
            frequency_5: 0.8, frequency_20: 1.0, bayesian: 1.0,
            cycle_detection: 1.1, mean_reversion: 1.0,
            pattern_matching: 1.4, trend_line: 1.0, momentum: 1.0,
            pattern_3_2_special: 1.2
        };
    }

    predict() {
        const algosList = [
            ["streak_basic", () => this.algo.streak_basic()],
            ["streak_advanced", () => this.algo.streak_advanced()],
            ["alternating_1_1", () => this.algo.alternating_1_1()],
            ["alternating_2_2", () => this.algo.alternating_2_2()],
            ["alternating_3_3", () => this.algo.alternating_3_3()],
            ["pattern_2_1_2", () => this.algo.pattern_2_1_2()],
            ["pattern_3_2_1", () => this.algo.pattern_3_2_1()],
            ["pattern_1_2_3", () => this.algo.pattern_1_2_3()],
            ["zigzag_long", () => this.algo.zigzag_long()],
            ["pattern_2_nhip", () => this.algo.pattern_2_nhip()],
            ["pattern_3_nhip", () => this.algo.pattern_3_nhip()],
            ["frequency_10_hands", () => this.algo.frequency_10_hands()],
            ["triple_special", () => this.algo.triple_special()],
            ["double_face_6", () => this.algo.double_face_6()],
            ["double_face_1", () => this.algo.double_face_1()],
            ["double_face_5", () => this.algo.double_face_5()],
            ["double_face_2", () => this.algo.double_face_2()],
            ["increasing_sequence", () => this.algo.increasing_sequence()],
            ["decreasing_sequence", () => this.algo.decreasing_sequence()],
            ["has_1_and_6", () => this.algo.has_1_and_6()],
            ["frequency_5", () => this.algo.frequency_5()],
            ["frequency_20", () => this.algo.frequency_20()],
            ["bayesian", () => this.algo.bayesian()],
            ["cycle_detection", () => this.algo.cycle_detection()],
            ["mean_reversion", () => this.algo.mean_reversion()],
            ["pattern_matching", () => this.algo.pattern_matching()],
            ["trend_line", () => this.algo.trend_line()],
            ["momentum", () => this.algo.momentum()],
            ["pattern_3_2_special", () => this.algo.pattern_3_2_special()]
        ];

        const scores = { "Tài": 0, "Xỉu": 0 };
        const details = [];
        let activeAlgorithms = 0;

        for (const [name, func] of algosList) {
            const [pred, conf] = func();
            if (pred) {
                const weight = this.weights[name] || 1.0;
                scores[pred] += conf * weight;
                details.push({ name, pred, conf, weight });
                activeAlgorithms++;
            }
        }

        // Điều chỉnh xu hướng
        if (this.fullData.length >= 10) {
            const last10Results = this.fullData.slice(-10).map(d => d.ket_qua);
            const taiRatio = last10Results.reduce((a, b) => a + b, 0) / 10;
            if (taiRatio >= 0.8) {
                scores["Xỉu"] += 50;
                details.push({ name: "ĐIỀU_CHỈNH", pred: "Xỉu", conf: 50, weight: 1, note: "8/10 Tài → ưu tiên Xỉu" });
            } else if (taiRatio <= 0.2) {
                scores["Tài"] += 50;
                details.push({ name: "ĐIỀU_CHỈNH", pred: "Tài", conf: 50, weight: 1, note: "8/10 Xỉu → ưu tiên Tài" });
            }
        }

        const finalPred = scores["Tài"] >= scores["Xỉu"] ? "Tài" : "Xỉu";
        const totalScore = scores["Tài"] + scores["Xỉu"];
        const confidence = totalScore > 0 ? (Math.max(scores["Tài"], scores["Xỉu"]) / totalScore * 100) : 50;

        return {
            prediction: finalPred,
            confidence: Math.round(Math.min(96, Math.max(55, confidence))),
            details: details.sort((a, b) => (b.conf * b.weight) - (a.conf * a.weight)),
            activeCount: activeAlgorithms,
            scores: { tai: scores["Tài"].toFixed(1), xiu: scores["Xỉu"].toFixed(1) }
        };
    }

    updateWithNewData(newData) {
        this.rawData = [...newData, ...this.rawData].slice(0, 500);
        this.fullData = this.addAllFeatures(this.rawData);
        this.algo = new GodPredictorAlgorithms(this.fullData);
    }
}

// ==================== LOAD/SAVE FUNCTIONS ====================

function loadAllData() {
    try {
        if (fs.existsSync(KETQUA_FILE)) {
            const data = fs.readFileSync(KETQUA_FILE, 'utf8');
            const parsed = JSON.parse(data);
            winLossHistory = parsed.winLossHistory || { hu: [], md5: [] };
            console.log(`✅ Đã tải lịch sử thắng thua: HU=${winLossHistory.hu.length}, MD5=${winLossHistory.md5.length}`);
        }
    } catch (error) { console.error('❌ Lỗi load thắng thua:', error.message); }
    
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            const data = fs.readFileSync(SESSIONS_FILE, 'utf8');
            sessionsStore = JSON.parse(data);
            console.log(`✅ Đã tải sessions: HU=${sessionsStore.hu.length}, MD5=${sessionsStore.md5.length}`);
            
            if (sessionsStore.hu.length >= 30) {
                isReady.hu = true;
                predictors.hu = new GodPredictor(sessionsStore.hu);
            }
            if (sessionsStore.md5.length >= 30) {
                isReady.md5 = true;
                predictors.md5 = new GodPredictor(sessionsStore.md5);
            }
        }
    } catch (error) { console.error('❌ Lỗi load sessions:', error.message); }
    
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = fs.readFileSync(HISTORY_FILE, 'utf8');
            const parsed = JSON.parse(data);
            predictionHistory = parsed.predictionHistory || { hu: [], md5: [] };
            lastProcessedPhien = parsed.lastProcessedPhien || { hu: null, md5: null };
            console.log(`✅ Đã tải lịch sử dự đoán: HU=${predictionHistory.hu.length}, MD5=${predictionHistory.md5.length}`);
        }
    } catch (error) { console.error('❌ Lỗi load dự đoán:', error.message); }
}

function saveAllData() {
    try {
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessionsStore, null, 2));
    } catch (error) { console.error('❌ Lỗi save sessions:', error.message); }
    
    try {
        fs.writeFileSync(KETQUA_FILE, JSON.stringify({ winLossHistory, lastUpdated: new Date().toISOString() }, null, 2));
    } catch (error) { console.error('❌ Lỗi save thắng thua:', error.message); }
    
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify({ predictionHistory, lastProcessedPhien, lastSaved: new Date().toISOString() }, null, 2));
    } catch (error) { console.error('❌ Lỗi save dự đoán:', error.message); }
}

// ==================== API DATA FETCHING ====================

function transformApiData(apiData) {
    if (!apiData || !apiData.list || !Array.isArray(apiData.list)) return null;
    return apiData.list.map(item => ({
        Phien: item.id,
        Ket_qua: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
        Xuc_xac_1: item.dices[0],
        Xuc_xac_2: item.dices[1],
        Xuc_xac_3: item.dices[2],
        Tong: item.point
    }));
}

async function fetchDataHu() {
    try {
        const response = await axios.get(API_URL_HU, { timeout: 15000, params: { limit: FETCH_PER_REQUEST } });
        return transformApiData(response.data);
    } catch (error) {
        console.error('❌ [HU] Fetch error:', error.message);
        return null;
    }
}

async function fetchDataMd5() {
    try {
        const response = await axios.get(API_URL_MD5, { timeout: 15000, params: { limit: FETCH_PER_REQUEST } });
        return transformApiData(response.data);
    } catch (error) {
        console.error('❌ [MD5] Fetch error:', error.message);
        return null;
    }
}

// ==================== UPDATE SESSIONS ====================

function updateSessions(type, newData) {
    if (!newData || newData.length === 0) return 0;
    
    const existingMap = new Map();
    sessionsStore[type].forEach(s => existingMap.set(s.Phien, s));
    
    let addedCount = 0;
    for (const s of newData) {
        if (!existingMap.has(s.Phien)) {
            sessionsStore[type].push(s);
            addedCount++;
        }
    }
    
    sessionsStore[type].sort((a, b) => b.Phien - a.Phien);
    if (sessionsStore[type].length > 1000) {
        sessionsStore[type] = sessionsStore[type].slice(0, 1000);
    }
    return addedCount;
}

async function fetchAndUpdate(type) {
    const fetchFn = type === 'hu' ? fetchDataHu : fetchDataMd5;
    const data = await fetchFn();
    if (!data) return false;
    
    const addedCount = updateSessions(type, data);
    if (addedCount > 0) saveAllData();
    
    if (!isReady[type] && sessionsStore[type].length >= 30) {
        isReady[type] = true;
        predictors[type] = new GodPredictor(sessionsStore[type]);
        console.log(`🎉 [${type.toUpperCase()}] ĐÃ SẴN SÀNG!`);
    } else if (isReady[type] && predictors[type] && addedCount > 0) {
        predictors[type].updateWithNewData(sessionsStore[type]);
    }
    return true;
}

// ==================== VERIFY & RECORD (1 PHIÊN 1 DỮ LIỆU) ====================

function verifyAndRecord(type) {
    if (!predictors[type]) return;
    
    const data = sessionsStore[type];
    let updated = false;
    
    for (let i = 0; i < predictionHistory[type].length; i++) {
        const record = predictionHistory[type][i];
        if (record.da_kiem_tra) continue;
        
        const actualResult = data.find(d => d.Phien.toString() === record.phien_du_doan);
        if (actualResult) {
            const isCorrect = record.du_doan === actualResult.Ket_qua;
            record.ket_qua_du_doan = isCorrect ? 'Đúng ✅' : 'Sai ❌';
            record.ket_qua_thuc_te = actualResult.Ket_qua;
            record.da_kiem_tra = true;
            
            const existingIndex = winLossHistory[type].findIndex(w => w.phien_du_doan === record.phien_du_doan);
            const winLossRecord = {
                phien_hien_tai: record.phien_hien_tai,
                phien_du_doan: record.phien_du_doan,
                du_doan: record.du_doan,
                ket_qua_thuc_te: actualResult.Ket_qua,
                ket_qua: isCorrect ? 'Đúng' : 'Sai',
                do_tin_cay: record.do_tin_cay,
                thoi_gian: new Date().toISOString()
            };
            
            if (existingIndex !== -1) {
                winLossHistory[type][existingIndex] = winLossRecord;
            } else {
                winLossHistory[type].push(winLossRecord);
            }
            updated = true;
        }
    }
    
    if (winLossHistory[type].length > MAX_HISTORY) {
        winLossHistory[type] = winLossHistory[type].slice(-MAX_HISTORY);
    }
    if (predictionHistory[type].length > MAX_HISTORY) {
        predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
    }
    
    if (updated) {
        saveAllData();
        const stats = calculateStats(type);
        console.log(`📊 [${type.toUpperCase()}] Đúng=${stats.dung}, Sai=${stats.sai}, Tỉ lệ=${stats.tiLe}%`);
    }
}

function calculateStats(type) {
    let dung = 0, sai = 0;
    for (const record of winLossHistory[type]) {
        if (record.ket_qua === 'Đúng') dung++;
        else if (record.ket_qua === 'Sai') sai++;
    }
    const total = dung + sai;
    const tiLe = total > 0 ? (dung / total * 100).toFixed(2) : 0;
    return { dung, sai, tiLe, total };
}

function savePredictionToHistory(type, phienDuDoan, phienHienTai, prediction, confidence, latestData, signals = []) {
    const record = {
        phien_hien_tai: phienHienTai.toString(),
        phien_du_doan: phienDuDoan.toString(),
        du_doan: prediction,
        do_tin_cay: `${confidence}%`,
        ket_qua_du_doan: '',
        ket_qua_thuc_te: '',
        da_kiem_tra: false,
        xuc_xac: [latestData.Xuc_xac_1, latestData.Xuc_xac_2, latestData.Xuc_xac_3],
        tong: latestData.Tong,
        ket_qua_hien_tai: latestData.Ket_qua,
        signals: signals.slice(0, 5).map(s => s.name),
        id: 'love trang',
        timestamp: new Date().toISOString()
    };
    
    predictionHistory[type].unshift(record);
    if (predictionHistory[type].length > MAX_HISTORY) {
        predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
    }
    return record;
}

// ==================== AUTO PROCESS ====================

async function fetchLoop() {
    console.log('═══════════════════════════════════════════════════');
    console.log('🔄 BẮT ĐẦU FETCH DỮ LIỆU...');
    console.log('═══════════════════════════════════════════════════');
    
    while (true) {
        await Promise.all([fetchAndUpdate('hu'), fetchAndUpdate('md5')]);
        await new Promise(resolve => setTimeout(resolve, FETCH_INTERVAL));
    }
}

async function autoProcess() {
    if (!isReady.hu && !isReady.md5) return;
    
    try {
        if (isReady.hu && predictors.hu) {
            await fetchAndUpdate('hu');
            verifyAndRecord('hu');
            
            const latestSessions = sessionsStore.hu;
            if (latestSessions.length > 0 && predictors.hu) {
                const latestPhien = latestSessions[0].Phien;
                const nextPhien = latestPhien + 1;
                
                if (lastProcessedPhien.hu !== nextPhien) {
                    const result = predictors.hu.predict();
                    savePredictionToHistory('hu', nextPhien, latestPhien, result.prediction, result.confidence, latestSessions[0], result.details);
                    lastProcessedPhien.hu = nextPhien;
                    const stats = calculateStats('hu');
                    console.log(`[DỰ ĐOÁN] 👑 HU Phien ${nextPhien}: ${result.prediction} (${result.confidence}%) - ${result.activeCount} thuật toán - 📊 TL: ${stats.tiLe}% (${stats.dung}/${stats.total})`);
                    saveAllData();
                }
            }
        }
        
        if (isReady.md5 && predictors.md5) {
            await fetchAndUpdate('md5');
            verifyAndRecord('md5');
            
            const latestSessions = sessionsStore.md5;
            if (latestSessions.length > 0 && predictors.md5) {
                const latestPhien = latestSessions[0].Phien;
                const nextPhien = latestPhien + 1;
                
                if (lastProcessedPhien.md5 !== nextPhien) {
                    const result = predictors.md5.predict();
                    savePredictionToHistory('md5', nextPhien, latestPhien, result.prediction, result.confidence, latestSessions[0], result.details);
                    lastProcessedPhien.md5 = nextPhien;
                    const stats = calculateStats('md5');
                    console.log(`[DỰ ĐOÁN] 👑 MD5 Phien ${nextPhien}: ${result.prediction} (${result.confidence}%) - ${result.activeCount} thuật toán - 📊 TL: ${stats.tiLe}% (${stats.dung}/${stats.total})`);
                    saveAllData();
                }
            }
        }
    } catch (error) {
        console.error('[Auto] ❌ Error:', error.message);
    }
}

// ==================== STARTUP ====================

async function startup() {
    loadAllData();
    
    console.log('');
    console.log('═══════════════════════════════════════════════════');
    console.log('👑 THE GOD PREDICTOR - HỆ THỐNG DỰ ĐOÁN TÀI XỈU');
    console.log(`📋 Lưu tối đa ${MAX_HISTORY} phiên - 1 phiên 1 dữ liệu`);
    console.log('═══════════════════════════════════════════════════');
    
    fetchLoop();
    setTimeout(() => {
        setInterval(autoProcess, AUTO_SAVE_INTERVAL);
    }, 5000);
}

// ==================== ENDPOINTS ====================

app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send('t.me/CuTools');
});

app.get('/status', (req, res) => {
    const huStats = calculateStats('hu');
    const md5Stats = calculateStats('md5');
    res.json({
        hu: { sessions: sessionsStore.hu.length, ready: isReady.hu, ...huStats },
        md5: { sessions: sessionsStore.md5.length, ready: isReady.md5, ...md5Stats }
    });
});

app.get('/lc79-hu', async (req, res) => {
    try {
        if (!isReady.hu || !predictors.hu) {
            return res.json({ status: 'loading', message: `Đang tải: ${sessionsStore.hu.length}/30` });
        }
        
        await fetchAndUpdate('hu');
        verifyAndRecord('hu');
        
        const latestSessions = sessionsStore.hu;
        if (latestSessions.length === 0) return res.json({ error: 'No data' });
        
        const latestPhien = latestSessions[0].Phien;
        const nextPhien = latestPhien + 1;
        const result = predictors.hu.predict();
        const stats = calculateStats('hu');
        
        const record = savePredictionToHistory('hu', nextPhien, latestPhien, result.prediction, result.confidence, latestSessions[0], result.details);
        
        res.json({
            phien_hien_tai: record.phien_hien_tai,
            phien_du_doan: record.phien_du_doan,
            du_doan: record.du_doan,
            do_tin_cay: record.do_tin_cay,
            ket_qua_hien_tai: record.ket_qua_hien_tai,
            xuc_xac: record.xuc_xac,
            tong: record.tong,
            signals: result.details.slice(0, 10).map(s => ({ name: s.name, pred: s.pred, conf: s.conf, weight: s.weight })),
            active_algorithms: result.activeCount,
            scores: result.scores,
            thong_ke: { tong_du_doan: stats.total, so_dung: stats.dung, so_sai: stats.sai, ti_le_thang: `${stats.tiLe}%` },
            id: 'love trang'
        });
    } catch (error) {
        res.status(500).json({ error: 'Lỗi server' });
    }
});

app.get('/lc79-md5', async (req, res) => {
    try {
        if (!isReady.md5 || !predictors.md5) {
            return res.json({ status: 'loading', message: `Đang tải: ${sessionsStore.md5.length}/30` });
        }
        
        await fetchAndUpdate('md5');
        verifyAndRecord('md5');
        
        const latestSessions = sessionsStore.md5;
        if (latestSessions.length === 0) return res.json({ error: 'No data' });
        
        const latestPhien = latestSessions[0].Phien;
        const nextPhien = latestPhien + 1;
        const result = predictors.md5.predict();
        const stats = calculateStats('md5');
        
        const record = savePredictionToHistory('md5', nextPhien, latestPhien, result.prediction, result.confidence, latestSessions[0], result.details);
        
        res.json({
            phien_hien_tai: record.phien_hien_tai,
            phien_du_doan: record.phien_du_doan,
            du_doan: record.du_doan,
            do_tin_cay: record.do_tin_cay,
            ket_qua_hien_tai: record.ket_qua_hien_tai,
            xuc_xac: record.xuc_xac,
            tong: record.tong,
            signals: result.details.slice(0, 10).map(s => ({ name: s.name, pred: s.pred, conf: s.conf, weight: s.weight })),
            active_algorithms: result.activeCount,
            scores: result.scores,
            thong_ke: { tong_du_doan: stats.total, so_dung: stats.dung, so_sai: stats.sai, ti_le_thang: `${stats.tiLe}%` },
            id: 'love trang'
        });
    } catch (error) {
        res.status(500).json({ error: 'Lỗi server' });
    }
});

app.get('/lc79-hu/lichsu', (req, res) => {
    res.json({
        type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
        lich_su_du_doan: predictionHistory.hu,
        lich_su_thang_thua: winLossHistory.hu,
        tong_so: predictionHistory.hu.length,
        thong_ke: calculateStats('hu')
    });
});

app.get('/lc79-md5/lichsu', (req, res) => {
    res.json({
        type: 'Lẩu Cua 79 - Tài Xỉu MD5',
        lich_su_du_doan: predictionHistory.md5,
        lich_su_thang_thua: winLossHistory.md5,
        tong_so: predictionHistory.md5.length,
        thong_ke: calculateStats('md5')
    });
});

app.get('/lc79-hu/thongke', (req, res) => {
    res.json({ type: 'HU', ...calculateStats('hu'), lich_su_gan_day: winLossHistory.hu.slice(-20) });
});

app.get('/lc79-md5/thongke', (req, res) => {
    res.json({ type: 'MD5', ...calculateStats('md5'), lich_su_gan_day: winLossHistory.md5.slice(-20) });
});

app.get('/lc79-hu/analysis', (req, res) => {
    if (!isReady.hu || !predictors.hu) return res.json({ status: 'loading' });
    const result = predictors.hu.predict();
    res.json({
        prediction: result.prediction,
        confidence: result.confidence,
        signals: result.details.slice(0, 15).map(s => ({ name: s.name, pred: s.pred, conf: s.conf, weight: s.weight })),
        active_algorithms: result.activeCount,
        scores: result.scores
    });
});

app.get('/lc79-md5/analysis', (req, res) => {
    if (!isReady.md5 || !predictors.md5) return res.json({ status: 'loading' });
    const result = predictors.md5.predict();
    res.json({
        prediction: result.prediction,
        confidence: result.confidence,
        signals: result.details.slice(0, 15).map(s => ({ name: s.name, pred: s.pred, conf: s.conf, weight: s.weight })),
        active_algorithms: result.activeCount,
        scores: result.scores
    });
});

// ==================== START SERVER ====================

app.listen(PORT, '0.0.0.0', () => {
    console.log('═══════════════════════════════════════════════════');
    console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
    console.log('👑 THE GOD PREDICTOR - HỆ THỐNG DỰ ĐOÁN TÀI XỈU');
    console.log('═══════════════════════════════════════════════════');
    console.log('');
    console.log('📊 CÁC NHÓM THUẬT TOÁN:');
    console.log('   • Nhóm 1: Cầu kết quả (12 thuật toán)');
    console.log('   • Nhóm 2: Cầu xúc xắc (8 thuật toán)');
    console.log('   • Nhóm 3: Thống kê & xác suất (5 thuật toán)');
    console.log('   • Nhóm 4: Đặc biệt (4 thuật toán)');
    console.log('');
    console.log('📊 TÍNH NĂNG:');
    console.log(`   • 1 phiên 1 dữ liệu - không bị nhảy`);
    console.log(`   • Lưu tối đa ${MAX_HISTORY} phiên`);
    console.log('   • Tự động đối chiếu kết quả');
    console.log('   • Thống kê tỉ lệ thắng');
    console.log('');
    console.log('👤 ID: love trang');
    console.log('═══════════════════════════════════════════════════');
    
    startup();
});
