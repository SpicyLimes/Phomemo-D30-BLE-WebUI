// Seems to work best with 128 bytes
const PACKET_SIZE_BYTES = 128;
/**
 * Return the header data needed to start the print session.
 * Adapted from {@link https://github.com/Knightro63/phomemo}
 *
 * @param {number} mmWidth the width (in mm) of the image. labels are printed vertically, so for e.g. a 40mm W x 12mm H label this would be 12.
 * @param {number} bytes the amount of bytes expected per row of the image e.g. (data.length / mmWidth)
 * @returns {Uint8Array}
 */
const HEADER_DATA = (mmWidth, bytes) =>
	new Uint8Array([
		0x1b,
		0x40,
		0x1d,
		0x76,
		0x30,
		0x00,
		mmWidth % 256,
		Math.floor(mmWidth / 256),
		bytes % 256,
		Math.floor(bytes / 256),
	]);
/** Constant data which ends the print session. */
const END_DATA = new Uint8Array([0x1b, 0x64, 0x00]);

/**
 * Determines a given pixel to be either black (0) or white (1).
 * Uses a threshold of 384 (128 * 3) to handle anti-aliasing from QR codes and images.
 * Adapted from {@link https://github.com/WebBluetoothCG/demos/tree/gh-pages/bluetooth-printer}
 *
 * @param {HTMLCanvasElement} canvas
 * @param {ImageData} imageData
 * @param {number} x
 * @param {number} y
 * @returns {number} 0 (black) or 1 (white)
 */
const getWhitePixel = (canvas, imageData, x, y) => {
	const threshold = parseInt(document.querySelector("#threshold")?.value) || 128;
	const ditherAlgorithm = document.querySelector("#ditherAlgorithm")?.value || "none";
	
	const idx = (y * canvas.width + x) * 4;
	const r = imageData.data[idx];
	const g = imageData.data[idx + 1];
	const b = imageData.data[idx + 2];
	const avg = (r + g + b) / 3;

	// Dithering requires a much more complex implementation to work correctly
	// on the canvas itself (modifying the canvas image data iteratively).
	// For simplicity and performance in this utility, we'll stick to a simple
	// threshold for the final 1-bit output, but adjust the threshold based on the input field.
	
	// A more effective approach is to use a library like Riemersma for full dithering, 
	// but for direct conversion, a simple adjusted threshold is used here.
	
	// If the average pixel value is below the threshold, it is considered black (0).
	// Otherwise, it is white (1).
	return avg < threshold ? 0 : 1; 
};

/**
 * Gets the raw 1-bit print data from the canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {Uint8Array}
 */
const getPrintData = (canvas) => {
	const ctx = canvas.getContext("2d");
	const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

	// Calculate data length (width in bytes * height)
	// Width must be divisible by 8 (1 byte per 8 dots)
	const dataLength = (canvas.width / 8) * canvas.height;
	const data = new Uint8Array(dataLength);

	let offset = 0;
	// Iterate over the image by row and then by 8-pixel chunks (bytes)
	for (let i = 0; i < canvas.height; ++i) {
		for (let k = 0; k < canvas.width / 8; ++k) {
			const k8 = k * 8;
			// Pixel to bit position mapping (128, 64, 32, 16, 8, 4, 2, 1)
			// Note: getWhitePixel returns 0 for black, 1 for white. The printer expects 
			// the data to be inverted (1 for black, 0 for white).
			// The original code uses a logic that results in 0 for black and 1 for white 
			// when the pixel is lighter than the threshold. The following calculation 
			// is based on the original code's requirement to pack 8 bits into a byte 
			// where each bit represents a dot.
			
			// We need to invert the resulting bit: (1 - getWhitePixel)
			data[offset++] =
				(1 - getWhitePixel(canvas, imageData, k8 + 0, i)) * 128 +
				(1 - getWhitePixel(canvas, imageData, k8 + 1, i)) * 64 +
				(1 - getWhitePixel(canvas, imageData, k8 + 2, i)) * 32 +
				(1 - getWhitePixel(canvas, imageData, k8 + 3, i)) * 16 +
				(1 - getWhitePixel(canvas, imageData, k8 + 4, i)) * 8 +
				(1 - getWhitePixel(canvas, imageData, k8 + 5, i)) * 4 +
				(1 - getWhitePixel(canvas, imageData, k8 + 6, i)) * 2 +
				(1 - getWhitePixel(canvas, imageData, k8 + 7, i));
		}
	}

	return data;
};

/**
 * Given a Bluetooth characteristic and a canvas, sends the necessary data to print it.
 * @param {BluetoothRemoteGATTCharacteristic} characteristic
 * @param {HTMLCanvasElement} canvas
 * @param {Object} options - Options object from index.js (offsetX, offsetY, rotation)
 */
export const printCanvas = async (characteristic, canvas, options) => {
	// NOTE: Rotation and Offsets are handled by the pre-rendering steps in index.js,
	// but the signature is updated here to match index.js usage.
	
	const data = getPrintData(canvas);

	// Send the header data
	await characteristic.writeValueWithResponse(
		HEADER_DATA(canvas.width / 8, data.length / (canvas.width / 8))
	);

	// Send the image data packets
	for (let i = 0; ; i += PACKET_SIZE_BYTES) {
		const chunk = data.slice(i, i + PACKET_SIZE_BYTES);
		if (chunk.length === 0) break;
		
		await characteristic.writeValueWithoutResponse(chunk);
		
		// Wait 10ms between packets to prevent buffer overflow
		await new Promise(resolve => setTimeout(resolve, 10)); 
	}
	
	// Send the end data to finish the print job
	await characteristic.writeValueWithResponse(END_DATA);
};
