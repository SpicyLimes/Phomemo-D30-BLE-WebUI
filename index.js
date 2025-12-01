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
let previewRotation = -90;
let offsetX = 0;
let offsetY = 0;

// Font mapping
const FONT_MAP = {
	Inter: '"Inter", system-ui, Arial, Helvetica, sans-serif',
	"Libre Franklin": '"Libre Franklin", "Franklin Gothic Medium", Arial, Helvetica, sans-serif',
	Oswald: '"Oswald", "DIN Alternate", "DIN Condensed", Arial, Helvetica, sans-serif',
	Staatliches: '"Staatliches", "Bahnschrift", Arial, Helvetica, sans-serif',
	Fredoka: '"Fredoka", "Arial Rounded MT", Arial, sans-serif',
	"Baloo 2": '"Baloo 2", "Comic Sans MS", cursive',
	"Libre Baskerville": '"Libre Baskerville", "Times New Roman", Times, serif',
	"JetBrains Mono": '"JetBrains Mono", "Courier New", Courier, monospace',
	"Alex Brush": '"Alex Brush", "Brush Script MT", cursive',
	Caveat: '"Caveat", "Bradley Hand", cursive',
	"Stardos Stencil": '"Stardos Stencil", "Stencil", Impact, sans-serif',
	Arial: "Arial, Helvetica, sans-serif",
	"Times New Roman": '"Times New Roman", Times, serif',
	"Courier New": '"Courier New", Courier, monospace',
};

const num = (v, dflt = 0) => {
	const n = parseFloat(String(v ?? "").replace(",", "."));
	return Number.isFinite(n) ? n : dflt;
};

/**
 * Generate QR code or barcode
 */
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
				color: {
					dark: "#000000",
					light: "#FFFFFF",
				},
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
	await new Promise((resolve) => {
		img.onload = resolve;
	});

	return img;
};

const generateBlueNoiseMap = (size = 64) => {
	const map = new Uint8Array(size * size);
	const used = new Array(size * size).fill(false);

	for (let i = 0; i < size * size; i++) {
		let bestDist = -1;
		let bestIdx = 0;

		for (let attempt = 0; attempt < Math.min(100, size * size - i); attempt++) {
			const candidate = Math.floor(Math.random() * size * size);
			if (used[candidate]) continue;

			let minDist = Infinity;
			for (let j = 0; j < size * size; j++) {
				if (!used[j]) continue;

				const x1 = candidate % size;
				const y1 = Math.floor(candidate / size);
				const x2 = j % size;
				const y2 = Math.floor(j / size);

				const dist = Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
				minDist = Math.min(minDist, dist);
			}

			if (minDist > bestDist) {
				bestDist = minDist;
				bestIdx = candidate;
			}
		}

		used[bestIdx] = true;
		map[bestIdx] = Math.floor((i / (size * size)) * 256);
	}

	return map;
};

const detectEdges = (imgData) => {
	const { width, height, data } = imgData;
	const edges = new Uint8Array(width * height);

	const sobelX = [
		[-1, 0, 1],
		[-2, 0, 2],
		[-1, 0, 1],
	];
	const sobelY = [
		[-1, -2, -1],
		[0, 0, 0],
		[1, 2, 1],
	];

	for (let y = 1; y < height - 1; y++) {
		for (let x = 1; x < width - 1; x++) {
			let gx = 0,
				gy = 0;

			for (let ky = -1; ky <= 1; ky++) {
				for (let kx = -1; kx <= 1; kx++) {
					const idx = ((y + ky) * width + (x + kx)) * 4;
					const intensity = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];

					gx += intensity * sobelX[ky + 1][kx + 1];
					gy += intensity * sobelY[ky + 1][kx + 1];
				}
			}

			const magnitude = Math.sqrt(gx * gx + gy * gy);
			edges[y * width + x] = Math.min(255, magnitude);
		}
	}

	return edges;
};

const scaleToExactResolution = (image, targetWidth, targetHeight, method = "lanczos") => {
	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d");

	canvas.width = targetWidth;
	canvas.height = targetHeight;

	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	if (method === "nearest") {
		ctx.imageSmoothingEnabled = false;
	} else {
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = method === "lanczos" ? "high" : "medium";
	}

	const scaleX = targetWidth / image.width;
	const scaleY = targetHeight / image.height;
	const scale = Math.min(scaleX, scaleY);

	const scaledWidth = image.width * scale;
	const scaledHeight = image.height * scale;
	const offsetX = (targetWidth - scaledWidth) / 2;
	const offsetY = (targetHeight - scaledHeight) / 2;

	ctx.drawImage(image, offsetX, offsetY, scaledWidth, scaledHeight);

	return canvas;
};

const ditherImageData = (
	imgData,
	algorithm = "floyd",
	threshold = 128,
	brightness = 0,
	contrast = 0,
	noise = 0,
	serpentine = true,
	edgeMap = null
) => {
	const { width, height, data } = imgData;
	const gray = new Float32Array(width * height);

	const brightnessAdjust = brightness * 2.55;
	const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
	const noiseAmount = noise * 2.55;

	for (let i = 0; i < gray.length; i++) {
		const r = data[i * 4];
		const g = data[i * 4 + 1];
		const b = data[i * 4 + 2];

		let adjustedR = Math.max(0, Math.min(255, contrastFactor * (r - 128) + 128 + brightnessAdjust));
		let adjustedG = Math.max(0, Math.min(255, contrastFactor * (g - 128) + 128 + brightnessAdjust));
		let adjustedB = Math.max(0, Math.min(255, contrastFactor * (b - 128) + 128 + brightnessAdjust));

		let luminance = 0.299 * adjustedR + 0.587 * adjustedG + 0.114 * adjustedB;

		if (noise > 0) {
			const randomNoise = (Math.random() - 0.5) * noiseAmount;
			luminance = Math.max(0, Math.min(255, luminance + randomNoise));
		}

		gray[i] = luminance;
	}

	const setBWPixel = (idx, val) => {
		data[idx * 4] = data[idx * 4 + 1] = data[idx * 4 + 2] = val;
		data[idx * 4 + 3] = 255;
	};

	if (algorithm === "threshold") {
		for (let i = 0; i < gray.length; i++) {
			let adjustedThreshold = threshold;

			if (edgeMap) {
				const edgeStrength = edgeMap[i] / 255;
				adjustedThreshold = threshold - edgeStrength * 30;
			}

			setBWPixel(i, gray[i] < adjustedThreshold ? 0 : 255);
		}
		return imgData;
	}

	if (algorithm === "blue_noise") {
		const noiseMap = generateBlueNoiseMap(64);
		const mapSize = 64;

		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const idx = y * width + x;
				const noiseIdx = (y % mapSize) * mapSize + (x % mapSize);
				const noiseThreshold = noiseMap[noiseIdx];

				let adjustedThreshold = noiseThreshold;
				if (edgeMap) {
					const edgeStrength = edgeMap[idx] / 255;
					adjustedThreshold = noiseThreshold - edgeStrength * 40;
				}

				setBWPixel(idx, gray[idx] < adjustedThreshold ? 0 : 255);
			}
		}
		return imgData;
	}

	if (algorithm.startsWith("ordered")) {
		let matrix;
		if (algorithm === "ordered2") {
			matrix = [
				[0, 2],
				[3, 1],
			];
		} else if (algorithm === "ordered4") {
			matrix = [
				[0, 8, 2, 10],
				[12, 4, 14, 6],
				[3, 11, 1, 9],
				[15, 7, 13, 5],
			];
		} else if (algorithm === "ordered8") {
			matrix = [
				[0, 32, 8, 40, 2, 34, 10, 42],
				[48, 16, 56, 24, 50, 18, 58, 26],
				[12, 44, 4, 36, 14, 46, 6, 38],
				[60, 28, 52, 20, 62, 30, 54, 22],
				[3, 35, 11, 43, 1, 33, 9, 41],
				[51, 19, 59, 27, 49, 17, 57, 25],
				[15, 47, 7, 39, 13, 45, 5, 37],
				[63, 31, 55, 23, 61, 29, 53, 21],
			];
		} else {
			matrix = [
				[0, 8, 2, 10],
				[12, 4, 14, 6],
				[3, 11, 1, 9],
				[15, 7, 13, 5],
			];
		}

		const n = matrix.length;
		const scale = 255 / (n * n);

		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const idx = y * width + x;
				let thresholdVal = (matrix[y % n][x % n] + 0.5) * scale;

				if (edgeMap) {
					const edgeStrength = edgeMap[idx] / 255;
					thresholdVal -= edgeStrength * 40;
				}

				setBWPixel(idx, gray[idx] < thresholdVal ? 0 : 255);
			}
		}

		return imgData;
	}

	const errorKernels = {
		floyd: [
			{ x: 1, y: 0, weight: 7 / 16 },
			{ x: -1, y: 1, weight: 3 / 16 },
			{ x: 0, y: 1, weight: 5 / 16 },
			{ x: 1, y: 1, weight: 1 / 16 },
		],
		atkinson: [
			{ x: 1, y: 0, weight: 1 / 8 },
			{ x: 2, y: 0, weight: 1 / 8 },
			{ x: -1, y: 1, weight: 1 / 8 },
			{ x: 0, y: 1, weight: 1 / 8 },
			{ x: 1, y: 1, weight: 1 / 8 },
			{ x: 0, y: 2, weight: 1 / 8 },
		],
		stucki: [
			{ x: 1, y: 0, weight: 8 / 42 },
			{ x: 2, y: 0, weight: 4 / 42 },
			{ x: -2, y: 1, weight: 2 / 42 },
			{ x: -1, y: 1, weight: 4 / 42 },
			{ x: 0, y: 1, weight: 8 / 42 },
			{ x: 1, y: 1, weight: 4 / 42 },
			{ x: 2, y: 1, weight: 2 / 42 },
			{ x: -2, y: 2, weight: 1 / 42 },
			{ x: -1, y: 2, weight: 2 / 42 },
			{ x: 0, y: 2, weight: 4 / 42 },
			{ x: 1, y: 2, weight: 2 / 42 },
			{ x: 2, y: 2, weight: 1 / 42 },
		],
		jarvis: [
			{ x: 1, y: 0, weight: 7 / 48 },
			{ x: 2, y: 0, weight: 5 / 48 },
			{ x: -2, y: 1, weight: 3 / 48 },
			{ x: -1, y: 1, weight: 5 / 48 },
			{ x: 0, y: 1, weight: 7 / 48 },
			{ x: 1, y: 1, weight: 5 / 48 },
			{ x: 2, y: 1, weight: 3 / 48 },
			{ x: -2, y: 2, weight: 1 / 48 },
			{ x: -1, y: 2, weight: 3 / 48 },
			{ x: 0, y: 2, weight: 5 / 48 },
			{ x: 1, y: 2, weight: 3 / 48 },
			{ x: 2, y: 2, weight: 1 / 48 },
		],
		sierra: [
			{ x: 1, y: 0, weight: 5 / 32 },
			{ x: 2, y: 0, weight: 3 / 32 },
			{ x: -2, y: 1, weight: 2 / 32 },
			{ x: -1, y: 1, weight: 4 / 32 },
			{ x: 0, y: 1, weight: 5 / 32 },
			{ x: 1, y: 1, weight: 4 / 32 },
			{ x: 2, y: 1, weight: 2 / 32 },
			{ x: -1, y: 2, weight: 2 / 32 },
			{ x: 0, y: 2, weight: 3 / 32 },
			{ x: 1, y: 2, weight: 2 / 32 },
		],
		burkes: [
			{ x: 1, y: 0, weight: 8 / 32 },
			{ x: 2, y: 0, weight: 4 / 32 },
			{ x: -2, y: 1, weight: 2 / 32 },
			{ x: -1, y: 1, weight: 4 / 32 },
			{ x: 0, y: 1, weight: 8 / 32 },
			{ x: 1, y: 1, weight: 4 / 32 },
			{ x: 2, y: 1, weight: 2 / 32 },
		],
	};

	const kernel = errorKernels[algorithm] || errorKernels.floyd;

	for (let y = 0; y < height; y++) {
		const direction = serpentine && y % 2 === 1 ? -1 : 1;
		const startX = direction === 1 ? 0 : width - 1;
		const endX = direction === 1 ? width : -1;

		for (let x = startX; x !== endX; x += direction) {
			const idx = y * width + x;
			const oldVal = gray[idx];

			let adjustedThreshold = threshold;
			if (edgeMap) {
				const edgeStrength = edgeMap[idx] / 255;
				adjustedThreshold = threshold - edgeStrength * 20;
			}

			const newVal = oldVal < adjustedThreshold ? 0 : 255;
			const err = oldVal - newVal;
			gray[idx] = newVal;
			setBWPixel(idx, newVal);

			for (const { x: dx, y: dy, weight } of kernel) {
				const nx = x + dx * direction;
				const ny = y + dy;

				if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
					const nIdx = ny * width + nx;
					gray[nIdx] += err * weight;
				}
			}
		}
	}

	return imgData;
};

const rotateImage = (image, angle) => {
	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d");

	const normalizedAngle = ((angle % 360) + 360) % 360;

	if (normalizedAngle === 90 || normalizedAngle === 270) {
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

			if (data[idx] === 0) {
				let blackNeighbors = 0;

				for (let dy = -1; dy <= 1; dy++) {
					for (let dx = -1; dx <= 1; dx++) {
						if (dx === 0 && dy === 0) continue;
						const nIdx = ((y + dy) * width + (x + dx)) * 4;
						if (data[nIdx] === 0) blackNeighbors++;
					}
				}

				if (blackNeighbors === 0) {
					output[idx] = output[idx + 1] = output[idx + 2] = 255;
				}
			} else if (data[idx] === 255) {
				const leftBlack = x > 0 && data[(y * width + (x - 1)) * 4] === 0;
				const rightBlack = x < width - 1 && data[(y * width + (x + 1)) * 4] === 0;
				const topWhite = y > 0 && data[((y - 1) * width + x) * 4] === 255;
				const bottomWhite = y < height - 1 && data[((y + 1) * width + x) * 4] === 255;

				const topBlack = y > 0 && data[((y - 1) * width + x) * 4] === 0;
				const bottomBlack = y < height - 1 && data[((y + 1) * width + x) * 4] === 0;
				const leftWhite = x > 0 && data[(y * width + (x - 1)) * 4] === 255;
				const rightWhite = x < width - 1 && data[(y * width + (x + 1)) * 4] === 255;

				if (
					(leftBlack && rightBlack && topWhite && bottomWhite) ||
					(topBlack && bottomBlack && leftWhite && rightWhite)
				) {
					output[idx] = output[idx + 1] = output[idx + 2] = 0;
				}
			}
		}
	}

	data.set(output);
	return imgData;
};

const applyTwoPhaseDiffusion = (imgData, threshold, brightness, contrast, noise, edgeMap) => {
	const phase1 = ditherImageData(
		new ImageData(new Uint8ClampedArray(imgData.data), imgData.width, imgData.height),
		"ordered4",
		threshold,
		brightness,
		contrast,
		noise,
		false,
		null
	);

	return ditherImageData(
		phase1,
		"floyd",
		threshold + 10,
		0,
		0,
		0,
		true,
		edgeMap
	);
};

const processImageWithAdjustments = (
	image,
	brightness = 0,
	contrast = 0,
	algorithm = "floyd",
	threshold = 128,
	rotation = 0,
	noise = 0,
	advancedOptions = {}
) => {
	const {
		useGammaCorrection = false,
		gamma = 2.2,
		usePreFiltering = false,
		blurSigma = 0.5,
		unsharpRadius = 1.0,
		unsharpAmount = 0.8,
		useCLAHE = false,
		claheClipLimit = 2.0,
		claheTileSize = 16,
		useEdgeAware = false,
		useHardwareCleanup = false,
		usePrinterResolution = false,
		printerWidth = 320,
		printerHeight = 96,
		scalingMethod = "lanczos",
		serpentine = true,
	} = advancedOptions;

	let rotatedImage = image;
	if (rotation !== 0) {
		rotatedImage = rotateImage(image, rotation);
	}

	if (usePrinterResolution) {
		rotatedImage = scaleToExactResolution(rotatedImage, printerWidth, printerHeight, scalingMethod);
	}

	const tempCanvas = document.createElement("canvas");
	const tempCtx = tempCanvas.getContext("2d");

	tempCanvas.width = rotatedImage.width;
	tempCanvas.height = rotatedImage.height;

	tempCtx.fillStyle = "#ffffff";
	tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

	tempCtx.drawImage(rotatedImage, 0, 0);

	let imgData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);

	if (useGammaCorrection) {
		imgData = applyGammaCorrection(imgData, gamma);
	}

	if (useCLAHE) {
		imgData = applyCLAHE(imgData, claheTileSize, claheClipLimit);
	}

	if (usePreFiltering) {
		imgData = applyGaussianBlur(imgData, blurSigma);
		imgData = applyUnsharpMask(imgData, unsharpRadius, unsharpAmount);
	}

	let edgeMap = null;
	if (useEdgeAware) {
		edgeMap = detectEdges(imgData);
	}

	let processedData;
	if (algorithm === "two_phase") {
		processedData = applyTwoPhaseDiffusion(imgData, threshold, brightness, contrast, noise, edgeMap);
	} else {
		processedData = ditherImageData(
			imgData,
			algorithm,
			threshold,
			brightness,
			contrast,
			noise,
			serpentine,
			edgeMap
		);
	}

	if (useHardwareCleanup) {
		processedData = applyHardwareCleanup(processedData);
	}

	tempCtx.putImageData(processedData, 0, 0);

	return tempCanvas;
};

const updateImagePreview = () => {
	const previewGroup = $("#imagePreviewGroup");
	const originalCanvas = $("#imagePreviewOriginal");
	const processedCanvasEl = $("#imagePreviewProcessed");

	if (!previewGroup || !originalCanvas || !processedCanvasEl) return;

	if (!uploadedImage) {
		previewGroup.style.display = "none";
		return;
	}

	previewGroup.style.display = "block";

	const brightness = $("#brightness")?.valueAsNumber ?? 0;
	const contrast = $("#contrast")?.valueAsNumber ?? 0;
	const algorithm = $("#ditherAlgorithm")?.value || "floyd";
	const threshold = $("#threshold")?.valueAsNumber ?? 128;
	const imageRotation = parseInt($("#imageRotation")?.value || "0", 10);
	const noise = $("#noise")?.valueAsNumber ?? 0;

	const maxPreviewDim = 120;

	const origScale = Math.min(1, maxPreviewDim / Math.max(uploadedImage.width, uploadedImage.height));
	const origW = Math.round(uploadedImage.width * origScale);
	const origH = Math.round(uploadedImage.height * origScale);

	originalCanvas.width = origW;
	originalCanvas.height = origH;
	originalCanvas.style.width = origW + "px";
	originalCanvas.style.height = origH + "px";
	originalCanvas.style.imageRendering = "pixelated";

	const origCtx = originalCanvas.getContext("2d");
	origCtx.imageSmoothingEnabled = false;
	origCtx.clearRect(0, 0, origW, origH);
	origCtx.drawImage(uploadedImage, 0, 0, origW, origH);

	const advancedOptions = {
		useGammaCorrection: $("#useGammaCorrection")?.checked || false,
		gamma: parseFloat($("#gamma")?.value || "2.2"),
		usePreFiltering: $("#usePreFiltering")?.checked || false,
		blurSigma: parseFloat($("#blurSigma")?.value || "0.5"),
		unsharpRadius: 1.0,
		unsharpAmount: parseFloat($("#unsharpAmount")?.value || "0.8"),
		useCLAHE: $("#useCLAHE")?.checked || false,
		claheClipLimit: parseFloat($("#claheClipLimit")?.value || "2.0"),
		claheTileSize: 16,
		useEdgeAware: $("#useEdgeAware")?.checked || false,
		useHardwareCleanup: $("#useHardwareCleanup")?.checked || false,
		usePrinterResolution: false,
		serpentine: $("#serpentine")?.checked !== false,
	};

	const processedTemp = processImageWithAdjustments(
		uploadedImage,
		brightness,
		contrast,
		algorithm,
		threshold,
		imageRotation,
		noise,
		advancedOptions
	);

	const procScale = Math.min(1, maxPreviewDim / Math.max(processedTemp.width, processedTemp.height));
	const procW = Math.round(processedTemp.width * procScale);
	const procH = Math.round(processedTemp.height * procScale);

	processedCanvasEl.width = procW;
	processedCanvasEl.height = procH;
	processedCanvasEl.style.width = procW + "px";
	processedCanvasEl.style.height = procH + "px";
	processedCanvasEl.style.imageRendering = "pixelated";

	const procCtx = processedCanvasEl.getContext("2d");
	procCtx.imageSmoothingEnabled = false;
	procCtx.clearRect(0, 0, procW, procH);
	procCtx.drawImage(processedTemp, 0, 0, procW, procH);

	[originalCanvas, processedCanvasEl].forEach((c) => {
		const wrapper = c.closest(".flex-fill");
		if (wrapper) {
			wrapper.style.minWidth = maxPreviewDim + "px";
			wrapper.style.minHeight = Math.max(origH, procH) + "px";
		}
	});
};

/**
 * Draw border on canvas
 */
const drawBorder = (ctx, width, height, borderWidth, borderStyle) => {
	if (!borderWidth || borderWidth < 1) return;

	ctx.save();
	ctx.strokeStyle = "#000000";
	ctx.lineWidth = borderWidth;

	const halfWidth = borderWidth / 2;
	const x = halfWidth;
	const y = halfWidth;
	const w = width - borderWidth;
	const h = height - borderWidth;

	if (borderStyle === "rounded") {
		const radius = 4;
		ctx.beginPath();
		ctx.moveTo(x + radius, y);
		ctx.lineTo(x + w - radius, y);
		ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
		ctx.lineTo(x + w, y + h - radius);
		ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
		ctx.lineTo(x + radius, y + h);
		ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
		ctx.lineTo(x, y + radius);
		ctx.quadraticCurveTo(x, y, x + radius, y);
		ctx.closePath();
		ctx.stroke();
	} else {
		ctx.strokeRect(x, y, w, h);
	}

	ctx.restore();
};

/**
 * Letter-spacing with preserved kerning
 */
function drawTextKerningSpacing(ctx, text, x, y, align, letterSpacing) {
	const n = text.length;
	if (n === 0) return { startX: x, totalW: 0 };

	if (!letterSpacing) {
		const w = ctx.measureText(text).width;
		let left = x;
		if (align === "center") left = x - w / 2;
		else if (align === "right") left = x - w;

		const prev = ctx.textAlign;
		ctx.textAlign = "left";
		ctx.fillText(text, left, y);
		ctx.textAlign = prev;

		return { startX: left, totalW: w };
	}

	const baseW = ctx.measureText(text).width;
	const totalW = baseW + (n - 1) * letterSpacing;

	let left = x;
	if (align === "center") left = x - totalW / 2;
	else if (align === "right") left = x - totalW;

	const prev = ctx.textAlign;
	ctx.textAlign = "left";

	for (let i = 0; i < n; i++) {
		const subW = ctx.measureText(text.slice(0, i)).width;
		const gx = left + subW + i * letterSpacing;
		ctx.fillText(text[i], gx, y);
	}

	ctx.textAlign = prev;
	return { startX: left, totalW };
}

/**
 * Draw vertical text
 */
const drawVerticalText = (ctx, text, options) => {
	const { x, y, width, height, fontFamily, fontSize, fontWeight, align } = options;

	ctx.save();
	ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
	ctx.textBaseline = "middle";

	const visibleChars = text.split("").filter((char) => char.trim());

	const lineHeight = fontSize * 1.2;
	const totalTextHeight = visibleChars.length * lineHeight;

	const centerX = x + width / 2;
	const centerY = y + height / 2;

	ctx.translate(centerX, centerY);
	ctx.rotate(-Math.PI / 2);

	let startY = -totalTextHeight / 2 + lineHeight / 2;
	let charX = 0;

	switch (align) {
		case "left":
			charX = -width / 2 + fontSize / 2;
			break;
		case "right":
			charX = width / 2 - fontSize / 2;
			break;
		case "center":
		default:
			charX = 0;
			break;
	}

	let charIndex = 0;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (char.trim()) {
			ctx.textAlign = "center";
			ctx.fillText(char, charX, startY + charIndex * lineHeight);
			charIndex++;
		}
	}

	ctx.restore();
};

/**
 * Main canvas update function
 */
const updateCanvasText = async (canvas) => {
	// Get all settings
	let text = $("#inputText").value;
	const fontSize = $("#inputFontSize").valueAsNumber;
	const fontFamilyName = $("#fontFamily")?.value || "Arial";
	const fontFamily = FONT_MAP[fontFamilyName] || `"${fontFamilyName}", sans-serif`;
	const textAlign = $("#textAlign")?.value || "center";
	const verticalText = $("#verticalText")?.checked || false;
	const imagePosition = $("#imagePosition")?.value || "none";
	const imageSize = $("#imageSize")?.valueAsNumber || 50;
	const imageRotation = parseInt($("#imageRotation")?.value || "0", 10);
	const algorithm = $("#ditherAlgorithm")?.value || "floyd";
	const threshold = $("#threshold")?.valueAsNumber ?? 128;
	const brightness = $("#brightness")?.valueAsNumber ?? 0;
	const contrast = $("#contrast")?.valueAsNumber ?? 0;
	const noise = $("#noise")?.valueAsNumber ?? 0;

	// Text styling
	const isBold = !!$("#fontBold")?.checked;
	const isItalic = !!$("#fontItalic")?.checked;
	const isUnderline = !!$("#fontUnderline")?.checked;
	const isUppercase = !!$("#fontUppercase")?.checked;
	const lineHeight = Math.max(1, Math.min(2, num($("#lineHeight")?.value, 1.2)));
	const margin = Math.max(0, Math.min(30, parseInt($("#textMargin")?.value || "6", 10)));
	const letterSpacing = Math.max(0, num($("#letterSpacing")?.value, 0));

	// Border settings
	const enableBorder = !!$("#enableBorder")?.checked;
	const borderWidth = parseInt($("#borderWidth")?.value || "2", 10);
	const borderStyle = $("#borderStyle")?.value || "square";

	// QR/Barcode
	const codeType = $("#codeType")?.value || "none";
	const codeData = $("#codeData")?.value || "";
	const codePosition = $("#codePosition")?.value || "above";
	const codeSize = $("#codeSize")?.valueAsNumber || 30;
	const qrErrorCorrection = $("#qrErrorCorrection")?.value || "M";
	const barcodeFormat = $("#barcodeFormat")?.value || "CODE128";

	if (isUppercase) text = text.toUpperCase();

	// Generate code if needed
	if (codeType !== "none" && codeData.trim()) {
		try {
			generatedCode = await generateCode(codeData, codeType, barcodeFormat, qrErrorCorrection);
		} catch (err) {
			console.error("Code generation failed:", err);
			generatedCode = null;
		}
	} else {
		generatedCode = null;
	}

	if (isNaN(fontSize)) {
		handleError("font size invalid");
		return;
	}

	const ctx = canvas.getContext("2d");
	ctx.imageSmoothingEnabled = false;
	ctx.fillStyle = "#fff";
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	ctx.save();
	ctx.translate(canvas.width / 2, canvas.height / 2);
	ctx.rotate(Math.PI / 2);
	ctx.translate(offsetX, offsetY);

	const rotatedWidth = canvas.height;
	const rotatedHeight = canvas.width;

	let textArea = {
		x: -rotatedWidth / 2,
		y: -rotatedHeight / 2,
		width: rotatedWidth,
		height: rotatedHeight,
	};

	// Apply margin to text area
	textArea.x += margin;
	textArea.y += margin;
	textArea.width -= margin * 2;
	textArea.height -= margin * 2;

/**
 * Update rotation buttons and CSS
 */
const updateRotationButtons = () => {
	const canvas = $("#canvas");
	if (!canvas) return;
	const card = canvas.closest(".card");
	if (!card) return;

	card.classList.remove("rotate-90", "rotate-180", "rotate-270");

	const normalizedRotation = ((previewRotation % 360) + 360) % 360;

	switch (normalizedRotation) {
		case 0:
			break;
		case 90:
			card.classList.add("rotate-90");
			break;
		case 180:
			card.classList.add("rotate-180");
			break;
		case 270:
			card.classList.add("rotate-270");
			break;
	}
};

// Handle image processing and positioning
	let codeImageHeight = 0;
	let codeImageWidth = 0;

	if (generatedCode) {
		const codeSizeRatio = codeSize / 100;
		const maxCodeW = rotatedWidth * codeSizeRatio;
		const maxCodeH = rotatedHeight * codeSizeRatio;
		const codeScale = Math.min(maxCodeW / generatedCode.width, maxCodeH / generatedCode.height);
		codeImageWidth = generatedCode.width * codeScale;
		codeImageHeight = generatedCode.height * codeScale;
	}

	if (uploadedImage && imagePosition !== "none") {
		const advancedOptions = {
			useGammaCorrection: $("#useGammaCorrection")?.checked || false,
			gamma: parseFloat($("#gamma")?.value || "2.2"),
			usePreFiltering: $("#usePreFiltering")?.checked || false,
			blurSigma: parseFloat($("#blurSigma")?.value || "0.5"),
			unsharpRadius: 1.0,
			unsharpAmount: parseFloat($("#unsharpAmount")?.value || "0.8"),
			useCLAHE: $("#useCLAHE")?.checked || false,
			claheClipLimit: parseFloat($("#claheClipLimit")?.value || "2.0"),
			claheTileSize: 16,
			useEdgeAware: $("#useEdgeAware")?.checked || false,
			useHardwareCleanup: $("#useHardwareCleanup")?.checked || false,
			usePrinterResolution: $("#usePrinterResolution")?.checked || false,
			printerWidth: canvas.width,
			printerHeight: canvas.height,
			scalingMethod: "lanczos",
			serpentine: $("#serpentine")?.checked !== false,
		};

		processedImage = processImageWithAdjustments(
			uploadedImage,
			brightness,
			contrast,
			algorithm,
			threshold,
			imageRotation,
			noise,
			advancedOptions
		);

		const imageSizeRatio = imageSize / 100;

		if (imagePosition === "background") {
			const maxW = rotatedWidth;
			const maxH = rotatedHeight;
			const scale =
				Math.min(maxW / processedImage.width, maxH / processedImage.height) * imageSizeRatio;
			const drawW = processedImage.width * scale;
			const drawH = processedImage.height * scale;

			ctx.globalAlpha = 0.3;
			ctx.drawImage(processedImage, -drawW / 2, -drawH / 2, drawW, drawH);
			ctx.globalAlpha = 1.0;
		} else {
			const maxImageW = rotatedWidth * imageSizeRatio;
			const maxImageH = rotatedHeight * imageSizeRatio;
			const scale = Math.min(maxImageW / processedImage.width, maxImageH / processedImage.height);
			const imageW = processedImage.width * scale;
			const imageH = processedImage.height * scale;

			let imageX, imageY;

			switch (imagePosition) {
				case "above":
					imageX = -imageW / 2;
					imageY = -rotatedHeight / 2;
					textArea.y = imageY + imageH + 10;
					textArea.height = rotatedHeight - imageH - 10;
					break;
				case "below":
					imageX = -imageW / 2;
					imageY = rotatedHeight / 2 - imageH;
					textArea.height = rotatedHeight - imageH - 10;
					break;
				case "left":
					imageX = -rotatedWidth / 2;
					imageY = -imageH / 2;
					textArea.x = imageX + imageW + 10;
					textArea.width = rotatedWidth - imageW - 10;
					break;
				case "right":
					imageX = rotatedWidth / 2 - imageW;
					imageY = -imageH / 2;
					textArea.width = rotatedWidth - imageW - 10;
					break;
			}
							ctx.drawImage(processedImage, imageX, imageY, imageW, imageH);
						}
					}

// Handle code positioning
if (generatedCode && codePosition !== "background") {
	let codeX, codeY;

	switch (codePosition) {
		case "above":
			codeX = -codeImageWidth / 2;
			codeY = textArea.y;
			textArea.y = codeY + codeImageHeight + 10;
			textArea.height = Math.max(0, textArea.height - codeImageHeight - 10);
			break;
		case "below":
			codeX = -codeImageWidth / 2;
			codeY = textArea.y + textArea.height - codeImageHeight;
			textArea.height = Math.max(0, textArea.height - codeImageHeight - 10);
			break;
		case "left":
			codeX = textArea.x;
			codeY = -codeImageHeight / 2;
			textArea.x = codeX + codeImageWidth + 10;
			textArea.width = Math.max(0, textArea.width - codeImageWidth - 10);
			break;
		case "right":
			codeX = textArea.x + textArea.width - codeImageWidth;
			codeY = -codeImageHeight / 2;
			textArea.width = Math.max(0, textArea.width - codeImageWidth - 10);
			break;
	}

	ctx.drawImage(generatedCode, codeX, codeY, codeImageWidth, codeImageHeight);
} else if (generatedCode && codePosition === "background") {
	ctx.globalAlpha = 0.2;
	ctx.drawImage(
		generatedCode,
		-codeImageWidth / 2,
		-codeImageHeight / 2,
		codeImageWidth,
		codeImageHeight
	);
	ctx.globalAlpha = 1.0;
}

	// Draw text with advanced features
	if (text.trim()) {
		ctx.fillStyle = "#000";
		const weight = isBold ? "700" : "400";
		const style = isItalic ? "italic" : "normal";
		const font = `${style} ${weight} ${fontSize}px ${fontFamily}`;

		if (verticalText) {
			drawVerticalText(ctx, text, {
				x: textArea.x,
				y: textArea.y,
				width: textArea.width,
				height: textArea.height,
				fontFamily,
				fontSize,
				fontWeight: weight,
				align: textAlign,
			});
		} else {
			// Multi-line text with line height and letter spacing
			const lines = text.split(/\r?\n/);
			const lhPx = fontSize * lineHeight;
			const totalH = lhPx * (lines.length - 1);
			const yStart = textArea.y + textArea.height / 2 - totalH / 2;

			ctx.font = font;
			ctx.textBaseline = "middle";

			const underlineThickness = Math.max(1, Math.round(fontSize / 9));
			const underlineExtra = Math.max(fontSize * 0.35, 4);

			for (let i = 0; i < lines.length; i++) {
				const lineY = yStart + i * lhPx;
				let lineX = textArea.x + textArea.width / 2;

				if (textAlign === "left") lineX = textArea.x;
				else if (textAlign === "right") lineX = textArea.x + textArea.width;

				const { startX, totalW } = drawTextKerningSpacing(
					ctx,
					lines[i],
					lineX,
					lineY,
					textAlign,
					letterSpacing
				);

				if (isUnderline) {
					const m = ctx.measureText(lines[i]);
					const descent = m.actualBoundingBoxDescent ?? fontSize * 0.2;
					const uy = lineY + descent + underlineExtra;
					ctx.save();
					ctx.beginPath();
					ctx.lineWidth = underlineThickness;
					ctx.strokeStyle = "#000";
					ctx.moveTo(Math.round(startX), Math.round(uy));
					ctx.lineTo(Math.round(startX + totalW), Math.round(uy));
					ctx.stroke();
					ctx.restore();
				}
			}
		}
	}

	ctx.restore();

	// Draw border on the final rotated canvas
	if (enableBorder) {
		drawBorder(ctx, canvas.width, canvas.height, borderWidth, borderStyle);
	}
};

// [Continue with all other functions - updateLabelSize, handleError, etc.]
// Initialize and wire up event listeners

const updateLabelSize = (canvas) => {
	const inputWidth = $("#inputWidth").valueAsNumber;
	const inputHeight = $("#inputHeight").valueAsNumber;
	if (isNaN(inputWidth) || isNaN(inputHeight)) {
		handleError("label size invalid");
		return;
	}

	labelSize.width = inputWidth;
	labelSize.height = inputHeight;

	canvas.style.width = "";
	canvas.style.height = "";

	const actualCanvasWidth = labelSize.height * 8;
	const actualCanvasHeight = labelSize.width * 8;

	canvas.width = actualCanvasWidth;
	canvas.height = actualCanvasHeight;

	const previewContainer = canvas.parentElement;
	const containerHeight = previewContainer.clientHeight || 300;
	const containerWidth = previewContainer.clientWidth || 300;

	const scaleX = Math.floor(containerWidth / actualCanvasWidth);
	const scaleY = Math.floor(containerHeight / actualCanvasHeight);
	let scale = Math.max(1, Math.min(scaleX, scaleY));

	if (scaleX === 0 && scaleY === 0) {
		scale = Math.min(containerWidth / actualCanvasWidth, containerHeight / actualCanvasHeight);
	}

	const displayWidth = actualCanvasWidth * scale;
	const displayHeight = actualCanvasHeight * scale;

	canvas.style.width = displayWidth + "px";
	canvas.style.height = displayHeight + "px";
	canvas.style.imageRendering = "pixelated";

	updateCanvasText(canvas);
};

const handleError = (err) => {
	console.error(err);
	const toast = bootstrap.Toast.getOrCreateInstance($("#errorToast"));
	$("#errorText").textContent = err.toString();
	toast.show();
};

document.addEventListener("DOMContentLoaded", function () {
	const canvas = document.querySelector("#canvas");

	$all("#inputWidth, #inputHeight").forEach((e) =>
		e.addEventListener("input", () => updateLabelSize(canvas))
	);
	updateLabelSize(canvas);

	window.addEventListener("resize", () => {
		clearTimeout(window.resizeTimeout);
		window.resizeTimeout = setTimeout(() => {
			updateLabelSize(canvas);
		}, 100);
	});

	// Wire up all text controls
	$all(
		"#inputText, #inputFontSize, #fontFamily, #textAlign, #verticalText, #fontBold, #fontItalic, #fontUnderline, #fontUppercase, #lineHeight, #textMargin, #letterSpacing, #enableBorder, #borderWidth, #borderStyle"
	).forEach((e) => {
		e.addEventListener("input", () => updateCanvasText(canvas));
		e.addEventListener("change", () => updateCanvasText(canvas));
	});

	// Wire up image controls
	$all(
		"#imagePosition, #imageSize, #imageRotation, #ditherAlgorithm, #threshold, #brightness, #contrast, #noise"
	).forEach((e) => e.addEventListener("input", () => updateCanvasText(canvas)));

	// Advanced processing controls
	$all(
		"#useGammaCorrection, #gamma, #usePreFiltering, #blurSigma, #unsharpAmount, #useCLAHE, #claheClipLimit, #useEdgeAware, #useHardwareCleanup, #usePrinterResolution, #serpentine"
	).forEach((e) => e.addEventListener("input", () => updateCanvasText(canvas)));

	$all(
		"#useGammaCorrection, #usePreFiltering, #useCLAHE, #useEdgeAware, #useHardwareCleanup, #usePrinterResolution, #serpentine"
	).forEach((e) => e.addEventListener("change", () => updateCanvasText(canvas)));

	// QR Code and Barcode controls
	$all("#codeType, #codeData, #codePosition, #codeSize, #qrErrorCorrection, #barcodeFormat").forEach(
		(e) => e.addEventListener("input", () => updateCanvasText(canvas))
	);

	// Handle code type change to show/hide relevant options
	$("#codeType").addEventListener("change", (e) => {
		const codeType = e.target.value;
		const qrGroup = $("#qrErrorCorrectionGroup");
		const barcodeGroup = $("#barcodeFormatGroup");
		const codeDataGroup = $("#codeDataGroup");
		const codePositionGroup = $("#codePositionGroup");
		const codeSizeGroup = $("#codeSizeGroup");

		if (codeType === "none") {
			qrGroup.style.display = "none";
			barcodeGroup.style.display = "none";
			codeDataGroup.style.display = "none";
			codePositionGroup.style.display = "none";
			codeSizeGroup.style.display = "none";
		} else {
			codeDataGroup.style.display = "block";
			codePositionGroup.style.display = "block";
			codeSizeGroup.style.display = "block";

			if (codeType === "qr") {
				qrGroup.style.display = "block";
				barcodeGroup.style.display = "none";
			} else if (codeType === "barcode") {
				qrGroup.style.display = "none";
				barcodeGroup.style.display = "block";
			}
		}

		updateCanvasText(canvas);
	});

	// Image upload
	const inputImage = $("#inputImage");
	if (inputImage) {
		inputImage.addEventListener("change", (e) => {
			const file = e.target.files[0];
			if (!file) {
				uploadedImage = null;
				updateCanvasText(canvas);
				updateImagePreview();
				return;
			}
			const img = new Image();
			img.onload = () => {
				uploadedImage = img;
				updateCanvasText(canvas);
				updateImagePreview();
			};
			img.src = URL.createObjectURL(file);
		});
	}

	// Update slider value displays
	const thresholdSlider = $("#threshold");
	const brightnessSlider = $("#brightness");
	const contrastSlider = $("#contrast");
	const noiseSlider = $("#noise");
	const codeSizeSlider = $("#codeSize");
	const gammaSlider = $("#gamma");
	const blurSigmaSlider = $("#blurSigma");
	const unsharpAmountSlider = $("#unsharpAmount");
	const claheClipLimitSlider = $("#claheClipLimit");

	if (thresholdSlider) {
		thresholdSlider.addEventListener("input", (e) => {
			$("#thresholdValue").textContent = e.target.value;
		});
	}

	if (brightnessSlider) {
		brightnessSlider.addEventListener("input", (e) => {
			$("#brightnessValue").textContent = e.target.value;
		});
	}

	if (contrastSlider) {
		contrastSlider.addEventListener("input", (e) => {
			$("#contrastValue").textContent = e.target.value;
		});
	}

	if (noiseSlider) {
		noiseSlider.addEventListener("input", (e) => {
			$("#noiseValue").textContent = e.target.value;
		});
	}

	if (codeSizeSlider) {
		codeSizeSlider.addEventListener("input", (e) => {
			$("#codeSizeValue").textContent = e.target.value;
		});
	}

	if (gammaSlider) {
		gammaSlider.addEventListener("input", (e) => {
			$("#gammaValue").textContent = e.target.value;
		});
	}

	if (blurSigmaSlider) {
		blurSigmaSlider.addEventListener("input", (e) => {
			$("#blurSigmaValue").textContent = e.target.value;
		});
	}

	if (unsharpAmountSlider) {
		unsharpAmountSlider.addEventListener("input", (e) => {
			$("#unsharpAmountValue").textContent = e.target.value;
		});
	}

	if (claheClipLimitSlider) {
		claheClipLimitSlider.addEventListener("input", (e) => {
			$("#claheClipLimitValue").textContent = e.target.value;
		});
	}

	// Initialize QR/barcode options visibility
	const initialCodeType = $("#codeType").value;
	if (initialCodeType === "none") {
		$("#qrErrorCorrectionGroup").style.display = "none";
		$("#barcodeFormatGroup").style.display = "none";
		$("#codeDataGroup").style.display = "none";
		$("#codePositionGroup").style.display = "none";
		$("#codeSizeGroup").style.display = "none";
	}

	// Preview update hooks for image processing
	$all("#ditherAlgorithm, #threshold, #brightness, #contrast, #noise, #imageRotation").forEach((e) =>
		e.addEventListener("input", updateImagePreview)
	);

	$all(
		"#useGammaCorrection, #gamma, #usePreFiltering, #blurSigma, #unsharpAmount, #useCLAHE, #claheClipLimit, #useEdgeAware, #useHardwareCleanup, #serpentine"
	).forEach((e) => e.addEventListener("input", updateImagePreview));

	$all(
		"#useGammaCorrection, #usePreFiltering, #useCLAHE, #useEdgeAware, #useHardwareCleanup, #serpentine"
	).forEach((e) => e.addEventListener("change", updateImagePreview));

	updateImagePreview();

	// Slider value displays
	const imageSizeSlider = $("#imageSize");
	if (imageSizeSlider) {
		imageSizeSlider.addEventListener("input", (e) => {
			$("#imageSizeValue").textContent = e.target.value;
		});
	}

	const borderWidthSlider = $("#borderWidth");
	if (borderWidthSlider) {
		borderWidthSlider.addEventListener("input", (e) => {
			$("#borderWidthValue").textContent = e.target.value;
		});
	}

	// Rotation controls
	$("#rotateClockwise").addEventListener("click", () => {
		previewRotation = (previewRotation + 90) % 360;
		updateRotationButtons();
	});

	$("#rotateCounterClockwise").addEventListener("click", () => {
		previewRotation = previewRotation - 90;
		if (previewRotation <= -360) {
			previewRotation += 360;
		}
		updateRotationButtons();
	});

	// Offset controls
	const updateOffsetDisplay = () => {
		$("#offsetXValue").textContent = offsetX;
		$("#offsetYValue").textContent = offsetY;
	};

	$("#offsetUp").addEventListener("click", () => {
		const step = parseInt($("#offsetStep").value);
		offsetY -= step;
		updateOffsetDisplay();
		updateCanvasText(canvas);
	});

	$("#offsetDown").addEventListener("click", () => {
		const step = parseInt($("#offsetStep").value);
		offsetY += step;
		updateOffsetDisplay();
		updateCanvasText(canvas);
	});

	$("#offsetLeft").addEventListener("click", () => {
		const step = parseInt($("#offsetStep").value);
		offsetX -= step;
		updateOffsetDisplay();
		updateCanvasText(canvas);
	});

	$("#offsetRight").addEventListener("click", () => {
		const step = parseInt($("#offsetStep").value);
		offsetX += step;
		updateOffsetDisplay();
		updateCanvasText(canvas);
	});

	$("#offsetReset").addEventListener("click", () => {
		offsetX = 0;
		offsetY = 0;
		updateOffsetDisplay();
		updateCanvasText(canvas);
	});

	updateOffsetDisplay();
	updateRotationButtons();
	updateCanvasText(canvas);

/**
 * Applies gamma correction to image data
 */
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

/**
 * Applies Gaussian blur to image data
 */
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

	for (let i = 0; i < kernelSize; i++) {
		kernel[i] /= sum;
	}

	// Horizontal pass
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let r = 0,
				g = 0,
				b = 0;

			for (let i = 0; i < kernelSize; i++) {
				const px = Math.max(0, Math.min(width - 1, x + i - center));
				const idx = (y * width + px) * 4;
				const weight = kernel[i];

				r += data[idx] * weight;
				g += data[idx + 1] * weight;
				b += data[idx + 2] * weight;
			}

			const outIdx = (y * width + x) * 4;
			output[outIdx] = r;
			output[outIdx + 1] = g;
			output[outIdx + 2] = b;
			output[outIdx + 3] = data[outIdx + 3];
		}
	}

	data.set(output);

	// Vertical pass
	for (let x = 0; x < width; x++) {
		for (let y = 0; y < height; y++) {
			let r = 0,
				g = 0,
				b = 0;

			for (let i = 0; i < kernelSize; i++) {
				const py = Math.max(0, Math.min(height - 1, y + i - center));
				const idx = (py * width + x) * 4;
				const weight = kernel[i];

				r += data[idx] * weight;
				g += data[idx + 1] * weight;
				b += data[idx + 2] * weight;
			}

			const outIdx = (y * width + x) * 4;
			output[outIdx] = r;
			output[outIdx + 1] = g;
			output[outIdx + 2] = b;
			output[outIdx + 3] = data[outIdx + 3];
		}
	}

	data.set(output);
	return imgData;
};

/**
 * Applies unsharp mask to enhance edges
 */
const applyUnsharpMask = (imgData, radius = 1.0, amount = 0.8) => {
	const { width, height, data } = imgData;

	const blurred = new ImageData(new Uint8ClampedArray(data), width, height);
	applyGaussianBlur(blurred, radius);

	for (let i = 0; i < data.length; i += 4) {
		for (let c = 0; c < 3; c++) {
			const original = data[i + c];
			const blur = blurred.data[i + c];
			const enhanced = original + amount * (original - blur);
			data[i + c] = Math.max(0, Math.min(255, enhanced));
		}
	}

	return imgData;
};

/**
 * Applies CLAHE (Contrast Limited Adaptive Histogram Equalization)
 */
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
					const val = gray[y * width + x];
					hist[val]++;
					pixelCount++;
				}
			}

			const excess = Math.max(0, Math.max(...hist) - (clipLimit * pixelCount) / 256);
			if (excess > 0) {
				const redistribution = excess / 256;
				for (let i = 0; i < 256; i++) {
					if (hist[i] > (clipLimit * pixelCount) / 256) {
						hist[i] = (clipLimit * pixelCount) / 256;
					}
					hist[i] += redistribution;
				}
			}

			const cdf = new Array(256);
			cdf[0] = hist[0];
			for (let i = 1; i < 256; i++) {
				cdf[i] = cdf[i - 1] + hist[i];
			}

			const mapping = new Uint8Array(256);
			for (let i = 0; i < 256; i++) {
				mapping[i] = Math.round((cdf[i] / pixelCount) * 255);
			}

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
	
	// Print
	$("form").addEventListener("submit", (e) => {
		e.preventDefault();
		navigator.bluetooth
			.requestDevice({
				acceptAllDevices: true,
				optionalServices: ["0000ff00-0000-1000-8000-00805f9b34fb"],
			})
			.then((device) => device.gatt.connect())
			.then((server) => server.getPrimaryService("0000ff00-0000-1000-8000-00805f9b34fb"))
			.then((service) => service.getCharacteristic("0000ff02-0000-1000-8000-00805f9b34fb"))
			.then((char) => printCanvas(char, canvas))
			.catch(handleError);
	});
});
