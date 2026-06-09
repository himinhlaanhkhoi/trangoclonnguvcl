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
let wins = 0;
let losses = 0;
let predictorInstance = null;

const normalize = item => {
    const kq = (item.resultTruyenThong || '').toLowerCase().trim();
    return {
        ket_qua: kq === 'tai' || kq === 'tài' ? 'Tài' : 'Xỉu',
        tong: item.point || 0,
        xuc_xac_1: (item.dices && item.dices[0]) || 0,
        xuc_xac_2: (item.dices && item.dices[1]) || 0,
        xuc_xac_3: (item.dices && item.dices[2]) || 0,
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
    if (predictorInstance && predictorInstance.capNhatKetQua) {
        predictorInstance.capNhatKetQua(ketQua);
    }
    return isCorrect;
}

class ThichNghiSieuChinhXac {
    constructor(data) {
        this.raw = data;
        this.processed = this.preprocess(data);
        this.probabilities = this.tinhXacSuatThucTe();
        this.allCau = this.phatHienTatCaCau();
        
        this.stats = {
            trades: [],
            wins: 0,
            losses: 0,
            consecutiveLosses: 0,
            consecutiveWins: 0,
            last10Accuracy: 1.0,
            adaptiveThreshold: 68
        };
        
        this.cauPerformance = {};
        this.learningBuffer = [];
        this.totalPredictions = 0;
        this.correctPredictions = 0;
        this.currentPrimaryPattern = null;
        
        for (let key in this.allCau) {
            this.cauPerformance[key] = { wins: 0, losses: 0, confidence: 75, lastUsed: 0, successRate: 0.75, totalUsed: 0 };
        }
    }

    preprocess(data) {
        return data.map((item, idx, arr) => {
            const dice = [item.xuc_xac_1, item.xuc_xac_2, item.xuc_xac_3];
            let streak = 1;
            if (idx > 0 && arr[idx - 1].ket_qua === item.ket_qua) {
                streak = arr[idx - 1].streak + 1;
            }
            
            let taiStreak = 0, xiuStreak = 0;
            if (item.ket_qua === "Tài") {
                taiStreak = idx > 0 && arr[idx - 1].ket_qua === "Tài" ? arr[idx - 1].taiStreak + 1 : 1;
                xiuStreak = 0;
            } else {
                xiuStreak = idx > 0 && arr[idx - 1].ket_qua === "Xỉu" ? arr[idx - 1].xiuStreak + 1 : 1;
                taiStreak = 0;
            }
            
            let face1Streak = 0, face2Streak = 0, face3Streak = 0, face4Streak = 0, face5Streak = 0, face6Streak = 0;
            for (let j = idx; j >= 0; j--) {
                const d = arr[j];
                if (d.xuc_xac_1 === 1 || d.xuc_xac_2 === 1 || d.xuc_xac_3 === 1) face1Streak++;
                else break;
            }
            for (let j = idx; j >= 0; j--) {
                const d = arr[j];
                if (d.xuc_xac_1 === 6 || d.xuc_xac_2 === 6 || d.xuc_xac_3 === 6) face6Streak++;
                else break;
            }
            
            let totalHistory = [];
            for (let j = Math.max(0, idx - 20); j <= idx; j++) {
                totalHistory.push(arr[j].tong);
            }
            
            return {
                phien: item.phien,
                result: item.ket_qua === "Tài" ? 1 : 0,
                resultStr: item.ket_qua,
                total: item.tong,
                streak: streak,
                taiStreak: taiStreak,
                xiuStreak: xiuStreak,
                face1Streak: face1Streak,
                face2Streak: face2Streak,
                face3Streak: face3Streak,
                face4Streak: face4Streak,
                face5Streak: face5Streak,
                face6Streak: face6Streak,
                isTriple: dice[0] === dice[1] && dice[1] === dice[2],
                tripleVal: dice[0],
                sum: dice[0] + dice[1] + dice[2],
                totalHistory: totalHistory
            };
        });
    }

    phatHienTatCaCau() {
        return {
            bet_3: this.cauBet3.bind(this),
            bet_4: this.cauBet4.bind(this),
            bet_5: this.cauBet5.bind(this),
            bet_6: this.cauBet6.bind(this),
            bet_7: this.cauBet7.bind(this),
            bet_8: this.cauBet8.bind(this),
            bet_9: this.cauBet9.bind(this),
            bet_10: this.cauBet10.bind(this),
            be_bet_tai: this.beBetTai.bind(this),
            be_bet_xiu: this.beBetXiu.bind(this),
            bat_bet_tai_som: this.batBetTaiSom.bind(this),
            bat_bet_xiu_som: this.batBetXiuSom.bind(this),
            cau_1_1: this.cau1_1.bind(this),
            cau_2_2: this.cau2_2.bind(this),
            cau_2_2_2: this.cau2_2_2.bind(this),
            cau_2_2_2_2: this.cau2_2_2_2.bind(this),
            cau_3_1: this.cau3_1.bind(this),
            cau_1_3: this.cau1_3.bind(this),
            cau_3_2: this.cau3_2.bind(this),
            cau_2_3: this.cau2_3.bind(this),
            cau_3_3: this.cau3_3.bind(this),
            cau_4_1: this.cau4_1.bind(this),
            cau_1_4: this.cau1_4.bind(this),
            cau_4_2: this.cau4_2.bind(this),
            cau_2_4: this.cau2_4.bind(this),
            cau_4_3: this.cau4_3.bind(this),
            cau_3_4: this.cau3_4.bind(this),
            cau_4_4: this.cau4_4.bind(this),
            cau_5_1: this.cau5_1.bind(this),
            cau_1_5: this.cau1_5.bind(this),
            cau_5_2: this.cau5_2.bind(this),
            cau_2_5: this.cau2_5.bind(this),
            cau_5_3: this.cau5_3.bind(this),
            cau_3_5: this.cau3_5.bind(this),
            cau_5_4: this.cau5_4.bind(this),
            cau_4_5: this.cau4_5.bind(this),
            cau_5_5: this.cau5_5.bind(this),
            cau_6_1: this.cau6_1.bind(this),
            cau_1_6: this.cau1_6.bind(this),
            cau_6_2: this.cau6_2.bind(this),
            cau_2_6: this.cau2_6.bind(this),
            cau_6_3: this.cau6_3.bind(this),
            cau_3_6: this.cau3_6.bind(this),
            cau_6_4: this.cau6_4.bind(this),
            cau_4_6: this.cau4_6.bind(this),
            cau_6_5: this.cau6_5.bind(this),
            cau_5_6: this.cau5_6.bind(this),
            cau_6_6: this.cau6_6.bind(this),
            cau_fibonacci: this.cauFibonacci.bind(this),
            cau_doi_xung: this.cauDoiXung.bind(this),
            cau_doi_xung_2: this.cauDoiXung2.bind(this),
            cau_doi_xung_3: this.cauDoiXung3.bind(this),
            cau_tien_trien: this.cauTienTrien.bind(this),
            cau_lui: this.cauLui.bind(this),
            cau_nhac_lai_3: this.cauNhacLai3.bind(this),
            cau_nhac_lai_4: this.cauNhacLai4.bind(this),
            cau_nhac_lai_5: this.cauNhacLai5.bind(this),
            cau_da_chieu: this.cauDaChieu.bind(this),
            cau_xoay_vong: this.cauXoayVong.bind(this),
            cau_thang_tien: this.cauThangTien.bind(this),
            cau_thang_lui: this.cauThangLui.bind(this),
            cau_tam_giac: this.cauTamGiac.bind(this),
            cau_hinh_thang: this.cauHinhThang.bind(this),
            cau_duong_cheo: this.cauDuongCheo.bind(this),
            tong_diem_thap: this.tongDiemThap.bind(this),
            tong_diem_cao: this.tongDiemCao.bind(this),
            tong_diem_dac_biet: this.tongDiemDacBiet.bind(this),
            mat_1_vang: this.mat1Vang.bind(this),
            mat_6_vang: this.mat6Vang.bind(this),
            bao_ba: this.baoBa.bind(this),
            cau_lich_su: this.cauLichSu.bind(this),
            cau_thong_ke_streak: this.cauThongKeStreak.bind(this),
            cau_thong_ke_tong: this.cauThongKeTong.bind(this),
            cau_markov: this.cauMarkov.bind(this),
            cau_xac_suat: this.cauXacSuat.bind(this)
        };
    }

    beBetTai() {
        const last10 = this.processed.slice(-10);
        let taiCount = 0;
        for (let i = 0; i < last10.length; i++) {
            if (last10[i].result === 1) taiCount++;
        }
        
        if (taiCount >= 8) {
            let cangThang = 0;
            for (let i = last10.length - 3; i < last10.length; i++) {
                if (last10[i].result === 1) cangThang++;
            }
            
            if (cangThang >= 2) {
                return { type: "be_bet_tai", prediction: "Xỉu", confidence: 82 + (taiCount - 8) * 2, description: `Bẻ bệt Tài sau ${taiCount}/10 Tài` };
            }
        }
        
        const last8 = this.processed.slice(-8);
        let taiCount8 = 0;
        for (let i = 0; i < last8.length; i++) {
            if (last8[i].result === 1) taiCount8++;
        }
        if (taiCount8 >= 7) {
            return { type: "be_bet_tai", prediction: "Xỉu", confidence: 85, description: `Bẻ bệt Tài sau ${taiCount8}/8 Tài` };
        }
        
        return null;
    }

    beBetXiu() {
        const last10 = this.processed.slice(-10);
        let xiuCount = 0;
        for (let i = 0; i < last10.length; i++) {
            if (last10[i].result === 0) xiuCount++;
        }
        
        if (xiuCount >= 8) {
            let cangThang = 0;
            for (let i = last10.length - 3; i < last10.length; i++) {
                if (last10[i].result === 0) cangThang++;
            }
            
            if (cangThang >= 2) {
                return { type: "be_bet_xiu", prediction: "Tài", confidence: 82 + (xiuCount - 8) * 2, description: `Bẻ bệt Xỉu sau ${xiuCount}/10 Xỉu` };
            }
        }
        
        const last8 = this.processed.slice(-8);
        let xiuCount8 = 0;
        for (let i = 0; i < last8.length; i++) {
            if (last8[i].result === 0) xiuCount8++;
        }
        if (xiuCount8 >= 7) {
            return { type: "be_bet_xiu", prediction: "Tài", confidence: 85, description: `Bẻ bệt Xỉu sau ${xiuCount8}/8 Xỉu` };
        }
        
        return null;
    }

    batBetTaiSom() {
        const last5 = this.processed.slice(-5);
        let taiCount = 0;
        for (let i = 0; i < last5.length; i++) {
            if (last5[i].result === 1) taiCount++;
        }
        
        if (taiCount === 5) {
            return { type: "bat_bet_tai_som", prediction: "Tài", confidence: 88, description: "Bắt bệt Tài sớm - đã 5 Tài" };
        }
        
        if (taiCount === 4 && last5[4].result === 1) {
            return { type: "bat_bet_tai_som", prediction: "Tài", confidence: 84, description: "Bắt bệt Tài - 4/5 Tài" };
        }
        
        return null;
    }

    batBetXiuSom() {
        const last5 = this.processed.slice(-5);
        let xiuCount = 0;
        for (let i = 0; i < last5.length; i++) {
            if (last5[i].result === 0) xiuCount++;
        }
        
        if (xiuCount === 5) {
            return { type: "bat_bet_xiu_som", prediction: "Xỉu", confidence: 88, description: "Bắt bệt Xỉu sớm - đã 5 Xỉu" };
        }
        
        if (xiuCount === 4 && last5[4].result === 0) {
            return { type: "bat_bet_xiu_som", prediction: "Xỉu", confidence: 84, description: "Bắt bệt Xỉu - 4/5 Xỉu" };
        }
        
        return null;
    }

    cauBet3() {
        const last3 = this.processed.slice(-3).map(p => p.result);
        if (last3.every(r => r === 1)) {
            return { type: "bet_3_tai", prediction: "Tài", confidence: 84, description: "Bệt Tài 3" };
        }
        if (last3.every(r => r === 0)) {
            return { type: "bet_3_xiu", prediction: "Xỉu", confidence: 84, description: "Bệt Xỉu 3" };
        }
        return null;
    }

    cauBet4() {
        const last4 = this.processed.slice(-4).map(p => p.result);
        if (last4.every(r => r === 1)) {
            return { type: "bet_4_tai", prediction: "Tài", confidence: 87, description: "Bệt Tài 4" };
        }
        if (last4.every(r => r === 0)) {
            return { type: "bet_4_xiu", prediction: "Xỉu", confidence: 87, description: "Bệt Xỉu 4" };
        }
        return null;
    }

    cauBet5() {
        const last5 = this.processed.slice(-5).map(p => p.result);
        if (last5.every(r => r === 1)) {
            return { type: "bet_5_tai", prediction: "Tài", confidence: 90, description: "Bệt Tài 5" };
        }
        if (last5.every(r => r === 0)) {
            return { type: "bet_5_xiu", prediction: "Xỉu", confidence: 90, description: "Bệt Xỉu 5" };
        }
        return null;
    }

    cauBet6() {
        const last6 = this.processed.slice(-6).map(p => p.result);
        if (last6.every(r => r === 1)) {
            return { type: "bet_6_tai", prediction: "Tài", confidence: 93, description: "Bệt Tài 6" };
        }
        if (last6.every(r => r === 0)) {
            return { type: "bet_6_xiu", prediction: "Xỉu", confidence: 93, description: "Bệt Xỉu 6" };
        }
        return null;
    }

    cauBet7() {
        const last7 = this.processed.slice(-7).map(p => p.result);
        if (last7.every(r => r === 1)) {
            return { type: "bet_7_tai", prediction: "Tài", confidence: 95, description: "Bệt Tài 7" };
        }
        if (last7.every(r => r === 0)) {
            return { type: "bet_7_xiu", prediction: "Xỉu", confidence: 95, description: "Bệt Xỉu 7" };
        }
        return null;
    }

    cauBet8() {
        const last8 = this.processed.slice(-8).map(p => p.result);
        if (last8.every(r => r === 1)) {
            return { type: "bet_8_tai", prediction: "Tài", confidence: 96, description: "Bệt Tài 8" };
        }
        if (last8.every(r => r === 0)) {
            return { type: "bet_8_xiu", prediction: "Xỉu", confidence: 96, description: "Bệt Xỉu 8" };
        }
        return null;
    }

    cauBet9() {
        const last9 = this.processed.slice(-9).map(p => p.result);
        if (last9.every(r => r === 1)) {
            return { type: "bet_9_tai", prediction: "Tài", confidence: 97, description: "Bệt Tài 9" };
        }
        if (last9.every(r => r === 0)) {
            return { type: "bet_9_xiu", prediction: "Xỉu", confidence: 97, description: "Bệt Xỉu 9" };
        }
        return null;
    }

    cauBet10() {
        const last10 = this.processed.slice(-10).map(p => p.result);
        if (last10.every(r => r === 1)) {
            return { type: "bet_10_tai", prediction: "Tài", confidence: 98, description: "Bệt Tài 10 - siêu bệt" };
        }
        if (last10.every(r => r === 0)) {
            return { type: "bet_10_xiu", prediction: "Xỉu", confidence: 98, description: "Bệt Xỉu 10 - siêu bệt" };
        }
        return null;
    }

    cau1_1() {
        const last10 = this.processed.slice(-10).map(p => p.result);
        let isAlternating = true;
        for (let i = 1; i < last10.length; i++) {
            if (last10[i] === last10[i - 1]) {
                isAlternating = false;
                break;
            }
        }
        if (isAlternating && last10.length >= 6) {
            const lastResult = last10[last10.length - 1];
            const nextPrediction = lastResult === 1 ? "Xỉu" : "Tài";
            let confidence = 87;
            if (last10.length >= 8) confidence = 89;
            if (last10.length >= 10) confidence = 91;
            return { type: "cau_1_1", prediction: nextPrediction, confidence: confidence, description: "Cầu 1-1 xen kẽ" };
        }
        return null;
    }

    cau2_2() {
        const last6 = this.processed.slice(-6).map(p => p.result);
        if (last6[0] === last6[1] && last6[2] === last6[3] && last6[4] === last6[5] && 
            last6[0] !== last6[2] && last6[2] !== last6[4]) {
            const nextPred = last6[5] === 1 ? "Xỉu" : "Tài";
            return { type: "cau_2_2_2", prediction: nextPred, confidence: 90, description: "Cầu 2-2-2" };
        }
        
        const last4 = this.processed.slice(-4).map(p => p.result);
        if (last4[0] === last4[1] && last4[2] === last4[3] && last4[0] !== last4[2]) {
            const nextPred = last4[3] === 1 ? "Xỉu" : "Tài";
            return { type: "cau_2_2", prediction: nextPred, confidence: 85, description: "Cầu 2-2 cơ bản" };
        }
        return null;
    }

    cau2_2_2() {
        const last8 = this.processed.slice(-8).map(p => p.result);
        if (last8[0] === last8[1] && last8[2] === last8[3] && last8[4] === last8[5] && last8[6] === last8[7] &&
            last8[0] !== last8[2] && last8[2] !== last8[4] && last8[4] !== last8[6]) {
            const nextPred = last8[7] === 1 ? "Xỉu" : "Tài";
            return { type: "cau_2_2_2_2", prediction: nextPred, confidence: 93, description: "Cầu 2-2-2-2" };
        }
        return null;
    }

    cau2_2_2_2() {
        const last10 = this.processed.slice(-10).map(p => p.result);
        if (last10[0] === last10[1] && last10[2] === last10[3] && last10[4] === last10[5] && 
            last10[6] === last10[7] && last10[8] === last10[9] &&
            last10[0] !== last10[2] && last10[2] !== last10[4] && last10[4] !== last10[6] && last10[6] !== last10[8]) {
            const nextPred = last10[9] === 1 ? "Xỉu" : "Tài";
            return { type: "cau_2_2_2_2_2", prediction: nextPred, confidence: 95, description: "Cầu 2-2-2-2-2" };
        }
        return null;
    }

    cau3_1() {
        const last4 = this.processed.slice(-4).map(p => p.result);
        if (last4[0] === 1 && last4[1] === 1 && last4[2] === 1 && last4[3] === 0) {
            return { type: "cau_3_1_tai", prediction: "Xỉu", confidence: 86, description: "Cầu 3 Tài 1 Xỉu" };
        }
        if (last4[0] === 0 && last4[1] === 0 && last4[2] === 0 && last4[3] === 1) {
            return { type: "cau_3_1_xiu", prediction: "Tài", confidence: 86, description: "Cầu 3 Xỉu 1 Tài" };
        }
        return null;
    }

    cau1_3() {
        const last4 = this.processed.slice(-4).map(p => p.result);
        if (last4[0] === 1 && last4[1] === 0 && last4[2] === 0 && last4[3] === 0) {
            return { type: "cau_1_3", prediction: "Xỉu", confidence: 85, description: "Cầu 1 Tài 3 Xỉu" };
        }
        if (last4[0] === 0 && last4[1] === 1 && last4[2] === 1 && last4[3] === 1) {
            return { type: "cau_1_3", prediction: "Tài", confidence: 85, description: "Cầu 1 Xỉu 3 Tài" };
        }
        return null;
    }

    cau3_2() {
        const last7 = this.processed.slice(-7).map(p => p.result);
        if (last7.length >= 7) {
            if (last7[0] === 1 && last7[1] === 1 && last7[2] === 1 && last7[3] === 0 && last7[4] === 0 && last7[5] === 1 && last7[6] === 1) {
                return { type: "cau_3_2", prediction: "Xỉu", confidence: 87, description: "Cầu 3-2-2" };
            }
            if (last7[0] === 0 && last7[1] === 0 && last7[2] === 0 && last7[3] === 1 && last7[4] === 1 && last7[5] === 0 && last7[6] === 0) {
                return { type: "cau_3_2", prediction: "Tài", confidence: 87, description: "Cầu 3-2-2" };
            }
        }
        return null;
    }

    cau2_3() {
        const last7 = this.processed.slice(-7).map(p => p.result);
        if (last7.length >= 7) {
            if (last7[0] === 1 && last7[1] === 1 && last7[2] === 0 && last7[3] === 0 && last7[4] === 0 && last7[5] === 1 && last7[6] === 1) {
                return { type: "cau_2_3", prediction: "Xỉu", confidence: 86, description: "Cầu 2-3-2" };
            }
            if (last7[0] === 0 && last7[1] === 0 && last7[2] === 1 && last7[3] === 1 && last7[4] === 1 && last7[5] === 0 && last7[6] === 0) {
                return { type: "cau_2_3", prediction: "Tài", confidence: 86, description: "Cầu 2-3-2" };
            }
        }
        return null;
    }

    cau3_3() {
        const last9 = this.processed.slice(-9).map(p => p.result);
        if (last9.length >= 9) {
            if (last9[0] === 1 && last9[1] === 1 && last9[2] === 1 && last9[3] === 0 && last9[4] === 0 && last9[5] === 0 && last9[6] === 1 && last9[7] === 1 && last9[8] === 1) {
                return { type: "cau_3_3", prediction: "Xỉu", confidence: 90, description: "Cầu 3-3-3" };
            }
            if (last9[0] === 0 && last9[1] === 0 && last9[2] === 0 && last9[3] === 1 && last9[4] === 1 && last9[5] === 1 && last9[6] === 0 && last9[7] === 0 && last9[8] === 0) {
                return { type: "cau_3_3", prediction: "Tài", confidence: 90, description: "Cầu 3-3-3" };
            }
        }
        return null;
    }

    cau4_1() {
        const last5 = this.processed.slice(-5).map(p => p.result);
        if (last5[0] === 1 && last5[1] === 1 && last5[2] === 1 && last5[3] === 1 && last5[4] === 0) {
            return { type: "cau_4_1", prediction: "Xỉu", confidence: 88, description: "Cầu 4 Tài 1 Xỉu" };
        }
        if (last5[0] === 0 && last5[1] === 0 && last5[2] === 0 && last5[3] === 0 && last5[4] === 1) {
            return { type: "cau_4_1", prediction: "Tài", confidence: 88, description: "Cầu 4 Xỉu 1 Tài" };
        }
        return null;
    }

    cau1_4() {
        const last5 = this.processed.slice(-5).map(p => p.result);
        if (last5[0] === 1 && last5[1] === 0 && last5[2] === 0 && last5[3] === 0 && last5[4] === 0) {
            return { type: "cau_1_4", prediction: "Xỉu", confidence: 87, description: "Cầu 1 Tài 4 Xỉu" };
        }
        if (last5[0] === 0 && last5[1] === 1 && last5[2] === 1 && last5[3] === 1 && last5[4] === 1) {
            return { type: "cau_1_4", prediction: "Tài", confidence: 87, description: "Cầu 1 Xỉu 4 Tài" };
        }
        return null;
    }

    cau4_2() {
        const last8 = this.processed.slice(-8).map(p => p.result);
        if (last8.length >= 8) {
            if (last8[0] === 1 && last8[1] === 1 && last8[2] === 1 && last8[3] === 1 && last8[4] === 0 && last8[5] === 0 && last8[6] === 1 && last8[7] === 1) {
                return { type: "cau_4_2", prediction: "Xỉu", confidence: 89, description: "Cầu 4-2-2" };
            }
            if (last8[0] === 0 && last8[1] === 0 && last8[2] === 0 && last8[3] === 0 && last8[4] === 1 && last8[5] === 1 && last8[6] === 0 && last8[7] === 0) {
                return { type: "cau_4_2", prediction: "Tài", confidence: 89, description: "Cầu 4-2-2" };
            }
        }
        return null;
    }

    cau2_4() {
        const last8 = this.processed.slice(-8).map(p => p.result);
        if (last8.length >= 8) {
            if (last8[0] === 1 && last8[1] === 1 && last8[2] === 0 && last8[3] === 0 && last8[4] === 0 && last8[5] === 0 && last8[6] === 1 && last8[7] === 1) {
                return { type: "cau_2_4", prediction: "Xỉu", confidence: 88, description: "Cầu 2-4-2" };
            }
            if (last8[0] === 0 && last8[1] === 0 && last8[2] === 1 && last8[3] === 1 && last8[4] === 1 && last8[5] === 1 && last8[6] === 0 && last8[7] === 0) {
                return { type: "cau_2_4", prediction: "Tài", confidence: 88, description: "Cầu 2-4-2" };
            }
        }
        return null;
    }

    cau4_3() {
        const last9 = this.processed.slice(-9).map(p => p.result);
        if (last9.length >= 9) {
            if (last9[0] === 1 && last9[1] === 1 && last9[2] === 1 && last9[3] === 1 && last9[4] === 0 && last9[5] === 0 && last9[6] === 0 && last9[7] === 1 && last9[8] === 1) {
                return { type: "cau_4_3", prediction: "Xỉu", confidence: 87, description: "Cầu 4-3-2" };
            }
            if (last9[0] === 0 && last9[1] === 0 && last9[2] === 0 && last9[3] === 0 && last9[4] === 1 && last9[5] === 1 && last9[6] === 1 && last9[7] === 0 && last9[8] === 0) {
                return { type: "cau_4_3", prediction: "Tài", confidence: 87, description: "Cầu 4-3-2" };
            }
        }
        return null;
    }

    cau3_4() {
        const last9 = this.processed.slice(-9).map(p => p.result);
        if (last9.length >= 9) {
            if (last9[0] === 1 && last9[1] === 1 && last9[2] === 1 && last9[3] === 0 && last9[4] === 0 && last9[5] === 0 && last9[6] === 0 && last9[7] === 1 && last9[8] === 1) {
                return { type: "cau_3_4", prediction: "Xỉu", confidence: 88, description: "Cầu 3-4-2" };
            }
            if (last9[0] === 0 && last9[1] === 0 && last9[2] === 0 && last9[3] === 1 && last9[4] === 1 && last9[5] === 1 && last9[6] === 1 && last9[7] === 0 && last9[8] === 0) {
                return { type: "cau_3_4", prediction: "Tài", confidence: 88, description: "Cầu 3-4-2" };
            }
        }
        return null;
    }

    cau4_4() {
        const last12 = this.processed.slice(-12).map(p => p.result);
        if (last12.length >= 12) {
            if (last12[0] === 1 && last12[1] === 1 && last12[2] === 1 && last12[3] === 1 && 
                last12[4] === 0 && last12[5] === 0 && last12[6] === 0 && last12[7] === 0 &&
                last12[8] === 1 && last12[9] === 1 && last12[10] === 1 && last12[11] === 1) {
                return { type: "cau_4_4", prediction: "Xỉu", confidence: 93, description: "Cầu 4-4-4" };
            }
            if (last12[0] === 0 && last12[1] === 0 && last12[2] === 0 && last12[3] === 0 && 
                last12[4] === 1 && last12[5] === 1 && last12[6] === 1 && last12[7] === 1 &&
                last12[8] === 0 && last12[9] === 0 && last12[10] === 0 && last12[11] === 0) {
                return { type: "cau_4_4", prediction: "Tài", confidence: 93, description: "Cầu 4-4-4" };
            }
        }
        return null;
    }

    cau5_1() {
        const last6 = this.processed.slice(-6).map(p => p.result);
        if (last6[0] === 1 && last6[1] === 1 && last6[2] === 1 && last6[3] === 1 && last6[4] === 1 && last6[5] === 0) {
            return { type: "cau_5_1", prediction: "Xỉu", confidence: 90, description: "Cầu 5 Tài 1 Xỉu" };
        }
        if (last6[0] === 0 && last6[1] === 0 && last6[2] === 0 && last6[3] === 0 && last6[4] === 0 && last6[5] === 1) {
            return { type: "cau_5_1", prediction: "Tài", confidence: 90, description: "Cầu 5 Xỉu 1 Tài" };
        }
        return null;
    }

    cau1_5() {
        const last6 = this.processed.slice(-6).map(p => p.result);
        if (last6[0] === 1 && last6[1] === 0 && last6[2] === 0 && last6[3] === 0 && last6[4] === 0 && last6[5] === 0) {
            return { type: "cau_1_5", prediction: "Xỉu", confidence: 89, description: "Cầu 1 Tài 5 Xỉu" };
        }
        if (last6[0] === 0 && last6[1] === 1 && last6[2] === 1 && last6[3] === 1 && last6[4] === 1 && last6[5] === 1) {
            return { type: "cau_1_5", prediction: "Tài", confidence: 89, description: "Cầu 1 Xỉu 5 Tài" };
        }
        return null;
    }

    cau5_2() {
        const last9 = this.processed.slice(-9).map(p => p.result);
        if (last9.length >= 9) {
            if (last9[0] === 1 && last9[1] === 1 && last9[2] === 1 && last9[3] === 1 && last9[4] === 1 && 
                last9[5] === 0 && last9[6] === 0 && last9[7] === 1 && last9[8] === 1) {
                return { type: "cau_5_2", prediction: "Xỉu", confidence: 89, description: "Cầu 5-2-2" };
            }
            if (last9[0] === 0 && last9[1] === 0 && last9[2] === 0 && last9[3] === 0 && last9[4] === 0 && 
                last9[5] === 1 && last9[6] === 1 && last9[7] === 0 && last9[8] === 0) {
                return { type: "cau_5_2", prediction: "Tài", confidence: 89, description: "Cầu 5-2-2" };
            }
        }
        return null;
    }

    cau2_5() {
        const last9 = this.processed.slice(-9).map(p => p.result);
        if (last9.length >= 9) {
            if (last9[0] === 1 && last9[1] === 1 && last9[2] === 0 && last9[3] === 0 && last9[4] === 0 && 
                last9[5] === 0 && last9[6] === 0 && last9[7] === 1 && last9[8] === 1) {
                return { type: "cau_2_5", prediction: "Xỉu", confidence: 88, description: "Cầu 2-5-2" };
            }
            if (last9[0] === 0 && last9[1] === 0 && last9[2] === 1 && last9[3] === 1 && last9[4] === 1 && 
                last9[5] === 1 && last9[6] === 1 && last9[7] === 0 && last9[8] === 0) {
                return { type: "cau_2_5", prediction: "Tài", confidence: 88, description: "Cầu 2-5-2" };
            }
        }
        return null;
    }

    cau5_3() {
        const last10 = this.processed.slice(-10).map(p => p.result);
        if (last10.length >= 10) {
            if (last10[0] === 1 && last10[1] === 1 && last10[2] === 1 && last10[3] === 1 && last10[4] === 1 && 
                last10[5] === 0 && last10[6] === 0 && last10[7] === 0 && last10[8] === 1 && last10[9] === 1) {
                return { type: "cau_5_3", prediction: "Xỉu", confidence: 88, description: "Cầu 5-3-2" };
            }
            if (last10[0] === 0 && last10[1] === 0 && last10[2] === 0 && last10[3] === 0 && last10[4] === 0 && 
                last10[5] === 1 && last10[6] === 1 && last10[7] === 1 && last10[8] === 0 && last10[9] === 0) {
                return { type: "cau_5_3", prediction: "Tài", confidence: 88, description: "Cầu 5-3-2" };
            }
        }
        return null;
    }

    cau3_5() {
        const last10 = this.processed.slice(-10).map(p => p.result);
        if (last10.length >= 10) {
            if (last10[0] === 1 && last10[1] === 1 && last10[2] === 1 && last10[3] === 0 && last10[4] === 0 && 
                last10[5] === 0 && last10[6] === 0 && last10[7] === 0 && last10[8] === 1 && last10[9] === 1) {
                return { type: "cau_3_5", prediction: "Xỉu", confidence: 88, description: "Cầu 3-5-2" };
            }
            if (last10[0] === 0 && last10[1] === 0 && last10[2] === 0 && last10[3] === 1 && last10[4] === 1 && 
                last10[5] === 1 && last10[6] === 1 && last10[7] === 1 && last10[8] === 0 && last10[9] === 0) {
                return { type: "cau_3_5", prediction: "Tài", confidence: 88, description: "Cầu 3-5-2" };
            }
        }
        return null;
    }

    cau5_4() {
        const last11 = this.processed.slice(-11).map(p => p.result);
        if (last11.length >= 11) {
            if (last11[0] === 1 && last11[1] === 1 && last11[2] === 1 && last11[3] === 1 && last11[4] === 1 && 
                last11[5] === 0 && last11[6] === 0 && last11[7] === 0 && last11[8] === 0 && last11[9] === 1 && last11[10] === 1) {
                return { type: "cau_5_4", prediction: "Xỉu", confidence: 89, description: "Cầu 5-4-2" };
            }
            if (last11[0] === 0 && last11[1] === 0 && last11[2] === 0 && last11[3] === 0 && last11[4] === 0 && 
                last11[5] === 1 && last11[6] === 1 && last11[7] === 1 && last11[8] === 1 && last11[9] === 0 && last11[10] === 0) {
                return { type: "cau_5_4", prediction: "Tài", confidence: 89, description: "Cầu 5-4-2" };
            }
        }
        return null;
    }

    cau4_5() {
        const last11 = this.processed.slice(-11).map(p => p.result);
        if (last11.length >= 11) {
            if (last11[0] === 1 && last11[1] === 1 && last11[2] === 1 && last11[3] === 1 && 
                last11[4] === 0 && last11[5] === 0 && last11[6] === 0 && last11[7] === 0 && last11[8] === 0 && 
                last11[9] === 1 && last11[10] === 1) {
                return { type: "cau_4_5", prediction: "Xỉu", confidence: 88, description: "Cầu 4-5-2" };
            }
            if (last11[0] === 0 && last11[1] === 0 && last11[2] === 0 && last11[3] === 0 && 
                last11[4] === 1 && last11[5] === 1 && last11[6] === 1 && last11[7] === 1 && last11[8] === 1 && 
                last11[9] === 0 && last11[10] === 0) {
                return { type: "cau_4_5", prediction: "Tài", confidence: 88, description: "Cầu 4-5-2" };
            }
        }
        return null;
    }

    cau5_5() {
        const last12 = this.processed.slice(-12).map(p => p.result);
        if (last12.length >= 12) {
            if (last12[0] === 1 && last12[1] === 1 && last12[2] === 1 && last12[3] === 1 && last12[4] === 1 && 
                last12[5] === 0 && last12[6] === 0 && last12[7] === 0 && last12[8] === 0 && last12[9] === 0 &&
                last12[10] === 1 && last12[11] === 1) {
                return { type: "cau_5_5", prediction: "Xỉu", confidence: 92, description: "Cầu 5-5-2" };
            }
            if (last12[0] === 0 && last12[1] === 0 && last12[2] === 0 && last12[3] === 0 && last12[4] === 0 && 
                last12[5] === 1 && last12[6] === 1 && last12[7] === 1 && last12[8] === 1 && last12[9] === 1 &&
                last12[10] === 0 && last12[11] === 0) {
                return { type: "cau_5_5", prediction: "Tài", confidence: 92, description: "Cầu 5-5-2" };
            }
        }
        return null;
    }

    cau6_1() {
        const last7 = this.processed.slice(-7).map(p => p.result);
        if (last7[0] === 1 && last7[1] === 1 && last7[2] === 1 && last7[3] === 1 && last7[4] === 1 && last7[5] === 1 && last7[6] === 0) {
            return { type: "cau_6_1", prediction: "Xỉu", confidence: 92, description: "Cầu 6 Tài 1 Xỉu" };
        }
        if (last7[0] === 0 && last7[1] === 0 && last7[2] === 0 && last7[3] === 0 && last7[4] === 0 && last7[5] === 0 && last7[6] === 1) {
            return { type: "cau_6_1", prediction: "Tài", confidence: 92, description: "Cầu 6 Xỉu 1 Tài" };
        }
        return null;
    }

    cau1_6() {
        const last7 = this.processed.slice(-7).map(p => p.result);
        if (last7[0] === 1 && last7[1] === 0 && last7[2] === 0 && last7[3] === 0 && last7[4] === 0 && last7[5] === 0 && last7[6] === 0) {
            return { type: "cau_1_6", prediction: "Xỉu", confidence: 91, description: "Cầu 1 Tài 6 Xỉu" };
        }
        if (last7[0] === 0 && last7[1] === 1 && last7[2] === 1 && last7[3] === 1 && last7[4] === 1 && last7[5] === 1 && last7[6] === 1) {
            return { type: "cau_1_6", prediction: "Tài", confidence: 91, description: "Cầu 1 Xỉu 6 Tài" };
        }
        return null;
    }

    cau6_2() {
        const last10 = this.processed.slice(-10).map(p => p.result);
        if (last10.length >= 10) {
            if (last10[0] === 1 && last10[1] === 1 && last10[2] === 1 && last10[3] === 1 && last10[4] === 1 && last10[5] === 1 && 
                last10[6] === 0 && last10[7] === 0 && last10[8] === 1 && last10[9] === 1) {
                return { type: "cau_6_2", prediction: "Xỉu", confidence: 91, description: "Cầu 6-2-2" };
            }
            if (last10[0] === 0 && last10[1] === 0 && last10[2] === 0 && last10[3] === 0 && last10[4] === 0 && last10[5] === 0 && 
                last10[6] === 1 && last10[7] === 1 && last10[8] === 0 && last10[9] === 0) {
                return { type: "cau_6_2", prediction: "Tài", confidence: 91, description: "Cầu 6-2-2" };
            }
        }
        return null;
    }

    cau2_6() {
        const last10 = this.processed.slice(-10).map(p => p.result);
        if (last10.length >= 10) {
            if (last10[0] === 1 && last10[1] === 1 && last10[2] === 0 && last10[3] === 0 && last10[4] === 0 && last10[5] === 0 && 
                last10[6] === 0 && last10[7] === 0 && last10[8] === 1 && last10[9] === 1) {
                return { type: "cau_2_6", prediction: "Xỉu", confidence: 90, description: "Cầu 2-6-2" };
            }
            if (last10[0] === 0 && last10[1] === 0 && last10[2] === 1 && last10[3] === 1 && last10[4] === 1 && last10[5] === 1 && 
                last10[6] === 1 && last10[7] === 1 && last10[8] === 0 && last10[9] === 0) {
                return { type: "cau_2_6", prediction: "Tài", confidence: 90, description: "Cầu 2-6-2" };
            }
        }
        return null;
    }

    cau6_3() {
        const last11 = this.processed.slice(-11).map(p => p.result);
        if (last11.length >= 11) {
            if (last11[0] === 1 && last11[1] === 1 && last11[2] === 1 && last11[3] === 1 && last11[4] === 1 && last11[5] === 1 && 
                last11[6] === 0 && last11[7] === 0 && last11[8] === 0 && last11[9] === 1 && last11[10] === 1) {
                return { type: "cau_6_3", prediction: "Xỉu", confidence: 90, description: "Cầu 6-3-2" };
            }
            if (last11[0] === 0 && last11[1] === 0 && last11[2] === 0 && last11[3] === 0 && last11[4] === 0 && last11[5] === 0 && 
                last11[6] === 1 && last11[7] === 1 && last11[8] === 1 && last11[9] === 0 && last11[10] === 0) {
                return { type: "cau_6_3", prediction: "Tài", confidence: 90, description: "Cầu 6-3-2" };
            }
        }
        return null;
    }

    cau3_6() {
        const last11 = this.processed.slice(-11).map(p => p.result);
        if (last11.length >= 11) {
            if (last11[0] === 1 && last11[1] === 1 && last11[2] === 1 && last11[3] === 0 && last11[4] === 0 && last11[5] === 0 && 
                last11[6] === 0 && last11[7] === 0 && last11[8] === 0 && last11[9] === 1 && last11[10] === 1) {
                return { type: "cau_3_6", prediction: "Xỉu", confidence: 90, description: "Cầu 3-6-2" };
            }
            if (last11[0] === 0 && last11[1] === 0 && last11[2] === 0 && last11[3] === 1 && last11[4] === 1 && last11[5] === 1 && 
                last11[6] === 1 && last11[7] === 1 && last11[8] === 1 && last11[9] === 0 && last11[10] === 0) {
                return { type: "cau_3_6", prediction: "Tài", confidence: 90, description: "Cầu 3-6-2" };
            }
        }
        return null;
    }

    cau6_4() {
        const last12 = this.processed.slice(-12).map(p => p.result);
        if (last12.length >= 12) {
            if (last12[0] === 1 && last12[1] === 1 && last12[2] === 1 && last12[3] === 1 && last12[4] === 1 && last12[5] === 1 && 
                last12[6] === 0 && last12[7] === 0 && last12[8] === 0 && last12[9] === 0 && last12[10] === 1 && last12[11] === 1) {
                return { type: "cau_6_4", prediction: "Xỉu", confidence: 91, description: "Cầu 6-4-2" };
            }
            if (last12[0] === 0 && last12[1] === 0 && last12[2] === 0 && last12[3] === 0 && last12[4] === 0 && last12[5] === 0 && 
                last12[6] === 1 && last12[7] === 1 && last12[8] === 1 && last12[9] === 1 && last12[10] === 0 && last12[11] === 0) {
                return { type: "cau_6_4", prediction: "Tài", confidence: 91, description: "Cầu 6-4-2" };
            }
        }
        return null;
    }

    cau4_6() {
        const last12 = this.processed.slice(-12).map(p => p.result);
        if (last12.length >= 12) {
            if (last12[0] === 1 && last12[1] === 1 && last12[2] === 1 && last12[3] === 1 && 
                last12[4] === 0 && last12[5] === 0 && last12[6] === 0 && last12[7] === 0 && last12[8] === 0 && last12[9] === 0 && 
                last12[10] === 1 && last12[11] === 1) {
                return { type: "cau_4_6", prediction: "Xỉu", confidence: 90, description: "Cầu 4-6-2" };
            }
            if (last12[0] === 0 && last12[1] === 0 && last12[2] === 0 && last12[3] === 0 && 
                last12[4] === 1 && last12[5] === 1 && last12[6] === 1 && last12[7] === 1 && last12[8] === 1 && last12[9] === 1 && 
                last12[10] === 0 && last12[11] === 0) {
                return { type: "cau_4_6", prediction: "Tài", confidence: 90, description: "Cầu 4-6-2" };
            }
        }
        return null;
    }

    cau6_5() {
        const last13 = this.processed.slice(-13).map(p => p.result);
        if (last13.length >= 13) {
            if (last13[0] === 1 && last13[1] === 1 && last13[2] === 1 && last13[3] === 1 && last13[4] === 1 && last13[5] === 1 && 
                last13[6] === 0 && last13[7] === 0 && last13[8] === 0 && last13[9] === 0 && last13[10] === 0 && 
                last13[11] === 1 && last13[12] === 1) {
                return { type: "cau_6_5", prediction: "Xỉu", confidence: 91, description: "Cầu 6-5-2" };
            }
            if (last13[0] === 0 && last13[1] === 0 && last13[2] === 0 && last13[3] === 0 && last13[4] === 0 && last13[5] === 0 && 
                last13[6] === 1 && last13[7] === 1 && last13[8] === 1 && last13[9] === 1 && last13[10] === 1 && 
                last13[11] === 0 && last13[12] === 0) {
                return { type: "cau_6_5", prediction: "Tài", confidence: 91, description: "Cầu 6-5-2" };
            }
        }
        return null;
    }

    cau5_6() {
        const last13 = this.processed.slice(-13).map(p => p.result);
        if (last13.length >= 13) {
            if (last13[0] === 1 && last13[1] === 1 && last13[2] === 1 && last13[3] === 1 && last13[4] === 1 && 
                last13[5] === 0 && last13[6] === 0 && last13[7] === 0 && last13[8] === 0 && last13[9] === 0 && last13[10] === 0 && 
                last13[11] === 1 && last13[12] === 1) {
                return { type: "cau_5_6", prediction: "Xỉu", confidence: 90, description: "Cầu 5-6-2" };
            }
            if (last13[0] === 0 && last13[1] === 0 && last13[2] === 0 && last13[3] === 0 && last13[4] === 0 && 
                last13[5] === 1 && last13[6] === 1 && last13[7] === 1 && last13[8] === 1 && last13[9] === 1 && last13[10] === 1 && 
                last13[11] === 0 && last13[12] === 0) {
                return { type: "cau_5_6", prediction: "Tài", confidence: 90, description: "Cầu 5-6-2" };
            }
        }
        return null;
    }

    cau6_6() {
        const last14 = this.processed.slice(-14).map(p => p.result);
        if (last14.length >= 14) {
            if (last14[0] === 1 && last14[1] === 1 && last14[2] === 1 && last14[3] === 1 && last14[4] === 1 && last14[5] === 1 && 
                last14[6] === 0 && last14[7] === 0 && last14[8] === 0 && last14[9] === 0 && last14[10] === 0 && last14[11] === 0 &&
                last14[12] === 1 && last14[13] === 1) {
                return { type: "cau_6_6", prediction: "Xỉu", confidence: 94, description: "Cầu 6-6-2" };
            }
            if (last14[0] === 0 && last14[1] === 0 && last14[2] === 0 && last14[3] === 0 && last14[4] === 0 && last14[5] === 0 && 
                last14[6] === 1 && last14[7] === 1 && last14[8] === 1 && last14[9] === 1 && last14[10] === 1 && last14[11] === 1 &&
                last14[12] === 0 && last14[13] === 0) {
                return { type: "cau_6_6", prediction: "Tài", confidence: 94, description: "Cầu 6-6-2" };
            }
        }
        return null;
    }

    cauFibonacci() {
        const lastResults = this.processed.slice(-20).map(p => p.result);
        const fibonacci = [1, 1, 2, 3, 5, 8, 13];
        
        for (let i = 0; i < fibonacci.length - 2; i++) {
            const len = fibonacci[i] + fibonacci[i+1];
            if (lastResults.length >= len) {
                let isValid = true;
                for (let j = 0; j < fibonacci[i]; j++) {
                    if (lastResults[lastResults.length - len + j] !== 1) {
                        isValid = false;
                        break;
                    }
                }
                if (isValid) {
                    for (let j = 0; j < fibonacci[i+1]; j++) {
                        if (lastResults[lastResults.length - len + fibonacci[i] + j] !== 0) {
                            isValid = false;
                            break;
                        }
                    }
                    if (isValid) {
                        return { type: "cau_fibonacci", prediction: "Tài", confidence: 88, description: "Cầu Fibonacci" };
                    }
                }
            }
        }
        return null;
    }

    cauDoiXung() {
        const last10 = this.processed.slice(-10).map(p => p.result);
        if (last10.length >= 8) {
            let isSymmetric = true;
            for (let i = 0; i < 4; i++) {
                if (last10[last10.length - 1 - i] !== last10[last10.length - 5 - i]) {
                    isSymmetric = false;
                    break;
                }
            }
            if (isSymmetric) {
                const center = last10[last10.length - 5];
                const nextPred = center === 1 ? "Xỉu" : "Tài";
                return { type: "cau_doi_xung", prediction: nextPred, confidence: 87, description: "Cầu đối xứng" };
            }
        }
        return null;
    }

    cauDoiXung2() {
        const last12 = this.processed.slice(-12).map(p => p.result);
        if (last12.length >= 10) {
            let isSymmetric = true;
            for (let i = 0; i < 5; i++) {
                if (last12[last12.length - 1 - i] !== last12[last12.length - 6 - i]) {
                    isSymmetric = false;
                    break;
                }
            }
            if (isSymmetric) {
                const center = last12[last12.length - 6];
                const nextPred = center === 1 ? "Xỉu" : "Tài";
                return { type: "cau_doi_xung_2", prediction: nextPred, confidence: 89, description: "Cầu đối xứng 5-5" };
            }
        }
        return null;
    }

    cauDoiXung3() {
        const last14 = this.processed.slice(-14).map(p => p.result);
        if (last14.length >= 12) {
            let isSymmetric = true;
            for (let i = 0; i < 6; i++) {
                if (last14[last14.length - 1 - i] !== last14[last14.length - 7 - i]) {
                    isSymmetric = false;
                    break;
                }
            }
            if (isSymmetric) {
                const center = last14[last14.length - 7];
                const nextPred = center === 1 ? "Xỉu" : "Tài";
                return { type: "cau_doi_xung_3", prediction: nextPred, confidence: 90, description: "Cầu đối xứng 6-6" };
            }
        }
        return null;
    }

    cauTienTrien() {
        const last8 = this.processed.slice(-8).map(p => p.resultStr);
        const patterns = ["Tài", "Xỉu", "Tài", "Tài", "Xỉu", "Xỉu", "Tài", "Tài"];
        let matchCount = 0;
        for (let i = 0; i < last8.length; i++) {
            if (last8[i] === patterns[i % patterns.length]) matchCount++;
        }
        if (matchCount >= 6) {
            const nextPattern = patterns[last8.length % patterns.length];
            return { type: "cau_tien_trien", prediction: nextPattern, confidence: 85, description: "Cầu tiến triển" };
        }
        return null;
    }

    cauLui() {
        const last8 = this.processed.slice(-8).map(p => p.resultStr);
        const patterns = ["Tài", "Tài", "Xỉu", "Xỉu", "Tài", "Tài", "Xỉu", "Xỉu"];
        let matchCount = 0;
        for (let i = 0; i < last8.length; i++) {
            if (last8[i] === patterns[i % patterns.length]) matchCount++;
        }
        if (matchCount >= 6) {
            const nextPattern = patterns[last8.length % patterns.length];
            return { type: "cau_lui", prediction: nextPattern, confidence: 86, description: "Cầu lùi" };
        }
        return null;
    }

    cauNhacLai3() {
        const last6 = this.processed.slice(-6).map(p => p.result);
        const last3Before = this.processed.slice(-9, -6).map(p => p.result);
        if (last6[0] === last3Before[0] && last6[1] === last3Before[1] && last6[2] === last3Before[2] &&
            last6[3] === last3Before[0] && last6[4] === last3Before[1] && last6[5] === last3Before[2]) {
            const nextPred = last3Before[0] === 1 ? "Xỉu" : "Tài";
            return { type: "cau_nhac_lai_3", prediction: nextPred, confidence: 89, description: "Cầu nhắc lại 3 phiên" };
        }
        return null;
    }

    cauNhacLai4() {
        const last8 = this.processed.slice(-8).map(p => p.result);
        const last4Before = this.processed.slice(-12, -8).map(p => p.result);
        if (last8[0] === last4Before[0] && last8[1] === last4Before[1] && last8[2] === last4Before[2] && last8[3] === last4Before[3] &&
            last8[4] === last4Before[0] && last8[5] === last4Before[1] && last8[6] === last4Before[2] && last8[7] === last4Before[3]) {
            const nextPred = last4Before[0] === 1 ? "Xỉu" : "Tài";
            return { type: "cau_nhac_lai_4", prediction: nextPred, confidence: 91, description: "Cầu nhắc lại 4 phiên" };
        }
        return null;
    }

    cauNhacLai5() {
        const last10 = this.processed.slice(-10).map(p => p.result);
        const last5Before = this.processed.slice(-15, -10).map(p => p.result);
        let matchCount = 0;
        for (let i = 0; i < 5; i++) {
            if (last10[i] === last5Before[i]) matchCount++;
            if (last10[i+5] === last5Before[i]) matchCount++;
        }
        if (matchCount >= 8) {
            const nextPred = last5Before[0] === 1 ? "Xỉu" : "Tài";
            return { type: "cau_nhac_lai_5", prediction: nextPred, confidence: 92, description: "Cầu nhắc lại 5 phiên" };
        }
        return null;
    }

    cauDaChieu() {
        const last15 = this.processed.slice(-15).map(p => p.result);
        let count3Tai = 0, count3Xiu = 0;
        for (let i = 0; i < last15.length - 2; i++) {
            if (last15[i] === 1 && last15[i+1] === 1 && last15[i+2] === 1) count3Tai++;
            if (last15[i] === 0 && last15[i+1] === 0 && last15[i+2] === 0) count3Xiu++;
        }
        if (count3Tai === 2 && count3Xiu === 1) {
            return { type: "cau_da_chieu", prediction: "Xỉu", confidence: 84, description: "Cầu đa chiều" };
        }
        if (count3Xiu === 2 && count3Tai === 1) {
            return { type: "cau_da_chieu", prediction: "Tài", confidence: 84, description: "Cầu đa chiều" };
        }
        return null;
    }

    cauXoayVong() {
        const last12 = this.processed.slice(-12).map(p => p.result);
        let pattern1 = [1,0,1,0,1,0];
        let pattern2 = [0,1,0,1,0,1];
        let match1 = 0, match2 = 0;
        for (let i = 0; i < 6; i++) {
            if (last12[i] === pattern1[i]) match1++;
            if (last12[i+6] === pattern1[i]) match1++;
            if (last12[i] === pattern2[i]) match2++;
            if (last12[i+6] === pattern2[i]) match2++;
        }
        if (match1 >= 10) {
            return { type: "cau_xoay_vong", prediction: "Xỉu", confidence: 87, description: "Cầu xoay vòng" };
        }
        if (match2 >= 10) {
            return { type: "cau_xoay_vong", prediction: "Tài", confidence: 87, description: "Cầu xoay vòng" };
        }
        return null;
    }

    cauThangTien() {
        const last10 = this.processed.slice(-10).map(p => p.result);
        let increasing = true;
        for (let i = 1; i < last10.length; i++) {
            if (last10[i] === last10[i-1]) {
                increasing = false;
                break;
            }
        }
        if (increasing) {
            const last = last10[last10.length - 1];
            const nextPred = last === 1 ? "Xỉu" : "Tài";
            return { type: "cau_thang_tien", prediction: nextPred, confidence: 86, description: "Cầu thăng tiến" };
        }
        return null;
    }

    cauThangLui() {
        const last10 = this.processed.slice(-10).map(p => p.result);
        let isAlternating = true;
        for (let i = 1; i < last10.length; i++) {
            if (last10[i] === last10[i-1]) {
                isAlternating = false;
                break;
            }
        }
        if (isAlternating && last10.length >= 8) {
            const last = last10[last10.length - 1];
            const nextPred = last === 1 ? "Xỉu" : "Tài";
            return { type: "cau_thang_lui", prediction: nextPred, confidence: 85, description: "Cầu thoái lui" };
        }
        return null;
    }

    cauTamGiac() {
        const last9 = this.processed.slice(-9).map(p => p.result);
        if (last9[0] === 1 && last9[1] === 1 && last9[2] === 0 && 
            last9[3] === 1 && last9[4] === 0 && last9[5] === 1 && 
            last9[6] === 0 && last9[7] === 1 && last9[8] === 1) {
            return { type: "cau_tam_giac", prediction: "Xỉu", confidence: 88, description: "Cầu tam giác" };
        }
        if (last9[0] === 0 && last9[1] === 0 && last9[2] === 1 && 
            last9[3] === 0 && last9[4] === 1 && last9[5] === 0 && 
            last9[6] === 1 && last9[7] === 0 && last9[8] === 0) {
            return { type: "cau_tam_giac", prediction: "Tài", confidence: 88, description: "Cầu tam giác" };
        }
        return null;
    }

    cauHinhThang() {
        const last8 = this.processed.slice(-8).map(p => p.result);
        if (last8[0] === 1 && last8[1] === 1 && last8[2] === 0 && last8[3] === 0 && 
            last8[4] === 1 && last8[5] === 1 && last8[6] === 0 && last8[7] === 0) {
            return { type: "cau_hinh_thang", prediction: "Xỉu", confidence: 87, description: "Cầu hình thang" };
        }
        if (last8[0] === 0 && last8[1] === 0 && last8[2] === 1 && last8[3] === 1 && 
            last8[4] === 0 && last8[5] === 0 && last8[6] === 1 && last8[7] === 1) {
            return { type: "cau_hinh_thang", prediction: "Tài", confidence: 87, description: "Cầu hình thang" };
        }
        return null;
    }

    cauDuongCheo() {
        const last10 = this.processed.slice(-10).map(p => p.result);
        const positions = [0, 2, 4, 6, 8];
        let diagonalValues = positions.map(p => last10[p]);
        if (diagonalValues.every(v => v === 1)) {
            return { type: "cau_duong_cheo", prediction: "Xỉu", confidence: 86, description: "Cầu đường chéo Tài" };
        }
        if (diagonalValues.every(v => v === 0)) {
            return { type: "cau_duong_cheo", prediction: "Tài", confidence: 86, description: "Cầu đường chéo Xỉu" };
        }
        return null;
    }

    tongDiemThap() {
        const last = this.processed[this.processed.length - 1];
        if (last.total >= 3 && last.total <= 7) {
            let prob = 0.76;
            if (last.total === 4 || last.total === 5) prob = 0.83;
            if (last.total === 3 || last.total === 6) prob = 0.79;
            return { type: "tong_diem_thap", prediction: "Xỉu", confidence: prob * 100, description: `Tổng thấp ${last.total}` };
        }
        return null;
    }

    tongDiemCao() {
        const last = this.processed[this.processed.length - 1];
        if (last.total >= 14 && last.total <= 18) {
            let prob = 0.76;
            if (last.total === 16 || last.total === 17) prob = 0.83;
            if (last.total === 15 || last.total === 18) prob = 0.79;
            return { type: "tong_diem_cao", prediction: "Tài", confidence: prob * 100, description: `Tổng cao ${last.total}` };
        }
        return null;
    }

    tongDiemDacBiet() {
        const last = this.processed[this.processed.length - 1];
        if (last.total === 4 || last.total === 17) {
            const confidence = 86;
            return { type: "tong_diem_dac_biet", prediction: last.total === 4 ? "Xỉu" : "Tài", confidence: confidence, description: `Tổng ${last.total} đặc biệt` };
        }
        if (last.total === 5 || last.total === 16) {
            const confidence = 83;
            return { type: "tong_diem_dac_biet", prediction: last.total === 5 ? "Xỉu" : "Tài", confidence: confidence, description: `Tổng ${last.total} đặc biệt` };
        }
        if (last.total === 6 || last.total === 15) {
            const confidence = 81;
            return { type: "tong_diem_dac_biet", prediction: last.total === 6 ? "Xỉu" : "Tài", confidence: confidence, description: `Tổng ${last.total} đặc biệt` };
        }
        return null;
    }

    mat1Vang() {
        const last = this.processed[this.processed.length - 1];
        if (last.face1Streak >= 10) {
            return { type: "mat_1_vang", prediction: "Xỉu", confidence: 90, description: `Mặt 1 vắng ${last.face1Streak} phiên - rất hiếm` };
        }
        if (last.face1Streak >= 7) {
            return { type: "mat_1_vang", prediction: "Xỉu", confidence: 85, description: `Mặt 1 vắng ${last.face1Streak} phiên` };
        }
        if (last.face1Streak >= 5) {
            return { type: "mat_1_vang", prediction: "Xỉu", confidence: 80, description: `Mặt 1 vắng ${last.face1Streak} phiên` };
        }
        return null;
    }

    mat6Vang() {
        const last = this.processed[this.processed.length - 1];
        if (last.face6Streak >= 10) {
            return { type: "mat_6_vang", prediction: "Tài", confidence: 90, description: `Mặt 6 vắng ${last.face6Streak} phiên - rất hiếm` };
        }
        if (last.face6Streak >= 7) {
            return { type: "mat_6_vang", prediction: "Tài", confidence: 85, description: `Mặt 6 vắng ${last.face6Streak} phiên` };
        }
        if (last.face6Streak >= 5) {
            return { type: "mat_6_vang", prediction: "Tài", confidence: 80, description: `Mặt 6 vắng ${last.face6Streak} phiên` };
        }
        return null;
    }

    baoBa() {
        const last = this.processed[this.processed.length - 1];
        if (last.isTriple) {
            if (last.tripleVal === 1 || last.tripleVal === 6) {
                const nextPred = last.tripleVal === 1 ? "Xỉu" : "Tài";
                return { type: "bao_ba", prediction: nextPred, confidence: 93, description: `Bộ ba ${last.tripleVal} - mạnh` };
            }
            const pred = last.tripleVal <= 3 ? "Xỉu" : "Tài";
            return { type: "bao_ba", prediction: pred, confidence: 87, description: `Bộ ba ${last.tripleVal}` };
        }
        return null;
    }

    cauLichSu() {
        const last10 = this.processed.slice(-10).map(p => p.resultStr);
        let bestMatch = null;
        let bestSimilarity = 0;
        
        for (let i = 0; i < this.processed.length - 15; i++) {
            let similarity = 0;
            for (let j = 0; j < 10; j++) {
                if (this.processed[i + j].resultStr === last10[j]) similarity++;
            }
            const similarityRate = similarity / 10;
            if (similarityRate >= 0.8 && similarityRate > bestSimilarity) {
                bestSimilarity = similarityRate;
                const nextResult = this.processed[i + 10].resultStr;
                bestMatch = { prediction: nextResult, similarity: similarityRate };
            }
        }
        
        if (bestMatch && bestMatch.similarity >= 0.8) {
            const confidence = 76 + (bestMatch.similarity - 0.75) * 60;
            return { type: "cau_lich_su", prediction: bestMatch.prediction, confidence: Math.min(92, confidence), description: `Lịch sử lặp lại (${(bestMatch.similarity*100).toFixed(0)}% giống)` };
        }
        return null;
    }

    cauThongKeStreak() {
        const last = this.processed[this.processed.length - 1];
        if (last.streak >= 3 && this.probabilities[`streak_${Math.min(last.streak, 10)}`]) {
            const prob = this.probabilities[`streak_${Math.min(last.streak, 10)}`];
            const samples = this.probabilities[`streak_${Math.min(last.streak, 10)}_samples`];
            let confidence = prob > 0.5 ? prob * 100 : (1 - prob) * 100;
            
            if (samples >= 50) confidence += 6;
            if (last.streak >= 5) confidence += 5;
            if (last.streak >= 7) confidence += 4;
            
            if (confidence >= 80 && samples >= 30) {
                return { type: "cau_thong_ke_streak", prediction: prob > 0.5 ? "Tài" : "Xỉu", confidence: Math.min(95, confidence), description: `Thống kê streak ${last.streak} (${samples} mẫu)` };
            }
        }
        return null;
    }

    cauThongKeTong() {
        const last = this.processed[this.processed.length - 1];
        if (this.probabilities[`total_${last.total}`]) {
            const prob = this.probabilities[`total_${last.total}`];
            const samples = this.probabilities[`total_${last.total}_samples`];
            let confidence = prob > 0.5 ? prob * 100 : (1 - prob) * 100;
            
            if (samples >= 40) confidence += 5;
            
            if (confidence >= 80 && samples >= 25) {
                return { type: "cau_thong_ke_tong", prediction: prob > 0.5 ? "Tài" : "Xỉu", confidence: Math.min(93, confidence), description: `Thống kê tổng ${last.total} (${samples} mẫu)` };
            }
        }
        return null;
    }

    cauMarkov() {
        const last3 = this.processed.slice(-3).map(p => p.result).join('');
        let transitions = {};
        
        for (let i = 0; i < this.processed.length - 3; i++) {
            const state = this.processed.slice(i, i + 3).map(p => p.result).join('');
            const next = this.processed[i + 3].result;
            if (!transitions[state]) transitions[state] = { tai: 0, xiu: 0 };
            if (next === 1) transitions[state].tai++;
            else transitions[state].xiu++;
        }
        
        if (transitions[last3] && (transitions[last3].tai + transitions[last3].xiu) >= 15) {
            const total = transitions[last3].tai + transitions[last3].xiu;
            const probTai = transitions[last3].tai / total;
            const confidence = (probTai > 0.5 ? probTai : 1 - probTai) * 100;
            if (confidence >= 78) {
                return { type: "cau_markov", prediction: probTai > 0.5 ? "Tài" : "Xỉu", confidence: confidence, description: `Markov chain (${total} mẫu)` };
            }
        }
        return null;
    }

    cauXacSuat() {
        const last = this.processed[this.processed.length - 1];
        const lastResult = last.result;
        let taiAfterTai = 0, xiuAfterTai = 0, taiAfterXiu = 0, xiuAfterXiu = 0;
        
        for (let i = 1; i < this.processed.length; i++) {
            if (this.processed[i - 1].result === 1) {
                if (this.processed[i].result === 1) taiAfterTai++;
                else xiuAfterTai++;
            } else {
                if (this.processed[i].result === 1) taiAfterXiu++;
                else xiuAfterXiu++;
            }
        }
        
        if (lastResult === 1) {
            const total = taiAfterTai + xiuAfterTai;
            if (total >= 40) {
                const probTai = taiAfterTai / total;
                if (probTai >= 0.72) {
                    return { type: "cau_xac_suat", prediction: "Tài", confidence: probTai * 100, description: `XS Tài sau Tài: ${(probTai*100).toFixed(1)}% (${total} mẫu)` };
                }
                const probXiu = xiuAfterTai / total;
                if (probXiu >= 0.72) {
                    return { type: "cau_xac_suat", prediction: "Xỉu", confidence: probXiu * 100, description: `XS Xỉu sau Tài: ${(probXiu*100).toFixed(1)}% (${total} mẫu)` };
                }
            }
        } else {
            const total = taiAfterXiu + xiuAfterXiu;
            if (total >= 40) {
                const probTai = taiAfterXiu / total;
                if (probTai >= 0.72) {
                    return { type: "cau_xac_suat", prediction: "Tài", confidence: probTai * 100, description: `XS Tài sau Xỉu: ${(probTai*100).toFixed(1)}% (${total} mẫu)` };
                }
                const probXiu = xiuAfterXiu / total;
                if (probXiu >= 0.72) {
                    return { type: "cau_xac_suat", prediction: "Xỉu", confidence: probXiu * 100, description: `XS Xỉu sau Xỉu: ${(probXiu*100).toFixed(1)}% (${total} mẫu)` };
                }
            }
        }
        return null;
    }

    tinhXacSuatThucTe() {
        const probs = {};
        
        for (let s = 1; s <= 10; s++) {
            let tai = 0, xiu = 0;
            for (let i = s; i < this.processed.length; i++) {
                let isStreak = true;
                for (let j = 0; j < s; j++) {
                    if (i - 1 - j < 0 || this.processed[i - 1 - j].result !== this.processed[i - 1].result) {
                        isStreak = false;
                        break;
                    }
                }
                if (isStreak) {
                    if (this.processed[i].result === 1) tai++;
                    else xiu++;
                }
            }
            const totalS = tai + xiu;
            if (totalS >= 40) {
                probs[`streak_${s}`] = tai / totalS;
                probs[`streak_${s}_samples`] = totalS;
            }
        }
        
        for (let t = 3; t <= 18; t++) {
            let tai = 0, xiu = 0;
            for (let i = 1; i < this.processed.length; i++) {
                if (this.processed[i - 1].total === t) {
                    if (this.processed[i].result === 1) tai++;
                    else xiu++;
                }
            }
            const totalT = tai + xiu;
            if (totalT >= 30) {
                probs[`total_${t}`] = tai / totalT;
                probs[`total_${t}_samples`] = totalT;
            }
        }
        
        return probs;
    }

    dieuChinhThichNghi(opportunities) {
        if (opportunities.length === 0) return [];
        
        for (let opp of opportunities) {
            const perf = this.cauPerformance[opp.type];
            if (perf) {
                let adjustedConf = opp.confidence;
                
                if (perf.successRate > 0.88) adjustedConf += 7;
                else if (perf.successRate > 0.82) adjustedConf += 5;
                else if (perf.successRate > 0.76) adjustedConf += 3;
                else if (perf.successRate < 0.68) adjustedConf -= 10;
                else if (perf.successRate < 0.6) adjustedConf -= 16;
                
                if (this.stats.consecutiveWins >= 4 && perf.successRate > 0.75) adjustedConf += 5;
                if (this.stats.consecutiveLosses >= 1) adjustedConf -= 10;
                if (this.stats.consecutiveLosses >= 2) adjustedConf -= 15;
                
                const timeSinceLastUse = Date.now() - (perf.lastUsed || 0);
                if (timeSinceLastUse > 600000 && perf.successRate > 0.75) adjustedConf += 4;
                
                if (perf.totalUsed > 25 && perf.successRate > 0.85) adjustedConf += 4;
                
                opp.confidence = Math.min(98, Math.max(68, adjustedConf));
                opp.adjustedConfidence = adjustedConf;
            }
        }
        
        opportunities.sort((a, b) => {
            if (a.confidence > 94 && b.confidence > 94) return 0;
            return b.confidence - a.confidence;
        });
        
        return opportunities;
    }

    timKiemCoHoi() {
        const opportunities = [];
        
        for (let [cauName, cauFunc] of Object.entries(this.allCau)) {
            const result = cauFunc();
            if (result && result.confidence >= 68) {
                result.type = cauName;
                opportunities.push(result);
            }
        }
        
        if (opportunities.length === 0) return null;
        
        const adjustedOps = this.dieuChinhThichNghi(opportunities);
        
        if (adjustedOps.length > 0) {
            const best = adjustedOps[0];
            
            if (best.type && this.cauPerformance[best.type]) {
                this.cauPerformance[best.type].lastUsed = Date.now();
                this.cauPerformance[best.type].totalUsed = (this.cauPerformance[best.type].totalUsed || 0) + 1;
                this.currentPrimaryPattern = best.type;
            }
            
            return best;
        }
        
        return null;
    }
    
    duDoan() {
        if (this.stats.consecutiveLosses >= 5) {
            return {
                shouldBet: false,
                reason: `Thua ${this.stats.consecutiveLosses} lien tiep - Tam dung`,
                prediction: null,
                confidence: 0,
                coolDown: true
            };
        }
        
        const opp = this.timKiemCoHoi();
        
        if (!opp || opp.confidence < this.stats.adaptiveThreshold) {
            return {
                shouldBet: false,
                reason: opp ? `Tin cay ${opp.confidence}% < ${this.stats.adaptiveThreshold}%` : "Khong phat hien cau nao",
                prediction: null,
                confidence: 0
            };
        }
        
        return {
            shouldBet: true,
            prediction: opp.prediction,
            confidence: opp.confidence,
            reason: opp.description,
            type: opp.type
        };
    }
    
    capNhatKetQua(actualResult) {
        const lastTrade = this.stats.trades[this.stats.trades.length - 1];
        if (!lastTrade) return;
        
        const isWin = lastTrade.prediction === actualResult;
        this.totalPredictions++;
        if (isWin) this.correctPredictions++;
        
        if (isWin) {
            this.stats.wins++;
            this.stats.consecutiveWins++;
            this.stats.consecutiveLosses = 0;
        } else {
            this.stats.losses++;
            this.stats.consecutiveLosses++;
            this.stats.consecutiveWins = 0;
        }
        
        if (lastTrade.type && this.cauPerformance[lastTrade.type]) {
            const perf = this.cauPerformance[lastTrade.type];
            if (isWin) {
                perf.wins++;
            } else {
                perf.losses++;
            }
            const total = perf.wins + perf.losses;
            perf.successRate = total > 0 ? perf.wins / total : 0.75;
            let newConfidence = 72 + (perf.successRate * 26);
            if (total > 30 && perf.successRate > 0.85) newConfidence += 4;
            if (total > 30 && perf.successRate < 0.65) newConfidence -= 8;
            perf.confidence = Math.min(97, Math.max(65, newConfidence));
        }
        
        this.stats.trades[this.stats.trades.length - 1].actual = actualResult;
        this.stats.trades[this.stats.trades.length - 1].isWin = isWin;
        
        const last10Trades = this.stats.trades.slice(-10);
        const winsInLast10 = last10Trades.filter(t => t.isWin === true).length;
        this.stats.last10Accuracy = winsInLast10 / 10;
        
        let newThreshold = 68;
        if (this.stats.last10Accuracy > 0.9) newThreshold = 64;
        else if (this.stats.last10Accuracy > 0.86) newThreshold = 66;
        else if (this.stats.last10Accuracy > 0.82) newThreshold = 68;
        else if (this.stats.last10Accuracy < 0.7) newThreshold = 74;
        else if (this.stats.last10Accuracy < 0.65) newThreshold = 76;
        else if (this.stats.last10Accuracy < 0.6) newThreshold = 78;
        
        if (this.stats.consecutiveWins >= 6) newThreshold = Math.max(62, newThreshold - 4);
        if (this.stats.consecutiveLosses >= 2) newThreshold = Math.min(80, newThreshold + 5);
        
        this.stats.adaptiveThreshold = newThreshold;
        
        const resultIcon = isWin ? "WIN" : "LOSS";
        console.log(`   ${resultIcon} Phien ${lastTrade.phien}: ${lastTrade.prediction} | Thuc te: ${actualResult} | Acc10: ${(this.stats.last10Accuracy*100).toFixed(1)}% | Nguong: ${this.stats.adaptiveThreshold}% | ${lastTrade.type}`);
        
        return isWin;
    }
    
    chay() {
        const pred = this.duDoan();
        
        if (pred.shouldBet && !pred.coolDown) {
            const nextPhien = this.processed[this.processed.length - 1].phien + 1;
            this.stats.trades.push({
                timestamp: new Date().toISOString(),
                phien: nextPhien,
                prediction: pred.prediction,
                confidence: pred.confidence,
                reason: pred.reason,
                type: pred.type
            });
        }
        
        return pred;
    }
}

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
                const actualStr = actual.ket_qua;
                const duDoanPrev = currentPrediction.Du_doan;
                addToHistory(predictedPhien, duDoanPrev, actualStr, currentPrediction.Do_tin_cay);
                if (duDoanPrev && duDoanPrev !== 'BỎ QUA') {
                    if (duDoanPrev.toLowerCase() === actualStr.toLowerCase()) wins++;
                    else losses++;
                }
                console.log(`📝 ${predictedPhien}: ${duDoanPrev} vs ${actualStr} | ${duDoanPrev.toLowerCase() === actualStr.toLowerCase() ? '✅' : '❌'}`);
            }
        }

        gameHistory = data;
        
        if (!predictorInstance || predictorInstance.processed.length !== data.length) {
            predictorInstance = new ThichNghiSieuChinhXac(data.slice(-500));
        } else {
            predictorInstance.processed = predictorInstance.preprocess(data.slice(-500));
            predictorInstance.probabilities = predictorInstance.tinhXacSuatThucTe();
        }
        
        const pred = predictorInstance.chay();

        let pattern = "";
        for (let i = Math.max(0, data.length - 10); i < data.length; i++) pattern += data[i].ket_qua === "Tài" ? "t" : "x";

        const recentTotals = data.slice(-10).map(p => p.tong);
        let predTotal = Math.round(recentTotals.reduce((a, b) => a + b, 0) / recentTotals.length);
        if (latest.tong >= 15) predTotal = Math.min(predTotal, 12);
        if (latest.tong <= 5) predTotal = Math.max(predTotal, 9);

        const totalTrades = wins + losses;
        const winRate = totalTrades > 0 ? (wins / totalTrades * 100).toFixed(1) + '%' : '0%';

        currentPrediction = {
            id: "@anhkhoidzai102",
            Phien: latest.phien,
            Xuc_xac_1: latest.xuc_xac_1, Xuc_xac_2: latest.xuc_xac_2, Xuc_xac_3: latest.xuc_xac_3,
            Tong: latest.tong,
            Ket_qua: latest.ket_qua,
            pattern: pattern,
            Phien_hien_tai: latest.phien + 1,
            Du_doan: pred.shouldBet ? pred.prediction : 'BỎ QUA',
            Do_tin_cay: pred.shouldBet ? pred.confidence + "%" : '0%',
            Tong_du_doan: pred.shouldBet ? predTotal : 0,
            Ly_do: pred.reason,
            Trang_thai: pred.shouldBet ? 'NÊN ĐÁNH' : 'KHÔNG ĐÁNH',
            Tong_Thang: wins,
            Tong_Thua: losses,
            Tong_Ti_le: winRate,
            Loai_cau: pred.type || 'Không có',
            timestamp: Date.now()
        };

        const wc = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const wr = verifiedResults.length > 0 ? (wc / verifiedResults.length * 100).toFixed(1) : '0.0';
        console.log(`✅ ${pred.shouldBet ? pred.prediction : 'BỎ QUA'} | ${pred.reason} | AI: ${winRate} | Lịch sử: ${wc}/${verifiedResults.length} (${wr}%)`);
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
        Ly_do: "", Trang_thai: "", Tong_Thang: wins, Tong_Thua: losses, Tong_Ti_le: '0%',
        Loai_cau: '',
        timestamp: Date.now(),
        Lich_su: { Tong_phien: verifiedResults.length, Thang: verifiedResults.filter(v => v.danh_gia === 'thang').length, Thua: verifiedResults.filter(v => v.danh_gia === 'thua').length, Ty_le_thang: verifiedResults.length > 0 ? (verifiedResults.filter(v => v.danh_gia === 'thang').length / verifiedResults.length * 100).toFixed(1) + "%" : "0%" },
        Bang_thang_thua: verifiedResults.slice(0, 20)
    });
});

app.get('/', (req, res) => res.redirect('/taixiu'));

loadHistory();
console.log('='.repeat(70));
console.log('   ⚔️ THICH NGHI SIEU CHINH XAC - TAT CA CAC LOAI CAU ⚔️');
console.log('   API: wtxmd52.tele68.com | 10 phiên | 30K lịch sử');
console.log('   MOI: Be bet Tai/Xiu, Bat bet som Tai/Xiu');
console.log('   Chien luoc: Thich nghi dong + Hoc tu sai lam + Dieu chinh nguong');
console.log('='.repeat(70));

(async () => { const d = await fetchData(); if (d && d.length >= 10) { gameHistory = d; await updatePrediction(); } })();
setInterval(updatePrediction, 300);

app.listen(PORT, () => { console.log(`🚀 Port: ${PORT} | /taixiu`); });
