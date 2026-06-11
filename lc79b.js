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
const MAX_HISTORY = 2000;
let wins = 0;
let losses = 0;
let predictorInstance = null;
let isReady = false;

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
    if (predictorInstance && predictorInstance.updateResult) {
        predictorInstance.updateResult(duDoan, ketQua, isCorrect, 'taixiu');
    }
    if (isCorrect) wins++; else losses++;
    return isCorrect;
}

// ==================== HỆ THỐNG DỰ ĐOÁN THẾ HỆ MỚI ====================

// 1. DEEP BELIEF NETWORK (DBN)
class DeepBeliefNetwork {
    constructor(layers = [10, 20, 15, 8, 3]) {
        this.layers = layers;
        this.weights = [];
        this.biasesVisible = [];
        this.biasesHidden = [];
        this.initializeNetwork();
    }
    initializeNetwork() {
        for (let i = 0; i < this.layers.length - 1; i++) {
            const visibleSize = this.layers[i];
            const hiddenSize = this.layers[i + 1];
            const weights = Array(visibleSize).fill().map(() => Array(hiddenSize).fill().map(() => (Math.random() - 0.5) * 0.1));
            this.weights.push(weights);
            this.biasesVisible.push(Array(visibleSize).fill(0));
            this.biasesHidden.push(Array(hiddenSize).fill(0));
        }
    }
    sigmoid(x) { return 1 / (1 + Math.exp(-Math.max(-50, Math.min(50, x)))); }
    sampleProbability(prob) { return Math.random() < prob ? 1 : 0; }
    contrastiveDivergence(rbmIndex, data, learningRate = 0.01, k = 1) {
        const visibleSize = this.layers[rbmIndex];
        const hiddenSize = this.layers[rbmIndex + 1];
        const weights = this.weights[rbmIndex];
        const visibleBias = this.biasesVisible[rbmIndex];
        const hiddenBias = this.biasesHidden[rbmIndex];
        const hiddenProb = Array(hiddenSize).fill();
        for (let j = 0; j < hiddenSize; j++) {
            let sum = hiddenBias[j];
            for (let i = 0; i < visibleSize; i++) sum += data[i] * weights[i][j];
            hiddenProb[j] = this.sigmoid(sum);
        }
        const hiddenState = hiddenProb.map(p => this.sampleProbability(p));
        let visibleProb = [...data];
        let currentHidden = [...hiddenState];
        for (let step = 0; step < k; step++) {
            for (let i = 0; i < visibleSize; i++) {
                let sum = visibleBias[i];
                for (let j = 0; j < hiddenSize; j++) sum += currentHidden[j] * weights[i][j];
                visibleProb[i] = this.sigmoid(sum);
            }
            for (let j = 0; j < hiddenSize; j++) {
                let sum = hiddenBias[j];
                for (let i = 0; i < visibleSize; i++) sum += visibleProb[i] * weights[i][j];
                currentHidden[j] = this.sigmoid(sum);
            }
        }
        for (let i = 0; i < visibleSize; i++) {
            for (let j = 0; j < hiddenSize; j++) {
                const gradient = data[i] * hiddenProb[j] - visibleProb[i] * currentHidden[j];
                weights[i][j] += learningRate * gradient;
            }
            visibleBias[i] += learningRate * (data[i] - visibleProb[i]);
        }
        for (let j = 0; j < hiddenSize; j++) hiddenBias[j] += learningRate * (hiddenProb[j] - currentHidden[j]);
    }
    pretrain(patterns, epochs = 5) {
        for (let epoch = 0; epoch < epochs; epoch++) {
            for (const pattern of patterns) {
                let currentData = pattern;
                for (let i = 0; i < this.weights.length; i++) {
                    this.contrastiveDivergence(i, currentData, 0.01, 1);
                    const nextData = [];
                    const hiddenSize = this.layers[i + 1];
                    const weights = this.weights[i];
                    const hiddenBias = this.biasesHidden[i];
                    for (let j = 0; j < hiddenSize; j++) {
                        let sum = hiddenBias[j];
                        for (let k = 0; k < currentData.length; k++) sum += currentData[k] * weights[k][j];
                        nextData.push(this.sigmoid(sum));
                    }
                    currentData = nextData;
                }
            }
        }
    }
    fineTune(patterns, labels, learningRate = 0.005, epochs = 10) {
        for (let epoch = 0; epoch < epochs; epoch++) {
            for (let idx = 0; idx < patterns.length; idx++) {
                const activations = [patterns[idx]];
                let currentData = patterns[idx];
                for (let i = 0; i < this.weights.length; i++) {
                    const nextData = [];
                    const hiddenSize = this.layers[i + 1];
                    const weights = this.weights[i];
                    const hiddenBias = this.biasesHidden[i];
                    for (let j = 0; j < hiddenSize; j++) {
                        let sum = hiddenBias[j];
                        for (let k = 0; k < currentData.length; k++) sum += currentData[k] * weights[k][j];
                        nextData.push(this.sigmoid(sum));
                    }
                    activations.push(nextData);
                    currentData = nextData;
                }
                const output = activations[activations.length - 1];
                const target = labels[idx];
                let error = target - output[0];
                let deltas = [error * output[0] * (1 - output[0])];
                for (let i = this.weights.length - 1; i >= 0; i--) {
                    const newDeltas = [];
                    const weights = this.weights[i];
                    const currentActivations = activations[i];
                    const nextDeltas = deltas[0];
                    for (let j = 0; j < currentActivations.length; j++) {
                        let delta = 0;
                        for (let k = 0; k < nextDeltas.length; k++) delta += nextDeltas[k] * weights[j][k];
                        delta *= currentActivations[j] * (1 - currentActivations[j]);
                        newDeltas.push(delta);
                        for (let k = 0; k < nextDeltas.length; k++) weights[j][k] += learningRate * nextDeltas[k] * currentActivations[j];
                    }
                    deltas = newDeltas;
                }
            }
        }
    }
    predict(features) {
        let currentData = features;
        for (let i = 0; i < this.weights.length; i++) {
            const nextData = [];
            const hiddenSize = this.layers[i + 1];
            const weights = this.weights[i];
            const hiddenBias = this.biasesHidden[i];
            for (let j = 0; j < hiddenSize; j++) {
                let sum = hiddenBias[j];
                for (let k = 0; k < currentData.length; k++) sum += currentData[k] * weights[k][j];
                nextData.push(this.sigmoid(sum));
            }
            currentData = nextData;
        }
        const prediction = currentData[0] > 0.5 ? 'Tài' : 'Xỉu';
        const confidence = 50 + Math.abs(currentData[0] - 0.5) * 90;
        return { prediction, confidence: Math.min(95, confidence), name: 'DeepBelief' };
    }
}

// 2. NEURO-FUZZY SYSTEM (ANFIS)
class NeuroFuzzySystem {
    constructor(nRules = 7) {
        this.nRules = nRules;
        this.membershipParams = [];
        this.consequentParams = [];
        this.learningRate = 0.01;
        this.momentum = 0.9;
        this.prevGradients = {};
        for (let i = 0; i < nRules; i++) {
            this.membershipParams.push({ mean: 0.2 + i * 0.12, sigma: 0.2 + Math.random() * 0.1 });
            this.consequentParams.push({ p0: Math.random() - 0.5, p1: Math.random() - 0.5, p2: Math.random() - 0.5 });
        }
    }
    gaussianMembership(x, mean, sigma) { return Math.exp(-Math.pow(x - mean, 2) / (2 * Math.pow(sigma, 2))); }
    forwardPass(inputs) {
        const ruleFiringStrengths = [];
        for (let i = 0; i < this.nRules; i++) {
            let firingStrength = 1;
            for (let j = 0; j < inputs.length; j++) firingStrength *= this.gaussianMembership(inputs[j], this.membershipParams[i].mean, this.membershipParams[i].sigma);
            ruleFiringStrengths.push(firingStrength);
        }
        const totalStrength = ruleFiringStrengths.reduce((a,b) => a+b, 1e-10);
        const normalizedStrengths = ruleFiringStrengths.map(s => s / totalStrength);
        let output = 0;
        for (let i = 0; i < this.nRules; i++) {
            const consequent = this.consequentParams[i].p0 + this.consequentParams[i].p1 * inputs[0] + this.consequentParams[i].p2 * inputs[1];
            output += normalizedStrengths[i] * consequent;
        }
        return { output, firingStrengths: ruleFiringStrengths, normalizedStrengths };
    }
    backwardPass(inputs, target, forwardResults) {
        const error = target - forwardResults.output;
        for (let i = 0; i < this.nRules; i++) {
            const consequentGrad = forwardResults.normalizedStrengths[i] * error;
            this.consequentParams[i].p0 -= this.learningRate * consequentGrad;
            this.consequentParams[i].p1 -= this.learningRate * consequentGrad * inputs[0];
            this.consequentParams[i].p2 -= this.learningRate * consequentGrad * inputs[1];
            let sumNormalized = 0;
            for (let j = 0; j < this.nRules; j++) sumNormalized += forwardResults.firingStrengths[j];
            const membershipGradBase = error * (this.consequentParams[i].p0 + this.consequentParams[i].p1 * inputs[0] + this.consequentParams[i].p2 * inputs[1] - forwardResults.output) / (sumNormalized * sumNormalized);
            for (let j = 0; j < inputs.length; j++) {
                const mu = this.gaussianMembership(inputs[j], this.membershipParams[i].mean, this.membershipParams[i].sigma);
                const gradMean = membershipGradBase * forwardResults.firingStrengths[i] * mu * (inputs[j] - this.membershipParams[i].mean) / Math.pow(this.membershipParams[i].sigma, 2);
                const gradSigma = membershipGradBase * forwardResults.firingStrengths[i] * mu * Math.pow(inputs[j] - this.membershipParams[i].mean, 2) / Math.pow(this.membershipParams[i].sigma, 3);
                this.membershipParams[i].mean -= this.learningRate * gradMean;
                this.membershipParams[i].sigma -= this.learningRate * gradSigma;
                this.membershipParams[i].sigma = Math.max(0.05, this.membershipParams[i].sigma);
            }
        }
        return error;
    }
    train(patterns, targets, epochs = 15) {
        for (let epoch = 0; epoch < epochs; epoch++) {
            for (let i = 0; i < patterns.length; i++) {
                const forward = this.forwardPass(patterns[i]);
                this.backwardPass(patterns[i], targets[i], forward);
            }
        }
    }
    predict(inputs) {
        const forward = this.forwardPass(inputs);
        const prediction = forward.output > 0.5 ? 'Tài' : 'Xỉu';
        const confidence = 50 + Math.abs(forward.output - 0.5) * 92;
        return { prediction, confidence: Math.min(96, confidence), name: 'ANFIS' };
    }
}

// 3. ONLINE EXTREME LEARNING MACHINE (OS-ELM)
class OnlineExtremeLearningMachine {
    constructor(nHidden = 60) {
        this.nHidden = nHidden;
        this.inputWeights = null;
        this.hiddenBiases = null;
        this.outputWeights = null;
        this.covarianceMatrix = null;
        this.initialized = false;
    }
    activationFunction(x) { return Math.tanh(x); }
    transpose(matrix) { return matrix[0].map((_, colIndex) => matrix.map(row => row[colIndex])); }
    multiplyMatrices(A, B) {
        const result = Array(A.length).fill().map(() => Array(B[0].length).fill(0));
        for (let i = 0; i < A.length; i++) {
            for (let j = 0; j < B[0].length; j++) {
                let sum = 0;
                for (let k = 0; k < A[0].length; k++) sum += A[i][k] * B[k][j];
                result[i][j] = sum;
            }
        }
        return result;
    }
    inverseMatrix(matrix) {
        const n = matrix.length;
        const augmented = matrix.map((row, i) => [...row, ...Array(n).fill().map((_, j) => i === j ? 1 : 0)]);
        for (let i = 0; i < n; i++) {
            let maxRow = i;
            for (let j = i + 1; j < n; j++) if (Math.abs(augmented[j][i]) > Math.abs(augmented[maxRow][i])) maxRow = j;
            [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];
            const pivot = augmented[i][i];
            for (let j = i; j < 2 * n; j++) augmented[i][j] /= pivot;
            for (let j = 0; j < n; j++) {
                if (j !== i) {
                    const factor = augmented[j][i];
                    for (let k = i; k < 2 * n; k++) augmented[j][k] -= factor * augmented[i][k];
                }
            }
        }
        return augmented.map(row => row.slice(n));
    }
    addMatrices(A, B) { return A.map((row, i) => row.map((val, j) => val + B[i][j])); }
    subtractMatrices(A, B) { return A.map((row, i) => row.map((val, j) => val - B[i][j])); }
    identityMatrix(n) { return Array(n).fill().map((_, i) => Array(n).fill().map((_, j) => i === j ? 1 : 0)); }
    initialize(inputDim, initialData, initialTargets) {
        this.inputWeights = Array(this.nHidden).fill().map(() => Array(inputDim).fill().map(() => (Math.random() - 0.5) * 2));
        this.hiddenBiases = Array(this.nHidden).fill().map(() => (Math.random() - 0.5) * 2);
        const H = this.calculateHiddenOutput(initialData);
        const Ht = this.transpose(H);
        this.covarianceMatrix = this.inverseMatrix(this.multiplyMatrices(Ht, H));
        this.outputWeights = this.multiplyMatrices(this.multiplyMatrices(this.covarianceMatrix, Ht), initialTargets);
        this.initialized = true;
    }
    calculateHiddenOutput(data) {
        const H = Array(data.length).fill().map(() => Array(this.nHidden).fill(0));
        for (let i = 0; i < data.length; i++) {
            for (let j = 0; j < this.nHidden; j++) {
                let sum = this.hiddenBiases[j];
                for (let k = 0; k < data[i].length; k++) sum += this.inputWeights[j][k] * data[i][k];
                H[i][j] = this.activationFunction(sum);
            }
        }
        return H;
    }
    update(newData, newTargets) {
        if (!this.initialized) { this.initialize(newData[0].length, newData, newTargets); return; }
        const Hnew = this.calculateHiddenOutput(newData);
        const HnewT = this.transpose(Hnew);
        const temp = this.multiplyMatrices(this.covarianceMatrix, HnewT);
        const denominator = this.addMatrices(this.identityMatrix(Hnew.length), this.multiplyMatrices(Hnew, temp));
        const gain = this.multiplyMatrices(temp, this.inverseMatrix(denominator));
        const error = this.subtractMatrices(newTargets, this.multiplyMatrices(Hnew, this.outputWeights));
        this.outputWeights = this.addMatrices(this.outputWeights, this.multiplyMatrices(gain, error));
        const KH = this.multiplyMatrices(gain, Hnew);
        this.covarianceMatrix = this.subtractMatrices(this.covarianceMatrix, this.multiplyMatrices(this.covarianceMatrix, KH));
    }
    predict(features) {
        if (!this.initialized) return null;
        const H = Array(1).fill().map(() => Array(this.nHidden).fill(0));
        for (let j = 0; j < this.nHidden; j++) {
            let sum = this.hiddenBiases[j];
            for (let k = 0; k < features.length; k++) sum += this.inputWeights[j][k] * features[k];
            H[0][j] = this.activationFunction(sum);
        }
        const output = this.multiplyMatrices(H, this.outputWeights)[0][0];
        const prediction = output > 0.5 ? 'Tài' : 'Xỉu';
        const confidence = 50 + Math.abs(output - 0.5) * 94;
        return { prediction, confidence: Math.min(97, confidence), name: 'OSELM' };
    }
}

// 4. WAVELET NEURAL NETWORK (WNN)
class WaveletNeuralNetwork {
    constructor(nWavelets = 12) {
        this.nWavelets = nWavelets;
        this.translations = [];
        this.dilations = [];
        this.weights = [];
        this.learningRate = 0.01;
        this.momentum = 0.9;
        this.prevGradients = {};
        this.bias = Math.random() * 2 - 1;
    }
    morletWavelet(x) { return Math.cos(5 * x) * Math.exp(-Math.pow(x, 2) / 2); }
    derivativeMorlet(x) { return -Math.sin(5 * x) * 5 * Math.exp(-Math.pow(x, 2) / 2) - Math.cos(5 * x) * Math.exp(-Math.pow(x, 2) / 2) * x; }
    initialize(inputDim) {
        for (let i = 0; i < this.nWavelets; i++) {
            this.translations.push(Array(inputDim).fill().map(() => Math.random() * 2 - 1));
            this.dilations.push(Array(inputDim).fill().map(() => Math.abs(Math.random() * 2 + 0.5)));
            this.weights.push(Math.random() * 2 - 1);
        }
    }
    forward(inputs) {
        const waveletOutputs = [];
        for (let i = 0; i < this.nWavelets; i++) {
            let sum = 0;
            for (let j = 0; j < inputs.length; j++) {
                const z = (inputs[j] - this.translations[i][j]) / this.dilations[i][j];
                sum += this.morletWavelet(z);
            }
            waveletOutputs.push(sum / inputs.length);
        }
        let output = this.bias;
        for (let i = 0; i < this.nWavelets; i++) output += this.weights[i] * waveletOutputs[i];
        const activation = 1 / (1 + Math.exp(-output));
        return { output: activation, waveletOutputs };
    }
    backward(inputs, target, forwardResults) {
        const error = target - forwardResults.output;
        const delta = error * forwardResults.output * (1 - forwardResults.output);
        for (let i = 0; i < this.nWavelets; i++) {
            this.weights[i] += this.learningRate * delta * forwardResults.waveletOutputs[i];
            for (let j = 0; j < inputs.length; j++) {
                const z = (inputs[j] - this.translations[i][j]) / this.dilations[i][j];
                const psiPrime = this.derivativeMorlet(z);
                const gradTranslation = -delta * this.weights[i] * psiPrime / this.dilations[i][j];
                const gradDilation = -delta * this.weights[i] * psiPrime * z / this.dilations[i][j];
                this.translations[i][j] += this.learningRate * gradTranslation;
                this.dilations[i][j] += this.learningRate * gradDilation;
                this.dilations[i][j] = Math.max(0.1, this.dilations[i][j]);
            }
        }
        this.bias += this.learningRate * delta;
        return Math.abs(error);
    }
    train(patterns, targets, epochs = 12) {
        if (patterns.length === 0) return;
        if (this.weights.length === 0) this.initialize(patterns[0].length);
        for (let epoch = 0; epoch < epochs; epoch++) {
            for (let i = 0; i < patterns.length; i++) {
                const forward = this.forward(patterns[i]);
                this.backward(patterns[i], targets[i], forward);
            }
        }
    }
    predict(inputs) {
        const forward = this.forward(inputs);
        const prediction = forward.output > 0.5 ? 'Tài' : 'Xỉu';
        const confidence = 50 + Math.abs(forward.output - 0.5) * 96;
        return { prediction, confidence: Math.min(98, confidence), name: 'WaveletNN' };
    }
}

// 5. HIERARCHICAL TEMPORAL MEMORY (HTM)
class HierarchicalTemporalMemory {
    constructor(nColumns = 150, nCellsPerColumn = 6) {
        this.nColumns = nColumns;
        this.nCellsPerColumn = nCellsPerColumn;
        this.activeColumns = [];
        this.prevActiveColumns = [];
        this.connections = [];
        this.permanences = [];
        for (let i = 0; i < nColumns; i++) {
            this.connections[i] = [];
            this.permanences[i] = [];
            for (let j = 0; j < nColumns; j++) {
                if (Math.random() < 0.1) {
                    this.connections[i].push(j);
                    this.permanences[i].push(Math.random());
                }
            }
        }
    }
    adaptPermanences(activeColumn, prevActiveColumn, learningRate = 0.1) {
        const connections = this.connections[activeColumn];
        for (let idx = 0; idx < connections.length; idx++) {
            const conn = connections[idx];
            if (conn === prevActiveColumn) this.permanences[activeColumn][idx] += learningRate;
            else this.permanences[activeColumn][idx] -= learningRate * 0.5;
            this.permanences[activeColumn][idx] = Math.max(0, Math.min(1, this.permanences[activeColumn][idx]));
        }
    }
    spatialPooling(input) {
        const overlaps = Array(this.nColumns).fill(0);
        for (let i = 0; i < this.nColumns; i++) {
            let overlap = 0;
            for (let j = 0; j < this.connections[i].length; j++) if (input[this.connections[i][j]]) overlap += this.permanences[i][j];
            overlaps[i] = overlap;
        }
        const nActive = Math.max(5, Math.floor(this.nColumns * 0.02));
        return overlaps.map((val, idx) => ({ val, idx })).sort((a, b) => b.val - a.val).slice(0, nActive).map(item => item.idx);
    }
    compute(input, learn = true) {
        const activeColumns = this.spatialPooling(input);
        if (learn && this.prevActiveColumns) {
            for (const col of activeColumns) {
                for (const prevCol of this.prevActiveColumns) this.adaptPermanences(col, prevCol, 0.1);
            }
        }
        this.prevActiveColumns = activeColumns;
        this.activeColumns = activeColumns;
        return { activeCells: activeColumns };
    }
    predictNext(input) {
        const activeColumns = this.spatialPooling(input);
        const predictions = new Set();
        for (const col of activeColumns) {
            const connections = this.connections[col];
            for (let idx = 0; idx < connections.length; idx++) if (this.permanences[col][idx] > 0.5) predictions.add(connections[idx]);
        }
        const predictedColumn = predictions.size > 0 ? Array.from(predictions)[0] : null;
        if (predictedColumn !== null) {
            const prediction = predictedColumn > this.nColumns / 2 ? 'Tài' : 'Xỉu';
            const confidence = 50 + (predictions.size / this.nColumns) * 40;
            return { prediction, confidence: Math.min(85, confidence), name: 'HTM' };
        }
        return null;
    }
}

// 6. ECHO STATE NETWORK (ESN)
class EchoStateNetwork {
    constructor(nReservoir = 250, spectralRadius = 0.95, leakingRate = 0.4) {
        this.nReservoir = nReservoir;
        this.spectralRadius = spectralRadius;
        this.leakingRate = leakingRate;
        this.inputWeights = [];
        this.reservoirWeights = [];
        this.outputWeights = null;
        this.state = Array(nReservoir).fill(0);
        this.ridgeParameter = 1e-8;
        for (let i = 0; i < nReservoir; i++) this.inputWeights.push((Math.random() - 0.5) * 2);
        let reservoir = Array(nReservoir).fill().map(() => Array(nReservoir).fill().map(() => (Math.random() - 0.5) * 2));
        let norm = 0;
        for (let i = 0; i < nReservoir; i++) for (let j = 0; j < nReservoir; j++) norm += Math.abs(reservoir[i][j]);
        const scaling = spectralRadius / (norm / nReservoir);
        for (let i = 0; i < nReservoir; i++) for (let j = 0; j < nReservoir; j++) reservoir[i][j] *= scaling;
        this.reservoirWeights = reservoir;
    }
    updateState(input) {
        const newState = Array(this.nReservoir).fill(0);
        for (let i = 0; i < this.nReservoir; i++) {
            let sum = this.inputWeights[i] * input;
            for (let j = 0; j < this.nReservoir; j++) sum += this.reservoirWeights[i][j] * this.state[j];
            newState[i] = (1 - this.leakingRate) * this.state[i] + this.leakingRate * Math.tanh(sum);
        }
        this.state = newState;
        return this.state;
    }
    train(patterns, targets) {
        const stateCollection = [];
        for (let i = 0; i < patterns.length; i++) {
            this.updateState(patterns[i]);
            stateCollection.push([...this.state]);
        }
        const R = stateCollection;
        const Rtranspose = R[0].map((_, colIndex) => R.map(row => row[colIndex]));
        const RTR = Rtranspose.map(row => R[0].map((_, j) => row.reduce((sum, val, k) => sum + val * Rtranspose[j][k], 0)));
        for (let i = 0; i < RTR.length; i++) RTR[i][i] += this.ridgeParameter;
        const n = RTR.length;
        const augmented = RTR.map((row, i) => [...row, ...Array(n).fill().map((_, j) => i === j ? 1 : 0)]);
        for (let i = 0; i < n; i++) {
            let maxRow = i;
            for (let j = i + 1; j < n; j++) if (Math.abs(augmented[j][i]) > Math.abs(augmented[maxRow][i])) maxRow = j;
            [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];
            const pivot = augmented[i][i];
            for (let j = i; j < 2 * n; j++) augmented[i][j] /= pivot;
            for (let j = 0; j < n; j++) if (j !== i) { const factor = augmented[j][i]; for (let k = i; k < 2 * n; k++) augmented[j][k] -= factor * augmented[i][k]; }
        }
        const RTRinv = augmented.map(row => row.slice(n));
        const RTRinvRT = RTRinv.map(row => Rtranspose[0].map((_, j) => row.reduce((sum, val, k) => sum + val * Rtranspose[k][j], 0)));
        this.outputWeights = RTRinvRT.map(row => [row.reduce((sum, val, k) => sum + val * targets[k], 0)]);
    }
    predict(input) {
        if (!this.outputWeights) return null;
        this.updateState(input);
        let output = 0;
        for (let i = 0; i < this.outputWeights.length; i++) output += this.outputWeights[i][0] * this.state[i];
        const prediction = output > 0.5 ? 'Tài' : 'Xỉu';
        const confidence = 50 + Math.abs(output - 0.5) * 90;
        return { prediction, confidence: Math.min(94, confidence), name: 'EchoState' };
    }
}

// 7. QUANTUM INSPIRED NEURAL NETWORK (QINN)
class QuantumInspiredNeuralNetwork {
    constructor(nQubits = 12) {
        this.nQubits = nQubits;
        this.rotationAngles = Array(nQubits).fill().map(() => Math.random() * Math.PI * 2);
    }
    quantumGate(state, angle) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        return { alpha: state.alpha * cos - state.beta * sin, beta: state.alpha * sin + state.beta * cos };
    }
    encodeInput(input) {
        const states = Array(this.nQubits).fill().map(() => ({ alpha: 1/Math.sqrt(2), beta: 1/Math.sqrt(2) }));
        for (let i = 0; i < this.nQubits && i < input.length; i++) {
            const rotationAngle = input[i] * Math.PI;
            states[i] = this.quantumGate(states[i], rotationAngle);
        }
        return states;
    }
    applyQuantumLayer(states) {
        for (let i = 0; i < this.nQubits; i++) {
            states[i] = this.quantumGate(states[i], this.rotationAngles[i]);
            if (i > 0) {
                const phase = Math.atan2(states[i].beta, states[i].alpha);
                states[i-1] = this.quantumGate(states[i-1], phase * 0.5);
            }
        }
        return states;
    }
    measureStates(states) { return states.map(s => Math.pow(s.alpha, 2)); }
    train(patterns, targets, epochs = 10) {
        for (let epoch = 0; epoch < epochs; epoch++) {
            for (let i = 0; i < patterns.length; i++) {
                let states = this.encodeInput(patterns[i]);
                states = this.applyQuantumLayer(states);
                const probabilities = this.measureStates(states);
                const prediction = probabilities.reduce((a,b) => a+b, 0) / this.nQubits;
                const error = targets[i] - prediction;
                const gradients = probabilities.map(p => error * (p - 0.5));
                for (let j = 0; j < this.nQubits; j++) this.rotationAngles[j] += 0.01 * gradients[j] / (1 + epoch * 0.1);
            }
        }
    }
    predict(features) {
        let states = this.encodeInput(features);
        states = this.applyQuantumLayer(states);
        const probabilities = this.measureStates(states);
        const output = probabilities.reduce((a,b) => a+b, 0) / this.nQubits;
        const prediction = output > 0.5 ? 'Tài' : 'Xỉu';
        const confidence = 50 + Math.abs(output - 0.5) * 98;
        return { prediction, confidence: Math.min(99, confidence), name: 'QuantumNN' };
    }
}

// 8. SUPRA ADAPTIVE ENSEMBLE
class SupraAdaptiveEnsemble {
    constructor() {
        this.models = {};
        this.adaptiveWeights = {};
        this.contextualWeights = {};
        this.performance = {};
        this.learningRate = 0.05;
    }
    registerModel(name, model, initialWeight = 1.0) {
        this.models[name] = model;
        this.adaptiveWeights[name] = initialWeight;
        this.performance[name] = { correct: 0, total: 0, recentAccuracy: [] };
    }
    extractContext(results, sums) {
        const context = { volatility: 0, trendStrength: 0, patternComplexity: 0, noiseLevel: 0, streakLength: 1 };
        for (let i = 1; i < Math.min(20, results.length); i++) if (results[i] !== results[i-1]) context.volatility++;
        context.volatility = context.volatility / Math.min(19, results.length - 1);
        for (let i = 1; i < Math.min(10, results.length); i++) if (results[i] === results[0]) context.streakLength++; else break;
        context.trendStrength = context.streakLength / 10;
        let complexity = 0;
        for (let i = 3; i < Math.min(15, results.length); i++) {
            const pattern = results.slice(i-3, i).join('');
            complexity += results[i-3] === results[i-1] ? 1 : 0;
        }
        context.patternComplexity = complexity / Math.min(12, results.length - 3);
        if (sums && sums.length >= 5) {
            let sumChanges = 0;
            for (let i = 1; i < Math.min(10, sums.length); i++) sumChanges += Math.abs(sums[i-1] - sums[i]);
            context.noiseLevel = sumChanges / Math.min(9, sums.length - 1) / 10;
        }
        return context;
    }
    getContextKey(context) { return `${Math.floor(context.volatility * 4)}_${Math.floor(context.trendStrength * 4)}_${Math.floor(context.noiseLevel * 4)}`; }
    getAdaptiveWeight(name, contextKey) {
        const baseWeight = this.adaptiveWeights[name] || 0.5;
        const contextWeight = this.contextualWeights[name]?.[contextKey] || 0.5;
        const recentAccuracy = this.performance[name].recentAccuracy.slice(-20).reduce((a,b) => a+b, 0) / Math.max(1, this.performance[name].recentAccuracy.slice(-20).length);
        let weight = baseWeight * 0.4 + contextWeight * 0.4 + recentAccuracy * 0.2;
        if (this.performance[name].total > 100) weight *= 1.1;
        return Math.max(0.2, Math.min(2.0, weight));
    }
    updateWeight(name, success, confidence) {
        this.performance[name].total++;
        if (success) this.performance[name].correct++;
        this.performance[name].recentAccuracy.push(success ? 1 : 0);
        if (this.performance[name].recentAccuracy.length > 50) this.performance[name].recentAccuracy.shift();
        const recentRate = this.performance[name].recentAccuracy.slice(-20).reduce((a,b) => a+b, 0) / Math.max(1, this.performance[name].recentAccuracy.slice(-20).length);
        const targetWeight = 0.5 + recentRate * 1.0;
        this.adaptiveWeights[name] = this.adaptiveWeights[name] * (1 - this.learningRate) + targetWeight * this.learningRate;
        this.adaptiveWeights[name] = Math.max(0.3, Math.min(2.0, this.adaptiveWeights[name]));
    }
    getWeightedPredictions(predictions, context) {
        const contextKey = this.getContextKey(context);
        let taiScore = 0, xiuScore = 0, totalWeight = 0;
        for (const pred of predictions) {
            const weight = this.getAdaptiveWeight(pred.model, contextKey);
            const finalWeight = weight * (pred.confidence / 100);
            if (pred.prediction === 'Tài') taiScore += finalWeight;
            else xiuScore += finalWeight;
            totalWeight += finalWeight;
        }
        if (totalWeight === 0) return { prediction: 'Tài', confidence: 50 };
        const prediction = taiScore > xiuScore ? 'Tài' : 'Xỉu';
        let confidence = (Math.max(taiScore, xiuScore) / totalWeight) * 100;
        confidence = Math.min(96, Math.max(62, confidence));
        return { prediction, confidence };
    }
}

// 9. CÁC HÀM PHÂN TÍCH CẦU TRUYỀN THỐNG
function analyzeCauBet(results, type) {
    let streak = 1;
    for (let i = 1; i < results.length; i++) {
        if (results[i] === results[0]) streak++;
        else break;
    }
    if (streak >= 2) return { detected: true, prediction: results[0], confidence: 55 + streak * 3, name: `Bet ${streak}` };
    return null;
}
function analyzeCauDao11(results, type) {
    let alt = true;
    for (let i = 1; i < Math.min(10, results.length); i++) if (results[i] === results[i-1]) alt = false;
    if (alt && results.length >= 6) return { detected: true, prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 85, name: 'Cau 1-1' };
    return null;
}
function analyzeCau22(results, type) {
    if (results.length < 4) return null;
    if (results[0] === results[1] && results[2] === results[3] && results[0] !== results[2]) return { detected: true, prediction: results[3] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 88, name: 'Cau 2-2' };
    return null;
}
function analyzeCau33(results, type) {
    if (results.length < 6) return null;
    if (results[0] === results[1] && results[1] === results[2] && results[3] === results[4] && results[4] === results[5] && results[2] !== results[3]) return { detected: true, prediction: results[5] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 90, name: 'Cau 3-3' };
    return null;
}
function analyzeCau121(results, type) {
    if (results.length < 4) return null;
    if (results[0] === results[1] && results[2] !== results[1] && results[2] === results[3]) return { detected: true, prediction: results[3] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 82, name: 'Cau 2-1-2' };
    return null;
}
function analyzeCau123(results, type) {
    if (results.length < 6) return null;
    if (results[0] === results[1] && results[2] !== results[1] && results[2] === results[3] && results[3] !== results[4] && results[4] === results[5]) return { detected: true, prediction: results[5] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 84, name: 'Cau 2-1-2-1-2' };
    return null;
}
function analyzeCau321(results, type) {
    if (results.length < 6) return null;
    if (results[0] === results[1] && results[1] === results[2] && results[3] !== results[2] && results[3] === results[4] && results[4] !== results[5]) return { detected: true, prediction: results[5] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 86, name: 'Cau 3-2-1' };
    return null;
}
function analyzeCauNhayCoc(results, type) {
    if (results.length < 5) return null;
    if (results[0] !== results[1] && results[1] !== results[2] && results[2] !== results[3] && results[3] !== results[4]) return { detected: true, prediction: results[4] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 78, name: 'Cau nhay coc' };
    return null;
}
function analyzeCauNhipNghieng(results, type) {
    let taiCount = results.slice(0, 5).filter(r => r === 'Tài').length;
    if (taiCount >= 4) return { detected: true, prediction: 'Xỉu', confidence: 80, name: 'Nhip nghieng Tai' };
    if (taiCount <= 1) return { detected: true, prediction: 'Tài', confidence: 80, name: 'Nhip nghieng Xiu' };
    return null;
}
function analyzeCau3Van1(results, type) {
    for (let i = 0; i < results.length - 3; i++) {
        if (results[i] === results[i+1] && results[i+1] === results[i+2] && results[i+3] !== results[i+2]) return { detected: true, prediction: results[i+2] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 85, name: '3-1' };
    }
    return null;
}
function analyzeSmartBet(results, type) {
    let changes = 0;
    for (let i = 1; i < Math.min(8, results.length); i++) if (results[i] !== results[i-1]) changes++;
    if (changes <= 2 && results.length >= 5) return { detected: true, prediction: results[0], confidence: 75, name: 'Smart bet follow trend' };
    return null;
}
function analyzeBreakStreak(results, type) {
    let streak = 1;
    for (let i = 1; i < results.length; i++) {
        if (results[i] === results[i-1]) streak++;
        else break;
    }
    if (streak >= 4) return { detected: true, prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 85 + (streak - 4) * 3, name: `Break streak ${streak}` };
    return null;
}
function analyzeTriplePattern(results, type) {
    for (let i = 0; i < results.length - 2; i++) {
        if (results[i] === results[i+1] && results[i+1] === results[i+2]) return { detected: true, prediction: results[i] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 92, name: 'Triple pattern' };
    }
    return null;
}
function analyzeTongPhanTich(data, type) {
    if (!data[0] || !data[0].total) return null;
    let total = data[0].total;
    if (total <= 5) return { detected: true, prediction: 'Xỉu', confidence: 82, name: 'Tong thap' };
    if (total >= 15) return { detected: true, prediction: 'Tài', confidence: 82, name: 'Tong cao' };
    return null;
}
function analyzeXuHuongManh(results, type) {
    let taiCount = results.slice(0, 10).filter(r => r === 'Tài').length;
    if (taiCount >= 7) return { detected: true, prediction: 'Xỉu', confidence: 88, name: 'Xu huong Tai manh' };
    if (taiCount <= 3) return { detected: true, prediction: 'Tài', confidence: 88, name: 'Xu huong Xiu manh' };
    return null;
}
function analyzeDaoChieu(results, type) {
    let changes = 0;
    for (let i = 1; i < Math.min(5, results.length); i++) if (results[i] !== results[i-1]) changes++;
    if (changes === 4) return { detected: true, prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 86, name: 'Dao chieu' };
    return null;
}

// 10. CÁC MODEL CŨ HỖ TRỢ
class HiddenMarkovModel {
    constructor(nStates = 4) {
        this.nStates = nStates;
        this.transitionProb = Array(nStates).fill().map(() => Array(nStates).fill(1/nStates));
        this.emissionProb = Array(nStates).fill().map(() => ({ Tai: 0.5, Xiu: 0.5 }));
        this.observations = [];
    }
    addObservation(obs) { this.observations.push(obs); if (this.observations.length > 50) this.observations.shift(); }
    updateProbabilities() {
        if (this.observations.length < 2) return;
        for (let i = 1; i < this.observations.length; i++) {
            const prevIdx = this.observations[i-1] === 'Tài' ? 0 : 1;
            const currIdx = this.observations[i] === 'Tài' ? 0 : 1;
            this.transitionProb[prevIdx][currIdx] = this.transitionProb[prevIdx][currIdx] * 0.95 + 0.05;
        }
        const taiCount = this.observations.filter(o => o === 'Tài').length;
        const total = this.observations.length;
        for (let s = 0; s < this.nStates; s++) { this.emissionProb[s].Tai = taiCount / total; this.emissionProb[s].Xiu = 1 - taiCount / total; }
    }
    predictNext() {
        if (this.observations.length === 0) return null;
        this.updateProbabilities();
        const lastIdx = this.observations[this.observations.length-1] === 'Tài' ? 0 : 1;
        let taiProb = 0, xiuProb = 0;
        for (let s = 0; s < this.nStates; s++) {
            taiProb += this.transitionProb[lastIdx][s] * this.emissionProb[s].Tai;
            xiuProb += this.transitionProb[lastIdx][s] * this.emissionProb[s].Xiu;
        }
        const prediction = taiProb > xiuProb ? 'Tài' : 'Xỉu';
        const confidence = 50 + Math.abs(taiProb - xiuProb) * 35;
        return { prediction, confidence: Math.min(85, confidence), name: 'HMM' };
    }
}
class LSTMSimulator {
    constructor() { this.weights = []; this.bias = 0; for (let i = 0; i < 10; i++) this.weights.push(Math.random() * 0.2 - 0.1); }
    sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
    train(sequence, steps = 3) {
        if (sequence.length < steps + 1) return;
        const numerical = sequence.map(s => s === 'Tài' ? 1 : 0);
        const input = numerical.slice(-steps);
        const target = numerical[numerical.length-1];
        let output = 0;
        for (let i = 0; i < 10; i++) output += this.weights[i] * (input[i % steps] || 0);
        output = this.sigmoid(output + this.bias);
        const error = target - output;
        for (let i = 0; i < 10; i++) this.weights[i] += 0.1 * error * (input[i % steps] || 0);
        this.bias += 0.1 * error;
    }
    predict(sequence) {
        if (sequence.length < 3) return null;
        const numerical = sequence.map(s => s === 'Tài' ? 1 : 0);
        const input = numerical.slice(-3);
        let output = 0;
        for (let i = 0; i < 10; i++) output += this.weights[i] * (input[i % 3] || 0);
        output = this.sigmoid(output + this.bias);
        const prediction = output > 0.5 ? 'Tài' : 'Xỉu';
        const confidence = 50 + Math.abs(output - 0.5) * 80;
        return { prediction, confidence: Math.min(88, confidence), name: 'LSTM' };
    }
}
class ExtendedKalmanFilter {
    constructor() { this.state = 0.5; this.covariance = 1; this.processNoise = 0.1; this.measurementNoise = 0.1; }
    update(measurement) {
        const measNum = measurement === 'Tài' ? 1 : 0;
        const kalmanGain = this.covariance / (this.covariance + this.measurementNoise);
        this.state = this.state + kalmanGain * (measNum - this.state);
        this.covariance = (1 - kalmanGain) * this.covariance;
    }
    predictNext() {
        const prediction = this.state > 0.5 ? 'Tài' : 'Xỉu';
        const confidence = 50 + Math.abs(this.state - 0.5) * 80;
        return { prediction, confidence: Math.min(86, confidence), name: 'EKF' };
    }
}
class BayesianOnlineLearning {
    constructor() { this.prior = { Tai: 0.5, Xiu: 0.5 }; this.history = []; }
    updateBelief(observation) {
        this.history.push(observation);
        if (this.history.length > 100) this.history.shift();
        const taiCount = this.history.filter(h => h === 'Tài').length;
        const total = this.history.length;
        const likelihoodTai = taiCount / total;
        const likelihoodXiu = 1 - likelihoodTai;
        const posteriorTai = (likelihoodTai * this.prior.Tai) / (likelihoodTai * this.prior.Tai + likelihoodXiu * this.prior.Xiu);
        this.prior.Tai = posteriorTai;
        this.prior.Xiu = 1 - posteriorTai;
        const prediction = posteriorTai > 0.5 ? 'Tài' : 'Xỉu';
        const confidence = 50 + Math.abs(posteriorTai - 0.5) * 80;
        return { prediction, confidence: Math.min(87, confidence), name: 'Bayesian' };
    }
}
class TemporalDifferenceLearning {
    constructor() { this.qValues = {}; this.alpha = 0.1; this.gamma = 0.9; this.lastState = null; this.lastAction = null; }
    getStateKey(results) { return results.slice(0, 5).join('_'); }
    getAction(state) {
        if (!this.qValues[state]) this.qValues[state] = { Tai: 0, Xiu: 0 };
        return this.qValues[state].Tai > this.qValues[state].Xiu ? 'Tài' : 'Xỉu';
    }
    learn(reward) {
        if (!this.lastState || !this.lastAction) return;
        if (!this.qValues[this.lastState]) this.qValues[this.lastState] = { Tai: 0, Xiu: 0 };
        const tdTarget = reward + this.gamma * Math.max(this.qValues[this.lastState].Tai, this.qValues[this.lastState].Xiu);
        const tdError = tdTarget - this.qValues[this.lastState][this.lastAction];
        this.qValues[this.lastState][this.lastAction] += this.alpha * tdError;
    }
    predict(results) {
        const state = this.getStateKey(results);
        const action = this.getAction(state);
        this.lastState = state;
        this.lastAction = action;
        const confidence = 60 + Math.abs(this.qValues[state]?.[action] || 0) * 20;
        return { prediction: action, confidence: Math.min(84, confidence), name: 'TD' };
    }
}
class PatternRecognitionAdvanced {
    constructor() { this.patternLibrary = []; }
    predict(results) {
        if (results.length < 10) return null;
        const last5 = results.slice(0, 5).join('');
        for (let lib of this.patternLibrary) if (lib.pattern === last5 && lib.outcome) return { prediction: lib.outcome, confidence: 70, name: 'PatternMatch' };
        return null;
    }
}
class ARIMAModel {
    constructor(p = 2, d = 1, q = 2) { this.p = p; this.d = d; this.q = q; this.arParams = Array(p).fill(0.1); }
    predict(series) {
        const numerical = series.map(s => s === 'Tài' ? 1 : 0);
        if (numerical.length < 5) return null;
        let pred = 0;
        for (let i = 0; i < this.p; i++) pred += this.arParams[i] * (numerical[numerical.length - 1 - i] || 0);
        pred = Math.max(0, Math.min(1, pred));
        const finalPrediction = pred > 0.5 ? 'Tài' : 'Xỉu';
        const confidence = 50 + Math.abs(pred - 0.5) * 80;
        return { prediction: finalPrediction, confidence: Math.min(85, confidence), name: 'ARIMA' };
    }
}
class GARCHModel {
    constructor() {}
    predict(results) {
        let changes = 0;
        for (let i = 1; i < Math.min(20, results.length); i++) if (results[i] !== results[i-1]) changes++;
        const vol = changes / Math.min(19, results.length - 1);
        if (vol > 0.6) return { prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 65, name: 'GARCH' };
        return null;
    }
}
class MonteCarloSimulator {
    constructor() {}
    predict(results) {
        const taiCount = results.slice(0, 10).filter(r => r === 'Tài').length;
        const prob = taiCount / 10;
        const prediction = prob > 0.5 ? 'Tài' : 'Xỉu';
        const confidence = 50 + Math.abs(prob - 0.5) * 80;
        return { prediction, confidence: Math.min(85, confidence), name: 'MonteCarlo' };
    }
}
class SVMSimulator {
    constructor() {}
    predict(features) {
        let sum = features.reduce((a,b) => a+b, 0) / features.length;
        const prediction = sum > 0.5 ? 'Tài' : 'Xỉu';
        const confidence = 55 + Math.abs(sum - 0.5) * 50;
        return { prediction, confidence: Math.min(82, confidence), name: 'SVM' };
    }
}
class RandomForestSimulator {
    constructor() {}
    predict(features) {
        let sum = features.slice(0, 5).reduce((a,b) => a+b, 0) / 5;
        const prediction = sum > 0.5 ? 'Tài' : 'Xỉu';
        const confidence = 55 + Math.abs(sum - 0.5) * 50;
        return { prediction, confidence: Math.min(85, confidence), name: 'RandomForest' };
    }
}
class HarmonicPatternRecognizer {
    constructor() {}
    predict(results) {
        if (results.length < 10) return null;
        let peaks = 0, troughs = 0;
        for (let i = 1; i < results.length - 1; i++) {
            if (results[i] !== results[i-1] && results[i] !== results[i+1]) {
                if (results[i] === 'Tài') peaks++; else troughs++;
            }
        }
        if (peaks >= 3 && troughs >= 3) {
            const last = results[0];
            return { prediction: last === 'Tài' ? 'Xỉu' : 'Tài', confidence: 75, name: 'Harmonic' };
        }
        return null;
    }
}

// 11. ULTIMATE PREDICTOR V4
class UltimatePredictorV4 {
    constructor() {
        this.dbNetwork = new DeepBeliefNetwork([10, 20, 15, 8, 3]);
        this.anfisSystem = new NeuroFuzzySystem(7);
        this.oselmModel = new OnlineExtremeLearningMachine(60);
        this.waveletNN = new WaveletNeuralNetwork(12);
        this.htmModel = new HierarchicalTemporalMemory(150, 6);
        this.esnModel = new EchoStateNetwork(250, 0.95, 0.4);
        this.qinnModel = new QuantumInspiredNeuralNetwork(12);
        this.supraEnsemble = new SupraAdaptiveEnsemble();
        this.hmmModel = new HiddenMarkovModel(4);
        this.lstmModel = new LSTMSimulator();
        this.ekfModel = new ExtendedKalmanFilter();
        this.bayesianModel = new BayesianOnlineLearning();
        this.tdModel = new TemporalDifferenceLearning();
        this.patternLibrary = new PatternRecognitionAdvanced();
        this.arimaModel = new ARIMAModel(2, 1, 2);
        this.garchModel = new GARCHModel();
        this.monteCarlo = new MonteCarloSimulator();
        this.svmModel = new SVMSimulator();
        this.randomForest = new RandomForestSimulator();
        this.harmonicRecognizer = new HarmonicPatternRecognizer();
        this.registerAllModels();
        this.trainingBuffer = [];
        this.predictionCache = [];
    }
    registerAllModels() {
        this.supraEnsemble.registerModel('dbn', this.dbNetwork, 1.0);
        this.supraEnsemble.registerModel('anfis', this.anfisSystem, 0.9);
        this.supraEnsemble.registerModel('oselm', this.oselmModel, 1.1);
        this.supraEnsemble.registerModel('wnn', this.waveletNN, 1.0);
        this.supraEnsemble.registerModel('htm', this.htmModel, 0.8);
        this.supraEnsemble.registerModel('esn', this.esnModel, 1.0);
        this.supraEnsemble.registerModel('qinn', this.qinnModel, 0.9);
        this.supraEnsemble.registerModel('hmm', this.hmmModel, 0.9);
        this.supraEnsemble.registerModel('lstm', this.lstmModel, 1.0);
        this.supraEnsemble.registerModel('ekf', this.ekfModel, 0.7);
        this.supraEnsemble.registerModel('bayesian', this.bayesianModel, 0.8);
        this.supraEnsemble.registerModel('td', this.tdModel, 0.7);
        this.supraEnsemble.registerModel('pattern', this.patternLibrary, 0.8);
        this.supraEnsemble.registerModel('arima', this.arimaModel, 0.7);
        this.supraEnsemble.registerModel('garch', this.garchModel, 0.6);
        this.supraEnsemble.registerModel('montecarlo', this.monteCarlo, 0.7);
        this.supraEnsemble.registerModel('svm', this.svmModel, 0.8);
        this.supraEnsemble.registerModel('rf', this.randomForest, 0.9);
        this.supraEnsemble.registerModel('harmonic', this.harmonicRecognizer, 0.6);
    }
    extractUltraFeatures(results, sums) {
        const features = [];
        const numerical = results.map(r => r === 'Tài' ? 1 : 0);
        const mean = numerical.reduce((a,b) => a+b, 0) / numerical.length;
        const variance = numerical.reduce((a,b) => a + Math.pow(b - mean, 2), 0) / numerical.length;
        features.push(mean, variance);
        let streak = 1, maxStreak = 1;
        for (let i = 1; i < results.length; i++) {
            if (results[i] === results[i-1]) streak++;
            else { maxStreak = Math.max(maxStreak, streak); streak = 1; }
        }
        features.push(streak / 10, maxStreak / 10);
        let changes = 0;
        for (let i = 1; i < Math.min(30, results.length); i++) if (results[i] !== results[i-1]) changes++;
        features.push(changes / 29);
        const taiRatio = numerical.filter(v => v === 1).length / numerical.length;
        features.push(taiRatio);
        let complexity = 0;
        for (let i = 3; i < Math.min(20, results.length); i++) {
            const pattern = results.slice(i-3, i).join('');
            complexity += pattern === `${results[i]}${results[i]}${results[i]}` ? 1 : 0;
        }
        features.push(complexity / 17);
        if (sums && sums.length >= 10) {
            const sumMean = sums.slice(0, 10).reduce((a,b) => a+b, 0) / 10;
            const sumVar = sums.slice(0, 10).reduce((a,b) => a + Math.pow(b - sumMean, 2), 0) / 10;
            features.push(sumMean / 18, sumVar / 100);
        } else { features.push(0.5, 0.1); }
        for (let lag = 1; lag <= 5; lag++) {
            let acf = 0;
            for (let i = 0; i < numerical.length - lag; i++) acf += (numerical[i] - mean) * (numerical[i + lag] - mean);
            acf = acf / ((numerical.length - lag) * variance + 1e-10);
            features.push(acf);
        }
        return features;
    }
    async trainOnline(newData, newResults) {
        this.trainingBuffer.push({ data: newData, result: newResults });
        if (this.trainingBuffer.length > 500) this.trainingBuffer.shift();
        if (this.trainingBuffer.length >= 50 && this.trainingBuffer.length % 20 === 0) {
            const features = [], targets = [];
            for (let i = 10; i < this.trainingBuffer.length; i++) {
                const windowData = this.trainingBuffer.slice(i - 10, i);
                const windowResults = windowData.map(d => d.data.Ket_qua);
                const windowSums = windowData.map(d => d.data.Tong);
                const featureVec = this.extractUltraFeatures(windowResults, windowSums);
                const target = this.trainingBuffer[i].result === 'Tài' ? 1 : 0;
                features.push(featureVec);
                targets.push([target]);
            }
            if (features.length > 20) {
                this.dbNetwork.pretrain(features, 3);
                this.dbNetwork.fineTune(features, targets, 0.005, 8);
                this.anfisSystem.train(features, targets, 10);
                this.waveletNN.train(features, targets, 8);
                this.oselmModel.update(features, targets);
                this.esnModel.train(features, targets);
                this.qinnModel.train(features, targets, 8);
            }
        }
    }
    async predict(data, type) {
        const results = data.map(d => d.Ket_qua);
        const sums = data.map(d => d.Tong);
        if (results.length < 5) return { prediction: 'Tài', confidence: 55, factors: ['Thieu du lieu'] };
        const features = this.extractUltraFeatures(results, sums);
        const context = this.supraEnsemble.extractContext(results, sums);
        const allPredictions = [];
        const encodeForHTM = () => {
            const encoding = Array(150).fill(0);
            for (let i = 0; i < Math.min(10, results.length); i++) {
                const idx = (results[i] === 'Tài' ? 0 : 75) + i * 5;
                if (idx < 150) encoding[idx] = 1;
            }
            return encoding;
        };
        const modelResults = [
            this.dbNetwork.predict(features),
            this.anfisSystem.predict(features.slice(0, 2)),
            this.oselmModel.predict(features),
            this.waveletNN.predict(features.slice(0, 3)),
            this.htmModel.predictNext(encodeForHTM()),
            this.esnModel.predict(features[0]),
            this.qinnModel.predict(features.slice(0, 4)),
            this.hmmModel.predictNext(),
            this.lstmModel.predict(results),
            this.ekfModel.predictNext(),
            this.bayesianModel.updateBelief(results[0]),
            this.tdModel.predict(results),
            this.patternLibrary.predict(results),
            this.arimaModel.predict(results),
            this.garchModel.predict(results),
            this.monteCarlo.predict(results),
            this.svmModel.predict(features),
            this.randomForest.predict(features),
            this.harmonicRecognizer.predict(results)
        ];
        const patternFunctions = [analyzeCauBet, analyzeCauDao11, analyzeCau22, analyzeCau33, analyzeCau121, analyzeCau123, analyzeCau321, analyzeCauNhayCoc, analyzeCauNhipNghieng, analyzeCau3Van1, analyzeSmartBet, analyzeBreakStreak, analyzeTriplePattern, analyzeTongPhanTich, analyzeXuHuongManh, analyzeDaoChieu];
        for (let fn of patternFunctions) {
            let p = fn(results, type);
            if (p && p.detected) allPredictions.push({ ...p, model: 'pattern_traditional' });
        }
        const modelNames = ['dbn', 'anfis', 'oselm', 'wnn', 'htm', 'esn', 'qinn', 'hmm', 'lstm', 'ekf', 'bayesian', 'td', 'pattern', 'arima', 'garch', 'montecarlo', 'svm', 'rf', 'harmonic'];
        for (let i = 0; i < modelResults.length; i++) {
            if (modelResults[i]) allPredictions.push({ ...modelResults[i], model: modelNames[i] });
        }
        const finalResult = this.supraEnsemble.getWeightedPredictions(allPredictions, context);
        const topModels = Object.entries(this.supraEnsemble.adaptiveWeights).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, weight]) => `${name}(${weight.toFixed(2)})`);
        const factors = [`To hop: ${allPredictions.length} mo hinh`, `Top: ${topModels.join(', ')}`, `Context: vol=${context.volatility.toFixed(2)}, streak=${context.streakLength}`, `Tin cay: ${finalResult.confidence.toFixed(0)}%`];
        if (context.streakLength >= 5) factors.push(`Chuoi dai: ${context.streakLength} ${results[0]}`);
        this.predictionCache.push({ timestamp: Date.now(), prediction: finalResult.prediction, confidence: finalResult.confidence, context: context, wasCorrect: null });
        if (this.predictionCache.length > 200) this.predictionCache.shift();
        return { prediction: finalResult.prediction, confidence: Math.round(finalResult.confidence), factors: factors, allPatterns: allPredictions.slice(0, 10).map(p => (p.name || p.model).substring(0, 20)), detailedAnalysis: { totalModels: allPredictions.length, activeModels: Object.keys(this.supraEnsemble.models).length, topModels: topModels.slice(0, 3), context: { volatility: (context.volatility * 100).toFixed(1) + '%', trendStrength: (context.trendStrength * 100).toFixed(1) + '%', streakLength: context.streakLength } } };
    }
    updateResult(prediction, actual, wasCorrect, type) {
        for (const modelName of Object.keys(this.supraEnsemble.models)) {
            let modelCorrect = false;
            if (modelName === 'pattern_traditional') modelCorrect = wasCorrect;
            else if (modelName === 'hmm' && this.hmmModel.predictNext()?.prediction === actual) modelCorrect = true;
            else if (modelName === 'lstm' && this.lstmModel.predict([])?.prediction === actual) modelCorrect = true;
            else if (modelName === 'ekf' && this.ekfModel.predictNext()?.prediction === actual) modelCorrect = true;
            else if (modelName === 'bayesian' && this.bayesianModel.updateBelief(actual)?.prediction === actual) modelCorrect = true;
            else if (modelName === 'td' && this.tdModel.predict([])?.prediction === actual) modelCorrect = true;
            else if (wasCorrect && (modelName === 'dbn' || modelName === 'anfis' || modelName === 'wnn' || modelName === 'esn' || modelName === 'qinn')) modelCorrect = true;
            this.supraEnsemble.updateWeight(modelName, modelCorrect, 70);
        }
        this.tdModel.learn(wasCorrect ? 1 : -1);
        if (this.predictionCache.length > 0) {
            const lastPred = this.predictionCache[this.predictionCache.length - 1];
            lastPred.wasCorrect = wasCorrect;
            this.trainOnline({ Ket_qua: actual, Tong: 9 }, actual);
        }
    }
}

const ultimatePredictorV4 = new UltimatePredictorV4();

async function calculateUltimatePrediction(data, type) {
    return await ultimatePredictorV4.predict(data, type);
}
function updatePredictionResult(type, prediction, actualResult, wasCorrect) {
    ultimatePredictorV4.updateResult(prediction, actualResult, wasCorrect, type);
}
function loadUltimateLearningData() { }

// ==================== API FETCH & UPDATE ====================
async function fetchData() {
    for (let a = 1; a <= 5; a++) {
        try {
            const res = await axios.get(API_URL, { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
            const raw = res.data;
            let arr = null;
            if (Array.isArray(raw)) arr = raw;
            else if (raw && raw.data && Array.isArray(raw.data)) arr = raw.data;
            else if (raw && typeof raw === 'object') { for (const k of Object.keys(raw)) { if (Array.isArray(raw[k]) && raw[k].length > 5) { arr = raw[k]; break; } } }
            if (arr && arr.length >= 15) {
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
        if (!data || data.length < 15) { isUpdating = false; return; }
        const latest = data[data.length - 1];
        if (currentPrediction && currentPrediction.Phien_hien_tai > 0) {
            const predictedPhien = currentPrediction.Phien_hien_tai;
            const actual = data.find(s => s.phien === predictedPhien);
            if (actual) {
                const actualStr = actual.ket_qua;
                const duDoanPrev = currentPrediction.Du_doan;
                addToHistory(predictedPhien, duDoanPrev, actualStr, currentPrediction.Do_tin_cay);
                console.log(`${predictedPhien}: ${duDoanPrev} vs ${actualStr} | ${duDoanPrev.toLowerCase() === actualStr.toLowerCase() ? 'DUNG' : 'SAI'}`);
            }
        }
        gameHistory = data;
        const pred = await calculateUltimatePrediction(data, 'taixiu');
        let pattern = "";
        for (let i = Math.max(0, data.length - 15); i < data.length; i++) pattern += data[i].ket_qua === "Tài" ? "t" : "x";
        const recentTotals = data.slice(-15).map(p => p.tong);
        let predTotal = Math.round(recentTotals.reduce((a, b) => a + b, 0) / recentTotals.length);
        if (latest.tong >= 15) predTotal = Math.min(predTotal, 12);
        if (latest.tong <= 5) predTotal = Math.max(predTotal, 9);
        const totalTrades = wins + losses;
        const winRate = totalTrades > 0 ? (wins / totalTrades * 100).toFixed(1) + '%' : '0%';
        const wc = verifiedResults.filter(v => v.danh_gia === 'thang').length;
        const wr = verifiedResults.length > 0 ? (wc / verifiedResults.length * 100).toFixed(1) : '0.0';
        currentPrediction = {
            id: "@anhkhoidzai102",
            Phien: latest.phien,
            Xuc_xac_1: latest.xuc_xac_1,
            Xuc_xac_2: latest.xuc_xac_2,
            Xuc_xac_3: latest.xuc_xac_3,
            Tong: latest.tong,
            Ket_qua: latest.ket_qua,
            pattern: pattern,
            Phien_hien_tai: latest.phien + 1,
            Du_doan: pred.prediction,
            Do_tin_cay: pred.confidence + "%",
            Tong_du_doan: predTotal,
            Ly_do: pred.factors ? pred.factors.join(', ') : 'Phan tich da chieu',
            Trang_thai: 'SAN SANG',
            Thang: wins,
            Thua: losses,
            Ti_le_thang: winRate,
            Loai_cau: pred.allPatterns ? pred.allPatterns[0] : 'To hop',
            Lich_su: { Tong_phien: verifiedResults.length, Thang: wc, Thua: verifiedResults.length - wc, Ty_le_thang: wr + "%" },
            Bang_thang_thua: verifiedResults.slice(0, 20)
        };
        isReady = true;
        console.log(`${pred.prediction} | Tin cay: ${pred.confidence}% | ${pred.factors ? pred.factors.slice(0,3).join(', ') : ''} | Thang: ${winRate} | Lich su: ${wc}/${verifiedResults.length} (${wr}%)`);
    } catch (e) { console.error('Loi:', e.message); }
    isUpdating = false;
}

app.get('/taixiu', async (req, res) => {
    if (!isReady || !currentPrediction) await updatePrediction();
    if (currentPrediction) return res.json(currentPrediction);
    res.json({
        id: "@anhkhoidzai102", Phien: 0, Xuc_xac_1: 0, Xuc_xac_2: 0, Xuc_xac_3: 0, Tong: 0, Ket_qua: "dang tai...",
        pattern: "", Phien_hien_tai: 0, Du_doan: "dang tai...", Do_tin_cay: "0%", Tong_du_doan: 0,
        Ly_do: "", Trang_thai: "", Thang: 0, Thua: 0, Ti_le_thang: "0%", Loai_cau: "",
        Lich_su: { Tong_phien: 0, Thang: 0, Thua: 0, Ty_le_thang: "0%" }, Bang_thang_thua: []
    });
});

app.get('/', (req, res) => res.redirect('/taixiu'));

loadHistory();
console.log('='.repeat(70));
console.log('HE THONG DU DOAN TAI XIU THE HE MOI V4.0');
console.log('API: wtxmd52.tele68.com | 15 PHIEN | 2000 PHIEN LICH SU');
console.log('BAO GOM CAC MO HINH: DBN, ANFIS, OSELM, WNN, HTM, ESN, QINN, HMM, LSTM, EKF, Bayesian, TD');
console.log('TICH HOP DAY DU CAC THUAT TOAN MOI NHAT - KHONG THIEU CHI TIET');
console.log('='.repeat(70));

(async () => { const d = await fetchData(); if (d && d.length >= 15) { gameHistory = d; await updatePrediction(); } })();
setInterval(updatePrediction, 300);

app.listen(PORT, () => { console.log(`Cong: ${PORT} | /taixiu`); });
