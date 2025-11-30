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
let generatedCode = null; // Generated QR code or barcode image
let previewRotation = -90; // 0, 90, 180, 270 degrees (default: -90 = 90° CCW)
let offsetX = 0; // X offset for print positioning
let offsetY = 0; // Y offset for print positioning

/**
 * Generates a QR code or barcode image based on the current settings
 * @param {string} data - The data to encode
 * @param {string} type - 'qr' or 'barcode'
 * @param {string} format - Barcode format (for barcodes only)
 * @param {string} errorCorrection - QR error correction level (for QR codes only)
 * @returns {Promise<HTMLImageElement>}
 */
const generateCode = async (data, type, format = "CODE128", errorCorrection = "M") => {
	if (!data.trim()) return null;

	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d");

	if (type === "qr") {
		// Generate QR code
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
		// Generate barcode
		try {
			// Create a temporary image element for JsBarcode
			const tempImg = document.createElement("img");

			// Generate barcode to the temporary image
			JsBarcode(tempImg, data, {
				format: format,
				width: 2,
				height: 100,
				displayValue: false,
				background: "#FFFFFF",
				lineColor: "#000000",
				margin: 10,
			});

			// Wait for the image to load, then draw it to canvas
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

	// Convert canvas to image
	const img = new Image();
	img.src = canvas.toDataURL();
	await new Promise((resolve) => {
		img.onload = resolve;
	});

	return img;
};

/**
 * Updates the visual state of rotation buttons and applies CSS rotation to card container.
 * This is purely for preview purposes and does not affect the actual printed output.
 */
const updateRotationButtons = () => {
	const canvas = $("#canvas");
	const card = canvas.closest(".card");

	// Remove all rotation classes from card
	card.classList.remove("rotate-90", "rotate-180", "rotate-270");

	// Apply appropriate rotation class
	// Normalize rotation for CSS classes (CSS doesn't handle negative rotations well)
	const normalizedRotation = ((previewRotation % 360) + 360) % 360;

	switch (normalizedRotation) {
		case 0:
			// No rotation class needed for 0 degrees
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

/**
 * Advanced image processing helper functions
 */

/**
 * Applies gamma correction to image data
 * @param {ImageData} imgData
 * @param {number} gamma - gamma value (default 2.2 for screen to linear conversion)
 * @returns {ImageData}
 */
const applyGammaCorrection = (imgData, gamma = 2.2) => {
	const { data } = imgData;
	const gammaLUT = new Uint8Array(256);

	// Build gamma lookup table
	for (let i = 0; i < 256; i++) {
		gammaLUT[i] = Math.round(255 * Math.pow(i / 255, gamma));
	}

	// Apply gamma correction
	for (let i = 0; i < data.length; i += 4) {
		data[i] = gammaLUT[data[i]]; // R
		data[i + 1] = gammaLUT[data[i + 1]]; // G
		data[i + 2] = gammaLUT[data[i + 2]]; // B
		// Alpha remains unchanged
	}

	return imgData;
};

/**
 * Applies Gaussian blur to image data
 * @param {ImageData} imgData
 * @param {number} sigma - blur radius
 * @returns {ImageData}
 */
const applyGaussianBlur = (imgData, sigma = 0.5) => {
	if (sigma <= 0) return imgData;

	const { width, height, data } = imgData;
	const output = new Uint8ClampedArray(data);

	// Calculate kernel size and weights
	const kernelSize = Math.ceil(sigma * 3) * 2 + 1;
	const kernel = new Float32Array(kernelSize);
	const center = Math.floor(kernelSize / 2);
	let sum = 0;

	// Generate Gaussian kernel
	for (let i = 0; i < kernelSize; i++) {
		const x = i - center;
		kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
		sum += kernel[i];
	}

	// Normalize kernel
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

	// Copy back for vertical pass
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
 * @param {ImageData} imgData
 * @param {number} radius - blur radius for mask
 * @param {number} amount - enhancement strength (0.5-2.0)
 * @returns {ImageData}
 */
const applyUnsharpMask = (imgData, radius = 1.0, amount = 0.8) => {
	const { width, height, data } = imgData;

	// Create a copy for the blurred version
	const blurred = new ImageData(new Uint8ClampedArray(data), width, height);
	applyGaussianBlur(blurred, radius);

	// Apply unsharp mask formula: original + amount * (original - blurred)
	for (let i = 0; i < data.length; i += 4) {
		for (let c = 0; c < 3; c++) {
			// RGB channels
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
 * @param {ImageData} imgData
 * @param {number} tileSize - size of tiles for local processing
 * @param {number} clipLimit - contrast limit (2.0-4.0)
 * @returns {ImageData}
 */
const applyCLAHE = (imgData, tileSize = 16, clipLimit = 2.0) => {
	const { width, height, data } = imgData;
	const tilesX = Math.ceil(width / tileSize);
	const tilesY = Math.ceil(height / tileSize);

	// Convert to grayscale for processing
	const gray = new Uint8Array(width * height);
	for (let i = 0; i < gray.length; i++) {
		const idx = i * 4;
		gray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
	}

	// Process each tile
	const processedGray = new Uint8Array(gray);

	for (let ty = 0; ty < tilesY; ty++) {
		for (let tx = 0; tx < tilesX; tx++) {
			const x1 = tx * tileSize;
			const y1 = ty * tileSize;
			const x2 = Math.min(x1 + tileSize, width);
			const y2 = Math.min(y1 + tileSize, height);

			// Build histogram for this tile
			const hist = new Array(256).fill(0);
			let pixelCount = 0;

			for (let y = y1; y < y2; y++) {
				for (let x = x1; x < x2; x++) {
					const val = gray[y * width + x];
					hist[val]++;
					pixelCount++;
				}
			}

			// Apply contrast limiting
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

			// Create CDF and mapping
			const cdf = new Array(256);
			cdf[0] = hist[0];
			for (let i = 1; i < 256; i++) {
				cdf[i] = cdf[i - 1] + hist[i];
			}

			// Normalize CDF to 0-255 range
			const mapping = new Uint8Array(256);
			for (let i = 0; i < 256; i++) {
				mapping[i] = Math.round((cdf[i] / pixelCount) * 255);
			}

			// Apply mapping to tile
			for (let y = y1; y < y2; y++) {
				for (let x = x1; x < x2; x++) {
					const idx = y * width + x;
					processedGray[idx] = mapping[gray[idx]];
				}
			}
		}
	}

	// Apply processed grayscale back to RGB
	for (let i = 0; i < processedGray.length; i++) {
		const idx = i * 4;
		const originalGray = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
		const ratio = originalGray > 0 ? processedGray[i] / originalGray : 1;

		data[idx] = Math.min(255, data[idx] * ratio); // R
		data[idx + 1] = Math.min(255, data[idx + 1] * ratio); // G
		data[idx + 2] = Math.min(255, data[idx + 2] * ratio); // B
	}

	return imgData;
};

/**
 * Generates a blue noise threshold map
 * @param {number} size - size of the threshold map (power of 2)
 * @returns {Uint8Array}
 */
const generateBlueNoiseMap = (size = 64) => {
	// Simple blue noise approximation using Mitchell's best-candidate algorithm
	const map = new Uint8Array(size * size);
	const used = new Array(size * size).fill(false);

	for (let i = 0; i < size * size; i++) {
		let bestDist = -1;
		let bestIdx = 0;

		// Try random candidates and pick the one with maximum distance to existing points
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

/**
 * Applies edge detection to identify important edges
 * @param {ImageData} imgData
 * @returns {Uint8Array} - edge map (0-255)
 */
const detectEdges = (imgData) => {
	const { width, height, data } = imgData;
	const edges = new Uint8Array(width * height);

	// Sobel kernels
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

/**
 * Scales image to exact printer resolution
 * @param {HTMLImageElement|HTMLCanvasElement} image
 * @param {number} targetWidth - target width in pixels
 * @param {number} targetHeight - target height in pixels
 * @param {string} method - scaling method ("nearest", "bilinear", "lanczos")
 * @returns {HTMLCanvasElement}
 */
const scaleToExactResolution = (image, targetWidth, targetHeight, method = "lanczos") => {
	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d");

	canvas.width = targetWidth;
	canvas.height = targetHeight;

	// Fill with white background
	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	if (method === "nearest") {
		ctx.imageSmoothingEnabled = false;
	} else {
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = method === "lanczos" ? "high" : "medium";
	}

	// Scale to fit within target dimensions while maintaining aspect ratio
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

/**
 * Applies dithering to image data and returns a 1-bit black/white ImageData.
 * @param {ImageData} imgData
 * @param {"floyd"|"atkinson"|"threshold"|"stucki"|"jarvis"|"sierra"|"burkes"|"blue_noise"} algorithm
 * @param {number} threshold 0-255
 * @param {number} brightness -100 to 100
 * @param {number} contrast -100 to 100
 * @param {number} noise 0-50 (amount of random noise to add)
 * @param {boolean} serpentine - use serpentine scanning for error diffusion
 * @param {Uint8Array} edgeMap - optional edge map for edge-aware thresholding
 * @returns {ImageData}
 */
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

	// Convert brightness and contrast from -100/100 range to usable values
	const brightnessAdjust = brightness * 2.55; // Convert to -255 to 255 range
	const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast)); // Standard contrast formula
	const noiseAmount = noise * 2.55; // Convert noise from 0-50 to 0-127.5 range

	for (let i = 0; i < gray.length; i++) {
		const r = data[i * 4];
		const g = data[i * 4 + 1];
		const b = data[i * 4 + 2];

		// Apply brightness and contrast adjustments to each channel
		let adjustedR = Math.max(0, Math.min(255, contrastFactor * (r - 128) + 128 + brightnessAdjust));
		let adjustedG = Math.max(0, Math.min(255, contrastFactor * (g - 128) + 128 + brightnessAdjust));
		let adjustedB = Math.max(0, Math.min(255, contrastFactor * (b - 128) + 128 + brightnessAdjust));

		// Luminance formula with adjusted values
		let luminance = 0.299 * adjustedR + 0.587 * adjustedG + 0.114 * adjustedB;

		// Add random noise if specified
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

	// ----- Threshold dithering with edge-aware enhancement -----
	if (algorithm === "threshold") {
		for (let i = 0; i < gray.length; i++) {
			let adjustedThreshold = threshold;

			// Apply edge-aware threshold adjustment if edge map is provided
			if (edgeMap) {
				const edgeStrength = edgeMap[i] / 255;
				// Lower threshold for edges to preserve thin lines
				adjustedThreshold = threshold - edgeStrength * 30;
			}

			setBWPixel(i, gray[i] < adjustedThreshold ? 0 : 255);
		}
		return imgData;
	}

	// ----- Blue noise dithering -----
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

	// ----- Ordered dithering (Bayer matrices) -----
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
			// Default to 4x4 if unknown ordered size specified
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

	// ----- Error diffusion algorithms -----
	// Define error diffusion kernels
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
		// Serpentine scanning: alternate left-to-right and right-to-left
		const direction = serpentine && y % 2 === 1 ? -1 : 1;
		const startX = direction === 1 ? 0 : width - 1;
		const endX = direction === 1 ? width : -1;

		for (let x = startX; x !== endX; x += direction) {
			const idx = y * width + x;
			const oldVal = gray[idx];

			let adjustedThreshold = threshold;
			if (edgeMap) {
				const edgeStrength = edgeMap[idx] / 255;
				// Lower threshold for edges to preserve detail
				adjustedThreshold = threshold - edgeStrength * 20;
			}

			const newVal = oldVal < adjustedThreshold ? 0 : 255;
			const err = oldVal - newVal;
			gray[idx] = newVal;
			setBWPixel(idx, newVal);

			// Distribute error to neighboring pixels
			for (const { x: dx, y: dy, weight } of kernel) {
				const nx = x + dx * direction; // Account for serpentine direction
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

/**
 * Rotates an image by the specified angle
 * @param {HTMLImageElement|HTMLCanvasElement} image
 * @param {number} angle - Rotation angle in degrees (0, 90, 180, 270, -90, -180, -270)
 * @returns {HTMLCanvasElement}
 */
const rotateImage = (image, angle) => {
	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d");

	// Normalize angle to handle negative values
	const normalizedAngle = ((angle % 360) + 360) % 360;

	// Calculate new dimensions based on rotation
	if (normalizedAngle === 90 || normalizedAngle === 270) {
		canvas.width = image.height;
		canvas.height = image.width;
	} else {
		canvas.width = image.width;
		canvas.height = image.height;
	}

	// Fill with white background
	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	// Apply rotation (use original angle to preserve direction)
	ctx.translate(canvas.width / 2, canvas.height / 2);
	ctx.rotate((angle * Math.PI) / 180);
	ctx.drawImage(image, -image.width / 2, -image.height / 2);

	return canvas;
};

/**
 * Applies hardware-safe cleanup to 1-bit image data
 * @param {ImageData} imgData - 1-bit black/white image data
 * @returns {ImageData}
 */
const applyHardwareCleanup = (imgData) => {
	const { width, height, data } = imgData;
	const output = new Uint8ClampedArray(data);

	for (let y = 1; y < height - 1; y++) {
		for (let x = 1; x < width - 1; x++) {
			const idx = (y * width + x) * 4;

			// Check if this is a single black pixel with no black neighbors
			if (data[idx] === 0) {
				// Black pixel
				let blackNeighbors = 0;

				// Check 8-connected neighbors
				for (let dy = -1; dy <= 1; dy++) {
					for (let dx = -1; dx <= 1; dx++) {
						if (dx === 0 && dy === 0) continue;
						const nIdx = ((y + dy) * width + (x + dx)) * 4;
						if (data[nIdx] === 0) blackNeighbors++;
					}
				}

				// Remove isolated single black pixels
				if (blackNeighbors === 0) {
					output[idx] = output[idx + 1] = output[idx + 2] = 255;
				}
			}

			// Thicken 1-pixel lines by checking for thin lines
			else if (data[idx] === 255) {
				// White pixel
				let thinLineDetected = false;

				// Check for horizontal thin lines
				const leftBlack = x > 0 && data[(y * width + (x - 1)) * 4] === 0;
				const rightBlack = x < width - 1 && data[(y * width + (x + 1)) * 4] === 0;
				const topWhite = y > 0 && data[((y - 1) * width + x) * 4] === 255;
				const bottomWhite = y < height - 1 && data[((y + 1) * width + x) * 4] === 255;

				// Check for vertical thin lines
				const topBlack = y > 0 && data[((y - 1) * width + x) * 4] === 0;
				const bottomBlack = y < height - 1 && data[((y + 1) * width + x) * 4] === 0;
				const leftWhite = x > 0 && data[(y * width + (x - 1)) * 4] === 255;
				const rightWhite = x < width - 1 && data[(y * width + (x + 1)) * 4] === 255;

				// Fill gaps in thin lines (optional enhancement)
				if (
					(leftBlack && rightBlack && topWhite && bottomWhite) ||
					(topBlack && bottomBlack && leftWhite && rightWhite)
				) {
					// This is a gap in a thin line - fill it
					output[idx] = output[idx + 1] = output[idx + 2] = 0;
				}
			}
		}
	}

	data.set(output);
	return imgData;
};

/**
 * Applies two-phase diffusion (ordered dither + error diffusion)
 * @param {ImageData} imgData
 * @param {number} threshold
 * @param {number} brightness
 * @param {number} contrast
 * @param {number} noise
 * @param {Uint8Array} edgeMap
 * @returns {ImageData}
 */
const applyTwoPhaseDiffusion = (imgData, threshold, brightness, contrast, noise, edgeMap) => {
	// Phase 1: Light ordered dithering (4x4 Bayer)
	const phase1 = ditherImageData(
		new ImageData(new Uint8ClampedArray(imgData.data), imgData.width, imgData.height),
		"ordered4",
		threshold,
		brightness,
		contrast,
		noise,
		false, // No serpentine for ordered
		null
	);

	// Phase 2: Light Floyd-Steinberg on the result
	return ditherImageData(
		phase1,
		"floyd",
		threshold + 10, // Slightly higher threshold for refinement
		0, // No additional brightness/contrast adjustment
		0,
		0,
		true, // Use serpentine
		edgeMap
	);
};

/**
 * Processes an image with rotation first, then brightness, contrast, and dithering adjustments
 * @param {HTMLImageElement} image
 * @param {number} brightness -100 to 100
 * @param {number} contrast -100 to 100
 * @param {"floyd"|"atkinson"|"threshold"|"stucki"|"jarvis"|"sierra"|"burkes"|"blue_noise"|"two_phase"} algorithm
 * @param {number} threshold 0-255
 * @param {number} rotation - Rotation angle in degrees (0, 90, 180, 270)
 * @param {number} noise 0-50 (amount of random noise to add)
 * @param {object} advancedOptions - Advanced processing options
 * @returns {HTMLCanvasElement}
 */
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

	// IMPORTANT: Apply rotation FIRST to the original image before any other processing
	let rotatedImage = image;
	if (rotation !== 0) {
		rotatedImage = rotateImage(image, rotation);
	}

	// Step 1: Scale to exact printer resolution if requested
	if (usePrinterResolution) {
		rotatedImage = scaleToExactResolution(rotatedImage, printerWidth, printerHeight, scalingMethod);
	}

	// Create a temporary canvas to process the image
	const tempCanvas = document.createElement("canvas");
	const tempCtx = tempCanvas.getContext("2d");

	tempCanvas.width = rotatedImage.width;
	tempCanvas.height = rotatedImage.height;

	// Fill with white background first to handle transparency
	tempCtx.fillStyle = "#ffffff";
	tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

	// Draw the image on top of white background
	tempCtx.drawImage(rotatedImage, 0, 0);

	// Get image data for processing
	let imgData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);

	// Step 2: Apply gamma correction if enabled
	if (useGammaCorrection) {
		imgData = applyGammaCorrection(imgData, gamma);
	}

	// Step 3: Apply CLAHE if enabled
	if (useCLAHE) {
		imgData = applyCLAHE(imgData, claheTileSize, claheClipLimit);
	}

	// Step 4: Apply pre-filtering if enabled
	if (usePreFiltering) {
		// Gaussian blur to reduce noise
		imgData = applyGaussianBlur(imgData, blurSigma);

		// Unsharp mask to restore edge definition
		imgData = applyUnsharpMask(imgData, unsharpRadius, unsharpAmount);
	}

	// Step 5: Generate edge map if edge-aware processing is enabled
	let edgeMap = null;
	if (useEdgeAware) {
		edgeMap = detectEdges(imgData);
	}

	// Step 6: Apply dithering
	let processedData;
	if (algorithm === "two_phase") {
		processedData = applyTwoPhaseDiffusion(
			imgData,
			threshold,
			brightness,
			contrast,
			noise,
			edgeMap
		);
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

	// Step 7: Apply hardware-safe cleanup if enabled
	if (useHardwareCleanup) {
		processedData = applyHardwareCleanup(processedData);
	}

	// Put the processed data back
	tempCtx.putImageData(processedData, 0, 0);

	return tempCanvas;
};

/**
 * Draws text vertically (one letter stacked on top of another, rotated -90 degrees)
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {object} options
 */
const drawVerticalText = (ctx, text, options) => {
	const { x, y, width, height, fontFamily, fontSize, fontWeight, align } = options;

	ctx.save();
	ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
	ctx.textBaseline = "middle";

	// Filter out whitespace characters for proper centering
	const visibleChars = text.split("").filter((char) => char.trim());

	// Calculate total text height needed for stacking
	const lineHeight = fontSize * 1.2; // Add some spacing between letters
	const totalTextHeight = visibleChars.length * lineHeight;

	// Calculate center point for rotation
	const centerX = x + width / 2;
	const centerY = y + height / 2;

	// Move to center and rotate -90 degrees
	ctx.translate(centerX, centerY);
	ctx.rotate(-Math.PI / 2);

	// In the rotated coordinate system:
	// - X axis now points up (was Y axis)
	// - Y axis now points left (was -X axis)
	// We want letters stacked vertically, so we need to vary the Y coordinate (which is now horizontal)

	// Calculate starting Y position (horizontal in rotated system) for centering
	let startY = -totalTextHeight / 2 + lineHeight / 2;
	let charX = 0;

	// Adjust X position based on alignment (vertical in rotated coordinate system)
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

	// Draw each visible character
	let charIndex = 0;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (char.trim()) {
			// Only draw non-whitespace characters
			ctx.textAlign = "center";
			// In rotated system: X stays same, Y changes for stacking
			ctx.fillText(char, charX, startY + charIndex * lineHeight);
			charIndex++;
		}
	}

	ctx.restore();
};

const updateLabelSize = (canvas) => {
	const inputWidth = $("#inputWidth").valueAsNumber;
	const inputHeight = $("#inputHeight").valueAsNumber;
	if (isNaN(inputWidth) || isNaN(inputHeight)) {
		handleError("label size invalid");
		return;
	}

	labelSize.width = inputWidth;
	labelSize.height = inputHeight;

	// Reset canvas display size so container can expand before measuring
	canvas.style.width = ""; // remove inline width
	canvas.style.height = ""; // remove inline height

	// Calculate canvas dimensions for consistent preview sizing
	// Image sent to printer is printed top to bottom, so reverse width and height
	const actualCanvasWidth = labelSize.height * 8;
	const actualCanvasHeight = labelSize.width * 8;

	// Set canvas internal dimensions (for printing accuracy)
	canvas.width = actualCanvasWidth;
	canvas.height = actualCanvasHeight;

	// Calculate display size to maintain consistent preview height
	const previewContainer = canvas.parentElement;
	// Use the container's current rendered size instead of hard-coding 300px
	const containerHeight = previewContainer.clientHeight || 300;
	const containerWidth = previewContainer.clientWidth || 300;

	// Determine an integer scale factor (nearest-neighbour) so that each canvas pixel maps to an integer number of screen pixels.
	const scaleX = Math.floor(containerWidth / actualCanvasWidth);
	const scaleY = Math.floor(containerHeight / actualCanvasHeight);
	let scale = Math.max(1, Math.min(scaleX, scaleY));

	// Fallback to fractional scaling (with pixelated rendering) if the canvas is larger than the container in both directions.
	if (scaleX === 0 && scaleY === 0) {
		scale = Math.min(containerWidth / actualCanvasWidth, containerHeight / actualCanvasHeight);
	}

	const displayWidth = actualCanvasWidth * scale;
	const displayHeight = actualCanvasHeight * scale;

	// Apply display size via CSS
	canvas.style.width = displayWidth + "px";
	canvas.style.height = displayHeight + "px";
	// Ensure nearest-neighbour scaling is used when the browser rasterises the canvas element
	canvas.style.imageRendering = "pixelated";

	// Refresh preview based on active tab
	const activePane = document.querySelector(".tab-pane.show.active");
	if (activePane && activePane.id === "nav-barcode") {
		// Barcode tab is active – refresh barcode preview
		updateCanvasBarcode(canvas);
	} else {
		// Default to text preview (covers both Text & Image tab and cases where no explicit tab links exist)
		updateCanvasText(canvas);
	}
};

const updateCanvasText = async (canvas) => {
	const text = $("#inputText").value;
	const fontSize = $("#inputFontSize").valueAsNumber;
	const fontFamily = $("#fontFamily")?.value || "Arial, sans-serif";
	const fontWeight = $("#fontWeight")?.value || "normal";
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

	// QR Code and Barcode settings
	const codeType = $("#codeType")?.value || "none";
	const codeData = $("#codeData")?.value || "";
	const codePosition = $("#codePosition")?.value || "above";
	const codeSize = $("#codeSize")?.valueAsNumber || 30;
	const qrErrorCorrection = $("#qrErrorCorrection")?.value || "M";
	const barcodeFormat = $("#barcodeFormat")?.value || "CODE128";

	// Generate QR code or barcode if needed
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
	// Disable smoothing so scaled content stays pixelated in the printed preview
	ctx.imageSmoothingEnabled = false;
	ctx.fillStyle = "#fff";
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	ctx.save();
	ctx.translate(canvas.width / 2, canvas.height / 2);
	ctx.rotate(Math.PI / 2);

	// Apply print offset
	ctx.translate(offsetX, offsetY);

	const rotatedWidth = canvas.height;
	const rotatedHeight = canvas.width;

	// Handle image and code positioning
	let textArea = {
		x: -rotatedWidth / 2,
		y: -rotatedHeight / 2,
		width: rotatedWidth,
		height: rotatedHeight,
	};

	// Calculate space needed for codes and images
	let totalImageHeight = 0;
	let totalImageWidth = 0;
	let codeImageHeight = 0;
	let codeImageWidth = 0;

	// Calculate code dimensions if present
	if (generatedCode) {
		const codeSizeRatio = codeSize / 100;
		const maxCodeW = rotatedWidth * codeSizeRatio;
		const maxCodeH = rotatedHeight * codeSizeRatio;
		const codeScale = Math.min(maxCodeW / generatedCode.width, maxCodeH / generatedCode.height);
		codeImageWidth = generatedCode.width * codeScale;
		codeImageHeight = generatedCode.height * codeScale;
	}

	if (uploadedImage && imagePosition !== "none") {
		// Process the image with brightness, contrast, dithering adjustments, and rotation
		// NOTE: Only use the image rotation setting (from dropdown), not the preview rotation.
		// Preview rotation is purely visual (CSS transform) and doesn't affect canvas content or printed output.
		// Collect advanced processing options
		const advancedOptions = {
			useGammaCorrection: $("#useGammaCorrection")?.checked || false,
			gamma: parseFloat($("#gamma")?.value || "2.2"),
			usePreFiltering: $("#usePreFiltering")?.checked || false,
			blurSigma: parseFloat($("#blurSigma")?.value || "0.5"),
			unsharpRadius: 1.0, // Fixed value for now
			unsharpAmount: parseFloat($("#unsharpAmount")?.value || "0.8"),
			useCLAHE: $("#useCLAHE")?.checked || false,
			claheClipLimit: parseFloat($("#claheClipLimit")?.value || "2.0"),
			claheTileSize: 16, // Fixed value for now
			useEdgeAware: $("#useEdgeAware")?.checked || false,
			useHardwareCleanup: $("#useHardwareCleanup")?.checked || false,
			usePrinterResolution: $("#usePrinterResolution")?.checked || false,
			printerWidth: canvas.width, // Use current canvas dimensions
			printerHeight: canvas.height,
			scalingMethod: "lanczos",
			serpentine: $("#serpentine")?.checked !== false, // Default to true
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
			// Draw image as background first
			const maxW = rotatedWidth;
			const maxH = rotatedHeight;
			const scale =
				Math.min(maxW / processedImage.width, maxH / processedImage.height) * imageSizeRatio;
			const drawW = processedImage.width * scale;
			const drawH = processedImage.height * scale;

			ctx.globalAlpha = 0.3; // Make background image semi-transparent
			ctx.drawImage(processedImage, -drawW / 2, -drawH / 2, drawW, drawH);
			ctx.globalAlpha = 1.0;
		} else {
			// Calculate image dimensions
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

			// Draw the processed image
			ctx.drawImage(processedImage, imageX, imageY, imageW, imageH);
		}
	}

	// Draw QR code or barcode
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

		// Draw the generated code
		ctx.drawImage(generatedCode, codeX, codeY, codeImageWidth, codeImageHeight);
	} else if (generatedCode && codePosition === "background") {
		// Draw code as background
		ctx.globalAlpha = 0.2; // Make background code semi-transparent
		ctx.drawImage(
			generatedCode,
			-codeImageWidth / 2,
			-codeImageHeight / 2,
			codeImageWidth,
			codeImageHeight
		);
		ctx.globalAlpha = 1.0;
	}

	// Draw text
	if (text.trim()) {
		ctx.fillStyle = "#000";
		const font = `${fontWeight} ${fontSize}px ${fontFamily}`;

		if (verticalText) {
			drawVerticalText(ctx, text, {
				x: textArea.x,
				y: textArea.y,
				width: textArea.width,
				height: textArea.height,
				fontFamily,
				fontSize,
				fontWeight,
				align: textAlign,
			});
		} else {
			drawText(ctx, text, {
				x: textArea.x,
				y: textArea.y,
				width: textArea.width,
				height: textArea.height,
				font: fontFamily,
				fontSize,
				fontWeight,
				align: textAlign,
				vAlign: "middle",
			});
		}
	}

	ctx.restore();
};

const updateCanvasBarcode = (canvas) => {
	const barcodeData = $("#inputBarcode").value;
	const image = document.createElement("img");
	image.addEventListener("load", () => {
		const ctx = canvas.getContext("2d");
		ctx.fillStyle = "#fff";
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		ctx.translate(canvas.width / 2, canvas.height / 2);
		ctx.rotate(Math.PI / 2);

		// Apply print offset
		ctx.translate(offsetX, offsetY);

		ctx.imageSmoothingEnabled = false;
		ctx.drawImage(image, -image.width / 2, -image.height / 2);

		ctx.rotate(-Math.PI / 2);
		ctx.translate(-canvas.width / 2, -canvas.height / 2);
	});

	JsBarcode(image, barcodeData, {
		format: "CODE128",
		width: 2,
		height: labelSize.height * 7,
		displayValue: false,
	});
};

const handleError = (err) => {
	console.error(err);

	const toast = bootstrap.Toast.getOrCreateInstance($("#errorToast"));
	$("#errorText").textContent = err.toString();
	toast.show();
};

// Insert the updateImagePreview helper before DOMContentLoaded
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

	const maxPreviewDim = 120; // px ─ keep previews compact

	// ---------------------------------------------
	// Original (un-rotated) preview
	// ---------------------------------------------
	const origScale = Math.min(
		1,
		maxPreviewDim / Math.max(uploadedImage.width, uploadedImage.height)
	);
	const origW = Math.round(uploadedImage.width * origScale);
	const origH = Math.round(uploadedImage.height * origScale);

	originalCanvas.width = origW;
	originalCanvas.height = origH;
	originalCanvas.style.width = origW + "px";
	originalCanvas.style.height = origH + "px";
	// Ensure the browser preserves hard edges when scaling
	originalCanvas.style.imageRendering = "pixelated";

	const origCtx = originalCanvas.getContext("2d");
	origCtx.imageSmoothingEnabled = false;
	origCtx.clearRect(0, 0, origW, origH);
	origCtx.drawImage(uploadedImage, 0, 0, origW, origH);

	// ---------------------------------------------
	// Processed (may be rotated) preview
	// ---------------------------------------------
	// Collect advanced processing options for preview
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
		usePrinterResolution: false, // Don't use printer resolution for preview
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

	const procScale = Math.min(
		1,
		maxPreviewDim / Math.max(processedTemp.width, processedTemp.height)
	);
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

	// ---------------------------------------------
	// Ensure the surrounding flex items shrink/expand correctly
	// ---------------------------------------------
	// We explicitly set the min-height of each flex-fill wrapper so that
	// vertical images get enough room, preventing cropping.
	[originalCanvas, processedCanvasEl].forEach((c) => {
		const wrapper = c.closest(".flex-fill");
		if (wrapper) {
			wrapper.style.minWidth = maxPreviewDim + "px";
			wrapper.style.minHeight = Math.max(origH, procH) + "px";
		}
	});
};

document.addEventListener("DOMContentLoaded", function () {
	const canvas = document.querySelector("#canvas");

	document.addEventListener("shown.bs.tab", (e) => {
		if (e.target.id === "nav-text-tab") updateCanvasText(canvas);
		else if (e.target.id === "nav-barcode-tab") updateCanvasBarcode(canvas);
	});

	$all("#inputWidth, #inputHeight").forEach((e) =>
		e.addEventListener("input", () => updateLabelSize(canvas))
	);
	updateLabelSize(canvas);

	// Handle window resize to maintain proper canvas display sizing
	window.addEventListener("resize", () => {
		// Debounce resize events
		clearTimeout(window.resizeTimeout);
		window.resizeTimeout = setTimeout(() => {
			updateLabelSize(canvas);
		}, 100);
	});

	// Text and image controls
	$all(
		"#inputText, #inputFontSize, #fontFamily, #fontWeight, #textAlign, #verticalText, #imagePosition, #imageSize, #imageRotation, #ditherAlgorithm, #threshold, #brightness, #contrast, #noise"
	).forEach((e) => e.addEventListener("input", () => updateCanvasText(canvas)));

	// Advanced processing controls
	$all(
		"#useGammaCorrection, #gamma, #usePreFiltering, #blurSigma, #unsharpAmount, #useCLAHE, #claheClipLimit, #useEdgeAware, #useHardwareCleanup, #usePrinterResolution, #serpentine"
	).forEach((e) => e.addEventListener("input", () => updateCanvasText(canvas)));

	$all(
		"#useGammaCorrection, #usePreFiltering, #useCLAHE, #useEdgeAware, #useHardwareCleanup, #usePrinterResolution, #serpentine"
	).forEach((e) => e.addEventListener("change", () => updateCanvasText(canvas)));

	// QR Code and Barcode controls
	$all(
		"#codeType, #codeData, #codePosition, #codeSize, #qrErrorCorrection, #barcodeFormat"
	).forEach((e) => e.addEventListener("input", () => updateCanvasText(canvas)));

	// Handle checkbox change event for vertical text
	$("#verticalText").addEventListener("change", () => updateCanvasText(canvas));

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
	const imageSizeSlider = $("#imageSize");
	const thresholdSlider = $("#threshold");
	const brightnessSlider = $("#brightness");
	const contrastSlider = $("#contrast");
	const noiseSlider = $("#noise");
	const codeSizeSlider = $("#codeSize");
	const gammaSlider = $("#gamma");
	const blurSigmaSlider = $("#blurSigma");
	const unsharpAmountSlider = $("#unsharpAmount");
	const claheClipLimitSlider = $("#claheClipLimit");

	if (imageSizeSlider) {
		imageSizeSlider.addEventListener("input", (e) => {
			$("#imageSizeValue").textContent = e.target.value;
		});
	}

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

	updateCanvasText(canvas);

	// Initialize preview rotation to default state
	updateRotationButtons();

	$("#inputBarcode").addEventListener("input", () => updateCanvasBarcode(canvas));

	// Preview rotation controls - these only affect the visual CSS rotation, not the canvas content
	$("#rotateClockwise").addEventListener("click", () => {
		previewRotation = (previewRotation + 90) % 360;
		updateRotationButtons();
	});

	$("#rotateCounterClockwise").addEventListener("click", () => {
		// Use negative rotation for true counter-clockwise movement
		previewRotation = previewRotation - 90;
		// Normalize to keep within reasonable bounds but preserve negative values
		if (previewRotation <= -360) {
			previewRotation += 360;
		}
		updateRotationButtons();
	});

	// Print offset controls
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

	// Initialize offset display
	updateOffsetDisplay();

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

	// Inside DOMContentLoaded block, after existing listeners, add preview update hooks
	$all("#ditherAlgorithm, #threshold, #brightness, #contrast, #noise, #imageRotation").forEach(
		(e) => e.addEventListener("input", updateImagePreview)
	);

	// Advanced processing controls for preview updates
	$all(
		"#useGammaCorrection, #gamma, #usePreFiltering, #blurSigma, #unsharpAmount, #useCLAHE, #claheClipLimit, #useEdgeAware, #useHardwareCleanup, #serpentine"
	).forEach((e) => e.addEventListener("input", updateImagePreview));

	$all(
		"#useGammaCorrection, #usePreFiltering, #useCLAHE, #useEdgeAware, #useHardwareCleanup, #serpentine"
	).forEach((e) => e.addEventListener("change", updateImagePreview));

	// Call once on load
	updateImagePreview();
});
