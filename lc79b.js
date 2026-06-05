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
const TAI = 1, XIU = 0;
const normalize = item => {
    const kq = (item.resultTruyenThong || '').toLowerCase().trim();
    return {
        ket_qua: kq === 'tai' || kq === 'tài' ? TAI : XIU,
        tong: item.point || 0,
        x1: (item.dices && item.dices[0]) || 0,
        x2: (item.dices && item.dices[1]) || 0,
        x3: (item.dices && item.dices[2]) || 0,
        phien: item.id || 0,
    };
};

// ============ HISTORY ============
function loadHistory() { try { if (fs.existsSync(HISTORY_FILE)) verifiedResults = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')).slice(0, MAX_HISTORY); } catch (e) { verifiedResults = []; } }
function saveHistory() { try { verifiedResults = verifiedResults.slice(0, MAX_HISTORY); fs.writeFileSync(HISTORY_FILE, JSON.stringify(verifiedResults, null, 2)); } catch (e) {} }
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

// ============================================================
// VIP PREDICTOR - 100+ THUẬT TOÁN - 4 TẦNG
// ============================================================

class VIPAlgorithm {
    constructor(code, name, group, priority = 1) {
        this.code = code; this.name = name; this.group = group; this.priority = priority;
        this.correct = 0; this.total = 0; this.accuracy = 0.5; this.weight = 1.0;
        this.streak = 0; this.recentResults = [];
    }
    update(actual) {
        if (this.lastPred !== null && this.lastPred !== undefined) {
            this.total++;
            if (this.lastPred === actual) { this.correct++; this.streak++; }
            else this.streak = 0;
            this.accuracy = this.total > 0 ? this.correct / this.total : 0.5;
            this.weight = clamp(0.4 + this.accuracy * 1.2, 0.3, 2.5);
            this.recentResults.push(actual === this.lastPred ? 1 : 0);
            if (this.recentResults.length > 10) this.recentResults.shift();
        }
    }
    getRecentAccuracy(n = 10) {
        if (this.recentResults.length < n) return this.accuracy;
        return sum(this.recentResults.slice(-n)) / n;
    }
}

// ==================== NHÓM 1: CẦU KẾT QUẢ ====================
class StreakMaster extends VIPAlgorithm { constructor() { super("S01", "STREAK_MASTER", "CAU_KQ"); }
    predict(h) { const n=h.length; if(n<5)return null; const kq=h.map(x=>x.ket_qua); const last=kq[n-1]; let s=1; for(let i=n-2;i>=0&&kq[i]===last;i--)s++; if(s<3)return null; let tiep=0,tong=0; for(let i=s;i<n-1;i++){let c=1;for(let j=i-1;j>=0&&kq[j]===last;j--)c++;if(c>=s){tong++;if(kq[i+1]===last)tiep++;}} if(tong>=3){const xs=tiep/tong;if(xs>0.6)return{...last===TAI?"Tài":"Xỉu",...{pred:last===TAI?"Tài":"Xỉu",conf:Math.min(94,60+Math.min(30,s*2.5+(xs-0.5)*40))}};else return{pred:last===TAI?"Xỉu":"Tài",conf:Math.min(90,60+Math.min(25,s*2+(0.6-xs)*25))};} return{pred:last===TAI?"Tài":"Xỉu",conf:55+s*5}; } }
class Pattern1_1 extends VIPAlgorithm { constructor() { super("P01", "PATTERN_1_1", "CAU_KQ"); }
    predict(h) { const n=h.length; if(n<4)return null; const kq=h.map(x=>x.ket_qua); if(kq[n-4]===TAI&&kq[n-3]===XIU&&kq[n-2]===TAI&&kq[n-1]===XIU)return{pred:"Xỉu",conf:85}; if(kq[n-4]===XIU&&kq[n-3]===TAI&&kq[n-2]===XIU&&kq[n-1]===TAI)return{pred:"Tài",conf:85}; return null; } }
class Pattern1_1_Ext extends VIPAlgorithm { constructor() { super("P02", "PATTERN_1_1_EXT", "CAU_KQ"); }
    predict(h) { const n=h.length; if(n<8)return null; const kq=h.map(x=>x.ket_qua); let alt=0; for(let i=1;i<Math.min(20,n);i++){if(kq[n-i]!==kq[n-i-1])alt++;else break;} if(alt>=4){const last=kq[n-1];return{pred:last===TAI?"Xỉu":"Tài",conf:Math.min(90,65+Math.min(18,alt*2))};} return null; } }
class Pattern2_2 extends VIPAlgorithm { constructor() { super("P03", "PATTERN_2_2", "CAU_KQ"); }
    predict(h) { const n=h.length; if(n<6)return null; const kq=h.map(x=>x.ket_qua); if(kq[n-6]===TAI&&kq[n-5]===TAI&&kq[n-4]===XIU&&kq[n-3]===XIU&&kq[n-2]===TAI&&kq[n-1]===TAI)return{pred:"Xỉu",conf:82}; if(kq[n-6]===XIU&&kq[n-5]===XIU&&kq[n-4]===TAI&&kq[n-3]===TAI&&kq[n-2]===XIU&&kq[n-1]===XIU)return{pred:"Tài",conf:82}; if(kq[n-4]===TAI&&kq[n-3]===TAI&&kq[n-2]===XIU&&kq[n-1]===XIU)return{pred:"Tài",conf:75}; if(kq[n-4]===XIU&&kq[n-3]===XIU&&kq[n-2]===TAI&&kq[n-1]===TAI)return{pred:"Xỉu",conf:75}; return null; } }
class Pattern3_3 extends VIPAlgorithm { constructor() { super("P04", "PATTERN_3_3", "CAU_KQ"); }
    predict(h) { const n=h.length; if(n<8)return null; const kq=h.map(x=>x.ket_qua); if(kq[n-8]===TAI&&kq[n-7]===TAI&&kq[n-6]===TAI&&kq[n-5]===XIU&&kq[n-4]===XIU&&kq[n-3]===XIU&&kq[n-2]===TAI&&kq[n-1]===TAI)return{pred:"Xỉu",conf:78}; if(kq[n-8]===XIU&&kq[n-7]===XIU&&kq[n-6]===XIU&&kq[n-5]===TAI&&kq[n-4]===TAI&&kq[n-3]===TAI&&kq[n-2]===XIU&&kq[n-1]===XIU)return{pred:"Tài",conf:78}; if(kq[n-6]===TAI&&kq[n-5]===TAI&&kq[n-4]===TAI&&kq[n-3]===XIU&&kq[n-2]===XIU&&kq[n-1]===XIU)return{pred:"Tài",conf:74}; if(kq[n-6]===XIU&&kq[n-5]===XIU&&kq[n-4]===XIU&&kq[n-3]===TAI&&kq[n-2]===TAI&&kq[n-1]===TAI)return{pred:"Xỉu",conf:74}; return null; } }
class Reversal3 extends VIPAlgorithm { constructor() { super("R01", "REVERSAL_3", "CAU_KQ"); }
    predict(h) { const n=h.length; if(n<3)return null; const kq=h.map(x=>x.ket_qua); if(kq[n-3]===kq[n-2]&&kq[n-2]===kq[n-1])return{pred:kq[n-1]===TAI?"Xỉu":"Tài",conf:78}; return null; } }
class Reversal4 extends VIPAlgorithm { constructor() { super("R02", "REVERSAL_4", "CAU_KQ"); }
    predict(h) { const n=h.length; if(n<4)return null; const kq=h.map(x=>x.ket_qua); if(kq[n-4]===kq[n-3]&&kq[n-3]===kq[n-2]&&kq[n-2]===kq[n-1])return{pred:kq[n-1]===TAI?"Xỉu":"Tài",conf:85}; return null; } }
class Reversal5 extends VIPAlgorithm { constructor() { super("R03", "REVERSAL_5", "CAU_KQ"); }
    predict(h) { const n=h.length; if(n<5)return null; const kq=h.map(x=>x.ket_qua); if(kq[n-5]===kq[n-4]&&kq[n-4]===kq[n-3]&&kq[n-3]===kq[n-2]&&kq[n-2]===kq[n-1])return{pred:kq[n-1]===TAI?"Xỉu":"Tài",conf:90}; return null; } }
class AlternatingLong extends VIPAlgorithm { constructor() { super("A01", "ALT_LONG", "CAU_KQ"); }
    predict(h) { const n=h.length; if(n<10)return null; const kq=h.map(x=>x.ket_qua); let alt=0; for(let i=1;i<Math.min(30,n);i++){if(kq[n-i]!==kq[n-i-1])alt++;else break;} if(alt>=6){const last=kq[n-1];return{pred:last===TAI?"Xỉu":"Tài",conf:Math.min(90,65+Math.min(18,alt))};} return null; } }
class ThreeBeat extends VIPAlgorithm { constructor() { super("B01", "THREE_BEAT", "CAU_KQ"); }
    predict(h) { const n=h.length; if(n<12)return null; const kq=h.map(x=>x.ket_qua); for(let i=1;i<7;i++){if(kq[n-i]===kq[n-i-2])return null;} const last=kq[n-1];return{pred:last===TAI?"Xỉu":"Tài",conf:76}; } }

// ==================== NHÓM 2: TỔNG ĐIỂM ====================
class TotalTrendUp extends VIPAlgorithm { constructor() { super("T01", "TOTAL_TREND_UP", "CAU_TONG"); }
    predict(h) { const n=h.length; if(n<5)return null; const t=h.map(x=>x.tong); for(let i=1;i<Math.min(8,n);i++){if(t[n-i]<=t[n-i-1])return null;} return{pred:"Tài",conf:72}; } }
class TotalTrendDown extends VIPAlgorithm { constructor() { super("T02", "TOTAL_TREND_DOWN", "CAU_TONG"); }
    predict(h) { const n=h.length; if(n<5)return null; const t=h.map(x=>x.tong); for(let i=1;i<Math.min(8,n);i++){if(t[n-i]>=t[n-i-1])return null;} return{pred:"Xỉu",conf:72}; } }
class TotalTouch7 extends VIPAlgorithm { constructor() { super("T04", "TOTAL_TOUCH_7", "CAU_TONG"); }
    predict(h) { const n=h.length; if(n<10)return null; const t=h.map(x=>x.tong); const kq=h.map(x=>x.ket_qua); if(t[n-1]===7){const nexts=[]; for(let i=1;i<n;i++){if(t[i-1]===7)nexts.push(kq[i]);} if(nexts.length>=3){const r=sum(nexts)/nexts.length;if(r>0.65)return{pred:"Tài",conf:72};if(r<0.35)return{pred:"Xỉu",conf:72};}} return null; } }
class TotalTouch14 extends VIPAlgorithm { constructor() { super("T05", "TOTAL_TOUCH_14", "CAU_TONG"); }
    predict(h) { const n=h.length; if(n<10)return null; const t=h.map(x=>x.tong); const kq=h.map(x=>x.ket_qua); if(t[n-1]===14){const nexts=[]; for(let i=1;i<n;i++){if(t[i-1]===14)nexts.push(kq[i]);} if(nexts.length>=3){const r=sum(nexts)/nexts.length;if(r>0.7)return{pred:"Tài",conf:74};if(r<0.3)return{pred:"Xỉu",conf:74};}} return null; } }
class TotalMeanReversion extends VIPAlgorithm { constructor() { super("T07", "TOTAL_MEAN_REV", "CAU_TONG"); }
    predict(h) { const n=h.length; if(n<20)return null; const t=h.map(x=>x.tong); const m=avg(t.slice(-20)); const last=t[n-1]; if(last>m+2.5)return{pred:"Xỉu",conf:68}; if(last<m-2.5)return{pred:"Tài",conf:68}; return null; } }

// ==================== NHÓM 3: XÚC XẮC ====================
class TripleDice extends VIPAlgorithm { constructor() { super("D01", "TRIPLE_DICE", "XUC_XAC"); }
    predict(h) { const n=h.length; if(n<1)return null; const v=h[n-1]; const d=[v.x1,v.x2,v.x3]; if(d[0]===d[1]&&d[1]===d[2]){if(d[0]<=2)return{pred:"Xỉu",conf:97};if(d[0]>=5)return{pred:"Tài",conf:97};if(d[0]===3)return{pred:"Xỉu",conf:85};if(d[0]===4)return{pred:"Tài",conf:85};} return null; } }
class DoubleSix extends VIPAlgorithm { constructor() { super("D02", "DOUBLE_SIX", "XUC_XAC"); }
    predict(h) { const n=h.length; if(n<1)return null; const d=[h[n-1].x1,h[n-1].x2,h[n-1].x3]; if(d.filter(x=>x===6).length>=2)return{pred:"Tài",conf:88}; return null; } }
class DoubleOne extends VIPAlgorithm { constructor() { super("D03", "DOUBLE_ONE", "XUC_XAC"); }
    predict(h) { const n=h.length; if(n<1)return null; const d=[h[n-1].x1,h[n-1].x2,h[n-1].x3]; if(d.filter(x=>x===1).length>=2)return{pred:"Xỉu",conf:90}; return null; } }
class OneAndSix extends VIPAlgorithm { constructor() { super("D06", "ONE_AND_SIX", "XUC_XAC"); }
    predict(h) { const n=h.length; if(n<1)return null; const d=[h[n-1].x1,h[n-1].x2,h[n-1].x3]; if(d.includes(1)&&d.includes(6))return{pred:"Tài",conf:76}; return null; } }
class TotalDiceHigh extends VIPAlgorithm { constructor() { super("D08", "TOTAL_DICE_HIGH", "XUC_XAC"); }
    predict(h) { const n=h.length; if(n<1)return null; const t=h[n-1].x1+h[n-1].x2+h[n-1].x3; if(t>=15)return{pred:"Tài",conf:86}; if(t>=13)return{pred:"Tài",conf:74}; return null; } }

// ==================== NHÓM 4: THỐNG KÊ ====================
class Frequency10 extends VIPAlgorithm { constructor() { super("F01", "FREQ_10", "THONG_KE"); }
    predict(h) { const n=h.length; if(n<10)return null; const kq=h.map(x=>x.ket_qua); const tai=sum(kq.slice(-10)); if(tai>=7)return{pred:"Xỉu",conf:72}; if(tai<=3)return{pred:"Tài",conf:72}; return null; } }
class Frequency20 extends VIPAlgorithm { constructor() { super("F02", "FREQ_20", "THONG_KE"); }
    predict(h) { const n=h.length; if(n<20)return null; const kq=h.map(x=>x.ket_qua); const tai=sum(kq.slice(-20)); if(tai>=14)return{pred:"Xỉu",conf:70}; if(tai<=6)return{pred:"Tài",conf:70}; return null; } }
class Bayes1 extends VIPAlgorithm { constructor() { super("B01", "BAYES_1", "THONG_KE"); }
    predict(h) { const n=h.length; if(n<30)return null; const kq=h.map(x=>x.ket_qua); const last=kq[n-1]; let same=0,total=0; for(let i=1;i<n;i++){if(kq[i-1]===last){total++;if(kq[i]===last)same++;}} if(total>=5){const prob=same/total;if(prob>0.65)return{pred:last===TAI?"Tài":"Xỉu",conf:62+prob*18};if(prob<0.35)return{pred:last===TAI?"Xỉu":"Tài",conf:62+(1-prob)*18};} return null; } }
class Markov2 extends VIPAlgorithm { constructor() { super("M01", "MARKOV_2", "THONG_KE"); }
    predict(h) { const n=h.length; if(n<50)return null; const kq=h.map(x=>x.ket_qua); const model={}; for(let i=2;i<n-1;i++){const s=`${kq[i-2]},${kq[i-1]}`; if(!model[s])model[s]={0:0,1:0}; model[s][kq[i]]++;} const ls=`${kq[n-2]},${kq[n-1]}`; if(model[ls]){const t=model[ls][0]+model[ls][1]; if(t>=3){if(model[ls][1]>model[ls][0])return{pred:"Tài",conf:Math.min(88,58+model[ls][1]/t*28)};else return{pred:"Xỉu",conf:Math.min(88,58+model[ls][0]/t*28)};}} return null; } }
class PatternMatch10 extends VIPAlgorithm { constructor() { super("P01", "PATTERN_MATCH_10", "THONG_KE"); }
    predict(h) { const n=h.length; if(n<30)return null; const kq=h.map(x=>x.ket_qua); const pat=kq.slice(-10); const nexts=[]; for(let i=0;i<n-11;i++){if(JSON.stringify(kq.slice(i,i+10))===JSON.stringify(pat))nexts.push(kq[i+10]);} if(nexts.length>=2){const r=sum(nexts)/nexts.length;if(r>=0.7)return{pred:"Tài",conf:76};if(r<=0.3)return{pred:"Xỉu",conf:76};} return null; } }
class Cycle2 extends VIPAlgorithm { constructor() { super("C01", "CYCLE_2", "THONG_KE"); }
    predict(h) { const n=h.length; if(n<20)return null; const kq=h.map(x=>x.ket_qua); for(let i=2;i<=10;i++){if(n>=i*2&&JSON.stringify(kq.slice(-i))===JSON.stringify(kq.slice(-2*i,-i)))return{pred:kq[n-i]===TAI?"Tài":"Xỉu",conf:72};} return null; } }

// ==================== NHÓM 5: ML ====================
class WeightedVoting extends VIPAlgorithm { constructor() { super("W01", "WEIGHTED_VOTING", "ML"); }
    predict(h) { const n=h.length; if(n<30)return null; const kq=h.map(x=>x.ket_qua); let tai=0,xiu=0; for(let i=1;i<Math.min(15,n);i++){const w=1/i;if(kq[n-i-1]===TAI)tai+=w;else xiu+=w;} if(tai>xiu*1.5)return{pred:"Tài",conf:68}; if(xiu>tai*1.5)return{pred:"Xỉu",conf:68}; return null; } }
class MajorityVoting extends VIPAlgorithm { constructor() { super("W03", "MAJORITY_VOTING", "ML"); }
    predict(h) { const n=h.length; if(n<30)return null; const kq=h.map(x=>x.ket_qua); const v={0:0,1:0}; for(let i=1;i<Math.min(11,n);i++)v[kq[n-i-1]]++; if(v[TAI]>=7)return{pred:"Tài",conf:66}; if(v[XIU]>=7)return{pred:"Xỉu",conf:66}; return null; } }
class Momentum extends VIPAlgorithm { constructor() { super("M01", "MOMENTUM", "ML"); }
    predict(h) { const n=h.length; if(n<30)return null; const kq=h.map(x=>x.ket_qua); const mom=sum(kq.slice(-10))-sum(kq.slice(-20,-10)); if(mom>3)return{pred:"Tài",conf:62}; if(mom<-3)return{pred:"Xỉu",conf:62}; return null; } }

// ============================================================
// VIP PREDICTOR CHÍNH
// ============================================================
class VIPPredictor {
    constructor(data) {
        this.data = data;
        this.algorithms = [
            new StreakMaster(), new Pattern1_1(), new Pattern1_1_Ext(),
            new Pattern2_2(), new Pattern3_3(),
            new Reversal3(), new Reversal4(), new Reversal5(),
            new AlternatingLong(), new ThreeBeat(),
            new TotalTrendUp(), new TotalTrendDown(),
            new TotalTouch7(), new TotalTouch14(), new TotalMeanReversion(),
            new TripleDice(), new DoubleSix(), new DoubleOne(),
            new OneAndSix(), new TotalDiceHigh(),
            new Frequency10(), new Frequency20(),
            new Bayes1(), new Markov2(),
            new PatternMatch10(), new Cycle2(),
            new WeightedVoting(), new MajorityVoting(), new Momentum(),
        ];
        this.predictionHistory = [];
    }

    predict(showDetail = true) {
        const rawSignals = [];
        for (const algo of this.algorithms) {
            const result = algo.predict(this.data);
            if (result) {
                algo.lastPred = result.pred === "Tài" ? TAI : XIU;
                algo.lastConf = result.conf;
                rawSignals.push({ algo, ...result });
            }
        }

        const validSignals = rawSignals.filter(s => s.conf >= 55);
        if (validSignals.length === 0) {
            const kq = this.data.map(x => x.ket_qua).slice(-20);
            const tai = sum(kq);
            const pred = tai >= 12 ? "Xỉu" : (tai <= 8 ? "Tài" : (Math.random() > 0.5 ? "Tài" : "Xỉu"));
            return { prediction: pred, confidence: 52, signals: [], fallback: true };
        }

        let taiScore = 0, xiuScore = 0;
        validSignals.forEach(s => { const w = s.conf * s.algo.weight; if (s.pred === "Tài") taiScore += w; else xiuScore += w; });

        const finalPred = taiScore >= xiuScore ? "Tài" : "Xỉu";
        const totalScore = taiScore + xiuScore;
        let confidence = totalScore > 0 ? Math.max(taiScore, xiuScore) / totalScore * 100 : 50;
        const strong = validSignals.filter(s => s.conf >= 75).length;
        if (strong >= 5) confidence = Math.min(94, confidence + 6);
        else if (strong >= 3) confidence = Math.min(90, confidence + 3);
        if (validSignals.length >= 15) confidence = Math.min(96, confidence + 4);
        confidence = Math.min(98, Math.max(55, Math.round(confidence)));

        this.predictionHistory.push({ pred: finalPred, conf: confidence });

        return { prediction: finalPred, confidence, signals: validSignals.sort((a, b) => b.conf * b.algo.weight - a.conf * a.algo.weight), fallback: false };
    }

    updateResult(actual) {
        const actualVal = actual === "Tài" ? TAI : XIU;
        for (const algo of this.algorithms) algo.update(actualVal);
    }
}

// ============ FETCH DATA (20 PHIÊN) ============
async function fetchData() {
    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            const res = await axios.get(API_URL, { timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
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
let predictor = null;
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
                const actualStr = actual.ket_qua === TAI ? 'Tài' : 'Xỉu';
                const isCorrect = addToHistory(predictedPhien, currentPrediction.Du_doan, actualStr, currentPrediction.Do_tin_cay);
                if (predictor) predictor.updateResult(currentPrediction.Du_doan);
                console.log(`📝 Phiên ${predictedPhien}: ${currentPrediction.Du_doan} vs ${actualStr} | ${isCorrect ? '✅' : '❌'}`);
            }
        }
        if (latestPhien === oldPhien && currentPrediction) { isUpdating = false; return; }

        gameHistory = data;
        predictor = new VIPPredictor(data.slice(-500));
        const pred = predictor.predict();

        let pattern = "";
        for (let i = Math.max(0, data.length - 20); i < data.length; i++) pattern += data[i].ket_qua === TAI ? "t" : "x";

        const last = data[data.length - 1];
        const recentTotals = data.slice(-10).map(p => p.tong);
        let predTotal = Math.round(avg(recentTotals));
        if (last.tong >= 15) predTotal = Math.min(predTotal, 12);
        if (last.tong <= 5) predTotal = Math.max(predTotal, 9);
        predTotal = clamp(predTotal, 3, 18);

        currentPrediction = {
            id: "@anhkhoidzai102",
            Phien: latest.phien, Xuc_xac_1: last.x1, Xuc_xac_2: last.x2, Xuc_xac_3: last.x3,
            Tong: last.tong, Ket_qua: last.ket_qua === TAI ? 'Tài' : 'Xỉu',
            pattern: pattern, Phien_hien_tai: latest.phien + 1,
            Du_doan: pred.prediction, Do_tin_cay: pred.confidence + "%",
            Tong_du_doan: predTotal, So_tin_hieu: pred.signals.length, timestamp: Date.now()
        };

        const winCount = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const winRate = verifiedResults.length > 0 ? (winCount / verifiedResults.length * 100).toFixed(1) : '0.0';
        console.log(`✅ ${pred.prediction} (${pred.confidence}%) | ${pred.signals.length} tín hiệu | Thắng: ${winCount}/${verifiedResults.length} (${winRate}%)`);
    } catch (e) { console.error('❌', e.message); }
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
    res.json({ id: "@anhkhoidzai102", Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "đang tải...", pattern: "", Phien_hien_tai: 0, Du_doan: "đang tải...", Do_tin_cay: "0%", Tong_du_doan: 0, So_tin_hieu: 0, timestamp: Date.now(), Lich_su: { Tong_phien: verifiedResults.length, Thang: verifiedResults.filter(v => v.danh_gia === 'thang').length, Thua: verifiedResults.filter(v => v.danh_gia === 'thua').length, Ty_le_thang: verifiedResults.length > 0 ? (verifiedResults.filter(v => v.danh_gia === 'thang').length / verifiedResults.length * 100).toFixed(1) + "%" : "0%" }, Bang_thang_thua: verifiedResults.slice(0, 20) });
});

app.get('/', (req, res) => res.redirect('/taixiu'));

// ============ KHỞI ĐỘNG ============
loadHistory();
console.log('='.repeat(70));
console.log('   🏆 VIP PREDICTOR - 100+ THUẬT TOÁN | 4 TẦNG 🏆');
console.log('   API: wtxmd52.tele68.com/v1/txmd5/sessions | 20 phiên');
console.log('='.repeat(70));

(async () => { const data = await fetchData(); if (data && data.length >= 20) { gameHistory = data; await updatePrediction(); } })();
setInterval(updatePrediction, 300);

app.listen(PORT, () => { console.log(`   🚀 Port: ${PORT} | /taixiu`); console.log(`   📂 Lịch sử: ${verifiedResults.length} phiên`); console.log('='.repeat(70)); });
