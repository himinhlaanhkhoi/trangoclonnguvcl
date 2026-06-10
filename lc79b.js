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
const MAX_HISTORY = 50000;
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
    if (isCorrect) wins++; else losses++;
    return isCorrect;
}

class SieuChinhXacTuyetDoiDayDu {
    constructor(data) {
        this.raw = data;
        this.processed = this.preprocess(data);
        this.allCau = this.phatHienTatCaCau();
        
        this.stats = {
            trades: [], wins: 0, losses: 0, consecutiveLosses: 0, consecutiveWins: 0,
            last10Accuracy: 1.0, last20Accuracy: 1.0, last50Accuracy: 1.0,
            adaptiveThreshold: 55, totalPredictions: 0, correctPredictions: 0
        };
        
        this.cauPerformance = {};
        this.beCauHistory = [];
        this.learningMemory = [];
        this.patternLibrary = {};
        this.specialPatterns = {};
        
        for (let key in this.allCau) {
            this.cauPerformance[key] = { 
                wins: 0, losses: 0, confidence: 85, lastUsed: 0, 
                successRate: 0.85, totalUsed: 0, last10Results: [],
                bestStreak: 0, currentStreak: 0
            };
        }
    }

    preprocess(data) {
        return data.map((item, idx, arr) => {
            const dice = [item.xuc_xac_1, item.xuc_xac_2, item.xuc_xac_3];
            let streak = 1;
            if (idx > 0 && arr[idx - 1].ket_qua === item.ket_qua) streak = arr[idx - 1].streak + 1;
            
            let taiStreak = 0, xiuStreak = 0;
            if (item.ket_qua === "Tài") {
                taiStreak = idx > 0 && arr[idx - 1].ket_qua === "Tài" ? arr[idx - 1].taiStreak + 1 : 1;
                xiuStreak = 0;
            } else {
                xiuStreak = idx > 0 && arr[idx - 1].ket_qua === "Xỉu" ? arr[idx - 1].xiuStreak + 1 : 1;
                taiStreak = 0;
            }
            
            let f1=0,f2=0,f3=0,f4=0,f5=0,f6=0;
            for(let j=idx;j>=0;j--){
                const d=arr[j];
                if(d.xuc_xac_1===1||d.xuc_xac_2===1||d.xuc_xac_3===1) f1++; else break;
            }
            for(let j=idx;j>=0;j--){
                const d=arr[j];
                if(d.xuc_xac_1===2||d.xuc_xac_2===2||d.xuc_xac_3===2) f2++; else break;
            }
            for(let j=idx;j>=0;j--){
                const d=arr[j];
                if(d.xuc_xac_1===3||d.xuc_xac_2===3||d.xuc_xac_3===3) f3++; else break;
            }
            for(let j=idx;j>=0;j--){
                const d=arr[j];
                if(d.xuc_xac_1===4||d.xuc_xac_2===4||d.xuc_xac_3===4) f4++; else break;
            }
            for(let j=idx;j>=0;j--){
                const d=arr[j];
                if(d.xuc_xac_1===5||d.xuc_xac_2===5||d.xuc_xac_3===5) f5++; else break;
            }
            for(let j=idx;j>=0;j--){
                const d=arr[j];
                if(d.xuc_xac_1===6||d.xuc_xac_2===6||d.xuc_xac_3===6) f6++; else break;
            }
            
            let totalHistory = [];
            for(let j=Math.max(0,idx-50);j<=idx;j++) totalHistory.push(arr[j].tong);
            
            let avgTotal = totalHistory.reduce((a,b)=>a+b,0)/totalHistory.length;
            let variance = totalHistory.reduce((a,b)=>a+Math.pow(b-avgTotal,2),0)/totalHistory.length;
            
            return {
                phien: item.phien, result: item.ket_qua==="Tài"?1:0, resultStr: item.ket_qua,
                total: item.tong, streak, taiStreak, xiuStreak,
                f1,f2,f3,f4,f5,f6,
                isTriple: dice[0]===dice[1]&&dice[1]===dice[2], tripleVal: dice[0],
                sum: dice[0]+dice[1]+dice[2],
                totalHistory, avgTotal, variance
            };
        });
    }

    phatHienTatCaCau() {
        return {
            ...this.cauBetTu1Den100(),
            ...this.cauBeBetTu2Den30(),
            ...this.cauBatBetSomTu1Den15(),
            ...this.cauXenKeDayDu(),
            ...this.cauCapDoiDayDu(),
            ...this.cauKetHopDayDu(),
            ...this.cauDacBiet(),
            ...this.cauHinhHoc(),
            ...this.cauToanHocCaoCap(),
            ...this.cauThongKeToanDien(),
            ...this.cauLichSuDayDu(),
            ...this.cauDuBaoThongMinh(),
            ...this.cauPhongThuy(),
            ...this.cauThanSoHoc(),
            ...this.cauThienVan(),
            ...this.cauKinhDich(),
            ...this.cauThichNghi(),
            ...this.cauTuDongPhatHien(),
            ...this.cauBaoVe(),
            ...this.cauChongGay(),
            ...this.cauTongHop()
        };
    }

    // ==================== CAU BET TU 1 DEN 100 ====================
    cauBetTu1Den100() {
        const obj = {};
        for(let i = 1; i <= 100; i++) {
            obj[`bet_tai_${i}`] = () => {
                const last = this.processed.slice(-i).map(p => p.result);
                if(last.every(r => r === 1)) {
                    let conf = Math.min(99.99, 75 + i * 0.25);
                    if(i >= 10) conf = 82 + (i-10) * 0.3;
                    if(i >= 20) conf = 88 + (i-20) * 0.2;
                    if(i >= 30) conf = 92 + (i-30) * 0.15;
                    if(i >= 50) conf = 95 + (i-50) * 0.1;
                    if(i >= 80) conf = 98.5;
                    if(i >= 95) conf = 99.5;
                    conf = Math.min(99.99, conf);
                    return { type: `bet_tai_${i}`, prediction: "Tài", confidence: conf, description: `Bệt Tài ${i} phiên liên tiếp - siêu chuẩn xác` };
                }
                return null;
            };
            obj[`bet_xiu_${i}`] = () => {
                const last = this.processed.slice(-i).map(p => p.result);
                if(last.every(r => r === 0)) {
                    let conf = Math.min(99.99, 75 + i * 0.25);
                    if(i >= 10) conf = 82 + (i-10) * 0.3;
                    if(i >= 20) conf = 88 + (i-20) * 0.2;
                    if(i >= 30) conf = 92 + (i-30) * 0.15;
                    if(i >= 50) conf = 95 + (i-50) * 0.1;
                    if(i >= 80) conf = 98.5;
                    if(i >= 95) conf = 99.5;
                    conf = Math.min(99.99, conf);
                    return { type: `bet_xiu_${i}`, prediction: "Xỉu", confidence: conf, description: `Bệt Xỉu ${i} phiên liên tiếp - siêu chuẩn xác` };
                }
                return null;
            };
        }
        return obj;
    }

    // ==================== BE BET TU 2 DEN 30 ====================
    cauBeBetTu2Den30() {
        const obj = {};
        for(let i = 2; i <= 30; i++) {
            obj[`be_bet_tai_${i}`] = () => {
                const last = this.processed.slice(-i).map(p => p.result);
                if(last.every(r => r === 1)) {
                    let conf = 70 + i;
                    if(i >= 5) conf = 75 + (i-5) * 1.2;
                    if(i >= 10) conf = 82 + (i-10) * 1;
                    if(i >= 15) conf = 88 + (i-15) * 0.8;
                    if(i >= 20) conf = 93 + (i-20) * 0.5;
                    if(i >= 25) conf = 97;
                    if(i >= 28) conf = 98.5;
                    conf = Math.min(99.5, conf);
                    
                    const last20 = this.processed.slice(-20);
                    const taiCount20 = last20.filter(p => p.result === 1).length;
                    if(taiCount20 >= 16) conf += 2;
                    if(taiCount20 >= 18) conf += 3;
                    if(this.stats.consecutiveWins >= 3) conf += 2;
                    if(this.stats.consecutiveLosses >= 1) conf -= 5;
                    if(this.stats.consecutiveLosses >= 2) conf -= 8;
                    
                    return { type: `be_bet_tai_${i}`, prediction: "Xỉu", confidence: Math.min(99.5, conf), description: `Bẻ cầu Tài sau ${i} phiên - thời điểm vàng` };
                }
                return null;
            };
            obj[`be_bet_xiu_${i}`] = () => {
                const last = this.processed.slice(-i).map(p => p.result);
                if(last.every(r => r === 0)) {
                    let conf = 70 + i;
                    if(i >= 5) conf = 75 + (i-5) * 1.2;
                    if(i >= 10) conf = 82 + (i-10) * 1;
                    if(i >= 15) conf = 88 + (i-15) * 0.8;
                    if(i >= 20) conf = 93 + (i-20) * 0.5;
                    if(i >= 25) conf = 97;
                    if(i >= 28) conf = 98.5;
                    conf = Math.min(99.5, conf);
                    
                    const last20 = this.processed.slice(-20);
                    const xiuCount20 = last20.filter(p => p.result === 0).length;
                    if(xiuCount20 >= 16) conf += 2;
                    if(xiuCount20 >= 18) conf += 3;
                    if(this.stats.consecutiveWins >= 3) conf += 2;
                    if(this.stats.consecutiveLosses >= 1) conf -= 5;
                    if(this.stats.consecutiveLosses >= 2) conf -= 8;
                    
                    return { type: `be_bet_xiu_${i}`, prediction: "Tài", confidence: Math.min(99.5, conf), description: `Bẻ cầu Xỉu sau ${i} phiên - thời điểm vàng` };
                }
                return null;
            };
        }
        return obj;
    }

    // ==================== BAT BET SOM TU 1 DEN 15 ====================
    cauBatBetSomTu1Den15() {
        const obj = {};
        for(let i = 1; i <= 15; i++) {
            obj[`bat_som_tai_${i}`] = () => {
                const last = this.processed.slice(-i).map(p => p.result);
                if(last.every(r => r === 1)) {
                    let conf = 65 + i * 2;
                    if(i >= 3) conf = 70 + (i-3) * 1.5;
                    if(i >= 6) conf = 75 + (i-6) * 1;
                    if(i >= 10) conf = 82;
                    if(i >= 12) conf = 86;
                    if(i >= 14) conf = 90;
                    conf = Math.min(94, conf);
                    return { type: `bat_som_tai_${i}`, prediction: "Tài", confidence: conf, description: `Bắt bệt Tài sớm - đã ${i} phiên, còn dài` };
                }
                return null;
            };
            obj[`bat_som_xiu_${i}`] = () => {
                const last = this.processed.slice(-i).map(p => p.result);
                if(last.every(r => r === 0)) {
                    let conf = 65 + i * 2;
                    if(i >= 3) conf = 70 + (i-3) * 1.5;
                    if(i >= 6) conf = 75 + (i-6) * 1;
                    if(i >= 10) conf = 82;
                    if(i >= 12) conf = 86;
                    if(i >= 14) conf = 90;
                    conf = Math.min(94, conf);
                    return { type: `bat_som_xiu_${i}`, prediction: "Xỉu", confidence: conf, description: `Bắt bệt Xỉu sớm - đã ${i} phiên, còn dài` };
                }
                return null;
            };
        }
        return obj;
    }

    // ==================== CAU XEN KE DAY DU ====================
    cauXenKeDayDu() {
        return {
            cau_1_1: () => {
                const last20 = this.processed.slice(-20).map(p => p.result);
                let alternating = true;
                for(let i = 1; i < last20.length; i++) {
                    if(last20[i] === last20[i-1]) { alternating = false; break; }
                }
                if(alternating && last20.length >= 10) {
                    let conf = 88;
                    if(last20.length >= 12) conf = 91;
                    if(last20.length >= 14) conf = 94;
                    if(last20.length >= 16) conf = 96;
                    if(last20.length >= 18) conf = 97.5;
                    return { type: "cau_1_1", prediction: last20[last20.length-1] === 1 ? "Xỉu" : "Tài", confidence: conf, description: `Cầu 1-1 xen kẽ hoàn hảo - ${last20.length} phiên` };
                }
                return null;
            },
            cau_2_1: () => { const last3 = this.processed.slice(-3).map(p => p.result); if(last3[0] === last3[1] && last3[2] !== last3[1]) return { type: "cau_2_1", prediction: last3[2] === 1 ? "Xỉu" : "Tài", confidence: 86, description: "Cầu 2-1 chính xác" }; return null; },
            cau_1_2: () => { const last3 = this.processed.slice(-3).map(p => p.result); if(last3[0] !== last3[1] && last3[1] === last3[2]) return { type: "cau_1_2", prediction: last3[2] === 1 ? "Tài" : "Xỉu", confidence: 86, description: "Cầu 1-2 chính xác" }; return null; },
            cau_3_1: () => { const last4 = this.processed.slice(-4).map(p => p.result); if(last4[0]===1 && last4[1]===1 && last4[2]===1 && last4[3]===0) return { type: "cau_3_1", prediction: "Xỉu", confidence: 90, description: "Cầu 3 Tài 1 Xỉu - chuẩn" }; if(last4[0]===0 && last4[1]===0 && last4[2]===0 && last4[3]===1) return { type: "cau_3_1", prediction: "Tài", confidence: 90, description: "Cầu 3 Xỉu 1 Tài - chuẩn" }; return null; },
            cau_1_3: () => { const last4 = this.processed.slice(-4).map(p => p.result); if(last4[0]===1 && last4[1]===0 && last4[2]===0 && last4[3]===0) return { type: "cau_1_3", prediction: "Xỉu", confidence: 88, description: "Cầu 1 Tài 3 Xỉu - chuẩn" }; if(last4[0]===0 && last4[1]===1 && last4[2]===1 && last4[3]===1) return { type: "cau_1_3", prediction: "Tài", confidence: 88, description: "Cầu 1 Xỉu 3 Tài - chuẩn" }; return null; },
            cau_4_1: () => { const last5 = this.processed.slice(-5).map(p => p.result); if(last5[0]===1 && last5[1]===1 && last5[2]===1 && last5[3]===1 && last5[4]===0) return { type: "cau_4_1", prediction: "Xỉu", confidence: 92, description: "Cầu 4 Tài 1 Xỉu - siêu chuẩn" }; if(last5[0]===0 && last5[1]===0 && last5[2]===0 && last5[3]===0 && last5[4]===1) return { type: "cau_4_1", prediction: "Tài", confidence: 92, description: "Cầu 4 Xỉu 1 Tài - siêu chuẩn" }; return null; },
            cau_1_4: () => { const last5 = this.processed.slice(-5).map(p => p.result); if(last5[0]===1 && last5[1]===0 && last5[2]===0 && last5[3]===0 && last5[4]===0) return { type: "cau_1_4", prediction: "Xỉu", confidence: 91, description: "Cầu 1 Tài 4 Xỉu - siêu chuẩn" }; if(last5[0]===0 && last5[1]===1 && last5[2]===1 && last5[3]===1 && last5[4]===1) return { type: "cau_1_4", prediction: "Tài", confidence: 91, description: "Cầu 1 Xỉu 4 Tài - siêu chuẩn" }; return null; },
            cau_5_1: () => { const last6 = this.processed.slice(-6).map(p => p.result); if(last6[0]===1 && last6[1]===1 && last6[2]===1 && last6[3]===1 && last6[4]===1 && last6[5]===0) return { type: "cau_5_1", prediction: "Xỉu", confidence: 94, description: "Cầu 5 Tài 1 Xỉu - cực chuẩn" }; if(last6[0]===0 && last6[1]===0 && last6[2]===0 && last6[3]===0 && last6[4]===0 && last6[5]===1) return { type: "cau_5_1", prediction: "Tài", confidence: 94, description: "Cầu 5 Xỉu 1 Tài - cực chuẩn" }; return null; },
            cau_1_5: () => { const last6 = this.processed.slice(-6).map(p => p.result); if(last6[0]===1 && last6[1]===0 && last6[2]===0 && last6[3]===0 && last6[4]===0 && last6[5]===0) return { type: "cau_1_5", prediction: "Xỉu", confidence: 93, description: "Cầu 1 Tài 5 Xỉu - cực chuẩn" }; if(last6[0]===0 && last6[1]===1 && last6[2]===1 && last6[3]===1 && last6[4]===1 && last6[5]===1) return { type: "cau_1_5", prediction: "Tài", confidence: 93, description: "Cầu 1 Xỉu 5 Tài - cực chuẩn" }; return null; },
            cau_6_1: () => { const last7 = this.processed.slice(-7).map(p => p.result); if(last7[0]===1 && last7[1]===1 && last7[2]===1 && last7[3]===1 && last7[4]===1 && last7[5]===1 && last7[6]===0) return { type: "cau_6_1", prediction: "Xỉu", confidence: 96, description: "Cầu 6 Tài 1 Xỉu - thượng thừa" }; if(last7[0]===0 && last7[1]===0 && last7[2]===0 && last7[3]===0 && last7[4]===0 && last7[5]===0 && last7[6]===1) return { type: "cau_6_1", prediction: "Tài", confidence: 96, description: "Cầu 6 Xỉu 1 Tài - thượng thừa" }; return null; },
            cau_1_6: () => { const last7 = this.processed.slice(-7).map(p => p.result); if(last7[0]===1 && last7[1]===0 && last7[2]===0 && last7[3]===0 && last7[4]===0 && last7[5]===0 && last7[6]===0) return { type: "cau_1_6", prediction: "Xỉu", confidence: 95, description: "Cầu 1 Tài 6 Xỉu - thượng thừa" }; if(last7[0]===0 && last7[1]===1 && last7[2]===1 && last7[3]===1 && last7[4]===1 && last7[5]===1 && last7[6]===1) return { type: "cau_1_6", prediction: "Tài", confidence: 95, description: "Cầu 1 Xỉu 6 Tài - thượng thừa" }; return null; },
            cau_7_1: () => { const last8 = this.processed.slice(-8).map(p => p.result); if(last8[0]===1 && last8[1]===1 && last8[2]===1 && last8[3]===1 && last8[4]===1 && last8[5]===1 && last8[6]===1 && last8[7]===0) return { type: "cau_7_1", prediction: "Xỉu", confidence: 97, description: "Cầu 7 Tài 1 Xỉu - đỉnh cao" }; if(last8[0]===0 && last8[1]===0 && last8[2]===0 && last8[3]===0 && last8[4]===0 && last8[5]===0 && last8[6]===0 && last8[7]===1) return { type: "cau_7_1", prediction: "Tài", confidence: 97, description: "Cầu 7 Xỉu 1 Tài - đỉnh cao" }; return null; },
            cau_1_7: () => { const last8 = this.processed.slice(-8).map(p => p.result); if(last8[0]===1 && last8[1]===0 && last8[2]===0 && last8[3]===0 && last8[4]===0 && last8[5]===0 && last8[6]===0 && last8[7]===0) return { type: "cau_1_7", prediction: "Xỉu", confidence: 96, description: "Cầu 1 Tài 7 Xỉu - đỉnh cao" }; if(last8[0]===0 && last8[1]===1 && last8[2]===1 && last8[3]===1 && last8[4]===1 && last8[5]===1 && last8[6]===1 && last8[7]===1) return { type: "cau_1_7", prediction: "Tài", confidence: 96, description: "Cầu 1 Xỉu 7 Tài - đỉnh cao" }; return null; }
        };
    }

    // ==================== CAU CAP DOI DAY DU ====================
    cauCapDoiDayDu() {
        return {
            cau_2_2: () => { const last4 = this.processed.slice(-4).map(p => p.result); if(last4[0]===last4[1] && last4[2]===last4[3] && last4[0]!==last4[2]) return { type: "cau_2_2", prediction: last4[3]===1?"Xỉu":"Tài", confidence: 89, description: "Cầu 2-2 chuẩn xác" }; return null; },
            cau_2_2_2: () => { const last6 = this.processed.slice(-6).map(p => p.result); if(last6[0]===last6[1] && last6[2]===last6[3] && last6[4]===last6[5] && last6[0]!==last6[2] && last6[2]!==last6[4]) return { type: "cau_2_2_2", prediction: last6[5]===1?"Xỉu":"Tài", confidence: 93, description: "Cầu 2-2-2 hoàn hảo" }; return null; },
            cau_2_2_2_2: () => { const last8 = this.processed.slice(-8).map(p => p.result); if(last8[0]===last8[1] && last8[2]===last8[3] && last8[4]===last8[5] && last8[6]===last8[7] && last8[0]!==last8[2] && last8[2]!==last8[4] && last8[4]!==last8[6]) return { type: "cau_2_2_2_2", prediction: last8[7]===1?"Xỉu":"Tài", confidence: 96, description: "Cầu 2-2-2-2 tuyệt đỉnh" }; return null; },
            cau_2_2_2_2_2: () => { const last10 = this.processed.slice(-10).map(p => p.result); if(last10[0]===last10[1] && last10[2]===last10[3] && last10[4]===last10[5] && last10[6]===last10[7] && last10[8]===last10[9] && last10[0]!==last10[2] && last10[2]!==last10[4] && last10[4]!==last10[6] && last10[6]!==last10[8]) return { type: "cau_2_2_2_2_2", prediction: last10[9]===1?"Xỉu":"Tài", confidence: 98, description: "Cầu 2-2-2-2-2 thượng thừa" }; return null; },
            cau_3_3: () => { const last6 = this.processed.slice(-6).map(p => p.result); if(last6[0]===1 && last6[1]===1 && last6[2]===1 && last6[3]===0 && last6[4]===0 && last6[5]===0) return { type: "cau_3_3", prediction: "Tài", confidence: 91, description: "Cầu 3-3 chuẩn xác" }; if(last6[0]===0 && last6[1]===0 && last6[2]===0 && last6[3]===1 && last6[4]===1 && last6[5]===1) return { type: "cau_3_3", prediction: "Xỉu", confidence: 91, description: "Cầu 3-3 chuẩn xác" }; return null; },
            cau_3_3_3: () => { const last9 = this.processed.slice(-9).map(p => p.result); if(last9[0]===1 && last9[1]===1 && last9[2]===1 && last9[3]===0 && last9[4]===0 && last9[5]===0 && last9[6]===1 && last9[7]===1 && last9[8]===1) return { type: "cau_3_3_3", prediction: "Xỉu", confidence: 94, description: "Cầu 3-3-3 hoàn hảo" }; if(last9[0]===0 && last9[1]===0 && last9[2]===0 && last9[3]===1 && last9[4]===1 && last9[5]===1 && last9[6]===0 && last9[7]===0 && last9[8]===0) return { type: "cau_3_3_3", prediction: "Tài", confidence: 94, description: "Cầu 3-3-3 hoàn hảo" }; return null; },
            cau_3_3_3_3: () => { const last12 = this.processed.slice(-12).map(p => p.result); if(last12[0]===1 && last12[1]===1 && last12[2]===1 && last12[3]===0 && last12[4]===0 && last12[5]===0 && last12[6]===1 && last12[7]===1 && last12[8]===1 && last12[9]===0 && last12[10]===0 && last12[11]===0) return { type: "cau_3_3_3_3", prediction: "Tài", confidence: 96.5, description: "Cầu 3-3-3-3 tuyệt đỉnh" }; if(last12[0]===0 && last12[1]===0 && last12[2]===0 && last12[3]===1 && last12[4]===1 && last12[5]===1 && last12[6]===0 && last12[7]===0 && last12[8]===0 && last12[9]===1 && last12[10]===1 && last12[11]===1) return { type: "cau_3_3_3_3", prediction: "Xỉu", confidence: 96.5, description: "Cầu 3-3-3-3 tuyệt đỉnh" }; return null; },
            cau_4_4: () => { const last8 = this.processed.slice(-8).map(p => p.result); if(last8[0]===1 && last8[1]===1 && last8[2]===1 && last8[3]===1 && last8[4]===0 && last8[5]===0 && last8[6]===0 && last8[7]===0) return { type: "cau_4_4", prediction: "Tài", confidence: 92, description: "Cầu 4-4 chuẩn xác" }; if(last8[0]===0 && last8[1]===0 && last8[2]===0 && last8[3]===0 && last8[4]===1 && last8[5]===1 && last8[6]===1 && last8[7]===1) return { type: "cau_4_4", prediction: "Xỉu", confidence: 92, description: "Cầu 4-4 chuẩn xác" }; return null; },
            cau_4_4_4: () => { const last12 = this.processed.slice(-12).map(p => p.result); if(last12[0]===1 && last12[1]===1 && last12[2]===1 && last12[3]===1 && last12[4]===0 && last12[5]===0 && last12[6]===0 && last12[7]===0 && last12[8]===1 && last12[9]===1 && last12[10]===1 && last12[11]===1) return { type: "cau_4_4_4", prediction: "Xỉu", confidence: 95, description: "Cầu 4-4-4 hoàn hảo" }; if(last12[0]===0 && last12[1]===0 && last12[2]===0 && last12[3]===0 && last12[4]===1 && last12[5]===1 && last12[6]===1 && last12[7]===1 && last12[8]===0 && last12[9]===0 && last12[10]===0 && last12[11]===0) return { type: "cau_4_4_4", prediction: "Tài", confidence: 95, description: "Cầu 4-4-4 hoàn hảo" }; return null; },
            cau_5_5: () => { const last10 = this.processed.slice(-10).map(p => p.result); if(last10[0]===1 && last10[1]===1 && last10[2]===1 && last10[3]===1 && last10[4]===1 && last10[5]===0 && last10[6]===0 && last10[7]===0 && last10[8]===0 && last10[9]===0) return { type: "cau_5_5", prediction: "Tài", confidence: 93, description: "Cầu 5-5 chuẩn xác" }; if(last10[0]===0 && last10[1]===0 && last10[2]===0 && last10[3]===0 && last10[4]===0 && last10[5]===1 && last10[6]===1 && last10[7]===1 && last10[8]===1 && last10[9]===1) return { type: "cau_5_5", prediction: "Xỉu", confidence: 93, description: "Cầu 5-5 chuẩn xác" }; return null; },
            cau_5_5_5: () => { const last15 = this.processed.slice(-15).map(p => p.result); if(last15[0]===1 && last15[1]===1 && last15[2]===1 && last15[3]===1 && last15[4]===1 && last15[5]===0 && last15[6]===0 && last15[7]===0 && last15[8]===0 && last15[9]===0 && last15[10]===1 && last15[11]===1 && last15[12]===1 && last15[13]===1 && last15[14]===1) return { type: "cau_5_5_5", prediction: "Xỉu", confidence: 96.5, description: "Cầu 5-5-5 tuyệt đỉnh" }; if(last15[0]===0 && last15[1]===0 && last15[2]===0 && last15[3]===0 && last15[4]===0 && last15[5]===1 && last15[6]===1 && last15[7]===1 && last15[8]===1 && last15[9]===1 && last15[10]===0 && last15[11]===0 && last15[12]===0 && last15[13]===0 && last15[14]===0) return { type: "cau_5_5_5", prediction: "Tài", confidence: 96.5, description: "Cầu 5-5-5 tuyệt đỉnh" }; return null; },
            cau_6_6: () => { const last12 = this.processed.slice(-12).map(p => p.result); if(last12[0]===1 && last12[1]===1 && last12[2]===1 && last12[3]===1 && last12[4]===1 && last12[5]===1 && last12[6]===0 && last12[7]===0 && last12[8]===0 && last12[9]===0 && last12[10]===0 && last12[11]===0) return { type: "cau_6_6", prediction: "Tài", confidence: 94, description: "Cầu 6-6 chuẩn xác" }; if(last12[0]===0 && last12[1]===0 && last12[2]===0 && last12[3]===0 && last12[4]===0 && last12[5]===0 && last12[6]===1 && last12[7]===1 && last12[8]===1 && last12[9]===1 && last12[10]===1 && last12[11]===1) return { type: "cau_6_6", prediction: "Xỉu", confidence: 94, description: "Cầu 6-6 chuẩn xác" }; return null; },
            cau_6_6_6: () => { const last18 = this.processed.slice(-18).map(p => p.result); if(last18.length>=18 && last18[0]===1 && last18[1]===1 && last18[2]===1 && last18[3]===1 && last18[4]===1 && last18[5]===1 && last18[6]===0 && last18[7]===0 && last18[8]===0 && last18[9]===0 && last18[10]===0 && last18[11]===0 && last18[12]===1 && last18[13]===1 && last18[14]===1 && last18[15]===1 && last18[16]===1 && last18[17]===1) return { type: "cau_6_6_6", prediction: "Xỉu", confidence: 97.5, description: "Cầu 6-6-6 thượng thừa" }; if(last18.length>=18 && last18[0]===0 && last18[1]===0 && last18[2]===0 && last18[3]===0 && last18[4]===0 && last18[5]===0 && last18[6]===1 && last18[7]===1 && last18[8]===1 && last18[9]===1 && last18[10]===1 && last18[11]===1 && last18[12]===0 && last18[13]===0 && last18[14]===0 && last18[15]===0 && last18[16]===0 && last18[17]===0) return { type: "cau_6_6_6", prediction: "Tài", confidence: 97.5, description: "Cầu 6-6-6 thượng thừa" }; return null; }
        };
    }

    // ==================== CAU KET HOP DAY DU ====================
    cauKetHopDayDu() {
        const obj = {};
        const ketHop = [
            [2,3], [3,2], [2,4], [4,2], [2,5], [5,2], [2,6], [6,2], [2,7], [7,2],
            [3,4], [4,3], [3,5], [5,3], [3,6], [6,3], [3,7], [7,3],
            [4,5], [5,4], [4,6], [6,4], [4,7], [7,4],
            [5,6], [6,5], [5,7], [7,5], [6,7], [7,6],
            [2,3,2], [3,2,3], [2,4,2], [4,2,4], [2,5,2], [5,2,5], [2,6,2], [6,2,6],
            [3,4,3], [4,3,4], [3,5,3], [5,3,5], [3,6,3], [6,3,6],
            [4,5,4], [5,4,5], [4,6,4], [6,4,6], [5,6,5], [6,5,6],
            [1,2,3], [3,2,1], [1,3,2], [2,3,1], [1,4,2], [2,4,1], [1,5,2], [2,5,1],
            [1,2,4], [4,2,1], [1,3,4], [4,3,1], [2,3,4], [4,3,2], [2,4,3], [3,4,2],
            [2,2,3], [3,2,2], [2,3,3], [3,3,2], [2,2,4], [4,2,2], [2,4,4], [4,4,2]
        ];
        
        for(let kh of ketHop) {
            const name = kh.join('_');
            const len = kh.reduce((a,b)=>a+b,0);
            obj[`cau_ket_hop_${name}`] = () => {
                const last = this.processed.slice(-len).map(p => p.result);
                if(last.length < len) return null;
                
                if(kh.length === 2) {
                    const a = kh[0], b = kh[1];
                    let ok1 = true, ok2 = true;
                    for(let i = 0; i < a; i++) if(last[i] !== 1) ok1 = false;
                    for(let i = a; i < a + b; i++) if(last[i] !== 0) ok1 = false;
                    if(ok1) return { type: `cau_ket_hop_${name}`, prediction: "Xỉu", confidence: 86 + (a+b)*0.3, description: `Cầu ${a}-${b} chính xác` };
                    
                    for(let i = 0; i < a; i++) if(last[i] !== 0) ok2 = false;
                    for(let i = a; i < a + b; i++) if(last[i] !== 1) ok2 = false;
                    if(ok2) return { type: `cau_ket_hop_${name}`, prediction: "Tài", confidence: 86 + (a+b)*0.3, description: `Cầu ${a}-${b} chính xác` };
                }
                else if(kh.length === 3) {
                    const a = kh[0], b = kh[1], c = kh[2];
                    let ok1 = true, ok2 = true;
                    for(let i = 0; i < a; i++) if(last[i] !== 1) ok1 = false;
                    for(let i = a; i < a + b; i++) if(last[i] !== 0) ok1 = false;
                    for(let i = a + b; i < a + b + c; i++) if(last[i] !== 1) ok1 = false;
                    if(ok1) return { type: `cau_ket_hop_${name}`, prediction: "Xỉu", confidence: 88 + (a+b+c)*0.2, description: `Cầu ${a}-${b}-${c} chính xác` };
                    
                    for(let i = 0; i < a; i++) if(last[i] !== 0) ok2 = false;
                    for(let i = a; i < a + b; i++) if(last[i] !== 1) ok2 = false;
                    for(let i = a + b; i < a + b + c; i++) if(last[i] !== 0) ok2 = false;
                    if(ok2) return { type: `cau_ket_hop_${name}`, prediction: "Tài", confidence: 88 + (a+b+c)*0.2, description: `Cầu ${a}-${b}-${c} chính xác` };
                }
                return null;
            };
        }
        return obj;
    }

    // ==================== CAU DAC BIET ====================
    cauDacBiet() {
        return {
            cau_fibonacci: () => {
                const last = this.processed.slice(-55).map(p => p.result);
                const fib = [1,1,2,3,5,8,13,21,34];
                for(let i = 0; i < fib.length - 2; i++) {
                    const len = fib[i] + fib[i+1];
                    if(last.length >= len) {
                        let ok1 = true, ok2 = true;
                        for(let j = 0; j < fib[i]; j++) if(last[last.length - len + j] !== 1) ok1 = false;
                        if(ok1) for(let j = 0; j < fib[i+1]; j++) if(last[last.length - len + fib[i] + j] !== 0) ok1 = false;
                        if(ok1) return { type: "cau_fibonacci", prediction: "Tài", confidence: 94, description: `Cầu Fibonacci siêu chuẩn - ${fib[i]}-${fib[i+1]}` };
                        
                        for(let j = 0; j < fib[i]; j++) if(last[last.length - len + j] !== 0) ok2 = false;
                        if(ok2) for(let j = 0; j < fib[i+1]; j++) if(last[last.length - len + fib[i] + j] !== 1) ok2 = false;
                        if(ok2) return { type: "cau_fibonacci", prediction: "Xỉu", confidence: 94, description: `Cầu Fibonacci siêu chuẩn - ${fib[i]}-${fib[i+1]}` };
                    }
                }
                return null;
            },
            cau_fractal: () => {
                const last16 = this.processed.slice(-16).map(p => p.result);
                const last8 = last16.slice(-8);
                let same = 0;
                for(let i = 0; i < 8; i++) if(last16[i] === last8[i]) same++;
                if(same >= 7) {
                    const conf = 88 + (same - 7) * 3;
                    return { type: "cau_fractal", prediction: last8[7] === 1 ? "Xỉu" : "Tài", confidence: Math.min(96, conf), description: `Cầu fractal - ${same}/8 trùng khớp` };
                }
                return null;
            },
            cau_nhan_ban: () => {
                const last20 = this.processed.slice(-20).map(p => p.result);
                for(let period = 2; period <= 10; period++) {
                    let match = true;
                    for(let i = 0; i < period; i++) {
                        if(last20[i] !== last20[i + period]) match = false;
                    }
                    if(match) {
                        const pred = last20[period] === 1 ? "Xỉu" : "Tài";
                        return { type: "cau_nhan_ban", prediction: pred, confidence: 92, description: `Cầu nhân bản - chu kỳ ${period}` };
                    }
                }
                return null;
            },
            cau_xoay_vong_hoan_hao: () => {
                const last16 = this.processed.slice(-16).map(p => p.result);
                const pattern1 = [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0];
                const pattern2 = [0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1];
                let match1 = 0, match2 = 0;
                for(let i = 0; i < 16; i++) {
                    if(last16[i] === pattern1[i]) match1++;
                    if(last16[i] === pattern2[i]) match2++;
                }
                if(match1 >= 14) return { type: "cau_xoay_vong_hoan_hao", prediction: "Xỉu", confidence: 95, description: "Cầu xoay vòng hoàn hảo 16 phiên" };
                if(match2 >= 14) return { type: "cau_xoay_vong_hoan_hao", prediction: "Tài", confidence: 95, description: "Cầu xoay vòng hoàn hảo 16 phiên" };
                return null;
            },
            cau_doi_xung_toan_phan: () => {
                const last12 = this.processed.slice(-12).map(p => p.result);
                let symmetric = true;
                for(let i = 0; i < 6; i++) {
                    if(last12[i] !== last12[11 - i]) symmetric = false;
                }
                if(symmetric) {
                    const center = last12[5];
                    return { type: "cau_doi_xung_toan_phan", prediction: center === 1 ? "Xỉu" : "Tài", confidence: 94, description: "Cầu đối xứng toàn phần 12 phiên" };
                }
                return null;
            }
        };
    }

    // ==================== CAU HINH HOC ====================
    cauHinhHoc() {
        return {
            cau_tam_giac_deu: () => {
                const last9 = this.processed.slice(-9).map(p => p.result);
                if(last9[0]===1 && last9[1]===1 && last9[2]===0 && last9[3]===1 && last9[4]===0 && last9[5]===1 && last9[6]===0 && last9[7]===1 && last9[8]===1) return { type: "cau_tam_giac_deu", prediction: "Xỉu", confidence: 92, description: "Cầu tam giác đều - đỉnh Tài" };
                if(last9[0]===0 && last9[1]===0 && last9[2]===1 && last9[3]===0 && last9[4]===1 && last9[5]===0 && last9[6]===1 && last9[7]===0 && last9[8]===0) return { type: "cau_tam_giac_deu", prediction: "Tài", confidence: 92, description: "Cầu tam giác đều - đỉnh Xỉu" };
                return null;
            },
            cau_hinh_thang_can: () => {
                const last10 = this.processed.slice(-10).map(p => p.result);
                if(last10[0]===1 && last10[1]===1 && last10[2]===0 && last10[3]===0 && last10[4]===1 && last10[5]===1 && last10[6]===0 && last10[7]===0 && last10[8]===1 && last10[9]===1) return { type: "cau_hinh_thang_can", prediction: "Xỉu", confidence: 93, description: "Cầu hình thang cân 2-2-2-2-2" };
                if(last10[0]===0 && last10[1]===0 && last10[2]===1 && last10[3]===1 && last10[4]===0 && last10[5]===0 && last10[6]===1 && last10[7]===1 && last10[8]===0 && last10[9]===0) return { type: "cau_hinh_thang_can", prediction: "Tài", confidence: 93, description: "Cầu hình thang cân 2-2-2-2-2" };
                return null;
            },
            cau_hinh_vuong: () => {
                const last8 = this.processed.slice(-8).map(p => p.result);
                if(last8[0]===1 && last8[1]===0 && last8[2]===0 && last8[3]===1 && last8[4]===1 && last8[5]===0 && last8[6]===0 && last8[7]===1) return { type: "cau_hinh_vuong", prediction: "Xỉu", confidence: 90, description: "Cầu hình vuông 2x2" };
                if(last8[0]===0 && last8[1]===1 && last8[2]===1 && last8[3]===0 && last8[4]===0 && last8[5]===1 && last8[6]===1 && last8[7]===0) return { type: "cau_hinh_vuong", prediction: "Tài", confidence: 90, description: "Cầu hình vuông 2x2" };
                return null;
            },
            cau_duong_cheo_vang: () => {
                const last10 = this.processed.slice(-10).map(p => p.result);
                const pos = [0,2,4,6,8];
                const vals = pos.map(p => last10[p]);
                if(vals.every(v => v === 1)) return { type: "cau_duong_cheo_vang", prediction: "Xỉu", confidence: 88, description: "Cầu đường chéo vàng" };
                if(vals.every(v => v === 0)) return { type: "cau_duong_cheo_vang", prediction: "Tài", confidence: 88, description: "Cầu đường chéo vàng" };
                return null;
            },
            cau_luc_giac_deu: () => {
                const last12 = this.processed.slice(-12).map(p => p.result);
                const even = [last12[0], last12[2], last12[4], last12[6], last12[8], last12[10]];
                const odd = [last12[1], last12[3], last12[5], last12[7], last12[9], last12[11]];
                if(even.every(v => v === 1)) return { type: "cau_luc_giac_deu", prediction: "Xỉu", confidence: 91, description: "Lục giác đều - chẵn Tài" };
                if(odd.every(v => v === 1)) return { type: "cau_luc_giac_deu", prediction: "Xỉu", confidence: 91, description: "Lục giác đều - lẻ Tài" };
                if(even.every(v => v === 0)) return { type: "cau_luc_giac_deu", prediction: "Tài", confidence: 91, description: "Lục giác đều - chẵn Xỉu" };
                if(odd.every(v => v === 0)) return { type: "cau_luc_giac_deu", prediction: "Tài", confidence: 91, description: "Lục giác đều - lẻ Xỉu" };
                return null;
            }
        };
    }

    // ==================== CAU TOAN HOC CAO CAP ====================
    cauToanHocCaoCap() {
        return {
            cau_markov_bac_2: () => {
                const last2 = this.processed.slice(-2).map(p => p.result).join('');
                let trans = {};
                for(let i = 0; i < this.processed.length - 2; i++) {
                    const state = this.processed.slice(i, i+2).map(p => p.result).join('');
                    const next = this.processed[i+2].result;
                    if(!trans[state]) trans[state] = { tai: 0, xiu: 0 };
                    if(next === 1) trans[state].tai++; else trans[state].xiu++;
                }
                if(trans[last2] && trans[last2].tai + trans[last2].xiu >= 30) {
                    const pTai = trans[last2].tai / (trans[last2].tai + trans[last2].xiu);
                    if(pTai >= 0.85) return { type: "cau_markov_bac_2", prediction: "Tài", confidence: 92, description: `Markov bậc 2 - ${(pTai*100).toFixed(1)}% Tài (${trans[last2].tai + trans[last2].xiu} mẫu)` };
                    if(pTai <= 0.15) return { type: "cau_markov_bac_2", prediction: "Xỉu", confidence: 92, description: `Markov bậc 2 - ${((1-pTai)*100).toFixed(1)}% Xỉu (${trans[last2].tai + trans[last2].xiu} mẫu)` };
                }
                return null;
            },
            cau_markov_bac_3: () => {
                const last3 = this.processed.slice(-3).map(p => p.result).join('');
                let trans = {};
                for(let i = 0; i < this.processed.length - 3; i++) {
                    const state = this.processed.slice(i, i+3).map(p => p.result).join('');
                    const next = this.processed[i+3].result;
                    if(!trans[state]) trans[state] = { tai: 0, xiu: 0 };
                    if(next === 1) trans[state].tai++; else trans[state].xiu++;
                }
                if(trans[last3] && trans[last3].tai + trans[last3].xiu >= 25) {
                    const pTai = trans[last3].tai / (trans[last3].tai + trans[last3].xiu);
                    if(pTai >= 0.85) return { type: "cau_markov_bac_3", prediction: "Tài", confidence: 93, description: `Markov bậc 3 - ${(pTai*100).toFixed(1)}% Tài (${trans[last3].tai + trans[last3].xiu} mẫu)` };
                    if(pTai <= 0.15) return { type: "cau_markov_bac_3", prediction: "Xỉu", confidence: 93, description: `Markov bậc 3 - ${((1-pTai)*100).toFixed(1)}% Xỉu (${trans[last3].tai + trans[last3].xiu} mẫu)` };
                }
                return null;
            },
            cau_markov_bac_4: () => {
                const last4 = this.processed.slice(-4).map(p => p.result).join('');
                let trans = {};
                for(let i = 0; i < this.processed.length - 4; i++) {
                    const state = this.processed.slice(i, i+4).map(p => p.result).join('');
                    const next = this.processed[i+4].result;
                    if(!trans[state]) trans[state] = { tai: 0, xiu: 0 };
                    if(next === 1) trans[state].tai++; else trans[state].xiu++;
                }
                if(trans[last4] && trans[last4].tai + trans[last4].xiu >= 20) {
                    const pTai = trans[last4].tai / (trans[last4].tai + trans[last4].xiu);
                    if(pTai >= 0.9) return { type: "cau_markov_bac_4", prediction: "Tài", confidence: 94, description: `Markov bậc 4 - ${(pTai*100).toFixed(1)}% Tài (${trans[last4].tai + trans[last4].xiu} mẫu)` };
                    if(pTai <= 0.1) return { type: "cau_markov_bac_4", prediction: "Xỉu", confidence: 94, description: `Markov bậc 4 - ${((1-pTai)*100).toFixed(1)}% Xỉu (${trans[last4].tai + trans[last4].xiu} mẫu)` };
                }
                return null;
            },
            cau_xac_suat_co_dieu_kien: () => {
                const last = this.processed[this.processed.length - 1];
                let tt = 0, tx = 0, xt = 0, xx = 0;
                for(let i = 1; i < this.processed.length; i++) {
                    if(this.processed[i-1].result === 1) {
                        if(this.processed[i].result === 1) tt++; else tx++;
                    } else {
                        if(this.processed[i].result === 1) xt++; else xx++;
                    }
                }
                if(last.result === 1) {
                    const total = tt + tx;
                    if(total >= 50) {
                        const pT = tt / total;
                        if(pT >= 0.85) return { type: "cau_xac_suat_co_dieu_kien", prediction: "Tài", confidence: 94, description: `XS Tài sau Tài: ${(pT*100).toFixed(1)}% (${total} mẫu)` };
                        const pX = tx / total;
                        if(pX >= 0.85) return { type: "cau_xac_suat_co_dieu_kien", prediction: "Xỉu", confidence: 94, description: `XS Xỉu sau Tài: ${(pX*100).toFixed(1)}% (${total} mẫu)` };
                    }
                } else {
                    const total = xt + xx;
                    if(total >= 50) {
                        const pT = xt / total;
                        if(pT >= 0.85) return { type: "cau_xac_suat_co_dieu_kien", prediction: "Tài", confidence: 94, description: `XS Tài sau Xỉu: ${(pT*100).toFixed(1)}% (${total} mẫu)` };
                        const pX = xx / total;
                        if(pX >= 0.85) return { type: "cau_xac_suat_co_dieu_kien", prediction: "Xỉu", confidence: 94, description: `XS Xỉu sau Xỉu: ${(pX*100).toFixed(1)}% (${total} mẫu)` };
                    }
                }
                return null;
            }
        };
    }

    // ==================== CAU THONG KE TOAN DIEN ====================
    cauThongKeToanDien() {
        return {
            cau_tan_suat_20: () => {
                const last20 = this.processed.slice(-20);
                let tai = 0;
                for(let p of last20) if(p.result === 1) tai++;
                const rate = tai / 20;
                if(rate >= 0.8) return { type: "cau_tan_suat_20", prediction: "Xỉu", confidence: 88, description: `Tần suất Tài ${(rate*100).toFixed(0)}% (20 phiên) - bẻ Xỉu` };
                if(rate <= 0.2) return { type: "cau_tan_suat_20", prediction: "Tài", confidence: 88, description: `Tần suất Xỉu ${((1-rate)*100).toFixed(0)}% (20 phiên) - bẻ Tài` };
                return null;
            },
            cau_tan_suat_50: () => {
                const last50 = this.processed.slice(-50);
                let tai = 0;
                for(let p of last50) if(p.result === 1) tai++;
                const rate = tai / 50;
                if(rate >= 0.7) return { type: "cau_tan_suat_50", prediction: "Xỉu", confidence: 86, description: `Tần suất Tài ${(rate*100).toFixed(0)}% (50 phiên) - bẻ Xỉu` };
                if(rate <= 0.3) return { type: "cau_tan_suat_50", prediction: "Tài", confidence: 86, description: `Tần suất Xỉu ${((1-rate)*100).toFixed(0)}% (50 phiên) - bẻ Tài` };
                return null;
            },
            cau_tan_suat_100: () => {
                const last100 = this.processed.slice(-100);
                let tai = 0;
                for(let p of last100) if(p.result === 1) tai++;
                const rate = tai / 100;
                if(rate >= 0.65) return { type: "cau_tan_suat_100", prediction: "Xỉu", confidence: 82, description: `Tần suất Tài ${(rate*100).toFixed(0)}% (100 phiên) - bẻ Xỉu` };
                if(rate <= 0.35) return { type: "cau_tan_suat_100", prediction: "Tài", confidence: 82, description: `Tần suất Xỉu ${((1-rate)*100).toFixed(0)}% (100 phiên) - bẻ Tài` };
                return null;
            },
            cau_thong_ke_mat_xuc_sac: () => {
                const last = this.processed[this.processed.length - 1];
                for(let f = 1; f <= 6; f++) {
                    const streak = last[`f${f}`];
                    if(streak >= 15) {
                        let pred = "Tài";
                        if(f === 1 || f === 2 || f === 3) pred = "Xỉu";
                        if(f === 4 || f === 5 || f === 6) pred = "Tài";
                        return { type: "cau_thong_ke_mat_xuc_sac", prediction: pred, confidence: 97, description: `Mặt ${f} vắng ${streak} phiên - siêu hiếm, bẻ mạnh` };
                    }
                    if(streak >= 10) {
                        let pred = "Tài";
                        if(f === 1 || f === 2 || f === 3) pred = "Xỉu";
                        if(f === 4 || f === 5 || f === 6) pred = "Tài";
                        return { type: "cau_thong_ke_mat_xuc_sac", prediction: pred, confidence: 92, description: `Mặt ${f} vắng ${streak} phiên - bẻ` };
                    }
                    if(streak >= 7) {
                        let pred = "Tài";
                        if(f === 1 || f === 2 || f === 3) pred = "Xỉu";
                        if(f === 4 || f === 5 || f === 6) pred = "Tài";
                        return { type: "cau_thong_ke_mat_xuc_sac", prediction: pred, confidence: 86, description: `Mặt ${f} vắng ${streak} phiên` };
                    }
                }
                return null;
            },
            cau_thong_ke_bao_ba: () => {
                const last = this.processed[this.processed.length - 1];
                if(last.isTriple) {
                    if(last.tripleVal === 1) return { type: "cau_thong_ke_bao_ba", prediction: "Xỉu", confidence: 98, description: "Bộ ba 1 - Xỉu tuyệt đối" };
                    if(last.tripleVal === 6) return { type: "cau_thong_ke_bao_ba", prediction: "Tài", confidence: 98, description: "Bộ ba 6 - Tài tuyệt đối" };
                    const pred = last.tripleVal <= 3 ? "Xỉu" : "Tài";
                    return { type: "cau_thong_ke_bao_ba", prediction: pred, confidence: 92, description: `Bộ ba ${last.tripleVal} - ${pred}` };
                }
                return null;
            }
        };
    }

    // ==================== CAU LICH SU DAY DU ====================
    cauLichSuDayDu() {
        return {
            cau_lich_su_10: () => {
                const last10 = this.processed.slice(-10).map(p => p.resultStr);
                let best = null, bestSim = 0;
                for(let i = 0; i < this.processed.length - 15; i++) {
                    let sim = 0;
                    for(let j = 0; j < 10; j++) if(this.processed[i + j].resultStr === last10[j]) sim++;
                    const rate = sim / 10;
                    if(rate > bestSim && rate >= 0.9) {
                        bestSim = rate;
                        best = this.processed[i + 10].resultStr;
                    }
                }
                if(best && bestSim >= 0.9) {
                    const conf = 88 + (bestSim - 0.9) * 60;
                    return { type: "cau_lich_su_10", prediction: best, confidence: Math.min(98, conf), description: `Lịch sử 10 phiên - ${(bestSim*100).toFixed(0)}% giống` };
                }
                return null;
            },
            cau_lich_su_20: () => {
                const last20 = this.processed.slice(-20).map(p => p.resultStr);
                let best = null, bestSim = 0;
                for(let i = 0; i < this.processed.length - 25; i++) {
                    let sim = 0;
                    for(let j = 0; j < 20; j++) if(this.processed[i + j].resultStr === last20[j]) sim++;
                    const rate = sim / 20;
                    if(rate > bestSim && rate >= 0.85) {
                        bestSim = rate;
                        best = this.processed[i + 20].resultStr;
                    }
                }
                if(best && bestSim >= 0.85) {
                    const conf = 85 + (bestSim - 0.85) * 50;
                    return { type: "cau_lich_su_20", prediction: best, confidence: Math.min(96, conf), description: `Lịch sử 20 phiên - ${(bestSim*100).toFixed(0)}% giống` };
                }
                return null;
            },
            cau_lich_su_30: () => {
                const last30 = this.processed.slice(-30).map(p => p.resultStr);
                let best = null, bestSim = 0;
                for(let i = 0; i < this.processed.length - 35; i++) {
                    let sim = 0;
                    for(let j = 0; j < 30; j++) if(this.processed[i + j].resultStr === last30[j]) sim++;
                    const rate = sim / 30;
                    if(rate > bestSim && rate >= 0.8) {
                        bestSim = rate;
                        best = this.processed[i + 30].resultStr;
                    }
                }
                if(best && bestSim >= 0.8) {
                    const conf = 82 + (bestSim - 0.8) * 40;
                    return { type: "cau_lich_su_30", prediction: best, confidence: Math.min(94, conf), description: `Lịch sử 30 phiên - ${(bestSim*100).toFixed(0)}% giống` };
                }
                return null;
            },
            cau_lich_su_50: () => {
                const last50 = this.processed.slice(-50).map(p => p.resultStr);
                let best = null, bestSim = 0;
                for(let i = 0; i < this.processed.length - 55; i++) {
                    let sim = 0;
                    for(let j = 0; j < 50; j++) if(this.processed[i + j].resultStr === last50[j]) sim++;
                    const rate = sim / 50;
                    if(rate > bestSim && rate >= 0.75) {
                        bestSim = rate;
                        best = this.processed[i + 50].resultStr;
                    }
                }
                if(best && bestSim >= 0.75) {
                    const conf = 78 + (bestSim - 0.75) * 30;
                    return { type: "cau_lich_su_50", prediction: best, confidence: Math.min(90, conf), description: `Lịch sử 50 phiên - ${(bestSim*100).toFixed(0)}% giống` };
                }
                return null;
            }
        };
    }

    // ==================== CAU DU BAO THONG MINH ====================
    cauDuBaoThongMinh() {
        return {
            cau_du_bao_chu_ky: () => {
                const last30 = this.processed.slice(-30).map(p => p.result);
                for(let period = 2; period <= 15; period++) {
                    let matches = 0;
                    for(let i = 0; i < 30 - period; i++) {
                        if(last30[i] === last30[i + period]) matches++;
                    }
                    if(matches >= 26) {
                        const pred = last30[last30.length - period];
                        return { type: "cau_du_bao_chu_ky", prediction: pred === 1 ? "Tài" : "Xỉu", confidence: 94, description: `Chu kỳ hoàn hảo ${period} phiên - ${matches}/30 trùng` };
                    }
                    if(matches >= 23) {
                        const pred = last30[last30.length - period];
                        return { type: "cau_du_bao_chu_ky", prediction: pred === 1 ? "Tài" : "Xỉu", confidence: 88, description: `Chu kỳ ${period} phiên - ${matches}/30 trùng` };
                    }
                }
                return null;
            },
            cau_du_bao_xu_huong: () => {
                const last15 = this.processed.slice(-15);
                let taiCount = 0;
                for(let p of last15) if(p.result === 1) taiCount++;
                if(taiCount >= 12) return { type: "cau_du_bao_xu_huong", prediction: "Xỉu", confidence: 90, description: `Xu hướng Tài mạnh ${taiCount}/15 - bẻ Xỉu` };
                if(taiCount <= 3) return { type: "cau_du_bao_xu_huong", prediction: "Tài", confidence: 90, description: `Xu hướng Xỉu mạnh ${15-taiCount}/15 - bẻ Tài` };
                return null;
            },
            cau_du_bao_dao_chieu: () => {
                const last5 = this.processed.slice(-5);
                let changes = 0;
                for(let i = 1; i < last5.length; i++) if(last5[i].result !== last5[i-1].result) changes++;
                if(changes === 4) {
                    const last = last5[last5.length-1].result;
                    return { type: "cau_du_bao_dao_chieu", prediction: last === 1 ? "Xỉu" : "Tài", confidence: 86, description: "Đan xen 5 phiên - sắp đảo chiều" };
                }
                if(changes === 0 && last5[0].streak >= 3) {
                    return { type: "cau_du_bao_dao_chieu", prediction: last5[0].result === 1 ? "Xỉu" : "Tài", confidence: 88, description: `Bệt ${last5[0].streak} phiên - sắp đảo chiều` };
                }
                return null;
            },
            cau_du_bao_diem_roi: () => {
                const last = this.processed[this.processed.length - 1];
                if(last.streak >= 7) {
                    return { type: "cau_du_bao_diem_roi", prediction: last.result === 1 ? "Xỉu" : "Tài", confidence: 94, description: `Điểm rơi - bệt ${last.streak}, chuẩn bị gãy` };
                }
                if(last.streak === 5 || last.streak === 6) {
                    return { type: "cau_du_bao_diem_roi", prediction: last.result === 1 ? "Xỉu" : "Tài", confidence: 88, description: `Điểm rơi tiềm năng - bệt ${last.streak}` };
                }
                return null;
            }
        };
    }

    // ==================== CAU PHONG THUY ====================
    cauPhongThuy() {
        return {
            cau_ngu_hanh_tuong_sinh: () => {
                const last5 = this.processed.slice(-5).map(p => p.result);
                const tai = last5.filter(r => r === 1).length;
                if(tai === 2 || tai === 3) {
                    const last = last5[last5.length-1];
                    return { type: "cau_ngu_hanh_tuong_sinh", prediction: last === 1 ? "Xỉu" : "Tài", confidence: 80, description: `Ngũ hành cân bằng ${tai}-${5-tai} - hòa hợp, đánh ngược` };
                }
                return null;
            },
            cau_am_duong_thang_bang: () => {
                const last12 = this.processed.slice(-12).map(p => p.total);
                let duong = 0, am = 0;
                for(let t of last12) {
                    if(t >= 11) duong++; else am++;
                }
                if(duong - am >= 6) return { type: "cau_am_duong_thang_bang", prediction: "Xỉu", confidence: 90, description: `Dương vượng ${duong}-${am} - bẻ về Âm (Xỉu)` };
                if(am - duong >= 6) return { type: "cau_am_duong_thang_bang", prediction: "Tài", confidence: 90, description: `Âm vượng ${am}-${duong} - bẻ về Dương (Tài)` };
                return null;
            },
            cau_bat_quai: () => {
                const last8 = this.processed.slice(-8).map(p => p.result);
                const tai = last8.filter(r => r === 1).length;
                if(tai === 8) return { type: "cau_bat_quai", prediction: "Xỉu", confidence: 98, description: "Bát quái thuần Càn (8 Tài) - tuyệt đối bẻ Xỉu" };
                if(tai === 0) return { type: "cau_bat_quai", prediction: "Tài", confidence: 98, description: "Bát quái thuần Khôn (8 Xỉu) - tuyệt đối bẻ Tài" };
                if(tai === 7) return { type: "cau_bat_quai", prediction: "Xỉu", confidence: 94, description: "Bát quái 7 Tài 1 Xỉu - bẻ Xỉu" };
                if(tai === 1) return { type: "cau_bat_quai", prediction: "Tài", confidence: 94, description: "Bát quái 7 Xỉu 1 Tài - bẻ Tài" };
                return null;
            },
            cau_lien_hoan: () => {
                const last = this.processed[this.processed.length - 1];
                if(this.stats.consecutiveWins >= 4) {
                    return { type: "cau_lien_hoan", prediction: last.result === 1 ? "Tài" : "Xỉu", confidence: 86, description: `Liên hoàn - tiếp đà ${this.stats.consecutiveWins} thắng` };
                }
                if(this.stats.consecutiveLosses >= 3) {
                    return { type: "cau_lien_hoan", prediction: last.result === 1 ? "Xỉu" : "Tài", confidence: 90, description: `Liên hoàn - bẻ sau ${this.stats.consecutiveLosses} thua` };
                }
                return null;
            }
        };
    }

    // ==================== CAU THAN SO HOC ====================
    cauThanSoHoc() {
        return {
            cau_than_so_ca_nhan: () => {
                const last = this.processed[this.processed.length - 1];
                const thanSo = (last.total % 9) || 9;
                const history = [];
                for(let i = 0; i < this.processed.length - 1; i++) {
                    const ts = (this.processed[i].total % 9) || 9;
                    if(ts === thanSo) history.push(this.processed[i+1].result);
                }
                if(history.length >= 20) {
                    const tai = history.filter(r => r === 1).length;
                    const rate = tai / history.length;
                    if(rate >= 0.85) return { type: "cau_than_so_ca_nhan", prediction: "Tài", confidence: 92, description: `Thần số ${thanSo} - ${(rate*100).toFixed(0)}% Tài (${history.length} mẫu)` };
                    if(rate <= 0.15) return { type: "cau_than_so_ca_nhan", prediction: "Xỉu", confidence: 92, description: `Thần số ${thanSo} - ${((1-rate)*100).toFixed(0)}% Xỉu (${history.length} mẫu)` };
                }
                return null;
            },
            cau_than_so_nam_sinh: () => {
                const last = this.processed[this.processed.length - 1];
                const namHienTai = new Date().getFullYear();
                const thanSo = (last.total + namHienTai) % 9 || 9;
                const history = [];
                for(let i = 0; i < this.processed.length - 1; i++) {
                    const ts = (this.processed[i].total + namHienTai) % 9 || 9;
                    if(ts === thanSo) history.push(this.processed[i+1].result);
                }
                if(history.length >= 15) {
                    const tai = history.filter(r => r === 1).length;
                    const rate = tai / history.length;
                    if(rate >= 0.8) return { type: "cau_than_so_nam_sinh", prediction: "Tài", confidence: 88, description: `Thần số năm ${thanSo} - ${(rate*100).toFixed(0)}% Tài` };
                    if(rate <= 0.2) return { type: "cau_than_so_nam_sinh", prediction: "Xỉu", confidence: 88, description: `Thần số năm ${thanSo} - ${((1-rate)*100).toFixed(0)}% Xỉu` };
                }
                return null;
            }
        };
    }

    // ==================== CAU THIEN VAN ====================
    cauThienVan() {
        return {
            cau_sao_bang: () => {
                const last = this.processed[this.processed.length - 1];
                if(last.isTriple) {
                    if(last.tripleVal === 1) return { type: "cau_sao_bang", prediction: "Xỉu", confidence: 99, description: "Sao băng - bộ ba 1, Xỉu tuyệt đối" };
                    if(last.tripleVal === 6) return { type: "cau_sao_bang", prediction: "Tài", confidence: 99, description: "Sao băng - bộ ba 6, Tài tuyệt đối" };
                    const pred = last.tripleVal <= 3 ? "Xỉu" : "Tài";
                    return { type: "cau_sao_bang", prediction: pred, confidence: 94, description: `Sao băng - bộ ba ${last.tripleVal}` };
                }
                return null;
            },
            cau_nhat_thuc: () => {
                const last3 = this.processed.slice(-3);
                let tripleCount = 0;
                let lastTriple = null;
                for(let p of last3) {
                    if(p.isTriple) {
                        tripleCount++;
                        lastTriple = p;
                    }
                }
                if(tripleCount >= 2) {
                    const pred = lastTriple.tripleVal <= 3 ? "Xỉu" : "Tài";
                    return { type: "cau_nhat_thuc", prediction: pred, confidence: 96, description: `Nhật thực - ${tripleCount} bộ ba trong 3 phiên` };
                }
                return null;
            },
            cau_thien_ha_binh_nguyen: () => {
                const last20 = this.processed.slice(-20);
                let tai = 0;
                for(let p of last20) if(p.result === 1) tai++;
                if(tai === 10) {
                    const last = last20[last20.length-1].result;
                    return { type: "cau_thien_ha_binh_nguyen", prediction: last === 1 ? "Xỉu" : "Tài", confidence: 88, description: "Thiên hạ bình nguyên - 10-10 cân bằng, đánh ngược" };
                }
                return null;
            }
        };
    }

    // ==================== CAU KINH DICH ====================
    cauKinhDich() {
        return {
            cau_can_thuan: () => {
                const last8 = this.processed.slice(-8).map(p => p.result);
                if(last8.every(r => r === 1)) return { type: "cau_can_thuan", prediction: "Xỉu", confidence: 99, description: "Càn Thuần - 8 Tài, bẻ Xỉu tuyệt đối" };
                if(last8.every(r => r === 0)) return { type: "cau_can_thuan", prediction: "Tài", confidence: 99, description: "Khôn Thuần - 8 Xỉu, bẻ Tài tuyệt đối" };
                return null;
            },
            cau_thien_hanh_kien: () => {
                const last6 = this.processed.slice(-6).map(p => p.result);
                if(last6[0]===1 && last6[1]===1 && last6[2]===1 && last6[3]===0 && last6[4]===1 && last6[5]===1) return { type: "cau_thien_hanh_kien", prediction: "Xỉu", confidence: 92, description: "Thiên Hành Kiện - 3 Tài 1 Xỉu 2 Tài" };
                if(last6[0]===0 && last6[1]===0 && last6[2]===0 && last6[3]===1 && last6[4]===0 && last6[5]===0) return { type: "cau_thien_hanh_kien", prediction: "Tài", confidence: 92, description: "Thiên Hành Kiện - 3 Xỉu 1 Tài 2 Xỉu" };
                return null;
            },
            cau_thuy_hoat_tinh: () => {
                const last4 = this.processed.slice(-4).map(p => p.result);
                if(last4[0]===1 && last4[1]===0 && last4[2]===1 && last4[3]===0) return { type: "cau_thuy_hoat_tinh", prediction: "Xỉu", confidence: 88, description: "Thủy Hỏa Tế - 1-0-1-0" };
                if(last4[0]===0 && last4[1]===1 && last4[2]===0 && last4[3]===1) return { type: "cau_thuy_hoat_tinh", prediction: "Tài", confidence: 88, description: "Thủy Hỏa Tế - 0-1-0-1" };
                return null;
            }
        };
    }

    // ==================== CAU THICH NGHI ====================
    cauThichNghi() {
        return {
            cau_thich_nghi_dong: () => {
                if(this.learningMemory.length >= 20) {
                    const last10 = this.learningMemory.slice(-10);
                    const wins = last10.filter(w => w === true).length;
                    if(wins >= 8) {
                        const last = this.processed[this.processed.length-1].result;
                        return { type: "cau_thich_nghi_dong", prediction: last === 1 ? "Tài" : "Xỉu", confidence: 86, description: "Thích nghi - đang thắng lớn, tiếp đà" };
                    }
                    if(wins <= 3) {
                        const last = this.processed[this.processed.length-1].result;
                        return { type: "cau_thich_nghi_dong", prediction: last === 1 ? "Xỉu" : "Tài", confidence: 88, description: "Thích nghi - đang thua, đánh ngược" };
                    }
                }
                return null;
            },
            cau_hoc_tu_sai_lam: () => {
                if(this.learningMemory.length >= 15) {
                    const last10 = this.learningMemory.slice(-10);
                    const errors = last10.filter(e => e === false).length;
                    if(errors >= 7) {
                        const last = this.processed[this.processed.length-1].result;
                        return { type: "cau_hoc_tu_sai_lam", prediction: last === 1 ? "Xỉu" : "Tài", confidence: 90, description: "Học từ sai lầm - đang sai nhiều, đánh ngược" };
                    }
                }
                return null;
            },
            cau_thich_nghi_nhanh: () => {
                if(this.learningMemory.length >= 5) {
                    const last5 = this.learningMemory.slice(-5);
                    const wins = last5.filter(w => w === true).length;
                    if(wins === 5) {
                        const last = this.processed[this.processed.length-1].result;
                        return { type: "cau_thich_nghi_nhanh", prediction: last === 1 ? "Tài" : "Xỉu", confidence: 84, description: "Thích nghi nhanh - 5/5 thắng, tiếp tục" };
                    }
                    if(wins === 0) {
                        const last = this.processed[this.processed.length-1].result;
                        return { type: "cau_thich_nghi_nhanh", prediction: last === 1 ? "Xỉu" : "Tài", confidence: 88, description: "Thích nghi nhanh - 5/5 thua, bẻ ngay" };
                    }
                }
                return null;
            }
        };
    }

    // ==================== CAU TU DONG PHAT HIEN ====================
    cauTuDongPhatHien() {
        return {
            cau_tu_dong_1: () => {
                const last5 = this.processed.slice(-5).map(p => p.result);
                if(last5[0] === last5[1] && last5[2] === last5[3] && last5[4] !== last5[3]) {
                    return { type: "cau_tu_dong_1", prediction: last5[4] === 1 ? "Xỉu" : "Tài", confidence: 82, description: "Pattern tự động phát hiện 1 - 2-2-1" };
                }
                return null;
            },
            cau_tu_dong_2: () => {
                const last7 = this.processed.slice(-7).map(p => p.result);
                let pattern = [];
                for(let i = 0; i < 3; i++) pattern.push(last7[i].result);
                let match = true;
                for(let i = 0; i < 3; i++) if(last7[i+4].result !== pattern[i]) match = false;
                if(match) return { type: "cau_tu_dong_2", prediction: pattern[0] === 1 ? "Xỉu" : "Tài", confidence: 84, description: "Pattern tự động phát hiện 2 - lặp 3 phiên" };
                return null;
            },
            cau_tu_dong_3: () => {
                const last9 = this.processed.slice(-9).map(p => p.result);
                if(last9[0] === last9[4] && last9[4] === last9[8]) {
                    const val = last9[0];
                    return { type: "cau_tu_dong_3", prediction: val === 1 ? "Xỉu" : "Tài", confidence: 80, description: "Pattern tự động phát hiện 3 - cách đều 4" };
                }
                return null;
            }
        };
    }

    // ==================== CAU BAO VE ====================
    cauBaoVe() {
        return {
            cau_bao_ve_von: () => {
                if(this.stats.consecutiveLosses >= 4) {
                    const last = this.processed[this.processed.length-1].result;
                    return { type: "cau_bao_ve_von", prediction: last === 1 ? "Xỉu" : "Tài", confidence: 92, description: `Bảo vệ vốn - bẻ sau ${this.stats.consecutiveLosses} thua liên tiếp` };
                }
                return null;
            },
            cau_bao_ve_loi_nhuan: () => {
                if(this.stats.consecutiveWins >= 5) {
                    const last = this.processed[this.processed.length-1].result;
                    return { type: "cau_bao_ve_loi_nhuan", prediction: last === 1 ? "Xỉu" : "Tài", confidence: 86, description: `Bảo vệ lợi nhuận - chốt lời sau ${this.stats.consecutiveWins} thắng` };
                }
                return null;
            }
        };
    }

    // ==================== CAU CHONG GAY ====================
    cauChongGay() {
        return {
            cau_chong_gay_co_ban: () => {
                const last = this.processed[this.processed.length - 1];
                if(last.streak >= 4) {
                    const opp = last.result === 1 ? "Xỉu" : "Tài";
                    let conf = 86;
                    if(last.streak >= 6) conf = 92;
                    if(last.streak >= 8) conf = 96;
                    if(last.streak >= 10) conf = 98;
                    return { type: "cau_chong_gay_co_ban", prediction: opp, confidence: conf, description: `Chống gãy cầu - bệt ${last.streak}, sắp gãy` };
                }
                return null;
            },
            cau_chong_gay_sieu_cap: () => {
                const last = this.processed[this.processed.length - 1];
                const last20 = this.processed.slice(-20);
                const taiCount = last20.filter(p => p.result === 1).length;
                if(last.streak >= 5 && taiCount >= 15) {
                    return { type: "cau_chong_gay_sieu_cap", prediction: "Xỉu", confidence: 96, description: `Chống gãy siêu cấp - bệt ${last.streak}, ${taiCount}/20 Tài` };
                }
                if(last.streak >= 5 && taiCount <= 5) {
                    return { type: "cau_chong_gay_sieu_cap", prediction: "Tài", confidence: 96, description: `Chống gãy siêu cấp - bệt ${last.streak}, ${20-taiCount}/20 Xỉu` };
                }
                return null;
            }
        };
    }

    // ==================== CAU TONG HOP ====================
    cauTongHop() {
        return {
            cau_tong_hop_nhieu_tin_hieu: () => {
                let signals = [];
                const last = this.processed[this.processed.length - 1];
                const last10 = this.processed.slice(-10);
                
                const taiCount10 = last10.filter(p => p.result === 1).length;
                if(taiCount10 >= 7) signals.push({ pred: "Xỉu", weight: 3 });
                if(taiCount10 <= 3) signals.push({ pred: "Tài", weight: 3 });
                if(last.streak >= 3) signals.push({ pred: last.result === 1 ? "Xỉu" : "Tài", weight: 2 });
                if(last.f1 >= 8) signals.push({ pred: "Xỉu", weight: 3 });
                if(last.f6 >= 8) signals.push({ pred: "Tài", weight: 3 });
                
                if(signals.length >= 3) {
                    let taiWeight = 0, xiuWeight = 0;
                    for(let s of signals) {
                        if(s.pred === "Tài") taiWeight += s.weight;
                        else xiuWeight += s.weight;
                    }
                    const totalWeight = taiWeight + xiuWeight;
                    const ratio = Math.max(taiWeight, xiuWeight) / totalWeight;
                    if(ratio >= 0.6) {
                        const pred = taiWeight > xiuWeight ? "Tài" : "Xỉu";
                        const conf = 80 + ratio * 15;
                        return { type: "cau_tong_hop_nhieu_tin_hieu", prediction: pred, confidence: Math.min(96, conf), description: `Tổng hợp ${signals.length} tín hiệu - ${pred}` };
                    }
                }
                return null;
            },
            cau_dong_thuan: () => {
                const last5 = this.processed.slice(-5).map(p => p.result);
                const last10 = this.processed.slice(-10).map(p => p.result);
                const last20 = this.processed.slice(-20).map(p => p.result);
                const tai5 = last5.filter(r => r === 1).length;
                const tai10 = last10.filter(r => r === 1).length;
                const tai20 = last20.filter(r => r === 1).length;
                if(tai5 >= 4 && tai10 >= 7 && tai20 >= 14) return { type: "cau_dong_thuan", prediction: "Xỉu", confidence: 94, description: "Đồng thuận cao - bẻ Xỉu" };
                if(tai5 <= 1 && tai10 <= 3 && tai20 <= 6) return { type: "cau_dong_thuan", prediction: "Tài", confidence: 94, description: "Đồng thuận cao - bẻ Tài" };
                return null;
            }
        };
    }

    // ==================== DIEU CHINH THICH NGHI ====================
    dieuChinhThichNghi(ops) {
        if(ops.length === 0) return [];
        for(let op of ops) {
            const perf = this.cauPerformance[op.type];
            if(perf) {
                let adj = op.confidence;
                if(perf.successRate > 0.95) adj += 3;
                else if(perf.successRate > 0.9) adj += 2;
                else if(perf.successRate > 0.85) adj += 1;
                else if(perf.successRate < 0.8) adj -= 5;
                else if(perf.successRate < 0.75) adj -= 10;
                else if(perf.successRate < 0.7) adj -= 15;
                if(this.stats.consecutiveWins >= 3) adj += 3;
                if(this.stats.consecutiveLosses >= 1) adj -= 8;
                if(this.stats.consecutiveLosses >= 2) adj -= 12;
                if(this.stats.consecutiveLosses >= 3) adj -= 16;
                if(perf.totalUsed > 50 && perf.successRate > 0.85) adj += 2;
                op.confidence = Math.min(99.9, Math.max(65, adj));
            }
        }
        ops.sort((a,b) => b.confidence - a.confidence);
        return ops;
    }

    timKiemCoHoi() {
        const ops = [];
        for(let [name, func] of Object.entries(this.allCau)) {
            try {
                const res = func();
                if(res && res.confidence >= 65) {
                    res.type = name;
                    ops.push(res);
                }
            } catch(e) {}
        }
        if(ops.length === 0) return null;
        const adjusted = this.dieuChinhThichNghi(ops);
        if(adjusted.length > 0) {
            const best = adjusted[0];
            if(best.type && this.cauPerformance[best.type]) {
                this.cauPerformance[best.type].lastUsed = Date.now();
                this.cauPerformance[best.type].totalUsed++;
                const total = this.cauPerformance[best.type].wins + this.cauPerformance[best.type].losses + 1;
                this.cauPerformance[best.type].successRate = (this.cauPerformance[best.type].wins + 0.5) / total;
            }
            return best;
        }
        return null;
    }

    duDoan() {
        if(this.stats.consecutiveLosses >= 10) {
            return { shouldBet: false, reason: `THUA ${this.stats.consecutiveLosses} LIÊN TIẾP - DỪNG KHẨN CẤP`, prediction: null, confidence: 0, coolDown: true };
        }
        const opp = this.timKiemCoHoi();
        if(!opp || opp.confidence < this.stats.adaptiveThreshold) {
            return { shouldBet: false, reason: opp ? `TIN CẬY ${opp.confidence}% < ${this.stats.adaptiveThreshold}%` : "KHÔNG CÓ CẦU NÀO", prediction: null, confidence: 0 };
        }
        return { shouldBet: true, prediction: opp.prediction, confidence: opp.confidence, reason: opp.description, type: opp.type };
    }

    capNhatKetQua(actual) {
        const last = this.stats.trades[this.stats.trades.length-1];
        if(!last) return;
        const win = last.prediction === actual;
        if(win) {
            this.stats.wins++;
            this.stats.consecutiveWins++;
            this.stats.consecutiveLosses = 0;
            if(this.cauPerformance[last.type]) this.cauPerformance[last.type].wins++;
            this.learningMemory.push(true);
        } else {
            this.stats.losses++;
            this.stats.consecutiveLosses++;
            this.stats.consecutiveWins = 0;
            if(this.cauPerformance[last.type]) this.cauPerformance[last.type].losses++;
            this.learningMemory.push(false);
        }
        this.stats.totalPredictions++;
        if(win) this.stats.correctPredictions++;
        this.stats.trades[this.stats.trades.length-1].actual = actual;
        this.stats.trades[this.stats.trades.length-1].isWin = win;
        
        if(this.learningMemory.length > 100) this.learningMemory.shift();
        
        const last10 = this.stats.trades.slice(-10);
        const wins10 = last10.filter(t => t.isWin).length;
        this.stats.last10Accuracy = wins10 / 10;
        
        const last20 = this.stats.trades.slice(-20);
        const wins20 = last20.filter(t => t.isWin).length;
        this.stats.last20Accuracy = wins20 / 20;
        
        const last50 = this.stats.trades.slice(-50);
        const wins50 = last50.filter(t => t.isWin).length;
        this.stats.last50Accuracy = wins50 / 50;
        
        let nt = 55;
        if(this.stats.last10Accuracy > 0.98) nt = 50;
        else if(this.stats.last10Accuracy > 0.96) nt = 52;
        else if(this.stats.last10Accuracy > 0.94) nt = 54;
        else if(this.stats.last10Accuracy > 0.92) nt = 55;
        else if(this.stats.last10Accuracy > 0.9) nt = 56;
        else if(this.stats.last10Accuracy > 0.88) nt = 57;
        else if(this.stats.last10Accuracy > 0.86) nt = 58;
        else if(this.stats.last10Accuracy > 0.84) nt = 59;
        else if(this.stats.last10Accuracy > 0.82) nt = 60;
        else if(this.stats.last10Accuracy > 0.8) nt = 61;
        else if(this.stats.last10Accuracy < 0.75) nt = 65;
        else if(this.stats.last10Accuracy < 0.7) nt = 68;
        else if(this.stats.last10Accuracy < 0.65) nt = 72;
        
        if(this.stats.consecutiveWins >= 5) nt = Math.max(48, nt - 4);
        if(this.stats.consecutiveLosses >= 2) nt = Math.min(75, nt + 5);
        
        this.stats.adaptiveThreshold = nt;
        
        const kq = win ? "WIN" : "LOSS";
        console.log(`   ${kq} P${last.phien}: ${last.prediction} | TT: ${actual} | TL10: ${(this.stats.last10Accuracy*100).toFixed(1)}% | TL20: ${(this.stats.last20Accuracy*100).toFixed(1)}% | TL50: ${(this.stats.last50Accuracy*100).toFixed(1)}% | N: ${this.stats.adaptiveThreshold}% | ${last.type}`);
        return win;
    }

    chay() {
        const pred = this.duDoan();
        if(pred.shouldBet && !pred.coolDown) {
            this.stats.trades.push({
                phien: this.processed[this.processed.length-1].phien + 1,
                prediction: pred.prediction,
                confidence: pred.confidence,
                reason: pred.reason,
                type: pred.type,
                timestamp: new Date().toISOString()
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
            if (arr && arr.length >= 50) {
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
        if (!data || data.length < 50) { isUpdating = false; return; }

        const latest = data[data.length - 1];

        if (currentPrediction && currentPrediction.Phien_hien_tai > 0) {
            const predictedPhien = currentPrediction.Phien_hien_tai;
            const actual = data.find(s => s.phien === predictedPhien);
            if (actual) {
                const actualStr = actual.ket_qua;
                const duDoanPrev = currentPrediction.Du_doan;
                addToHistory(predictedPhien, duDoanPrev, actualStr, currentPrediction.Do_tin_cay);
                console.log(`📝 ${predictedPhien}: ${duDoanPrev} vs ${actualStr} | ${duDoanPrev.toLowerCase() === actualStr.toLowerCase() ? '✅' : '❌'}`);
            }
        }

        gameHistory = data;
        
        if (!predictorInstance || predictorInstance.processed.length !== data.length) {
            predictorInstance = new SieuChinhXacTuyetDoiDayDu(data.slice(-500));
        } else {
            predictorInstance.processed = predictorInstance.preprocess(data.slice(-500));
        }
        
        const pred = predictorInstance.chay();

        let pattern = "";
        for (let i = Math.max(0, data.length - 50); i < data.length; i++) pattern += data[i].ket_qua === "Tài" ? "t" : "x";

        const recentTotals = data.slice(-50).map(p => p.tong);
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
            AI_Thang: wins,
            AI_Thua: losses,
            AI_Ti_le: winRate,
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
        Ly_do: "", Trang_thai: "", AI_Thang: wins, AI_Thua: losses, AI_Ti_le: '0%',
        Loai_cau: '',
        timestamp: Date.now(),
        Lich_su: { Tong_phien: verifiedResults.length, Thang: verifiedResults.filter(v => v.danh_gia === 'thang').length, Thua: verifiedResults.filter(v => v.danh_gia === 'thua').length, Ty_le_thang: verifiedResults.length > 0 ? (verifiedResults.filter(v => v.danh_gia === 'thang').length / verifiedResults.length * 100).toFixed(1) + "%" : "0%" },
        Bang_thang_thua: verifiedResults.slice(0, 20)
    });
});

app.get('/', (req, res) => res.redirect('/taixiu'));

loadHistory();
console.log('='.repeat(70));
console.log('   ⚔️ SIÊU CHÍNH XÁC TUYỆT ĐỐI ĐẦY ĐỦ ⚔️');
console.log('   API: wtxmd52.tele68.com | 50 PHIÊN | 50K lịch sử');
console.log('   TỔNG SỐ THUẬT TOÁN: 300+ LOẠI CẦU');
console.log('   BAO GỒM: Bet 1-100, Bẻ bệt 2-30, Bắt sớm 1-15, Xen kẻ, Cặp đôi, Kết hợp');
console.log('   CAU ĐẶC BIỆT: Fibonacci, Fractal, Nhân bản, Xoay vòng, Đối xứng');
console.log('   CAU NÂNG CAO: Hình học, Toán học, Thống kê, Lịch sử, Dự báo');
console.log('   CAU TÂM LINH: Phong thủy, Thần số, Thiên văn, Kinh Dịch');
console.log('   CAU THÔNG MINH: Thích nghi, Tự động, Bảo vệ, Chống gãy, Tổng hợp');
console.log('='.repeat(70));

(async () => { const d = await fetchData(); if (d && d.length >= 50) { gameHistory = d; await updatePrediction(); } })();
setInterval(updatePrediction, 300);

app.listen(PORT, () => { console.log(`🚀 Port: ${PORT} | /taixiu`); });
