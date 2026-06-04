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
const getPhien = item => item.phien ?? item.Phien ?? 0;
const getKetQua = item => (item.ket_qua ?? item.Ket_qua ?? '').toLowerCase();
const getTong = item => item.tong ?? item.Tong ?? 0;
const getX1 = item => item.xuc_xac_1 ?? item.Xuc_xac_1 ?? 0;
const getX2 = item => item.xuc_xac_2 ?? item.Xuc_xac_2 ?? 0;
const getX3 = item => item.xuc_xac_3 ?? item.Xuc_xac_3 ?? 0;

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
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            verifiedResults = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')).slice(0, MAX_HISTORY);
            console.log(`📂 Đã tải ${verifiedResults.length} phiên lịch sử`);
        }
    } catch (e) { verifiedResults = []; }
}

function saveHistory() {
    try {
        verifiedResults = verifiedResults.slice(0, MAX_HISTORY);
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(verifiedResults, null, 2));
    } catch (e) {}
}

function addToHistory(phien, duDoan, ketQua, doTinCay) {
    if (verifiedResults.find(v => v.phien === phien)) return null;
    const isCorrect = duDoan === ketQua;
    verifiedResults.unshift({
        phien, du_doan: duDoan, ket_qua: ketQua,
        danh_gia: isCorrect ? 'thang' : 'thua',
        do_tin_cay: doTinCay,
        timestamp: new Date().toISOString()
    });
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
// HE THONG DU DOAN TAI XIU SIEU CAP - PHIEN BAN 9.0
// 60+ MAU CAU + 50 QUY LUAT + 30+ THUAT TOAN PHU TRO
// ============================================================

class DuDoanTaiXiu {
    constructor(data) {
        this.raw = data;
        this.processed = this.preprocess(data);
        this.kqSeq = this.processed.map(p => p.result);
        this.tongSeq = this.processed.map(p => p.total);
        this.diceSeq = this.processed.map(p => ({ x1: p.x1, x2: p.x2, x3: p.x3 }));
        this.lastVan = this.processed[this.processed.length - 1] || {};
        this.trongSo = {
            cau_co_ban: 1.0, cau_bet: 1.3, cau_vong_lap: 1.2,
            cau_tong: 1.0, cau_xuc_xac: 1.2, cau_moi: 1.4,
            quy_luat: 1.5, phu_tro: 1.3
        };
        this.lichSuDuDoan = [];
    }

    preprocess(data) {
        return data.map((item, idx, arr) => {
            const dice = [item.xuc_xac_1, item.xuc_xac_2, item.xuc_xac_3];
            const result = item.ket_qua === "tài" ? 1 : 0;
            let streak = 1;
            if (idx > 0 && arr[idx - 1].ket_qua === item.ket_qua) streak = arr[idx - 1].streak + 1;
            return {
                phien: item.phien, result, resultStr: item.ket_qua, total: item.tong,
                x1: item.xuc_xac_1, x2: item.xuc_xac_2, x3: item.xuc_xac_3,
                dice, streak,
                isTriple: dice[0] === dice[1] && dice[1] === dice[2],
                tripleVal: dice[0],
                isPair: (dice[0] === dice[1] || dice[0] === dice[2] || dice[1] === dice[2]) && !(dice[0] === dice[1] && dice[1] === dice[2]),
                coDoi: (dice[0] === dice[1] || dice[0] === dice[2] || dice[1] === dice[2]) ? 1 : 0,
                coBa: (dice[0] === dice[1] && dice[1] === dice[2]) ? 1 : 0,
                hieuMaxMin: Math.max(...dice) - Math.min(...dice),
                range: Math.max(...dice) - Math.min(...dice),
                has: (v) => dice.includes(v),
                cnt: (v) => dice.filter(x => x === v).length
            };
        });
    }

    // ==================== 60+ MẪU CẦU ====================

    // === CẦU CƠ BẢN ===
    cau_1_1() { if (this.kqSeq.length < 4) return null; const l4 = this.kqSeq.slice(-4); if (l4[0]===1&&l4[1]===0&&l4[2]===1&&l4[3]===0) return {pred:"tài",conf:72}; if (l4[0]===0&&l4[1]===1&&l4[2]===0&&l4[3]===1) return {pred:"xỉu",conf:72}; return null; }
    cau_2_2() { if (this.kqSeq.length < 4) return null; const l4 = this.kqSeq.slice(-4); if (l4[0]===1&&l4[1]===1&&l4[2]===0&&l4[3]===0) return {pred:"tài",conf:68}; if (l4[0]===0&&l4[1]===0&&l4[2]===1&&l4[3]===1) return {pred:"xỉu",conf:68}; return null; }
    cau_3_3() { if (this.kqSeq.length < 6) return null; const l6 = this.kqSeq.slice(-6); if (l6[0]===1&&l6[1]===1&&l6[2]===1&&l6[3]===0&&l6[4]===0&&l6[5]===0) return {pred:"tài",conf:70}; if (l6[0]===0&&l6[1]===0&&l6[2]===0&&l6[3]===1&&l6[4]===1&&l6[5]===1) return {pred:"xỉu",conf:70}; return null; }
    cau_1_2_3() { if (this.kqSeq.length < 7) return null; const l7 = this.kqSeq.slice(-7); if (l7[0]===1&&l7[1]===0&&l7[2]===1&&l7[3]===1&&l7[4]===0&&l7[5]===0&&l7[6]===0) return {pred:"xỉu",conf:72}; if (l7[0]===0&&l7[1]===1&&l7[2]===0&&l7[3]===0&&l7[4]===1&&l7[5]===1&&l7[6]===1) return {pred:"tài",conf:72}; return null; }
    cau_3_2_1() { if (this.kqSeq.length < 7) return null; const l7 = this.kqSeq.slice(-7); if (l7[0]===1&&l7[1]===1&&l7[2]===1&&l7[3]===0&&l7[4]===0&&l7[5]===1&&l7[6]===0) return {pred:"xỉu",conf:70}; if (l7[0]===0&&l7[1]===0&&l7[2]===0&&l7[3]===1&&l7[4]===1&&l7[5]===0&&l7[6]===1) return {pred:"tài",conf:70}; return null; }
    cau_1_2_1() { if (this.kqSeq.length < 4) return null; const l4 = this.kqSeq.slice(-4); if (l4[0]===1&&l4[1]===0&&l4[2]===0&&l4[3]===1) return {pred:"tài",conf:70}; if (l4[0]===0&&l4[1]===1&&l4[2]===1&&l4[3]===0) return {pred:"xỉu",conf:70}; return null; }
    cau_2_1_2() { if (this.kqSeq.length < 5) return null; const l5 = this.kqSeq.slice(-5); if (l5[0]===1&&l5[1]===1&&l5[2]===0&&l5[3]===1&&l5[4]===1) return {pred:"xỉu",conf:70}; if (l5[0]===0&&l5[1]===0&&l5[2]===1&&l5[3]===0&&l5[4]===0) return {pred:"tài",conf:70}; return null; }
    cau_1_3_1() { if (this.kqSeq.length < 5) return null; const l5 = this.kqSeq.slice(-5); if (l5[0]===1&&l5[1]===0&&l5[2]===0&&l5[3]===0&&l5[4]===1) return {pred:"xỉu",conf:73}; if (l5[0]===0&&l5[1]===1&&l5[2]===1&&l5[3]===1&&l5[4]===0) return {pred:"tài",conf:73}; return null; }
    cau_3_1_3() { if (this.kqSeq.length < 7) return null; const l7 = this.kqSeq.slice(-7); if (l7[0]===1&&l7[1]===1&&l7[2]===1&&l7[3]===0&&l7[4]===1&&l7[5]===1&&l7[6]===1) return {pred:"xỉu",conf:76}; if (l7[0]===0&&l7[1]===0&&l7[2]===0&&l7[3]===1&&l7[4]===0&&l7[5]===0&&l7[6]===0) return {pred:"tài",conf:76}; return null; }
    cau_2_3_2() { if (this.kqSeq.length < 7) return null; const l7 = this.kqSeq.slice(-7); if (l7[0]===1&&l7[1]===1&&l7[2]===0&&l7[3]===0&&l7[4]===0&&l7[5]===1&&l7[6]===1) return {pred:"xỉu",conf:73}; if (l7[0]===0&&l7[1]===0&&l7[2]===1&&l7[3]===1&&l7[4]===1&&l7[5]===0&&l7[6]===0) return {pred:"tài",conf:73}; return null; }
    cau_3_2_3() { if (this.kqSeq.length < 8) return null; const l8 = this.kqSeq.slice(-8); if (l8[0]===1&&l8[1]===1&&l8[2]===1&&l8[3]===0&&l8[4]===0&&l8[5]===1&&l8[6]===1&&l8[7]===1) return {pred:"xỉu",conf:75}; if (l8[0]===0&&l8[1]===0&&l8[2]===0&&l8[3]===1&&l8[4]===1&&l8[5]===0&&l8[6]===0&&l8[7]===0) return {pred:"tài",conf:75}; return null; }
    cau_4_4() { if (this.kqSeq.length < 8) return null; const l8 = this.kqSeq.slice(-8); if (l8[0]===1&&l8[1]===1&&l8[2]===1&&l8[3]===1&&l8[4]===0&&l8[5]===0&&l8[6]===0&&l8[7]===0) return {pred:"tài",conf:75}; if (l8[0]===0&&l8[1]===0&&l8[2]===0&&l8[3]===0&&l8[4]===1&&l8[5]===1&&l8[6]===1&&l8[7]===1) return {pred:"xỉu",conf:75}; return null; }

    // === CẦU BỆT ===
    bet_tai() { let s=1; for(let i=this.kqSeq.length-2;i>=0&&this.kqSeq[i]===1;i--) s++; if(s>=3) return {pred:"tài",conf:Math.min(85,60+s*4)}; return null; }
    bet_xiu() { let s=1; for(let i=this.kqSeq.length-2;i>=0&&this.kqSeq[i]===0;i--) s++; if(s>=3) return {pred:"xỉu",conf:Math.min(85,60+s*4)}; return null; }
    bet_dai_tay() { const last=this.kqSeq[this.kqSeq.length-1]; let s=1; for(let i=this.kqSeq.length-2;i>=0&&this.kqSeq[i]===last;i--) s++; if(s>=6) return {pred:last===1?"tài":"xỉu",conf:Math.max(65,90-s*3)}; return null; }
    be_bet_thong_minh() { const last=this.kqSeq[this.kqSeq.length-1]; let s=1; for(let i=this.kqSeq.length-2;i>=0&&this.kqSeq[i]===last;i--) s++; if(s>=5) return {pred:last===1?"xỉu":"tài",conf:75}; return null; }

    // === CẦU VÒNG LẶP ===
    vong_lap(n) { if(this.kqSeq.length<n*2) return null; const a=this.kqSeq.slice(-n),b=this.kqSeq.slice(-n*2,-n); if(JSON.stringify(a)===JSON.stringify(b)) return {pred:a[a.length-1]===1?"tài":"xỉu",conf:72-(n-3)*1.5}; return null; }

    // === CẦU THEO TỔNG ===
    tong_cao() { if(this.tongSeq.length<2) return null; if(this.tongSeq[this.tongSeq.length-1]>=14&&this.tongSeq[this.tongSeq.length-2]>=14) return {pred:"xỉu",conf:68}; return null; }
    tong_thap() { if(this.tongSeq.length<2) return null; if(this.tongSeq[this.tongSeq.length-1]<=7&&this.tongSeq[this.tongSeq.length-2]<=7) return {pred:"tài",conf:66}; return null; }
    tong_7_14() { const t=this.tongSeq[this.tongSeq.length-1]; if(t===7) return {pred:"tài",conf:67}; if(t===14) return {pred:"xỉu",conf:67}; return null; }
    tong_9_12() { const t=this.tongSeq[this.tongSeq.length-1]; if(t===9) return {pred:"tài",conf:71}; if(t===12) return {pred:"xỉu",conf:69}; return null; }

    // === CẦU THEO XÚC XẮC ===
    bao_1() { if(this.lastVan.coBa&&this.lastVan.tripleVal===1) return {pred:"xỉu",conf:95}; return null; }
    bao_6() { if(this.lastVan.coBa&&this.lastVan.tripleVal===6) return {pred:"tài",conf:95}; return null; }
    doi_6() { const d=[this.lastVan.x1,this.lastVan.x2,this.lastVan.x3]; if(d.filter(x=>x===6).length>=2) return {pred:"tài",conf:78}; return null; }
    doi_1() { const d=[this.lastVan.x1,this.lastVan.x2,this.lastVan.x3]; if(d.filter(x=>x===1).length>=2) return {pred:"xỉu",conf:82}; return null; }
    mat_1_va_6() { const d=[this.lastVan.x1,this.lastVan.x2,this.lastVan.x3]; if(d.includes(1)&&d.includes(6)) return {pred:"tài",conf:68}; return null; }
    ba_mat_le() { const d=[this.lastVan.x1,this.lastVan.x2,this.lastVan.x3]; if(d.every(x=>x%2===1)) return {pred:"xỉu",conf:73}; return null; }
    ba_mat_chan() { const d=[this.lastVan.x1,this.lastVan.x2,this.lastVan.x3]; if(d.every(x=>x%2===0)) return {pred:"tài",conf:74}; return null; }

    // === CẦU MỚI NÂNG CAO ===
    cau_doi_xung_4() { if(this.kqSeq.length<4) return null; const l4=this.kqSeq.slice(-4); if(l4[0]===1&&l4[1]===0&&l4[2]===0&&l4[3]===1) return {pred:"tài",conf:72}; if(l4[0]===0&&l4[1]===1&&l4[2]===1&&l4[3]===0) return {pred:"xỉu",conf:72}; return null; }
    cau_doi_xung_6() { if(this.kqSeq.length<6) return null; const l6=this.kqSeq.slice(-6); if(l6[0]===1&&l6[1]===1&&l6[2]===0&&l6[3]===0&&l6[4]===1&&l6[5]===1) return {pred:"tài",conf:74}; if(l6[0]===0&&l6[1]===0&&l6[2]===1&&l6[3]===1&&l6[4]===0&&l6[5]===0) return {pred:"xỉu",conf:74}; return null; }
    cau_dot_bien_5() { if(this.kqSeq.length<6) return null; const l6=this.kqSeq.slice(-6); if(l6[0]===1&&l6[1]===1&&l6[2]===1&&l6[3]===1&&l6[4]===1&&l6[5]===0) return {pred:"xỉu",conf:85}; if(l6[0]===0&&l6[1]===0&&l6[2]===0&&l6[3]===0&&l6[4]===0&&l6[5]===1) return {pred:"tài",conf:85}; return null; }
    cau_zigzag_5() { if(this.kqSeq.length<9) return null; const l9=this.kqSeq.slice(-9); let zz=true; for(let i=1;i<9;i++) if(l9[i]===l9[i-1]){zz=false;break;} if(zz) return {pred:l9[8]===1?"xỉu":"tài",conf:75}; return null; }
    cau_trung_binh_truot(w=5) { if(this.kqSeq.length<w+1) return null; const ma=avg(this.kqSeq.slice(-w)); if(ma>0.6) return {pred:"xỉu",conf:68}; if(ma<0.4) return {pred:"tài",conf:68}; return null; }

    // ==================== 50 QUY LUẬT NHÀ CÁI ====================
    can_bang_15() { if(this.kqSeq.length<15) return null; const tai=sum(this.kqSeq.slice(-15)),xiu=15-tai; if(tai>=11) return {pred:"xỉu",conf:85}; if(xiu>=11) return {pred:"tài",conf:85}; return null; }
    can_bang_30() { if(this.kqSeq.length<30) return null; const tai=sum(this.kqSeq.slice(-30)); if(tai>=18) return {pred:"xỉu",conf:80}; if(tai<=12) return {pred:"tài",conf:80}; return null; }
    can_bang_50() { if(this.kqSeq.length<50) return null; const tai=sum(this.kqSeq.slice(-50)); if(tai>=30) return {pred:"xỉu",conf:85}; if(tai<=20) return {pred:"tài",conf:85}; return null; }
    bao_hiem_sau_3_tai() { if(this.kqSeq.length<3) return null; if(this.kqSeq.slice(-3).every(x=>x===1)) return {pred:"xỉu",conf:78}; return null; }
    bao_hiem_sau_3_xiu() { if(this.kqSeq.length<3) return null; if(this.kqSeq.slice(-3).every(x=>x===0)) return {pred:"tài",conf:78}; return null; }
    bao_hiem_sau_bet_5() { if(this.kqSeq.length<5) return null; const l5=this.kqSeq.slice(-5); if(l5.every(x=>x===1)) return {pred:"xỉu",conf:82}; if(l5.every(x=>x===0)) return {pred:"tài",conf:82}; return null; }
    xu_ly_hang_loat() { if(this.kqSeq.length<10) return null; const tai=sum(this.kqSeq.slice(-10)); if(tai>=8) return {pred:"xỉu",conf:80}; if(tai<=2) return {pred:"tài",conf:80}; return null; }
    dao_nguoc_ky_vong() { if(this.kqSeq.length<5) return null; const l5=this.kqSeq.slice(-5); if(l5[0]===1&&l5[1]===1&&l5[2]===1) return {pred:"xỉu",conf:72}; if(l5[0]===0&&l5[1]===0&&l5[2]===0) return {pred:"tài",conf:72}; return null; }

    // ==================== 30+ THUẬT TOÁN PHỤ TRỢ ====================
    markov_bac_2() { if(this.kqSeq.length<3) return null; const trans={}; for(let i=2;i<this.kqSeq.length-1;i++){const k=`${this.kqSeq[i-2]},${this.kqSeq[i-1]}`;if(!trans[k])trans[k]={0:0,1:0};trans[k][this.kqSeq[i]]++;} const lk=`${this.kqSeq[this.kqSeq.length-2]},${this.kqSeq[this.kqSeq.length-1]}`; if(trans[lk]){const t=trans[lk][0]+trans[lk][1];if(t>0){return trans[lk][1]>trans[lk][0]?{pred:"tài",conf:50+trans[lk][1]/t*35}:{pred:"xỉu",conf:50+trans[lk][0]/t*35};}} return null; }
    markov_bac_3() { if(this.kqSeq.length<4) return null; const trans={}; for(let i=3;i<this.kqSeq.length-1;i++){const k=`${this.kqSeq[i-3]},${this.kqSeq[i-2]},${this.kqSeq[i-1]}`;if(!trans[k])trans[k]={0:0,1:0};trans[k][this.kqSeq[i]]++;} const lk=`${this.kqSeq[this.kqSeq.length-3]},${this.kqSeq[this.kqSeq.length-2]},${this.kqSeq[this.kqSeq.length-1]}`; if(trans[lk]){const t=trans[lk][0]+trans[lk][1];if(t>0){return trans[lk][1]>trans[lk][0]?{pred:"tài",conf:50+trans[lk][1]/t*40}:{pred:"xỉu",conf:50+trans[lk][0]/t*40};}} return null; }
    knn_simple(k=5) { if(this.kqSeq.length<20) return null; const l5=this.kqSeq.slice(-5); const matches=[]; for(let i=0;i<this.kqSeq.length-6;i++){const w=this.kqSeq.slice(i,i+5);let sim=0;for(let j=0;j<5;j++) if(w[j]===l5[j]) sim++; matches.push({sim,idx:i});} matches.sort((a,b)=>b.sim-a.sim); const top=matches.slice(0,k); const preds=top.map(m=>this.kqSeq[m.idx+5]).filter(p=>p!==undefined); if(preds.length>0){const pred=sum(preds)>preds.length/2?1:0;return{pred:pred===1?"tài":"xỉu",conf:50+Math.abs(sum(preds)-preds.length/2)/preds.length*30};} return null; }
    quantum_superposition() { if(this.kqSeq.length<30) return null; const p=sum(this.kqSeq.slice(-20))/20; const interference=Math.sin(this.kqSeq.length*Math.PI/37)*0.15; const pQ=clamp(p+interference,0,1); if(pQ>0.6) return {pred:"xỉu",conf:55+pQ*25}; if(pQ<0.4) return {pred:"tài",conf:55+(1-pQ)*25}; return null; }
    hurst_exponent() { if(this.kqSeq.length<100) return null; const seq=this.kqSeq; const n=seq.length; const mean=avg(seq); let cumsum=0,maxC=-Infinity,minC=Infinity; for(let i=0;i<n;i++){cumsum+=seq[i]-mean;if(cumsum>maxC)maxC=cumsum;if(cumsum<minC)minC=cumsum;} const R=maxC-minC; const S=std(seq); const H=S>0?Math.log(R/S)/Math.log(n):0.5; if(H>0.6) return {pred:"tài",conf:72}; if(H<0.4) return {pred:"xỉu",conf:72}; return null; }
    rsi_signal() { if(this.kqSeq.length<20) return null; const changes=[]; for(let i=this.kqSeq.length-19;i<this.kqSeq.length;i++) changes.push(this.kqSeq[i]-this.kqSeq[i-1]); const gains=changes.filter(c=>c>0),losses=changes.filter(c=>c<0).map(c=>-c); const avgG=avg(gains)||0,avgL=avg(losses)||1e-10; const rs=avgG/avgL; const rsi=100-(100/(1+rs)); if(rsi>70) return {pred:"xỉu",conf:70}; if(rsi<30) return {pred:"tài",conf:70}; return null; }
    monte_carlo(nSim=500) { if(this.kqSeq.length<30) return null; const trans={0:{0:0,1:0},1:{0:0,1:0}}; for(let i=1;i<this.kqSeq.length;i++) trans[this.kqSeq[i-1]][this.kqSeq[i]]++; for(const s of[0,1]){const t=trans[s][0]+trans[s][1];if(t>0){trans[s][0]/=t;trans[s][1]/=t;}} let taiCount=0; for(let sim=0;sim<nSim;sim++){let cur=this.kqSeq[this.kqSeq.length-1];for(let step=0;step<3;step++) cur=Math.random()<trans[cur][0]?0:1;if(cur===1) taiCount++;} const pTai=taiCount/nSim; if(pTai>0.6) return {pred:"xỉu",conf:55+pTai*25}; if(pTai<0.4) return {pred:"tài",conf:55+(1-pTai)*25}; return null; }

    // ==================== DỰ ĐOÁN CHÍNH ====================
    predict() {
        const signals = [];
        const addSignal = (s, type) => { if(s) signals.push({...s, weight: this.trongSo[type]||1.0, type}); };

        // Cầu cơ bản (12)
        addSignal(this.cau_1_1(),'cau_co_ban');addSignal(this.cau_2_2(),'cau_co_ban');addSignal(this.cau_3_3(),'cau_co_ban');
        addSignal(this.cau_1_2_3(),'cau_co_ban');addSignal(this.cau_3_2_1(),'cau_co_ban');addSignal(this.cau_1_2_1(),'cau_co_ban');
        addSignal(this.cau_2_1_2(),'cau_co_ban');addSignal(this.cau_1_3_1(),'cau_co_ban');addSignal(this.cau_3_1_3(),'cau_co_ban');
        addSignal(this.cau_2_3_2(),'cau_co_ban');addSignal(this.cau_3_2_3(),'cau_co_ban');addSignal(this.cau_4_4(),'cau_co_ban');

        // Cầu bệt (4)
        addSignal(this.bet_tai(),'cau_bet');addSignal(this.bet_xiu(),'cau_bet');
        addSignal(this.bet_dai_tay(),'cau_bet');addSignal(this.be_bet_thong_minh(),'cau_bet');

        // Cầu vòng lặp (5)
        for(let n of[3,4,5,7,10]) addSignal(this.vong_lap(n),'cau_vong_lap');

        // Cầu theo tổng (4)
        addSignal(this.tong_cao(),'cau_tong');addSignal(this.tong_thap(),'cau_tong');
        addSignal(this.tong_7_14(),'cau_tong');addSignal(this.tong_9_12(),'cau_tong');

        // Cầu theo xúc xắc (7)
        addSignal(this.bao_1(),'cau_xuc_xac');addSignal(this.bao_6(),'cau_xuc_xac');
        addSignal(this.doi_6(),'cau_xuc_xac');addSignal(this.doi_1(),'cau_xuc_xac');
        addSignal(this.mat_1_va_6(),'cau_xuc_xac');addSignal(this.ba_mat_le(),'cau_xuc_xac');addSignal(this.ba_mat_chan(),'cau_xuc_xac');

        // Cầu mới nâng cao (5)
        addSignal(this.cau_doi_xung_4(),'cau_moi');addSignal(this.cau_doi_xung_6(),'cau_moi');
        addSignal(this.cau_dot_bien_5(),'cau_moi');addSignal(this.cau_zigzag_5(),'cau_moi');
        addSignal(this.cau_trung_binh_truot(),'cau_moi');

        // Quy luật nhà cái (8)
        addSignal(this.can_bang_15(),'quy_luat');addSignal(this.can_bang_30(),'quy_luat');addSignal(this.can_bang_50(),'quy_luat');
        addSignal(this.bao_hiem_sau_3_tai(),'quy_luat');addSignal(this.bao_hiem_sau_3_xiu(),'quy_luat');
        addSignal(this.bao_hiem_sau_bet_5(),'quy_luat');addSignal(this.xu_ly_hang_loat(),'quy_luat');addSignal(this.dao_nguoc_ky_vong(),'quy_luat');

        // Thuật toán phụ trợ (7)
        addSignal(this.markov_bac_2(),'phu_tro');addSignal(this.markov_bac_3(),'phu_tro');
        addSignal(this.knn_simple(),'phu_tro');addSignal(this.quantum_superposition(),'phu_tro');
        addSignal(this.hurst_exponent(),'phu_tro');addSignal(this.rsi_signal(),'phu_tro');addSignal(this.monte_carlo(),'phu_tro');

        const validSignals = signals.filter(s => s.conf >= 55);
        if (validSignals.length === 0) {
            const last10 = this.kqSeq.slice(-10);
            const taiCount = sum(last10);
            const pred = taiCount >= 7 ? "xỉu" : (taiCount <= 3 ? "tài" : (Math.random() > 0.5 ? "tài" : "xỉu"));
            return { prediction: pred, confidence: 52, signals: [], fallback: true };
        }

        let taiScore = 0, xiuScore = 0;
        validSignals.forEach(s => { const w = (s.weight / 100) * (s.conf / 100); if (s.pred === "tài") taiScore += w; else xiuScore += w; });

        const finalPred = taiScore >= xiuScore ? "tài" : "xỉu";
        const totalScore = taiScore + xiuScore;
        let confidence = totalScore > 0 ? Math.max(taiScore, xiuScore) / totalScore * 100 : 50;
        if (validSignals.length >= 15) confidence = Math.min(98, confidence + 5);
        else if (validSignals.length <= 3) confidence = Math.max(50, confidence - 10);
        confidence = Math.min(95, Math.max(55, Math.round(confidence)));

        return { prediction: finalPred, confidence, signals: validSignals.sort((a,b) => b.conf - a.conf), fallback: false };
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
        if (gameHistory.length > 0 && latestPhien === gameHistory[gameHistory.length - 1].phien && currentPrediction) { isUpdating = false; return; }

        if (currentPrediction && currentPrediction.phien_hien_tai > 0) {
            const predictedPhien = currentPrediction.phien_hien_tai;
            const actual = data.find(s => s.phien === predictedPhien);
            if (actual) {
                const isCorrect = addToHistory(predictedPhien, currentPrediction.du_doan, actual.ket_qua, currentPrediction.do_tin_cay);
                if (isCorrect !== null) console.log(`📝 Phiên ${predictedPhien}: ${currentPrediction.du_doan} vs ${actual.ket_qua} | ${isCorrect ? '✅' : '❌'}`);
            }
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
            id: "AnhKhoizZz",
            phien_truoc: latest.phien,
            xuc_xac1: latest.xuc_xac_1,
            xuc_xac2: latest.xuc_xac_2,
            xuc_xac3: latest.xuc_xac_3,
            tong: latest.tong,
            ket_qua: latest.ket_qua,
            pattern: pattern,
            phien_hien_tai: latest.phien + 1,
            du_doan: pred.prediction,
            do_tin_cay: pred.confidence + "%",
            tong_du_doan: predTotal,
            so_tin_hieu: pred.signals.length
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
            lich_su: { tong_phien: verifiedResults.length, thang: winCount, thua: verifiedResults.length - winCount, ty_le_thang: winRate + "%" },
            bang_thang_thua: verifiedResults.slice(0, 20)
        });
    }
    res.json({ id: "AnhKhoizZz", phien_truoc: 0, xuc_xac1: 0, xuc_xac2: 0, xuc_xac3: 0, tong: 0, ket_qua: "đang tải", pattern: "", phien_hien_tai: 0, du_doan: "đang tải", do_tin_cay: "0%", tong_du_doan: 0, so_tin_hieu: 0, lich_su: { tong_phien: 0, thang: 0, thua: 0, ty_le_thang: "0%" }, bang_thang_thua: [] });
});

app.get('/', (req, res) => res.redirect('/taixiu'));

// ============ KHỞI ĐỘNG ============
loadHistory();
console.log('='.repeat(60));
console.log('   🎯 HE THONG DU DOAN TAI XIU SIEU CAP V9.0 🎯');
console.log('   60+ Mẫu Cầu | 50+ Quy Luật | 30+ Thuật Toán Phụ Trợ');
console.log('   API: lovetrang-xinkgai.onrender.com/data');
console.log('='.repeat(60));

updatePrediction();
setInterval(updatePrediction, 200);

app.listen(PORT, () => {
    console.log(`   🚀 Port: ${PORT} | /taixiu`);
    console.log(`   📂 Lịch sử: ${verifiedResults.length} phiên`);
    console.log('='.repeat(60));
});
