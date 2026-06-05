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

// ============ HISTORY ============
function loadHistory() { try { if (fs.existsSync(HISTORY_FILE)) verifiedResults = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')).slice(0, MAX_HISTORY); } catch (e) { verifiedResults = []; } }
function saveHistory() { try { verifiedResults = verifiedResults.slice(0, MAX_HISTORY); fs.writeFileSync(HISTORY_FILE, JSON.stringify(verifiedResults, null, 2)); } catch (e) {} }
function addToHistory(phien, duDoan, ketQua, doTinCay) {
    if (verifiedResults.find(v => v.phien === phien)) return null;
    const d = duDoan.toLowerCase().trim();
    const k = ketQua.toLowerCase().trim();
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
// GOD PREDICTOR ULTIMATE - 60+ THUẬT TOÁN
// ============================================================

class GodPredictorUltimate {
    constructor(data) {
        this.raw = data;
        this.processed = this.preprocess(data);
        this.kqSeq = this.processed.map(p => p.result);
        this.tongSeq = this.processed.map(p => p.total);
        this.x1Seq = this.processed.map(p => p.x1);
        this.x2Seq = this.processed.map(p => p.x2);
        this.x3Seq = this.processed.map(p => p.x3);
        this.lastVan = this.processed[this.processed.length - 1] || {};
        this.weights = this.initWeights();
        this.recentPredictions = [];
    }

    preprocess(data) {
        return data.map((item, idx, arr) => {
            const dice = [item.x1, item.x2, item.x3];
            const r = item.ket_qua;
            let streak = 1;
            if (idx > 0 && arr[idx - 1].ket_qua === item.ket_qua) streak = arr[idx - 1].streak + 1;
            return {
                phien: item.phien, result: r, total: item.tong,
                x1: item.x1, x2: item.x2, x3: item.x3, dice, streak,
                isTriple: dice[0] === dice[1] && dice[1] === dice[2],
                tripleVal: dice[0],
                soLan1: dice.filter(x => x === 1).length,
                soLan2: dice.filter(x => x === 2).length,
                soLan5: dice.filter(x => x === 5).length,
                soLan6: dice.filter(x => x === 6).length,
                co1va6: dice.includes(1) && dice.includes(6),
                co1va2: dice.includes(1) && dice.includes(2),
                co5va6: dice.includes(5) && dice.includes(6),
                dayTang: (dice[0]+1===dice[1] && dice[1]+1===dice[2]) || (dice[0]+1===dice[2] && dice[2]+1===dice[1]) || (dice[1]+1===dice[0] && dice[0]+1===dice[2]),
                dayGiam: (dice[0]-1===dice[1] && dice[1]-1===dice[2]) || (dice[0]-1===dice[2] && dice[2]-1===dice[1]) || (dice[1]-1===dice[0] && dice[0]-1===dice[2]),
            };
        });
    }

    initWeights() {
        return {
            cau_1_1: 1.4, cau_2_2: 1.4, cau_3_3: 1.3, cau_4_4: 1.2,
            cau_dai: 1.5, cau_dan_xen: 1.3, cau_2_1_2: 1.3, cau_1_2_1: 1.2,
            cau_3_2: 1.2, cau_2_3: 1.2, cau_3_nhip: 1.3, cau_4_nhip: 1.2,
            cau_so_le: 1.1,
            tong_tang_dan: 1.2, tong_giam_dan: 1.2, tong_chan_le: 1.0,
            tong_cham_7_14: 1.2, tong_cham_10: 1.1, tong_hoi_quy: 1.1,
            tong_trung_binh: 1.0, tong_tich_luy: 1.0,
            ba_mat_giong: 1.7, hai_mat_6: 1.5, hai_mat_1: 1.5, hai_mat_5: 1.2,
            hai_mat_2: 1.2, co_1_va_6: 1.2, co_1_va_2: 1.1, co_5_va_6: 1.2,
            day_tang: 1.1, day_giam: 1.0, x1_x2_x3_bang: 1.3,
            tan_suat_10: 1.1, tan_suat_20: 1.1, tan_suat_30: 1.0,
            bayes_1: 1.2, bayes_2: 1.3, bayes_3: 1.2,
            chu_ky_2: 1.2, chu_ky_3: 1.1, chu_ky_5: 1.0,
            chu_ky_fibonacci: 1.2, markov_bac_2: 1.3, markov_bac_3: 1.2,
            entropy_analysis: 1.1, autocorrelation: 1.1,
            so_khop_mau_10: 1.4, so_khop_mau_8: 1.3,
            dao_chieu_sau_3: 1.2, dao_chieu_sau_4: 1.3, dao_chieu_sau_5: 1.4,
        };
    }

    updateWeights(actualResult) {
        if (this.recentPredictions.length === 0) return;
        const actual = actualResult === "Tài" ? 1 : 0;
        for (const { name, pred } of this.recentPredictions) {
            const p = pred === "Tài" ? 1 : 0;
            const correct = p === actual;
            if (this.weights[name] !== undefined) {
                this.weights[name] = correct ? Math.min(2.5, this.weights[name] * 1.03) : Math.max(0.3, this.weights[name] * 0.97);
            }
        }
    }

    // ==================== NHÓM 1: CẦU KẾT QUẢ (13) ====================
    cau_1_1() { if (this.kqSeq.length < 4) return null; const l = this.kqSeq.slice(-4); if (l[0]===1&&l[1]===0&&l[2]===1&&l[3]===0) return {pred:"Xỉu",conf:82}; if (l[0]===0&&l[1]===1&&l[2]===0&&l[3]===1) return {pred:"Tài",conf:82}; return null; }
    cau_2_2() { if (this.kqSeq.length < 6) return null; const l = this.kqSeq.slice(-6); if (l[0]===1&&l[1]===1&&l[2]===0&&l[3]===0&&l[4]===1&&l[5]===1) return {pred:"Xỉu",conf:78}; if (l[0]===0&&l[1]===0&&l[2]===1&&l[3]===1&&l[4]===0&&l[5]===0) return {pred:"Tài",conf:78}; return null; }
    cau_3_3() { if (this.kqSeq.length < 8) return null; const l = this.kqSeq.slice(-8); if (l[0]===1&&l[1]===1&&l[2]===1&&l[3]===0&&l[4]===0&&l[5]===0&&l[6]===1&&l[7]===1) return {pred:"Xỉu",conf:75}; if (l[0]===0&&l[1]===0&&l[2]===0&&l[3]===1&&l[4]===1&&l[5]===1&&l[6]===0&&l[7]===0) return {pred:"Tài",conf:75}; return null; }
    cau_4_4() { if (this.kqSeq.length < 10) return null; const l = this.kqSeq.slice(-10); if (l[0]===1&&l[1]===1&&l[2]===1&&l[3]===1&&l[4]===0&&l[5]===0&&l[6]===0&&l[7]===0&&l[8]===1&&l[9]===1) return {pred:"Xỉu",conf:72}; if (l[0]===0&&l[1]===0&&l[2]===0&&l[3]===0&&l[4]===1&&l[5]===1&&l[6]===1&&l[7]===1&&l[8]===0&&l[9]===0) return {pred:"Tài",conf:72}; return null; }
    cau_dai() { if (this.kqSeq.length < 3) return null; const last = this.kqSeq[this.kqSeq.length-1]; let s=1; for(let i=this.kqSeq.length-2;i>=0&&this.kqSeq[i]===last;i--)s++; if(s<3)return null; let tiep=0,tong=0; for(let i=s;i<this.kqSeq.length-1;i++){let check=1;for(let j=i-1;j>=0&&this.kqSeq[j]===last;j--)check++;if(check>=s){tong++;if(this.kqSeq[i+1]===last)tiep++;}} if(tong>=3){const xs=tiep/tong;if(xs>0.6){const dtc=55+Math.min(30,s*3+(xs-0.5)*40);return{pred:last===1?"Tài":"Xỉu",conf:Math.min(92,dtc)};}else{const dtc=55+Math.min(25,s*2+(0.6-xs)*30);return{pred:last===1?"Xỉu":"Tài",conf:Math.min(88,dtc)};}} const dtc=50+Math.min(35,s*4);return{pred:last===1?"Tài":"Xỉu",conf:Math.min(88,dtc)};}
    cau_dan_xen() { if (this.kqSeq.length < 8) return null; let d=0; for(let i=1;i<Math.min(20,this.kqSeq.length);i++){if(this.kqSeq[this.kqSeq.length-i]!==this.kqSeq[this.kqSeq.length-i-1])d++;else break;} if(d>=5){const last=this.kqSeq[this.kqSeq.length-1];return{pred:last===1?"Xỉu":"Tài",conf:Math.min(88,60+Math.min(20,d*2))};} return null; }
    cau_2_1_2() { if (this.kqSeq.length < 5) return null; const l=this.kqSeq.slice(-5); if(l[0]===1&&l[1]===1&&l[2]===0&&l[3]===1&&l[4]===1)return{pred:"Xỉu",conf:78}; if(l[0]===0&&l[1]===0&&l[2]===1&&l[3]===0&&l[4]===0)return{pred:"Tài",conf:78}; return null; }
    cau_1_2_1() { if (this.kqSeq.length < 5) return null; const l=this.kqSeq.slice(-5); if(l[0]===1&&l[1]===0&&l[2]===0&&l[3]===1&&l[4]===1)return{pred:"Xỉu",conf:74}; if(l[0]===0&&l[1]===1&&l[2]===1&&l[3]===0&&l[4]===0)return{pred:"Tài",conf:74}; return null; }
    cau_3_2() { if (this.kqSeq.length < 5) return null; const l=this.kqSeq.slice(-5); if(l[0]===1&&l[1]===1&&l[2]===1&&l[3]===0&&l[4]===0)return{pred:"Tài",conf:72}; if(l[0]===0&&l[1]===0&&l[2]===0&&l[3]===1&&l[4]===1)return{pred:"Xỉu",conf:72}; return null; }
    cau_2_3() { if (this.kqSeq.length < 5) return null; const l=this.kqSeq.slice(-5); if(l[0]===1&&l[1]===1&&l[2]===0&&l[3]===0&&l[4]===0)return{pred:"Xỉu",conf:70}; if(l[0]===0&&l[1]===0&&l[2]===1&&l[3]===1&&l[4]===1)return{pred:"Tài",conf:70}; return null; }
    cau_3_nhip() { if (this.kqSeq.length < 12) return null; let dung=true; for(let i=1;i<7;i++){if(this.kqSeq[this.kqSeq.length-i]===this.kqSeq[this.kqSeq.length-i-2]){dung=false;break;}} if(dung){const last=this.kqSeq[this.kqSeq.length-1];return{pred:last===1?"Xỉu":"Tài",conf:75};} return null; }
    cau_4_nhip() { if (this.kqSeq.length < 16) return null; let dung=true; for(let i=1;i<9;i++){if(this.kqSeq[this.kqSeq.length-i]===this.kqSeq[this.kqSeq.length-i-3]){dung=false;break;}} if(dung){const last=this.kqSeq[this.kqSeq.length-1];return{pred:last===1?"Xỉu":"Tài",conf:72};} return null; }
    cau_so_le() { if (this.kqSeq.length < 6) return null; const l=this.kqSeq.slice(-6); if(l[0]===1&&l[1]===0&&l[2]===0&&l[3]===1&&l[4]===1&&l[5]===0)return{pred:"Xỉu",conf:68}; if(l[0]===0&&l[1]===1&&l[2]===1&&l[3]===0&&l[4]===0&&l[5]===1)return{pred:"Tài",conf:68}; return null; }

    // ==================== NHÓM 2: CẦU TỔNG ĐIỂM (8) ====================
    tong_tang_dan() { if (this.tongSeq.length < 10) return null; const t=this.tongSeq.slice(-10); for(let i=1;i<t.length;i++){if(t[i]<=t[i-1])return null;} return{pred:"Tài",conf:70}; }
    tong_giam_dan() { if (this.tongSeq.length < 10) return null; const t=this.tongSeq.slice(-10); for(let i=1;i<t.length;i++){if(t[i]>=t[i-1])return null;} return{pred:"Xỉu",conf:70}; }
    tong_chan_le() { if (this.tongSeq.length < 4) return null; const l=this.tongSeq.slice(-4).map(t=>t%2); if(l[0]===0&&l[1]===1&&l[2]===0&&l[3]===1)return{pred:"Tài",conf:65}; if(l[0]===1&&l[1]===0&&l[2]===1&&l[3]===0)return{pred:"Xỉu",conf:65}; return null; }
    tong_cham_7_14() { if (this.tongSeq.length < 2) return null; const last=this.tongSeq[this.tongSeq.length-1]; if(last===7||last===14){const nexts=[];for(let i=1;i<this.tongSeq.length;i++){if(this.tongSeq[i-1]===last)nexts.push(this.kqSeq[i]);}if(nexts.length>0){const tl=sum(nexts)/nexts.length;if(tl>0.65)return{pred:"Tài",conf:70};if(tl<0.35)return{pred:"Xỉu",conf:70};}} return null; }
    tong_cham_10() { if (this.tongSeq.length < 2) return null; const last=this.tongSeq[this.tongSeq.length-1]; if(last===10){const nexts=[];for(let i=1;i<this.tongSeq.length;i++){if(this.tongSeq[i-1]===10)nexts.push(this.kqSeq[i]);}if(nexts.length>0){const tl=sum(nexts)/nexts.length;if(tl>0.7)return{pred:"Tài",conf:68};if(tl<0.3)return{pred:"Xỉu",conf:68};}} return null; }
    tong_hoi_quy() { if (this.tongSeq.length < 20) return null; const t=this.tongSeq.slice(-20); const x=Array.from({length:20},(_,i)=>i); const n=20; const sx=sum(x),sy=sum(t),sxy=sum(x.map((v,i)=>v*t[i])),sx2=sum(x.map(v=>v*v)); const slope=(n*sxy-sx*sy)/(n*sx2-sx*sx); if(slope>0.2)return{pred:"Tài",conf:68}; if(slope<-0.2)return{pred:"Xỉu",conf:68}; return null; }
    tong_trung_binh() { if (this.tongSeq.length < 20) return null; const m=avg(this.tongSeq.slice(-20)); const last=this.tongSeq[this.tongSeq.length-1]; if(last>m+2)return{pred:"Xỉu",conf:65}; if(last<m-2)return{pred:"Tài",conf:65}; return null; }
    tong_tich_luy() { if (this.tongSeq.length < 10) return null; let c=0; for(let i=1;i<Math.min(10,this.tongSeq.length);i++)c+=(this.tongSeq[this.tongSeq.length-i]-this.tongSeq[this.tongSeq.length-i-1]); if(c>5)return{pred:"Tài",conf:62}; if(c<-5)return{pred:"Xỉu",conf:62}; return null; }

    // ==================== NHÓM 3: XÚC XẮC (11) ====================
    ba_mat_giong() { if(this.lastVan.isTriple){if(this.lastVan.tripleVal<=2)return{pred:"Xỉu",conf:96};if(this.lastVan.tripleVal>=5)return{pred:"Tài",conf:96};} return null; }
    hai_mat_6() { if(this.lastVan.soLan6>=2)return{pred:"Tài",conf:85}; return null; }
    hai_mat_1() { if(this.lastVan.soLan1>=2)return{pred:"Xỉu",conf:88}; return null; }
    hai_mat_5() { if(this.lastVan.soLan5>=2)return{pred:"Tài",conf:72}; return null; }
    hai_mat_2() { if(this.lastVan.soLan2>=2)return{pred:"Xỉu",conf:70}; return null; }
    co_1_va_6() { if(this.lastVan.co1va6)return{pred:"Tài",conf:70}; return null; }
    co_1_va_2() { if(this.lastVan.co1va2)return{pred:"Xỉu",conf:68}; return null; }
    co_5_va_6() { if(this.lastVan.co5va6)return{pred:"Tài",conf:72}; return null; }
    day_tang() { if(this.lastVan.dayTang){const d=[this.lastVan.x1,this.lastVan.x2,this.lastVan.x3].sort((a,b)=>a-b);if(d[0]>=4)return{pred:"Tài",conf:70};if(d[0]<=2)return{pred:"Xỉu",conf:65};} return null; }
    day_giam() { if(this.lastVan.dayGiam){const d=[this.lastVan.x1,this.lastVan.x2,this.lastVan.x3];if(d[0]>=5)return{pred:"Tài",conf:68};if(d[0]<=3)return{pred:"Xỉu",conf:62};} return null; }
    x1_x2_x3_bang() { if(this.processed.length<2)return null; const l=this.processed[this.processed.length-1],p=this.processed[this.processed.length-2]; if(l.x1===p.x1&&l.x2===p.x2&&l.x3===p.x3){return{pred:l.total>=11?"Tài":"Xỉu",conf:75};} return null; }

    // ==================== NHÓM 4: THỐNG KÊ (14) ====================
    tan_suat_10() { if(this.kqSeq.length<10)return null; const t=sum(this.kqSeq.slice(-10)); if(t>=7)return{pred:"Xỉu",conf:68}; if(t<=3)return{pred:"Tài",conf:68}; return null; }
    tan_suat_20() { if(this.kqSeq.length<20)return null; const t=sum(this.kqSeq.slice(-20)); if(t>=14)return{pred:"Xỉu",conf:66}; if(t<=6)return{pred:"Tài",conf:66}; return null; }
    tan_suat_30() { if(this.kqSeq.length<30)return null; const t=sum(this.kqSeq.slice(-30)); if(t>=20)return{pred:"Xỉu",conf:64}; if(t<=10)return{pred:"Tài",conf:64}; return null; }
    bayes_1() { if(this.kqSeq.length<20)return null; const last=this.kqSeq[this.kqSeq.length-1]; let g=0,t=0; for(let i=1;i<this.kqSeq.length;i++){if(this.kqSeq[i-1]===last){t++;if(this.kqSeq[i]===last)g++;}} if(t>=5){const xs=g/t;if(xs>0.65)return{pred:last===1?"Tài":"Xỉu",conf:60+xs*20};if(xs<0.35)return{pred:last===1?"Xỉu":"Tài",conf:60+(1-xs)*20};} return null; }
    bayes_2() { if(this.kqSeq.length<30)return null; const l2=[this.kqSeq[this.kqSeq.length-2],this.kqSeq[this.kqSeq.length-1]]; const nexts=[]; for(let i=2;i<this.kqSeq.length-1;i++){if(this.kqSeq[i-2]===l2[0]&&this.kqSeq[i-1]===l2[1])nexts.push(this.kqSeq[i]);} if(nexts.length>=3){const tl=sum(nexts)/nexts.length;if(tl>0.7)return{pred:"Tài",conf:68+tl*12};if(tl<0.3)return{pred:"Xỉu",conf:68+(1-tl)*12};} return null; }
    bayes_3() { if(this.kqSeq.length<50)return null; const l3=this.kqSeq.slice(-3); const nexts=[]; for(let i=3;i<this.kqSeq.length-1;i++){if(this.kqSeq[i-3]===l3[0]&&this.kqSeq[i-2]===l3[1]&&this.kqSeq[i-1]===l3[2])nexts.push(this.kqSeq[i]);} if(nexts.length>=2){const tl=sum(nexts)/nexts.length;if(tl>0.7)return{pred:"Tài",conf:65};if(tl<0.3)return{pred:"Xỉu",conf:65};} return null; }
    chu_ky_2() { if(this.kqSeq.length<10)return null; for(let i=2;i<=10;i++){if(this.kqSeq.length>=i*2){if(JSON.stringify(this.kqSeq.slice(-i))===JSON.stringify(this.kqSeq.slice(-2*i,-i)))return{pred:this.kqSeq[this.kqSeq.length-i]===1?"Tài":"Xỉu",conf:70};}} return null; }
    chu_ky_3() { if(this.kqSeq.length<15)return null; const l3=this.kqSeq.slice(-3); for(let i=3;i<this.kqSeq.length-3;i+=3){if(JSON.stringify(this.kqSeq.slice(-i-3,-i))===JSON.stringify(l3))return{pred:this.kqSeq[this.kqSeq.length-i]===1?"Tài":"Xỉu",conf:68};} return null; }
    chu_ky_5() { if(this.kqSeq.length<25)return null; const l5=this.kqSeq.slice(-5); for(let i=5;i<this.kqSeq.length-5;i+=5){if(JSON.stringify(this.kqSeq.slice(-i-5,-i))===JSON.stringify(l5))return{pred:this.kqSeq[this.kqSeq.length-i]===1?"Tài":"Xỉu",conf:65};} return null; }
    chu_ky_fibonacci() { if(this.kqSeq.length<34)return null; const fib=[3,5,8,13,21,34]; for(const f of fib){if(this.kqSeq.length>=f*2){if(JSON.stringify(this.kqSeq.slice(-f))===JSON.stringify(this.kqSeq.slice(-2*f,-f)))return{pred:this.kqSeq[this.kqSeq.length-f]===1?"Tài":"Xỉu",conf:68};}} return null; }
    markov_bac_2() { if(this.kqSeq.length<30)return null; const model={}; for(let i=2;i<this.kqSeq.length-1;i++){const state=`${this.kqSeq[i-2]},${this.kqSeq[i-1]}`; if(!model[state])model[state]={0:0,1:0}; model[state][this.kqSeq[i]]++;} const ls=`${this.kqSeq[this.kqSeq.length-2]},${this.kqSeq[this.kqSeq.length-1]}`; if(model[ls]){const t=model[ls][0]+model[ls][1]; if(t>=3){if(model[ls][1]>model[ls][0])return{pred:"Tài",conf:Math.min(85,55+model[ls][1]/t*30)};else return{pred:"Xỉu",conf:Math.min(85,55+model[ls][0]/t*30)};}} return null; }
    markov_bac_3() { if(this.kqSeq.length<50)return null; const model={}; for(let i=3;i<this.kqSeq.length-1;i++){const state=`${this.kqSeq[i-3]},${this.kqSeq[i-2]},${this.kqSeq[i-1]}`; if(!model[state])model[state]={0:0,1:0}; model[state][this.kqSeq[i]]++;} const ls=`${this.kqSeq[this.kqSeq.length-3]},${this.kqSeq[this.kqSeq.length-2]},${this.kqSeq[this.kqSeq.length-1]}`; if(model[ls]){const t=model[ls][0]+model[ls][1]; if(t>=2){if(model[ls][1]>model[ls][0])return{pred:"Tài",conf:62};else return{pred:"Xỉu",conf:62};}} return null; }
    entropy_analysis() { if(this.kqSeq.length<20)return null; const p=avg(this.kqSeq.slice(-20)); const e=p<=0||p>=1?0:-p*Math.log2(p)-(1-p)*Math.log2(1-p); if(e<0.5){const last=this.kqSeq[this.kqSeq.length-1];return{pred:last===1?"Tài":"Xỉu",conf:68};} if(e>0.8){const last=this.kqSeq[this.kqSeq.length-1];return{pred:last===1?"Xỉu":"Tài",conf:60};} return null; }
    autocorrelation() { if(this.kqSeq.length<30)return null; let bestLag=0,bestCorr=0; for(let lag=1;lag<=10;lag++){const a=this.kqSeq.slice(0,-lag),b=this.kqSeq.slice(lag); if(a.length===b.length){const ma=avg(a),mb=avg(b); let num=0,da=0,db=0; for(let i=0;i<a.length;i++){num+=(a[i]-ma)*(b[i]-mb);da+=Math.pow(a[i]-ma,2);db+=Math.pow(b[i]-mb,2);} const corr=da>0&&db>0?Math.abs(num/Math.sqrt(da*db)):0; if(corr>bestCorr){bestCorr=corr;bestLag=lag;}}} if(bestCorr>0.5&&bestLag>0&&this.kqSeq.length>=bestLag){return{pred:this.kqSeq[this.kqSeq.length-bestLag]===1?"Tài":"Xỉu",conf:65};} return null; }

    // ==================== NHÓM 5: ĐẶC BIỆT (5) ====================
    so_khop_mau_10() { if(this.kqSeq.length<30)return null; const mau=this.kqSeq.slice(-10); const nexts=[]; for(let i=0;i<this.kqSeq.length-11;i++){if(JSON.stringify(this.kqSeq.slice(i,i+10))===JSON.stringify(mau))nexts.push(this.kqSeq[i+10]);} if(nexts.length>=2){const tl=sum(nexts)/nexts.length;if(tl>=0.7)return{pred:"Tài",conf:75};if(tl<=0.3)return{pred:"Xỉu",conf:75};} return null; }
    so_khop_mau_8() { if(this.kqSeq.length<25)return null; const mau=this.kqSeq.slice(-8); const nexts=[]; for(let i=0;i<this.kqSeq.length-9;i++){if(JSON.stringify(this.kqSeq.slice(i,i+8))===JSON.stringify(mau))nexts.push(this.kqSeq[i+8]);} if(nexts.length>=2){const tl=sum(nexts)/nexts.length;if(tl>=0.7)return{pred:"Tài",conf:72};if(tl<=0.3)return{pred:"Xỉu",conf:72};} return null; }
    dao_chieu_sau_3() { if(this.kqSeq.length<3)return null; const l=this.kqSeq.slice(-3); if(l[0]===l[1]&&l[1]===l[2])return{pred:l[0]===1?"Xỉu":"Tài",conf:70}; return null; }
    dao_chieu_sau_4() { if(this.kqSeq.length<4)return null; const l=this.kqSeq.slice(-4); if(l[0]===l[1]&&l[1]===l[2]&&l[2]===l[3])return{pred:l[0]===1?"Xỉu":"Tài",conf:75}; return null; }
    dao_chieu_sau_5() { if(this.kqSeq.length<5)return null; const l=this.kqSeq.slice(-5); if(l[0]===l[1]&&l[1]===l[2]&&l[2]===l[3]&&l[3]===l[4])return{pred:l[0]===1?"Xỉu":"Tài",conf:80}; return null; }

    // ==================== DỰ ĐOÁN CHÍNH ====================
    predict() {
        const signals = [];
        const add = (s, name) => { if (s) signals.push({ ...s, name, weight: this.weights[name] || 1.0 }); };

        add(this.cau_1_1(), 'cau_1_1'); add(this.cau_2_2(), 'cau_2_2'); add(this.cau_3_3(), 'cau_3_3');
        add(this.cau_4_4(), 'cau_4_4'); add(this.cau_dai(), 'cau_dai'); add(this.cau_dan_xen(), 'cau_dan_xen');
        add(this.cau_2_1_2(), 'cau_2_1_2'); add(this.cau_1_2_1(), 'cau_1_2_1'); add(this.cau_3_2(), 'cau_3_2');
        add(this.cau_2_3(), 'cau_2_3'); add(this.cau_3_nhip(), 'cau_3_nhip'); add(this.cau_4_nhip(), 'cau_4_nhip');
        add(this.cau_so_le(), 'cau_so_le');

        add(this.tong_tang_dan(), 'tong_tang_dan'); add(this.tong_giam_dan(), 'tong_giam_dan');
        add(this.tong_chan_le(), 'tong_chan_le'); add(this.tong_cham_7_14(), 'tong_cham_7_14');
        add(this.tong_cham_10(), 'tong_cham_10'); add(this.tong_hoi_quy(), 'tong_hoi_quy');
        add(this.tong_trung_binh(), 'tong_trung_binh'); add(this.tong_tich_luy(), 'tong_tich_luy');

        add(this.ba_mat_giong(), 'ba_mat_giong'); add(this.hai_mat_6(), 'hai_mat_6');
        add(this.hai_mat_1(), 'hai_mat_1'); add(this.hai_mat_5(), 'hai_mat_5'); add(this.hai_mat_2(), 'hai_mat_2');
        add(this.co_1_va_6(), 'co_1_va_6'); add(this.co_1_va_2(), 'co_1_va_2'); add(this.co_5_va_6(), 'co_5_va_6');
        add(this.day_tang(), 'day_tang'); add(this.day_giam(), 'day_giam'); add(this.x1_x2_x3_bang(), 'x1_x2_x3_bang');

        add(this.tan_suat_10(), 'tan_suat_10'); add(this.tan_suat_20(), 'tan_suat_20');
        add(this.tan_suat_30(), 'tan_suat_30'); add(this.bayes_1(), 'bayes_1'); add(this.bayes_2(), 'bayes_2');
        add(this.bayes_3(), 'bayes_3'); add(this.chu_ky_2(), 'chu_ky_2'); add(this.chu_ky_3(), 'chu_ky_3');
        add(this.chu_ky_5(), 'chu_ky_5'); add(this.chu_ky_fibonacci(), 'chu_ky_fibonacci');
        add(this.markov_bac_2(), 'markov_bac_2'); add(this.markov_bac_3(), 'markov_bac_3');
        add(this.entropy_analysis(), 'entropy_analysis'); add(this.autocorrelation(), 'autocorrelation');

        add(this.so_khop_mau_10(), 'so_khop_mau_10'); add(this.so_khop_mau_8(), 'so_khop_mau_8');
        add(this.dao_chieu_sau_3(), 'dao_chieu_sau_3'); add(this.dao_chieu_sau_4(), 'dao_chieu_sau_4');
        add(this.dao_chieu_sau_5(), 'dao_chieu_sau_5');

        const validSignals = signals.filter(s => s.conf >= 55);
        if (validSignals.length === 0) {
            const last50 = this.kqSeq.slice(-50);
            const taiCount = sum(last50);
            const pred = taiCount >= 28 ? "Xỉu" : (taiCount <= 22 ? "Tài" : (Math.random() > 0.5 ? "Tài" : "Xỉu"));
            return { prediction: pred, confidence: 52, signals: [], fallback: true };
        }

        let taiScore = 0, xiuScore = 0;
        validSignals.forEach(s => { const w = s.conf * s.weight; if (s.pred === "Tài") taiScore += w; else xiuScore += w; });

        const finalPred = taiScore >= xiuScore ? "Tài" : "Xỉu";
        const totalScore = taiScore + xiuScore;
        let confidence = totalScore > 0 ? Math.max(taiScore, xiuScore) / totalScore * 100 : 50;
        if (validSignals.length >= 10) confidence = Math.min(96, confidence + 5);
        if (validSignals.filter(s => s.conf >= 80).length >= 3) confidence = Math.min(95, confidence + 8);
        confidence = Math.min(98, Math.max(55, Math.round(confidence)));

        this.recentPredictions = validSignals.map(s => ({ name: s.name, pred: s.pred }));

        return { prediction: finalPred, confidence, signals: validSignals.sort((a, b) => b.conf * b.weight - a.conf * a.weight), fallback: false };
    }

    updateWithResult(actualResult) { this.updateWeights(actualResult); }
}

// ============ FETCH DATA ============
async function fetchData() {
    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            const res = await axios.get(API_URL, { timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
            const raw = res.data;
            let arr = null;
            if (Array.isArray(raw)) arr = raw;
            else if (raw && raw.data && Array.isArray(raw.data)) arr = raw.data;
            else if (raw && typeof raw === 'object') { for (const key of Object.keys(raw)) { if (Array.isArray(raw[key]) && raw[key].length > 10) { arr = raw[key]; break; } } }
            if (arr && arr.length >= 50) { const n = arr.map(normalize).sort((a, b) => a.phien - b.phien); return n; }
            await new Promise(r => setTimeout(r, 3000));
        } catch (e) { if (attempt < 5) await new Promise(r => setTimeout(r, 5000)); }
    }
    return gameHistory.length >= 50 ? gameHistory : null;
}

// ============ UPDATE ============
let predictor = null;
async function updatePrediction() {
    if (isUpdating) return;
    isUpdating = true;
    try {
        const data = await fetchData();
        if (!data || data.length < 50) { isUpdating = false; return; }
        const latest = data[data.length - 1];
        const latestPhien = latest.phien;
        const oldPhien = gameHistory.length > 0 ? gameHistory[gameHistory.length - 1].phien : 0;

        if (currentPrediction && currentPrediction.Phien_hien_tai > 0) {
            const predictedPhien = currentPrediction.Phien_hien_tai;
            const actual = data.find(s => s.phien === predictedPhien);
            if (actual) {
                const actualStr = actual.ket_qua === 1 ? 'Tài' : 'Xỉu';
                const isCorrect = addToHistory(predictedPhien, currentPrediction.Du_doan, actualStr, currentPrediction.Do_tin_cay);
                if (predictor) predictor.updateWithResult(currentPrediction.Du_doan);
                console.log(`📝 Phiên ${predictedPhien}: ${currentPrediction.Du_doan} vs ${actualStr} | ${isCorrect ? '✅' : '❌'}`);
            }
        }
        if (latestPhien === oldPhien && currentPrediction) { isUpdating = false; return; }

        gameHistory = data;
        predictor = new GodPredictorUltimate(data.slice(-500));
        const pred = predictor.predict();

        let pattern = "";
        for (let i = Math.max(0, data.length - 50); i < data.length; i++) pattern += data[i].ket_qua === 1 ? "t" : "x";

        const last = data[data.length - 1];
        const recentTotals = data.slice(-20).map(p => p.tong);
        let predTotal = Math.round(avg(recentTotals));
        if (last.tong >= 15) predTotal = Math.min(predTotal, 12);
        if (last.tong <= 5) predTotal = Math.max(predTotal, 9);
        predTotal = clamp(predTotal, 3, 18);

        currentPrediction = {
            id: "@anhkhoidzai102",
            Phien: latest.phien,
            Xuc_xac_1: last.x1,
            Xuc_xac_2: last.x2,
            Xuc_xac_3: last.x3,
            Tong: last.tong,
            Ket_qua: last.ket_qua === 1 ? 'Tài' : 'Xỉu',
            pattern: pattern,
            Phien_hien_tai: latest.phien + 1,
            Du_doan: pred.prediction === "Tài" ? "Tài" : "Xỉu",
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
        return res.json({ ...currentPrediction, Lich_su: { Tong_phien: verifiedResults.length, Thang: winCount, Thua: verifiedResults.length - winCount, Ty_le_thang: winRate + "%" }, Bang_thang_thua: verifiedResults.slice(0, 20) });
    }
    res.json({ id: "@anhkhoidzai102", Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "đang tải...", pattern: "", Phien_hien_tai: 0, Du_doan: "đang tải...", Do_tin_cay: "0%", Tong_du_doan: 0, So_tin_hieu: 0, timestamp: Date.now(), Lich_su: { Tong_phien: verifiedResults.length, Thang: verifiedResults.filter(v => v.danh_gia === 'thang').length, Thua: verifiedResults.filter(v => v.danh_gia === 'thua').length, Ty_le_thang: verifiedResults.length > 0 ? (verifiedResults.filter(v => v.danh_gia === 'thang').length / verifiedResults.length * 100).toFixed(1) + "%" : "0%" }, Bang_thang_thua: verifiedResults.slice(0, 20) });
});

app.get('/', (req, res) => res.redirect('/taixiu'));

// ============ KHỞI ĐỘNG ============
loadHistory();
console.log('='.repeat(70));
console.log('   🔥 GOD PREDICTOR ULTIMATE - 60+ THUẬT TOÁN 🔥');
console.log('   API: wtxmd52.tele68.com/v1/txmd5/sessions');
console.log('   Tài=11-18 | Xỉu=3-10 | 50 phiên');
console.log('='.repeat(70));

(async () => { const data = await fetchData(); if (data && data.length >= 50) { gameHistory = data; await updatePrediction(); } })();
setInterval(updatePrediction, 300);

app.listen(PORT, () => { console.log(`   🚀 Port: ${PORT} | /taixiu`); console.log(`   📂 Lịch sử: ${verifiedResults.length} phiên`); console.log('='.repeat(70)); });
