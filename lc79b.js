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

class SieuChinhXacBatTatCaCau {
    constructor(data) {
        this.raw = data;
        this.processed = this.preprocess(data);
        this.allCau = this.phatHienTatCaCau();
        
        this.stats = {
            trades: [], wins: 0, losses: 0, consecutiveLosses: 0, consecutiveWins: 0,
            last10Accuracy: 1.0, last20Accuracy: 1.0, last50Accuracy: 1.0,
            adaptiveThreshold: 50,
            totalPredictions: 0,
            correctPredictions: 0
        };
        
        this.cauPerformance = {};
        this.learningMemory = [];
        
        for (let key in this.allCau) {
            this.cauPerformance[key] = {
                wins: 0, losses: 0, confidence: 80, lastUsed: 0,
                successRate: 0.8, totalUsed: 0
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
            
            return {
                phien: item.phien, result: item.ket_qua==="Tài"?1:0, resultStr: item.ket_qua,
                total: item.tong, streak, taiStreak, xiuStreak,
                f1,f2,f3,f4,f5,f6,
                isTriple: dice[0]===dice[1]&&dice[1]===dice[2], tripleVal: dice[0],
                sum: dice[0]+dice[1]+dice[2]
            };
        });
    }

    phatHienTatCaCau() {
        return {
            ...this.betTaiXiu(),
            ...this.beCau(),
            ...this.cauXenKe(),
            ...this.cauCapDoi(),
            ...this.cauDacBiet(),
            ...this.cauThongKe(),
            ...this.cauHinhHoc(),
            ...this.cauLichSu()
        };
    }

    // ==================== BET TAI XIU (1-100) ====================
    betTaiXiu() {
        const obj = {};
        for(let i = 1; i <= 100; i++) {
            obj[`bet_tai_${i}`] = () => {
                const last = this.processed.slice(-i).map(p => p.result);
                if(last.every(r => r === 1)) {
                    let conf = Math.min(99.5, 70 + i * 0.3);
                    return { type: `bet_tai_${i}`, prediction: "Tài", confidence: conf, description: `Bệt Tài ${i} phiên` };
                }
                return null;
            };
            obj[`bet_xiu_${i}`] = () => {
                const last = this.processed.slice(-i).map(p => p.result);
                if(last.every(r => r === 0)) {
                    let conf = Math.min(99.5, 70 + i * 0.3);
                    return { type: `bet_xiu_${i}`, prediction: "Xỉu", confidence: conf, description: `Bệt Xỉu ${i} phiên` };
                }
                return null;
            };
        }
        return obj;
    }

    // ==================== BE CAU (2-30) ====================
    beCau() {
        const obj = {};
        for(let i = 2; i <= 30; i++) {
            obj[`be_tai_${i}`] = () => {
                const last = this.processed.slice(-i).map(p => p.result);
                if(last.every(r => r === 1)) {
                    let conf = 70 + i;
                    if(i >= 10) conf = 82 + (i-10);
                    conf = Math.min(98, conf);
                    return { type: `be_tai_${i}`, prediction: "Xỉu", confidence: conf, description: `Bẻ Tài sau ${i} phiên` };
                }
                return null;
            };
            obj[`be_xiu_${i}`] = () => {
                const last = this.processed.slice(-i).map(p => p.result);
                if(last.every(r => r === 0)) {
                    let conf = 70 + i;
                    if(i >= 10) conf = 82 + (i-10);
                    conf = Math.min(98, conf);
                    return { type: `be_xiu_${i}`, prediction: "Tài", confidence: conf, description: `Bẻ Xỉu sau ${i} phiên` };
                }
                return null;
            };
        }
        return obj;
    }

    // ==================== CAU XEN KE ====================
    cauXenKe() {
        return {
            cau_1_1: () => {
                const last = this.processed.slice(-12).map(p => p.result);
                let alt = true;
                for(let i = 1; i < last.length; i++) if(last[i] === last[i-1]) alt = false;
                if(alt && last.length >= 6) return { type: "cau_1_1", prediction: last[last.length-1] === 1 ? "Xỉu" : "Tài", confidence: 90, description: "Cầu 1-1 xen kẽ" };
                return null;
            },
            cau_2_1: () => {
                const last = this.processed.slice(-3).map(p => p.result);
                if(last[0] === last[1] && last[2] !== last[1]) return { type: "cau_2_1", prediction: last[2] === 1 ? "Xỉu" : "Tài", confidence: 85, description: "Cầu 2-1" };
                return null;
            },
            cau_1_2: () => {
                const last = this.processed.slice(-3).map(p => p.result);
                if(last[0] !== last[1] && last[1] === last[2]) return { type: "cau_1_2", prediction: last[2] === 1 ? "Tài" : "Xỉu", confidence: 85, description: "Cầu 1-2" };
                return null;
            },
            cau_3_1: () => {
                const last = this.processed.slice(-4).map(p => p.result);
                if(last[0]===1 && last[1]===1 && last[2]===1 && last[3]===0) return { type: "cau_3_1", prediction: "Xỉu", confidence: 88, description: "Cầu 3 Tài 1 Xỉu" };
                if(last[0]===0 && last[1]===0 && last[2]===0 && last[3]===1) return { type: "cau_3_1", prediction: "Tài", confidence: 88, description: "Cầu 3 Xỉu 1 Tài" };
                return null;
            },
            cau_1_3: () => {
                const last = this.processed.slice(-4).map(p => p.result);
                if(last[0]===1 && last[1]===0 && last[2]===0 && last[3]===0) return { type: "cau_1_3", prediction: "Xỉu", confidence: 87, description: "Cầu 1 Tài 3 Xỉu" };
                if(last[0]===0 && last[1]===1 && last[2]===1 && last[3]===1) return { type: "cau_1_3", prediction: "Tài", confidence: 87, description: "Cầu 1 Xỉu 3 Tài" };
                return null;
            },
            cau_4_1: () => {
                const last = this.processed.slice(-5).map(p => p.result);
                if(last[0]===1 && last[1]===1 && last[2]===1 && last[3]===1 && last[4]===0) return { type: "cau_4_1", prediction: "Xỉu", confidence: 90, description: "Cầu 4 Tài 1 Xỉu" };
                if(last[0]===0 && last[1]===0 && last[2]===0 && last[3]===0 && last[4]===1) return { type: "cau_4_1", prediction: "Tài", confidence: 90, description: "Cầu 4 Xỉu 1 Tài" };
                return null;
            },
            cau_1_4: () => {
                const last = this.processed.slice(-5).map(p => p.result);
                if(last[0]===1 && last[1]===0 && last[2]===0 && last[3]===0 && last[4]===0) return { type: "cau_1_4", prediction: "Xỉu", confidence: 89, description: "Cầu 1 Tài 4 Xỉu" };
                if(last[0]===0 && last[1]===1 && last[2]===1 && last[3]===1 && last[4]===1) return { type: "cau_1_4", prediction: "Tài", confidence: 89, description: "Cầu 1 Xỉu 4 Tài" };
                return null;
            },
            cau_5_1: () => {
                const last = this.processed.slice(-6).map(p => p.result);
                if(last[0]===1 && last[1]===1 && last[2]===1 && last[3]===1 && last[4]===1 && last[5]===0) return { type: "cau_5_1", prediction: "Xỉu", confidence: 92, description: "Cầu 5 Tài 1 Xỉu" };
                if(last[0]===0 && last[1]===0 && last[2]===0 && last[3]===0 && last[4]===0 && last[5]===1) return { type: "cau_5_1", prediction: "Tài", confidence: 92, description: "Cầu 5 Xỉu 1 Tài" };
                return null;
            },
            cau_1_5: () => {
                const last = this.processed.slice(-6).map(p => p.result);
                if(last[0]===1 && last[1]===0 && last[2]===0 && last[3]===0 && last[4]===0 && last[5]===0) return { type: "cau_1_5", prediction: "Xỉu", confidence: 91, description: "Cầu 1 Tài 5 Xỉu" };
                if(last[0]===0 && last[1]===1 && last[2]===1 && last[3]===1 && last[4]===1 && last[5]===1) return { type: "cau_1_5", prediction: "Tài", confidence: 91, description: "Cầu 1 Xỉu 5 Tài" };
                return null;
            },
            cau_6_1: () => {
                const last = this.processed.slice(-7).map(p => p.result);
                if(last[0]===1 && last[1]===1 && last[2]===1 && last[3]===1 && last[4]===1 && last[5]===1 && last[6]===0) return { type: "cau_6_1", prediction: "Xỉu", confidence: 94, description: "Cầu 6 Tài 1 Xỉu" };
                if(last[0]===0 && last[1]===0 && last[2]===0 && last[3]===0 && last[4]===0 && last[5]===0 && last[6]===1) return { type: "cau_6_1", prediction: "Tài", confidence: 94, description: "Cầu 6 Xỉu 1 Tài" };
                return null;
            },
            cau_1_6: () => {
                const last = this.processed.slice(-7).map(p => p.result);
                if(last[0]===1 && last[1]===0 && last[2]===0 && last[3]===0 && last[4]===0 && last[5]===0 && last[6]===0) return { type: "cau_1_6", prediction: "Xỉu", confidence: 93, description: "Cầu 1 Tài 6 Xỉu" };
                if(last[0]===0 && last[1]===1 && last[2]===1 && last[3]===1 && last[4]===1 && last[5]===1 && last[6]===1) return { type: "cau_1_6", prediction: "Tài", confidence: 93, description: "Cầu 1 Xỉu 6 Tài" };
                return null;
            }
        };
    }

    // ==================== CAU CAP DOI ====================
    cauCapDoi() {
        return {
            cau_2_2: () => {
                const last = this.processed.slice(-4).map(p => p.result);
                if(last[0]===last[1] && last[2]===last[3] && last[0]!==last[2]) return { type: "cau_2_2", prediction: last[3]===1 ? "Xỉu" : "Tài", confidence: 88, description: "Cầu 2-2" };
                return null;
            },
            cau_2_2_2: () => {
                const last = this.processed.slice(-6).map(p => p.result);
                if(last[0]===last[1] && last[2]===last[3] && last[4]===last[5] && last[0]!==last[2] && last[2]!==last[4]) return { type: "cau_2_2_2", prediction: last[5]===1 ? "Xỉu" : "Tài", confidence: 92, description: "Cầu 2-2-2" };
                return null;
            },
            cau_2_2_2_2: () => {
                const last = this.processed.slice(-8).map(p => p.result);
                if(last[0]===last[1] && last[2]===last[3] && last[4]===last[5] && last[6]===last[7] && last[0]!==last[2] && last[2]!==last[4] && last[4]!==last[6]) return { type: "cau_2_2_2_2", prediction: last[7]===1 ? "Xỉu" : "Tài", confidence: 95, description: "Cầu 2-2-2-2" };
                return null;
            },
            cau_3_3: () => {
                const last = this.processed.slice(-6).map(p => p.result);
                if(last[0]===1 && last[1]===1 && last[2]===1 && last[3]===0 && last[4]===0 && last[5]===0) return { type: "cau_3_3", prediction: "Tài", confidence: 90, description: "Cầu 3-3" };
                if(last[0]===0 && last[1]===0 && last[2]===0 && last[3]===1 && last[4]===1 && last[5]===1) return { type: "cau_3_3", prediction: "Xỉu", confidence: 90, description: "Cầu 3-3" };
                return null;
            },
            cau_3_3_3: () => {
                const last = this.processed.slice(-9).map(p => p.result);
                if(last[0]===1 && last[1]===1 && last[2]===1 && last[3]===0 && last[4]===0 && last[5]===0 && last[6]===1 && last[7]===1 && last[8]===1) return { type: "cau_3_3_3", prediction: "Xỉu", confidence: 93, description: "Cầu 3-3-3" };
                if(last[0]===0 && last[1]===0 && last[2]===0 && last[3]===1 && last[4]===1 && last[5]===1 && last[6]===0 && last[7]===0 && last[8]===0) return { type: "cau_3_3_3", prediction: "Tài", confidence: 93, description: "Cầu 3-3-3" };
                return null;
            },
            cau_4_4: () => {
                const last = this.processed.slice(-8).map(p => p.result);
                if(last[0]===1 && last[1]===1 && last[2]===1 && last[3]===1 && last[4]===0 && last[5]===0 && last[6]===0 && last[7]===0) return { type: "cau_4_4", prediction: "Tài", confidence: 92, description: "Cầu 4-4" };
                if(last[0]===0 && last[1]===0 && last[2]===0 && last[3]===0 && last[4]===1 && last[5]===1 && last[6]===1 && last[7]===1) return { type: "cau_4_4", prediction: "Xỉu", confidence: 92, description: "Cầu 4-4" };
                return null;
            },
            cau_4_4_4: () => {
                const last = this.processed.slice(-12).map(p => p.result);
                if(last[0]===1 && last[1]===1 && last[2]===1 && last[3]===1 && last[4]===0 && last[5]===0 && last[6]===0 && last[7]===0 && last[8]===1 && last[9]===1 && last[10]===1 && last[11]===1) return { type: "cau_4_4_4", prediction: "Xỉu", confidence: 95, description: "Cầu 4-4-4" };
                if(last[0]===0 && last[1]===0 && last[2]===0 && last[3]===0 && last[4]===1 && last[5]===1 && last[6]===1 && last[7]===1 && last[8]===0 && last[9]===0 && last[10]===0 && last[11]===0) return { type: "cau_4_4_4", prediction: "Tài", confidence: 95, description: "Cầu 4-4-4" };
                return null;
            },
            cau_5_5: () => {
                const last = this.processed.slice(-10).map(p => p.result);
                if(last[0]===1 && last[1]===1 && last[2]===1 && last[3]===1 && last[4]===1 && last[5]===0 && last[6]===0 && last[7]===0 && last[8]===0 && last[9]===0) return { type: "cau_5_5", prediction: "Tài", confidence: 93, description: "Cầu 5-5" };
                if(last[0]===0 && last[1]===0 && last[2]===0 && last[3]===0 && last[4]===0 && last[5]===1 && last[6]===1 && last[7]===1 && last[8]===1 && last[9]===1) return { type: "cau_5_5", prediction: "Xỉu", confidence: 93, description: "Cầu 5-5" };
                return null;
            },
            cau_5_5_5: () => {
                const last = this.processed.slice(-15).map(p => p.result);
                if(last[0]===1 && last[1]===1 && last[2]===1 && last[3]===1 && last[4]===1 && last[5]===0 && last[6]===0 && last[7]===0 && last[8]===0 && last[9]===0 && last[10]===1 && last[11]===1 && last[12]===1 && last[13]===1 && last[14]===1) return { type: "cau_5_5_5", prediction: "Xỉu", confidence: 96, description: "Cầu 5-5-5" };
                if(last[0]===0 && last[1]===0 && last[2]===0 && last[3]===0 && last[4]===0 && last[5]===1 && last[6]===1 && last[7]===1 && last[8]===1 && last[9]===1 && last[10]===0 && last[11]===0 && last[12]===0 && last[13]===0 && last[14]===0) return { type: "cau_5_5_5", prediction: "Tài", confidence: 96, description: "Cầu 5-5-5" };
                return null;
            },
            cau_6_6: () => {
                const last = this.processed.slice(-12).map(p => p.result);
                if(last[0]===1 && last[1]===1 && last[2]===1 && last[3]===1 && last[4]===1 && last[5]===1 && last[6]===0 && last[7]===0 && last[8]===0 && last[9]===0 && last[10]===0 && last[11]===0) return { type: "cau_6_6", prediction: "Tài", confidence: 94, description: "Cầu 6-6" };
                if(last[0]===0 && last[1]===0 && last[2]===0 && last[3]===0 && last[4]===0 && last[5]===0 && last[6]===1 && last[7]===1 && last[8]===1 && last[9]===1 && last[10]===1 && last[11]===1) return { type: "cau_6_6", prediction: "Xỉu", confidence: 94, description: "Cầu 6-6" };
                return null;
            },
            cau_6_6_6: () => {
                const last = this.processed.slice(-18).map(p => p.result);
                if(last.length>=18 && last[0]===1 && last[1]===1 && last[2]===1 && last[3]===1 && last[4]===1 && last[5]===1 && last[6]===0 && last[7]===0 && last[8]===0 && last[9]===0 && last[10]===0 && last[11]===0 && last[12]===1 && last[13]===1 && last[14]===1 && last[15]===1 && last[16]===1 && last[17]===1) return { type: "cau_6_6_6", prediction: "Xỉu", confidence: 97, description: "Cầu 6-6-6" };
                if(last.length>=18 && last[0]===0 && last[1]===0 && last[2]===0 && last[3]===0 && last[4]===0 && last[5]===0 && last[6]===1 && last[7]===1 && last[8]===1 && last[9]===1 && last[10]===1 && last[11]===1 && last[12]===0 && last[13]===0 && last[14]===0 && last[15]===0 && last[16]===0 && last[17]===0) return { type: "cau_6_6_6", prediction: "Tài", confidence: 97, description: "Cầu 6-6-6" };
                return null;
            }
        };
    }

    // ==================== CAU DAC BIET ====================
    cauDacBiet() {
        return {
            cau_fibonacci: () => {
                const last = this.processed.slice(-34).map(p => p.result);
                const fib = [1,1,2,3,5,8,13,21];
                for(let i=0;i<fib.length-2;i++){
                    const len = fib[i]+fib[i+1];
                    if(last.length>=len){
                        let ok=true;
                        for(let j=0;j<fib[i];j++) if(last[last.length-len+j]!==1) ok=false;
                        if(ok) for(let j=0;j<fib[i+1];j++) if(last[last.length-len+fib[i]+j]!==0) ok=false;
                        if(ok) return { type: "cau_fibonacci", prediction: "Tài", confidence: 92, description: "Cầu Fibonacci" };
                        ok=true;
                        for(let j=0;j<fib[i];j++) if(last[last.length-len+j]!==0) ok=false;
                        if(ok) for(let j=0;j<fib[i+1];j++) if(last[last.length-len+fib[i]+j]!==1) ok=false;
                        if(ok) return { type: "cau_fibonacci", prediction: "Xỉu", confidence: 92, description: "Cầu Fibonacci ngược" };
                    }
                }
                return null;
            },
            cau_doi_xung: () => {
                const last = this.processed.slice(-12).map(p => p.result);
                let sym=true;
                for(let i=0;i<6;i++) if(last[i]!==last[11-i]) sym=false;
                if(sym) return { type: "cau_doi_xung", prediction: last[5]===1?"Xỉu":"Tài", confidence: 90, description: "Cầu đối xứng" };
                return null;
            },
            cau_nhan_ban: () => {
                const last = this.processed.slice(-16).map(p => p.result);
                let ok=true;
                for(let i=0;i<8;i++) if(last[i]!==last[i+8]) ok=false;
                if(ok) return { type: "cau_nhan_ban", prediction: last[8]===1?"Xỉu":"Tài", confidence: 93, description: "Cầu nhân bản" };
                return null;
            },
            cau_xoay_vong: () => {
                const last = this.processed.slice(-16).map(p => p.result);
                const p1=[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0];
                const p2=[0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1];
                let m1=0,m2=0;
                for(let i=0;i<16;i++) { if(last[i]===p1[i]) m1++; if(last[i]===p2[i]) m2++; }
                if(m1>=14) return { type: "cau_xoay_vong", prediction: "Xỉu", confidence: 94, description: "Cầu xoay vòng" };
                if(m2>=14) return { type: "cau_xoay_vong", prediction: "Tài", confidence: 94, description: "Cầu xoay vòng" };
                return null;
            }
        };
    }

    // ==================== CAU THONG KE ====================
    cauThongKe() {
        return {
            cau_tan_suat: () => {
                const last30 = this.processed.slice(-30);
                let tai=0;
                for(let p of last30) if(p.result===1) tai++;
                const rate=tai/30;
                if(rate>=0.7) return { type: "cau_tan_suat", prediction: "Xỉu", confidence: 85, description: `Tần suất Tài ${(rate*100).toFixed(0)}% - bẻ Xỉu` };
                if(rate<=0.3) return { type: "cau_tan_suat", prediction: "Tài", confidence: 85, description: `Tần suất Xỉu ${((1-rate)*100).toFixed(0)}% - bẻ Tài` };
                return null;
            },
            cau_mat_xuc_sac: () => {
                const last = this.processed[this.processed.length-1];
                if(last.f1>=10) return { type: "cau_mat_xuc_sac", prediction: "Xỉu", confidence: 94, description: `Mặt 1 vắng ${last.f1} phiên` };
                if(last.f6>=10) return { type: "cau_mat_xuc_sac", prediction: "Tài", confidence: 94, description: `Mặt 6 vắng ${last.f6} phiên` };
                if(last.f1>=7) return { type: "cau_mat_xuc_sac", prediction: "Xỉu", confidence: 88, description: `Mặt 1 vắng ${last.f1} phiên` };
                if(last.f6>=7) return { type: "cau_mat_xuc_sac", prediction: "Tài", confidence: 88, description: `Mặt 6 vắng ${last.f6} phiên` };
                return null;
            },
            cau_tong_diem: () => {
                const last = this.processed[this.processed.length-1];
                if(last.total<=5) return { type: "cau_tong_diem", prediction: "Xỉu", confidence: 88, description: `Tổng ${last.total} - Xỉu` };
                if(last.total>=15) return { type: "cau_tong_diem", prediction: "Tài", confidence: 88, description: `Tổng ${last.total} - Tài` };
                if(last.total<=7) return { type: "cau_tong_diem", prediction: "Xỉu", confidence: 82, description: `Tổng ${last.total} - Xỉu nhẹ` };
                if(last.total>=13) return { type: "cau_tong_diem", prediction: "Tài", confidence: 82, description: `Tổng ${last.total} - Tài nhẹ` };
                return null;
            },
            cau_bien_dong: () => {
                const last20 = this.processed.slice(-20);
                let changes=0;
                for(let i=1;i<last20.length;i++) if(last20[i].result!==last20[i-1].result) changes++;
                const rate=changes/19;
                if(rate>=0.7) return { type: "cau_bien_dong", prediction: last20[last20.length-1].result===1?"Xỉu":"Tài", confidence: 82, description: "Biến động mạnh - đánh ngược" };
                if(rate<=0.3) return { type: "cau_bien_dong", prediction: last20[last20.length-1].result===1?"Tài":"Xỉu", confidence: 80, description: "Ít biến động - tiếp đà" };
                return null;
            },
            cau_bao_ba: () => {
                const last = this.processed[this.processed.length-1];
                if(last.isTriple){
                    if(last.tripleVal===1) return { type: "cau_bao_ba", prediction: "Xỉu", confidence: 97, description: "Bộ ba 1 - Xỉu" };
                    if(last.tripleVal===6) return { type: "cau_bao_ba", prediction: "Tài", confidence: 97, description: "Bộ ba 6 - Tài" };
                    const pred = last.tripleVal<=3?"Xỉu":"Tài";
                    return { type: "cau_bao_ba", prediction: pred, confidence: 90, description: `Bộ ba ${last.tripleVal} - ${pred}` };
                }
                return null;
            }
        };
    }

    // ==================== CAU HINH HOC ====================
    cauHinhHoc() {
        return {
            cau_tam_giac: () => {
                const last9 = this.processed.slice(-9).map(p => p.result);
                if(last9[0]===1 && last9[1]===1 && last9[2]===0 && last9[3]===1 && last9[4]===0 && last9[5]===1 && last9[6]===0 && last9[7]===1 && last9[8]===1) return { type: "cau_tam_giac", prediction: "Xỉu", confidence: 90, description: "Cầu tam giác" };
                if(last9[0]===0 && last9[1]===0 && last9[2]===1 && last9[3]===0 && last9[4]===1 && last9[5]===0 && last9[6]===1 && last9[7]===0 && last9[8]===0) return { type: "cau_tam_giac", prediction: "Tài", confidence: 90, description: "Cầu tam giác" };
                return null;
            },
            cau_hinh_thang: () => {
                const last10 = this.processed.slice(-10).map(p => p.result);
                if(last10[0]===1 && last10[1]===1 && last10[2]===0 && last10[3]===0 && last10[4]===1 && last10[5]===1 && last10[6]===0 && last10[7]===0 && last10[8]===1 && last10[9]===1) return { type: "cau_hinh_thang", prediction: "Xỉu", confidence: 91, description: "Cầu hình thang" };
                if(last10[0]===0 && last10[1]===0 && last10[2]===1 && last10[3]===1 && last10[4]===0 && last10[5]===0 && last10[6]===1 && last10[7]===1 && last10[8]===0 && last10[9]===0) return { type: "cau_hinh_thang", prediction: "Tài", confidence: 91, description: "Cầu hình thang" };
                return null;
            },
            cau_hinh_vuong: () => {
                const last8 = this.processed.slice(-8).map(p => p.result);
                if(last8[0]===1 && last8[1]===0 && last8[2]===0 && last8[3]===1 && last8[4]===1 && last8[5]===0 && last8[6]===0 && last8[7]===1) return { type: "cau_hinh_vuong", prediction: "Xỉu", confidence: 88, description: "Cầu hình vuông" };
                if(last8[0]===0 && last8[1]===1 && last8[2]===1 && last8[3]===0 && last8[4]===0 && last8[5]===1 && last8[6]===1 && last8[7]===0) return { type: "cau_hinh_vuong", prediction: "Tài", confidence: 88, description: "Cầu hình vuông" };
                return null;
            }
        };
    }

    // ==================== CAU LICH SU ====================
    cauLichSu() {
        return {
            cau_lich_su_10: () => {
                const last10 = this.processed.slice(-10).map(p => p.resultStr);
                let best=null,bestSim=0;
                for(let i=0;i<this.processed.length-15;i++){
                    let sim=0;
                    for(let j=0;j<10;j++) if(this.processed[i+j].resultStr===last10[j]) sim++;
                    const rate=sim/10;
                    if(rate>bestSim && rate>=0.85){
                        bestSim=rate;
                        best=this.processed[i+10].resultStr;
                    }
                }
                if(best && bestSim>=0.85) return { type: "cau_lich_su_10", prediction: best, confidence: 88+(bestSim-0.85)*60, description: `Lịch sử 10 phiên - ${(bestSim*100).toFixed(0)}% giống` };
                return null;
            },
            cau_lich_su_20: () => {
                const last20 = this.processed.slice(-20).map(p => p.resultStr);
                let best=null,bestSim=0;
                for(let i=0;i<this.processed.length-25;i++){
                    let sim=0;
                    for(let j=0;j<20;j++) if(this.processed[i+j].resultStr===last20[j]) sim++;
                    const rate=sim/20;
                    if(rate>bestSim && rate>=0.8){
                        bestSim=rate;
                        best=this.processed[i+20].resultStr;
                    }
                }
                if(best && bestSim>=0.8) return { type: "cau_lich_su_20", prediction: best, confidence: 85+(bestSim-0.8)*50, description: `Lịch sử 20 phiên - ${(bestSim*100).toFixed(0)}% giống` };
                return null;
            }
        };
    }

    // ==================== DIEU CHINH ====================
    dieuChinhThichNghi(ops) {
        if(ops.length === 0) return [];
        for(let op of ops){
            const perf = this.cauPerformance[op.type];
            if(perf){
                let adj = op.confidence;
                if(perf.successRate > 0.9) adj += 3;
                else if(perf.successRate < 0.75) adj -= 8;
                if(this.stats.consecutiveWins >= 3) adj += 3;
                if(this.stats.consecutiveLosses >= 1) adj -= 8;
                if(this.stats.consecutiveLosses >= 2) adj -= 12;
                op.confidence = Math.min(99, Math.max(55, adj));
            }
        }
        ops.sort((a,b) => b.confidence - a.confidence);
        return ops;
    }

    timKiemCoHoi() {
        const ops = [];
        for(let [name, func] of Object.entries(this.allCau)){
            try{
                const res = func();
                if(res && res.confidence >= 50){
                    res.type = name;
                    ops.push(res);
                }
            }catch(e){}
        }
        if(ops.length === 0) return null;
        const adjusted = this.dieuChinhThichNghi(ops);
        if(adjusted.length > 0){
            const best = adjusted[0];
            if(best.type && this.cauPerformance[best.type]){
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
        if(this.stats.consecutiveLosses >= 12){
            return { shouldBet: false, reason: `THUA ${this.stats.consecutiveLosses} LIEN TIEP - DUNG`, prediction: null, confidence: 0, coolDown: true };
        }
        const opp = this.timKiemCoHoi();
        if(!opp || opp.confidence < this.stats.adaptiveThreshold){
            return { shouldBet: false, reason: opp ? `TIN CAY ${opp.confidence}% < ${this.stats.adaptiveThreshold}%` : "KHONG CO CAU", prediction: null, confidence: 0 };
        }
        return { shouldBet: true, prediction: opp.prediction, confidence: opp.confidence, reason: opp.description, type: opp.type };
    }

    capNhatKetQua(actual) {
        const last = this.stats.trades[this.stats.trades.length-1];
        if(!last) return;
        const win = last.prediction === actual;
        if(win){
            this.stats.wins++;
            this.stats.consecutiveWins++;
            this.stats.consecutiveLosses = 0;
            if(this.cauPerformance[last.type]) this.cauPerformance[last.type].wins++;
            this.learningMemory.push(true);
        }else{
            this.stats.losses++;
            this.stats.consecutiveLosses++;
            this.stats.consecutiveWins = 0;
            if(this.cauPerformance[last.type]) this.cauPerformance[last.type].losses++;
            this.learningMemory.push(false);
        }
        this.stats.trades[this.stats.trades.length-1].actual = actual;
        this.stats.trades[this.stats.trades.length-1].isWin = win;
        
        const last10 = this.stats.trades.slice(-10);
        const wins10 = last10.filter(t => t.isWin).length;
        this.stats.last10Accuracy = wins10 / 10;
        
        let nt = 50;
        if(this.stats.last10Accuracy > 0.95) nt = 48;
        else if(this.stats.last10Accuracy > 0.9) nt = 50;
        else if(this.stats.last10Accuracy > 0.85) nt = 52;
        else if(this.stats.last10Accuracy > 0.8) nt = 54;
        else if(this.stats.last10Accuracy < 0.7) nt = 60;
        else if(this.stats.last10Accuracy < 0.65) nt = 65;
        
        if(this.stats.consecutiveWins >= 5) nt = Math.max(45, nt - 3);
        if(this.stats.consecutiveLosses >= 2) nt = Math.min(70, nt + 5);
        
        this.stats.adaptiveThreshold = nt;
        
        const kq = win ? "WIN" : "LOSS";
        console.log(`   ${kq} P${last.phien}: ${last.prediction} | TT: ${actual} | TL10: ${(this.stats.last10Accuracy*100).toFixed(1)}% | N: ${this.stats.adaptiveThreshold}% | ${last.type}`);
        return win;
    }

    chay() {
        const pred = this.duDoan();
        if(pred.shouldBet && !pred.coolDown){
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
            if (arr && arr.length >= 20) {
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
        if (!data || data.length < 20) { isUpdating = false; return; }

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
            predictorInstance = new SieuChinhXacBatTatCaCau(data.slice(-500));
        } else {
            predictorInstance.processed = predictorInstance.preprocess(data.slice(-500));
        }
        
        const pred = predictorInstance.chay();

        let pattern = "";
        for (let i = Math.max(0, data.length - 20); i < data.length; i++) pattern += data[i].ket_qua === "Tài" ? "t" : "x";

        const recentTotals = data.slice(-20).map(p => p.tong);
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
console.log('   ⚔️ SIÊU CHÍNH XÁC BẮT TẤT CẢ CẦU - KHÔNG BỎ QUA PHIÊN NÀO ⚔️');
console.log('   API: wtxmd52.tele68.com | 20 PHIÊN | 50K lịch sử');
console.log('   TỔNG SỐ THUẬT TOÁN: 250+ LOẠI CẦU');
console.log('   BAO GỒM: Bet 1-100, Bẻ cầu 2-30, Xen kẻ, Cặp đôi, Đặc biệt');
console.log('   CAU NÂNG CAO: Hình học, Thống kê, Lịch sử, Fibonacci, Đối xứng');
console.log('='.repeat(70));

(async () => { const d = await fetchData(); if (d && d.length >= 20) { gameHistory = d; await updatePrediction(); } })();
setInterval(updatePrediction, 300);

app.listen(PORT, () => { console.log(`🚀 Port: ${PORT} | /taixiu`); });
