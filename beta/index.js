"use strict";

import { drawText } from "https://cdn.jsdelivr.net/npm/canvas-txt@4.1.1/+esm";
import { printCanvas } from "./src/printer.js";
import QRCode from "https://cdn.skypack.dev/qrcode@1.5.3";
import JsBarcode from "https://cdn.skypack.dev/jsbarcode@3.11.6";

const $ = document.querySelector.bind(document);
const $all = document.querySelectorAll.bind(document);

const labelSize = { width: 40, height: 12 };
let uploadedImage = null;
let processedImage = null;
let generatedCode = null;
let previewRotation = -90; // Default: 90° CCW for preview
let offsetX = 0;
let offsetY = 0;

/* ==========================================================================
   CODE GENERATION (QR & Barcode)
   ========================================================================== */

const generateCode = async (data, type, format = "CODE128", errorCorrection = "M") => {
    if (!data.trim()) return null;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    if (type === "qr") {
        try {
            await QRCode.toCanvas(canvas, data, {
                errorCorrectionLevel: errorCorrection,
                type: "image/png",
                quality: 0.92,
                margin: 1,
                color: { dark: "#000000", light: "#FFFFFF" },
                width: 200,
            });
        } catch (err) {
            console.error("QR code generation failed:", err);
            return null;
        }
    } else if (type === "barcode") {
        try {
            const tempImg = document.createElement("img");
            JsBarcode(tempImg, data, {
                format: format,
                width: 2,
                height: 100,
                displayValue: false,
                background: "#FFFFFF",
                lineColor: "#000000",
                margin: 10,
            });
            await new Promise((resolve, reject) => {
                tempImg.onload = () => {
                    canvas.width = tempImg.width;
                    canvas.height = tempImg.height;
                    ctx.fillStyle = "#FFFFFF";
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(tempImg, 0, 0);
                    resolve();
                };
                tempImg.onerror = reject;
            });
        } catch (err) {
            console.error("Barcode generation failed:", err);
            return null;
        }
    }

    const img = new Image();
    img.src = canvas.toDataURL();
    await new Promise((resolve) => { img.onload = resolve; });
    return img;
};

/* ==========================================================================
   IMAGE PROCESSING ALGORITHMS
   ========================================================================== */

const applyGammaCorrection = (imgData, gamma = 2.2) => {
    const { data } = imgData;
    const gammaLUT = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
        gammaLUT[i] = Math.round(255 * Math.pow(i / 255, gamma));
    }
    for (let i = 0; i < data.length; i += 4) {
        data[i] = gammaLUT[data[i]];
        data[i + 1] = gammaLUT[data[i + 1]];
        data[i + 2] = gammaLUT[data[i + 2]];
    }
    return imgData;
};

const applyGaussianBlur = (imgData, sigma = 0.5) => {
    if (sigma <= 0) return imgData;
    const { width, height, data } = imgData;
    const output = new Uint8ClampedArray(data);
    const kernelSize = Math.ceil(sigma * 3) * 2 + 1;
    const kernel = new Float32Array(kernelSize);
    const center = Math.floor(kernelSize / 2);
    let sum = 0;

    for (let i = 0; i < kernelSize; i++) {
        const x = i - center;
        kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
        sum += kernel[i];
    }
    for (let i = 0; i < kernelSize; i++) kernel[i] /= sum;

    // Horizontal pass
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let r = 0, g = 0, b = 0;
            for (let i = 0; i < kernelSize; i++) {
                const px = Math.max(0, Math.min(width - 1, x + i - center));
                const idx = (y * width + px) * 4;
                r += data[idx] * kernel[i];
                g += data[idx + 1] * kernel[i];
                b += data[idx + 2] * kernel[i];
            }
            const outIdx = (y * width + x) * 4;
            output[outIdx] = r; output[outIdx + 1] = g; output[outIdx + 2] = b;
        }
    }
    data.set(output);

    // Vertical pass
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            let r = 0, g = 0, b = 0;
            for (let i = 0; i < kernelSize; i++) {
                const py = Math.max(0, Math.min(height - 1, y + i - center));
                const idx = (py * width + x) * 4;
                r += data[idx] * kernel[i];
                g += data[idx + 1] * kernel[i];
                b += data[idx + 2] * kernel[i];
            }
            const outIdx = (y * width + x) * 4;
            output[outIdx] = r; output[outIdx + 1] = g; output[outIdx + 2] = b;
        }
    }
    data.set(output);
    return imgData;
};

const applyUnsharpMask = (imgData, radius = 1.0, amount = 0.8) => {
    const { width, height, data } = imgData;
    const blurred = new ImageData(new Uint8ClampedArray(data), width, height);
    applyGaussianBlur(blurred, radius);
    for (let i = 0; i < data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
            const original = data[i + c];
            const blur = blurred.data[i + c];
            data[i + c] = Math.max(0, Math.min(255, original + amount * (original - blur)));
        }
    }
    return imgData;
};

const applyCLAHE = (imgData, tileSize = 16, clipLimit = 2.0) => {
    const { width, height, data } = imgData;
    const tilesX = Math.ceil(width / tileSize);
    const tilesY = Math.ceil(height / tileSize);
    const gray = new Uint8Array(width * height);
    for (let i = 0; i < gray.length; i++) {
        const idx = i * 4;
        gray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    }
    const processedGray = new Uint8Array(gray);

    for (let ty = 0; ty < tilesY; ty++) {
        for (let tx = 0; tx < tilesX; tx++) {
            const x1 = tx * tileSize;
            const y1 = ty * tileSize;
            const x2 = Math.min(x1 + tileSize, width);
            const y2 = Math.min(y1 + tileSize, height);
            const hist = new Array(256).fill(0);
            let pixelCount = 0;

            for (let y = y1; y < y2; y++) {
                for (let x = x1; x < x2; x++) {
                    hist[gray[y * width + x]]++;
                    pixelCount++;
                }
            }

            const limit = (clipLimit * pixelCount) / 256;
            const excess = Math.max(0, Math.max(...hist) - limit);
            if (excess > 0) {
                const redistribution = excess / 256;
                for (let i = 0; i < 256; i++) {
                    if (hist[i] > limit) hist[i] = limit;
                    hist[i] += redistribution;
                }
            }

            const cdf = new Array(256);
            cdf[0] = hist[0];
            for (let i = 1; i < 256; i++) cdf[i] = cdf[i - 1] + hist[i];
            const mapping = new Uint8Array(256);
            for (let i = 0; i < 256; i++) mapping[i] = Math.round((cdf[i] / pixelCount) * 255);

            for (let y = y1; y < y2; y++) {
                for (let x = x1; x < x2; x++) {
                    const idx = y * width + x;
                    processedGray[idx] = mapping[gray[idx]];
                }
            }
        }
    }

    for (let i = 0; i < processedGray.length; i++) {
        const idx = i * 4;
        const originalGray = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
        const ratio = originalGray > 0 ? processedGray[i] / originalGray : 1;
        data[idx] = Math.min(255, data[idx] * ratio);
        data[idx + 1] = Math.min(255, data[idx + 1] * ratio);
        data[idx + 2] = Math.min(255, data[idx + 2] * ratio);
    }
    return imgData;
};

const generateBlueNoiseMap = (size = 64) => {
    const map = new Uint8Array(size * size);
    const used = new Array(size * size).fill(false);
    for (let i = 0; i < size * size; i++) {
        let bestDist = -1, bestIdx = 0;
        for (let attempt = 0; attempt < Math.min(100, size * size - i); attempt++) {
            const candidate = Math.floor(Math.random() * size * size);
            if (used[candidate]) continue;
            let minDist = Infinity;
            for (let j = 0; j < size * size; j++) {
                if (!used[j]) continue;
                const dist = Math.sqrt(((candidate % size) - (j % size)) ** 2 + (Math.floor(candidate / size) - Math.floor(j / size)) ** 2);
                minDist = Math.min(minDist, dist);
            }
            if (minDist > bestDist) { bestDist = minDist; bestIdx = candidate; }
        }
        used[bestIdx] = true;
        map[bestIdx] = Math.floor((i / (size * size)) * 256);
    }
    return map;
};

const detectEdges = (imgData) => {
    const { width, height, data } = imgData;
    const edges = new Uint8Array(width * height);
    const sobelX = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]];
    const sobelY = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]];

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            let gx = 0, gy = 0;
            for (let ky = -1; ky <= 1; ky++) {
                for (let kx = -1; kx <= 1; kx++) {
                    const idx = ((y + ky) * width + (x + kx)) * 4;
                    const val = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
                    gx += val * sobelX[ky + 1][kx + 1];
                    gy += val * sobelY[ky + 1][kx + 1];
                }
            }
            edges[y * width + x] = Math.min(255, Math.sqrt(gx * gx + gy * gy));
        }
    }
    return edges;
};

const scaleToExactResolution = (image, targetWidth, targetHeight, method = "lanczos") => {
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = method === "lanczos" ? "high" : "medium";

    const scale = Math.min(targetWidth / image.width, targetHeight / image.height);
    const sw = image.width * scale;
    const sh = image.height * scale;
    ctx.drawImage(image, (targetWidth - sw) / 2, (targetHeight - sh) / 2, sw, sh);
    return canvas;
};

const ditherImageData = (imgData, algorithm = "floyd", threshold = 128, brightness = 0, contrast = 0, noise = 0, serpentine = true, edgeMap = null) => {
    const { width, height, data } = imgData;
    const gray = new Float32Array(width * height);
    const brightnessAdjust = brightness * 2.55;
    const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
    const noiseAmount = noise * 2.55;

    for (let i = 0; i < gray.length; i++) {
        const r = contrastFactor * (data[i * 4] - 128) + 128 + brightnessAdjust;
        const g = contrastFactor * (data[i * 4 + 1] - 128) + 128 + brightnessAdjust;
        const b = contrastFactor * (data[i * 4 + 2] - 128) + 128 + brightnessAdjust;
        let lum = 0.299 * Math.max(0, Math.min(255, r)) + 0.587 * Math.max(0, Math.min(255, g)) + 0.114 * Math.max(0, Math.min(255, b));
        if (noise > 0) lum = Math.max(0, Math.min(255, lum + (Math.random() - 0.5) * noiseAmount));
        gray[i] = lum;
    }

    const setBW = (idx, val) => {
        data[idx * 4] = data[idx * 4 + 1] = data[idx * 4 + 2] = val;
        data[idx * 4 + 3] = 255;
    };

    if (algorithm === "threshold") {
        for (let i = 0; i < gray.length; i++) {
            let t = threshold;
            if (edgeMap) t -= (edgeMap[i] / 255) * 30;
            setBW(i, gray[i] < t ? 0 : 255);
        }
        return imgData;
    }

    if (algorithm === "blue_noise") {
        const noiseMap = generateBlueNoiseMap(64);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const nVal = noiseMap[(y % 64) * 64 + (x % 64)];
                let t = nVal;
                if (edgeMap) t -= (edgeMap[idx] / 255) * 40;
                setBW(idx, gray[idx] < t ? 0 : 255);
            }
        }
        return imgData;
    }

    if (algorithm.startsWith("ordered")) {
        let matrix;
        if (algorithm === "ordered2") matrix = [[0, 2], [3, 1]];
        else if (algorithm === "ordered8") matrix = [
            [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26],
            [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
            [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
            [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21]
        ];
        else matrix = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]; // ordered4

        const n = matrix.length;
        const scale = 255 / (n * n);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                let t = (matrix[y % n][x % n] + 0.5) * scale;
                if (edgeMap) t -= (edgeMap[idx] / 255) * 40;
                setBW(idx, gray[idx] < t ? 0 : 255);
            }
        }
        return imgData;
    }

    // Error Diffusion
    const kernels = {
        floyd: [{ x: 1, y: 0, w: 7 / 16 }, { x: -1, y: 1, w: 3 / 16 }, { x: 0, y: 1, w: 5 / 16 }, { x: 1, y: 1, w: 1 / 16 }],
        atkinson: [{ x: 1, y: 0, w: 1 / 8 }, { x: 2, y: 0, w: 1 / 8 }, { x: -1, y: 1, w: 1 / 8 }, { x: 0, y: 1, w: 1 / 8 }, { x: 1, y: 1, w: 1 / 8 }, { x: 0, y: 2, w: 1 / 8 }],
        stucki: [{ x: 1, y: 0, w: 8/42 }, { x: 2, y: 0, w: 4/42 }, { x: -2, y: 1, w: 2/42 }, { x: -1, y: 1, w: 4/42 }, { x: 0, y: 1, w: 8/42 }, { x: 1, y: 1, w: 4/42 }, { x: 2, y: 1, w: 2/42 }, { x: -2, y: 2, w: 1/42 }, { x: -1, y: 2, w: 2/42 }, { x: 0, y: 2, w: 4/42 }, { x: 1, y: 2, w: 2/42 }, { x: 2, y: 2, w: 1/42 }],
        jarvis: [{ x: 1, y: 0, w: 7/48 }, { x: 2, y: 0, w: 5/48 }, { x: -2, y: 1, w: 3/48 }, { x: -1, y: 1, w: 5/48 }, { x: 0, y: 1, w: 7/48 }, { x: 1, y: 1, w: 5/48 }, { x: 2, y: 1, w: 3/48 }, { x: -2, y: 2, w: 1/48 }, { x: -1, y: 2, w: 3/48 }, { x: 0, y: 2, w: 5/48 }, { x: 1, y: 2, w: 3/48 }, { x: 2, y: 2, w: 1/48 }],
        sierra: [{ x: 1, y: 0, w: 5/32 }, { x: 2, y: 0, w: 3/32 }, { x: -2, y: 1, w: 2/32 }, { x: -1, y: 1, w: 4/32 }, { x: 0, y: 1, w: 5/32 }, { x: 1, y: 1, w: 4/32 }, { x: 2, y: 1, w: 2/32 }, { x: -1, y: 2, w: 2/32 }, { x: 0, y: 2, w: 3/32 }, { x: 1, y: 2, w: 2/32 }],
        burkes: [{ x: 1, y: 0, w: 8/32 }, { x: 2, y: 0, w: 4/32 }, { x: -2, y: 1, w: 2/32 }, { x: -1, y: 1, w: 4/32 }, { x: 0, y: 1, w: 8/32 }, { x: 1, y: 1, w: 4/32 }, { x: 2, y: 1, w: 2/32 }]
    };
    const kernel = kernels[algorithm] || kernels.floyd;

    for (let y = 0; y < height; y++) {
        const dir = serpentine && y % 2 === 1 ? -1 : 1;
        const startX = dir === 1 ? 0 : width - 1;
        const endX = dir === 1 ? width : -1;
        for (let x = startX; x !== endX; x += dir) {
            const idx = y * width + x;
            const oldVal = gray[idx];
            let t = threshold;
            if (edgeMap) t -= (edgeMap[idx] / 255) * 20;
            const newVal = oldVal < t ? 0 : 255;
            const err = oldVal - newVal;
            gray[idx] = newVal;
            setBW(idx, newVal);
            for (const k of kernel) {
                const nx = x + k.x * dir;
                const ny = y + k.y;
                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    gray[ny * width + nx] += err * k.w;
                }
            }
        }
    }
    return imgData;
};

const rotateImage = (image, angle) => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const normAngle = ((angle % 360) + 360) % 360;
    if (normAngle === 90 || normAngle === 270) {
        canvas.width = image.height;
        canvas.height = image.width;
    } else {
        canvas.width = image.width;
        canvas.height = image.height;
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.drawImage(image, -image.width / 2, -image.height / 2);
    return canvas;
};

const applyHardwareCleanup = (imgData) => {
    const { width, height, data } = imgData;
    const output = new Uint8ClampedArray(data);
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = (y * width + x) * 4;
            if (data[idx] === 0) { // Black
                let neighbors = 0;
                for (let dy = -1; dy <= 1; dy++)
                    for (let dx = -1; dx <= 1; dx++)
                        if ((dx || dy) && data[((y + dy) * width + (x + dx)) * 4] === 0) neighbors++;
                if (neighbors === 0) output[idx] = output[idx + 1] = output[idx + 2] = 255; // Remove isolated
            } else { // White
                const top = data[((y - 1) * width + x) * 4] === 0;
                const bot = data[((y + 1) * width + x) * 4] === 0;
                const left = data[(y * width + (x - 1)) * 4] === 0;
                const right = data[(y * width + (x + 1)) * 4] === 0;
                if ((top && bot) || (left && right)) output[idx] = output[idx + 1] = output[idx + 2] = 0; // Fill gap
            }
        }
    }
    data.set(output);
    return imgData;
};

const processImageWithAdjustments = (image, brightness, contrast, algorithm, threshold, rotation, noise, options) => {
    let target = image;
    if (rotation !== 0) target = rotateImage(image, rotation);
    if (options.usePrinterResolution) target = scaleToExactResolution(target, options.printerWidth, options.printerHeight);

    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(target, 0, 0);

    let imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (options.useGammaCorrection) imgData = applyGammaCorrection(imgData, options.gamma);
    if (options.useCLAHE) imgData = applyCLAHE(imgData, options.claheTileSize, options.claheClipLimit);
    if (options.usePreFiltering) imgData = applyUnsharpMask(applyGaussianBlur(imgData, options.blurSigma), options.unsharpRadius, options.unsharpAmount);
    
    const edgeMap = options.useEdgeAware ? detectEdges(imgData) : null;
    
    if (algorithm === "two_phase") {
        let phase1 = ditherImageData(new ImageData(new Uint8ClampedArray(imgData.data), imgData.width, imgData.height), "ordered4", threshold, brightness, contrast, noise, false, null);
        imgData = ditherImageData(phase1, "floyd", threshold + 10, 0, 0, 0, true, edgeMap);
    } else {
        imgData = ditherImageData(imgData, algorithm, threshold, brightness, contrast, noise, options.serpentine, edgeMap);
    }

    if (options.useHardwareCleanup) imgData = applyHardwareCleanup(imgData);
    
    ctx.putImageData(imgData, 0, 0);
    return canvas;
};

/* ==========================================================================
   DRAWING & UI LOGIC
   ========================================================================== */

const drawVerticalText = (ctx, text, options) => {
    const { x, y, width, height, fontFamily, fontSize, fontWeight, align } = options;
    ctx.save();
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    ctx.textBaseline = "middle";
    const chars = text.split("").filter(c => c.trim());
    const lineHeight = fontSize * 1.2;
    const totalH = chars.length * lineHeight;
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    
    ctx.translate(centerX, centerY);
    ctx.rotate(-Math.PI / 2);
    
    let startY = -totalH / 2 + lineHeight / 2;
    let charX = 0;
    if (align === 'left') charX = -width / 2 + fontSize / 2;
    else if (align === 'right') charX = width / 2 - fontSize / 2;

    chars.forEach((char, i) => {
        ctx.textAlign = "center";
        ctx.fillText(char, charX, startY + i * lineHeight);
    });
    ctx.restore();
};

const updateRotationButtons = () => {
    $all("#previewRotation button").forEach(btn => {
        btn.classList.remove("bg-blue-500", "text-white");
        btn.classList.add("bg-gray-200");
    });
    const map = { "-90": "ccw90", "0": "none", "90": "cw90", "180": "flip" };
    const name = map[previewRotation];
    if (name) {
        $(`#rotate-${name}`).classList.remove("bg-gray-200");
        $(`#rotate-${name}`).classList.add("bg-blue-500", "text-white");
    }
};

const updatePreviewRotation = (canvas) => {
    const container = $(".preview-container");
    if (container) container.style.transform = `rotate(${previewRotation}deg)`;
    canvas.classList.toggle('rotated-90-270', Math.abs(previewRotation) === 90);
};

const handleError = (err) => {
    console.error(err);
    const toastEl = document.getElementById("errorToast");
    if (toastEl && window.bootstrap) {
        $("#errorText").textContent = err.toString();
        bootstrap.Toast.getOrCreateInstance(toastEl).show();
    } else {
        alert(err);
    }
};

const updateImagePreview = () => {
    if (!uploadedImage) {
        $("#imagePreviewGroup").style.display = "none";
        return;
    }
    $("#imagePreviewGroup").style.display = "block";
    const origC = $("#imagePreviewOriginal");
    const procC = $("#imagePreviewProcessed");
    
    // Original Preview
    const scaleO = Math.min(1, 120 / Math.max(uploadedImage.width, uploadedImage.height));
    origC.width = uploadedImage.width * scaleO;
    origC.height = uploadedImage.height * scaleO;
    origC.getContext("2d").drawImage(uploadedImage, 0, 0, origC.width, origC.height);

    // Processed Preview
    const opts = {
        useGammaCorrection: $("#useGammaCorrection")?.checked,
        gamma: parseFloat($("#gamma")?.value || 2.2),
        usePreFiltering: $("#usePreFiltering")?.checked,
        blurSigma: parseFloat($("#blurSigma")?.value || 0.5),
        unsharpRadius: 1.0,
        unsharpAmount: parseFloat($("#unsharpAmount")?.value || 0.8),
        useCLAHE: $("#useCLAHE")?.checked,
        claheClipLimit: parseFloat($("#claheClipLimit")?.value || 2.0),
        claheTileSize: 16,
        useEdgeAware: $("#useEdgeAware")?.checked,
        useHardwareCleanup: $("#useHardwareCleanup")?.checked,
        usePrinterResolution: false,
        serpentine: $("#serpentine")?.checked !== false
    };

    const processed = processImageWithAdjustments(
        uploadedImage,
        $("#brightness").valueAsNumber,
        $("#contrast").valueAsNumber,
        $("#ditherAlgorithm").value,
        $("#threshold").valueAsNumber,
        parseInt($("#imageRotation").value),
        $("#noise").valueAsNumber,
        opts
    );

    const scaleP = Math.min(1, 120 / Math.max(processed.width, processed.height));
    procC.width = processed.width * scaleP;
    procC.height = processed.height * scaleP;
    procC.getContext("2d").drawImage(processed, 0, 0, procC.width, procC.height);
};

const drawBorder = (ctx, width, height) => {
    const useBorder = $("#enableBorder")?.checked;
    if (!useBorder) return;
    
    const borderWidth = parseInt($("#borderWidth")?.value || "2");
    const style = $("#borderStyle")?.value || "square";
    
    ctx.strokeStyle = "black";
    ctx.lineWidth = borderWidth;
    const padding = 2; 

    if (style === "rounded") {
        const radius = 10;
        ctx.beginPath();
        ctx.roundRect(padding, padding, width - padding * 2, height - padding * 2, radius);
        ctx.stroke();
    } else {
        ctx.strokeRect(padding, padding, width - padding * 2, height - padding * 2);
    }
};

const updateCanvasText = async (canvas) => {
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.translate(offsetX, offsetY); // Print Offset

    const rW = canvas.height;
    const rH = canvas.width;
    let textArea = { x: -rW / 2, y: -rH / 2, width: rW, height: rH };

    // --- QR/Barcode Generation ---
    const codeType = $("#codeType")?.value || "none";
    const codeData = $("#codeData")?.value || "";
    if (codeType !== "none" && codeData.trim()) {
        try {
            generatedCode = await generateCode(codeData, codeType, $("#barcodeFormat")?.value, $("#qrErrorCorrection")?.value);
        } catch (e) { generatedCode = null; }
    } else generatedCode = null;

    let codeImgW = 0, codeImgH = 0;
    if (generatedCode) {
        const sizeRatio = ($("#codeSize")?.valueAsNumber || 30) / 100;
        const scale = Math.min((rW * sizeRatio) / generatedCode.width, (rH * sizeRatio) / generatedCode.height);
        codeImgW = generatedCode.width * scale;
        codeImgH = generatedCode.height * scale;
    }

    // --- Image Processing & Drawing ---
    if (uploadedImage && $("#imagePosition")?.value !== "none") {
        const opts = {
            useGammaCorrection: $("#useGammaCorrection")?.checked,
            gamma: parseFloat($("#gamma")?.value),
            usePreFiltering: $("#usePreFiltering")?.checked,
            blurSigma: parseFloat($("#blurSigma")?.value),
            unsharpRadius: 1.0,
            unsharpAmount: parseFloat($("#unsharpAmount")?.value),
            useCLAHE: $("#useCLAHE")?.checked,
            claheClipLimit: parseFloat($("#claheClipLimit")?.value),
            claheTileSize: 16,
            useEdgeAware: $("#useEdgeAware")?.checked,
            useHardwareCleanup: $("#useHardwareCleanup")?.checked,
            usePrinterResolution: $("#usePrinterResolution")?.checked,
            printerWidth: canvas.width,
            printerHeight: canvas.height,
            serpentine: $("#serpentine")?.checked !== false
        };

        processedImage = processImageWithAdjustments(
            uploadedImage,
            $("#brightness").valueAsNumber,
            $("#contrast").valueAsNumber,
            $("#ditherAlgorithm").value,
            $("#threshold").valueAsNumber,
            parseInt($("#imageRotation").value),
            $("#noise").valueAsNumber,
            opts
        );

        const pos = $("#imagePosition").value;
        const imgRatio = ($("#imageSize")?.valueAsNumber || 50) / 100;
        
        if (pos === "background") {
            const scale = Math.min(rW / processedImage.width, rH / processedImage.height) * imgRatio;
            const dw = processedImage.width * scale, dh = processedImage.height * scale;
            ctx.globalAlpha = 0.3;
            ctx.drawImage(processedImage, -dw/2, -dh/2, dw, dh);
            ctx.globalAlpha = 1.0;
        } else {
            const maxW = rW * imgRatio, maxH = rH * imgRatio;
            const scale = Math.min(maxW / processedImage.width, maxH / processedImage.height);
            const dw = processedImage.width * scale, dh = processedImage.height * scale;
            let ix, iy;
            
            if (pos === "above") { ix = -dw/2; iy = -rH/2; textArea.y = iy + dh + 10; textArea.height = rH - dh - 10; }
            else if (pos === "below") { ix = -dw/2; iy = rH/2 - dh; textArea.height = rH - dh - 10; }
            else if (pos === "left") { ix = -rW/2; iy = -dh/2; textArea.x = ix + dw + 10; textArea.width = rW - dw - 10; }
            else { ix = rW/2 - dw; iy = -dh/2; textArea.width = rW - dw - 10; }
            ctx.drawImage(processedImage, ix, iy, dw, dh);
        }
    }

    // --- Draw Code ---
    const codePos = $("#codePosition")?.value;
    if (generatedCode) {
        if (codePos === "background") {
            ctx.globalAlpha = 0.2;
            ctx.drawImage(generatedCode, -codeImgW/2, -codeImgH/2, codeImgW, codeImgH);
            ctx.globalAlpha = 1.0;
        } else {
            let cx, cy;
            if (codePos === "above") { cx = -codeImgW/2; cy = textArea.y; textArea.y += codeImgH + 10; textArea.height -= (codeImgH + 10); }
            else if (codePos === "below") { cx = -codeImgW/2; cy = textArea.y + textArea.height - codeImgH; textArea.height -= (codeImgH + 10); }
            else if (codePos === "left") { cx = textArea.x; cy = -codeImgH/2; textArea.x += codeImgW + 10; textArea.width -= (codeImgW + 10); }
            else { cx = textArea.x + textArea.width - codeImgW; cy = -codeImgH/2; textArea.width -= (codeImgW + 10); }
            ctx.drawImage(generatedCode, cx, cy, codeImgW, codeImgH);
        }
    }

    // --- Draw Text ---
    const text = $("#inputText").value;
    if (text.trim()) {
        ctx.fillStyle = "#000";
        const font = FONT_MAP[$("#fontFamily")?.value] || "Arial";
        const size = $("#inputFontSize").valueAsNumber;
        const weight = $("#fontWeight")?.value || "normal";
        const align = $("#textAlign")?.value || "center";
        
        if ($("#verticalText")?.checked) {
            drawVerticalText(ctx, text, { x: textArea.x, y: textArea.y, width: textArea.width, height: textArea.height, fontFamily: font, fontSize: size, fontWeight: weight, align: align });
        } else {
            // Adjust properties based on checkboxes in index.html (bold/italic) if they exist, or fallback to CSS-like font strings
            const isBold = $("#fontBold")?.checked;
            const isItalic = $("#fontItalic")?.checked;
            const isUnderline = $("#fontUnderline")?.checked; // Canvas-txt doesn't support underline natively easily, but we pass params
            // Note: canvas-txt 4.1.1 might not support all these, so we construct the font string carefully
            const fontStyle = isItalic ? "italic" : "normal";
            const fontWeightStr = isBold ? "bold" : "normal";
            
            drawText(ctx, text, {
                x: textArea.x,
                y: textArea.y,
                width: textArea.width,
                height: textArea.height,
                font: font,
                fontSize: size,
                fontStyle: fontStyle,
                fontWeight: fontWeightStr,
                align: align,
                vAlign: "middle",
            });
        }
    }
    
    // --- Draw Border (Visual only on top) ---
    // Restore context to unrotated state to draw border around the label edge
    ctx.restore();
    drawBorder(ctx, canvas.width, canvas.height);

    updatePreviewRotation(canvas);
};

const updateCanvasBarcode = (canvas) => {
    const data = $("#inputBarcode")?.value || "123456";
    const image = document.createElement("img");
    image.onload = () => {
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(Math.PI / 2);
        ctx.translate(offsetX, offsetY);
        
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(image, -image.width / 2, -image.height / 2);
        ctx.restore();
        
        drawBorder(ctx, canvas.width, canvas.height);
        updatePreviewRotation(canvas);
    };
    JsBarcode(image, data, { format: "CODE128", width: 2, height: labelSize.height * 7, displayValue: false });
};

const updateLabelSize = (canvas) => {
    const w = $("#inputWidth").valueAsNumber;
    const h = $("#inputHeight").valueAsNumber;
    if (isNaN(w) || isNaN(h)) return;
    labelSize.width = w;
    labelSize.height = h;
    
    // Printer prints top-to-bottom, so width in pixels is height * 8dots/mm
    canvas.width = labelSize.height * 8;
    canvas.height = labelSize.width * 8;

    // Display scaling
    canvas.style.width = ""; canvas.style.height = "";
    const container = canvas.parentElement;
    const cw = container.clientWidth || 300, ch = container.clientHeight || 300;
    const scale = Math.max(1, Math.min(Math.floor(cw / canvas.width), Math.floor(ch / canvas.height)));
    
    canvas.style.width = (canvas.width * scale) + "px";
    canvas.style.height = (canvas.height * scale) + "px";
    canvas.style.imageRendering = "pixelated";
    
    const activeTab = document.querySelector(".tab-pane.show.active");
    if (activeTab?.id === "nav-barcode") updateCanvasBarcode(canvas);
    else updateCanvasText(canvas);
};

/* ==========================================================================
   INITIALIZATION
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
    const canvas = $("#canvas");
    
    document.addEventListener("shown.bs.tab", (e) => {
        if (e.target.id === "nav-text-tab") updateCanvasText(canvas);
        else if (e.target.id === "nav-barcode-tab") updateCanvasBarcode(canvas);
    });

    const triggerUpdate = () => {
        const activeTab = document.querySelector(".tab-pane.show.active");
        if (activeTab?.id === "nav-barcode") updateCanvasBarcode(canvas);
        else updateCanvasText(canvas);
    };

    // Text & Font inputs
    $all("#inputText, #inputFontSize, #fontFamily, #textAlign, #verticalText").forEach(e => e.addEventListener("input", triggerUpdate));
    $all("#fontBold, #fontItalic, #fontUnderline, #fontUppercase").forEach(e => e.addEventListener("change", triggerUpdate));

    // Image Inputs
    $all("#imagePosition, #imageSize, #imageRotation, #ditherAlgorithm, #threshold, #brightness, #contrast, #noise").forEach(e => e.addEventListener("input", () => {
        updateImagePreview(); triggerUpdate();
    }));
    
    // Advanced Image Inputs
    $all("#useGammaCorrection, #gamma, #usePreFiltering, #blurSigma, #unsharpAmount, #useCLAHE, #claheClipLimit, #useEdgeAware, #useHardwareCleanup, #usePrinterResolution, #serpentine").forEach(e => {
        e.addEventListener("input", () => { updateImagePreview(); triggerUpdate(); });
        e.addEventListener("change", () => { updateImagePreview(); triggerUpdate(); });
    });

    // Code Inputs
    $all("#codeType, #codeData, #codePosition, #codeSize, #qrErrorCorrection, #barcodeFormat").forEach(e => e.addEventListener("input", triggerUpdate));
    
    // Border Inputs
    $all("#enableBorder, #borderWidth, #borderStyle").forEach(e => e.addEventListener("input", triggerUpdate));
    
    // Size & Offset Inputs
    $all("#inputWidth, #inputHeight").forEach(e => e.addEventListener("input", () => updateLabelSize(canvas)));
    
    const updateOffset = () => {
        $("#offsetXValue").textContent = offsetX; $("#offsetYValue").textContent = offsetY;
        triggerUpdate();
    };
    $("#offsetUp").addEventListener("click", () => { offsetY -= parseInt($("#offsetStep").value); updateOffset(); });
    $("#offsetDown").addEventListener("click", () => { offsetY += parseInt($("#offsetStep").value); updateOffset(); });
    $("#offsetLeft").addEventListener("click", () => { offsetX -= parseInt($("#offsetStep").value); updateOffset(); });
    $("#offsetRight").addEventListener("click", () => { offsetX += parseInt($("#offsetStep").value); updateOffset(); });
    $("#offsetReset").addEventListener("click", () => { offsetX = 0; offsetY = 0; updateOffset(); });

    // Rotation Preview Controls
    $("#rotateClockwise").addEventListener("click", () => { previewRotation = (previewRotation + 90) % 360; updateRotationButtons(); updatePreviewRotation(canvas); });
    $("#rotateCounterClockwise").addEventListener("click", () => { previewRotation -= 90; if(previewRotation <= -360) previewRotation += 360; updateRotationButtons(); updatePreviewRotation(canvas); });

    // Image Upload
    $("#inputImage").addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) { uploadedImage = null; updateImagePreview(); triggerUpdate(); return; }
        const img = new Image();
        img.onload = () => { uploadedImage = img; updateImagePreview(); triggerUpdate(); };
        img.src = URL.createObjectURL(file);
    });

    // Code Type Visibility Logic
    $("#codeType").addEventListener("change", (e) => {
        const type = e.target.value;
        const display = type === "none" ? "none" : "block";
        $("#codeDataGroup").style.display = display;
        $("#codePositionGroup").style.display = display;
        $("#codeSizeGroup").style.display = display;
        $("#qrErrorCorrectionGroup").style.display = type === "qr" ? "block" : "none";
        $("#barcodeFormatGroup").style.display = type === "barcode" ? "block" : "none";
        triggerUpdate();
    });

    // Printing
    $("form").addEventListener("submit", (e) => {
        e.preventDefault();
        navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: ["0000ff00-0000-1000-8000-00805f9b34fb"]
        })
        .then(device => device.gatt.connect())
        .then(server => server.getPrimaryService("0000ff00-0000-1000-8000-00805f9b34fb"))
        .then(service => service.getCharacteristic("0000ff02-0000-1000-8000-00805f9b34fb"))
        .then(char => printCanvas(char, canvas, { offsetX, offsetY, rotation: previewRotation }))
        .catch(handleError);
    });

    // Initial state
    updateLabelSize(canvas);
    updateRotationButtons();
    updateOffset();
    
    // Sliders value updates
    $all("input[type=range]").forEach(el => {
        el.addEventListener("input", (e) => {
            const display = $(`#${e.target.id}Value`);
            if (display) display.textContent = e.target.value;
        });
    });
});