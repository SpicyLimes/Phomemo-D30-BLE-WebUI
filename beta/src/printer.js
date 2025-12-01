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
 * @param {HTMLCanvasElement} canvas
 * @param {ImageData} imageData
 * @param {number} x
 * @param {number} y
 * @returns {number} 1 if white, 0 if black.
 */
const getWhitePixel = (canvas, imageData, x, y) => {
	const index = (y * canvas.width + x) * 4;
	const r = imageData.data[index];
	const g = imageData.data[index + 1];
	const b = imageData.data[index + 2];
	// Convert to black or white based on threshold (384/2 = 192 per channel average)
	return r + g + b > 384 ? 1 : 0;
};

/**
 * Converts a canvas element to the binary data format expected by the printer.
 * @param {HTMLCanvasElement} canvas
 * @returns {Uint8Array}
 */
const getPrintData = (canvas) => {
	const ctx = canvas.getContext("2d");
	const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
	
	// Create the Uint8Array for the printer data.
	// Width is in bits, converted to bytes (canvas.width / 8) * canvas.height
	const data = new Uint8Array((canvas.width / 8) * canvas.height);
	let offset = 0;

	// Loop over rows (height) and columns (width in bytes)
	for (let i = 0; i < canvas.height; ++i) {
		for (let k = 0; k < canvas.width / 8; ++k) {
			const k8 = k * 8;
			// Pixel to bit position mapping (MSB first)
			data[offset++] =
				getWhitePixel(canvas, imageData, k8 + 0, i) * 128 +
				getWhitePixel(canvas, imageData, k8 + 1, i) * 64 +
				getWhitePixel(canvas, imageData, k8 + 2, i) * 32 +
				getWhitePixel(canvas, imageData, k8 + 3, i) * 16 +
				getWhitePixel(canvas, imageData, k8 + 4, i) * 8 +
				getWhitePixel(canvas, imageData, k8 + 5, i) * 4 +
				getWhitePixel(canvas, imageData, k8 + 6, i) * 2 +
				getWhitePixel(canvas, imageData, k8 + 7, i);
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

		if (chunk.length === 0) {
			break; // Done
		}

		await characteristic.writeValueWithResponse(chunk);

		// Small delay (optional, but sometimes helps stability)
		await new Promise(r => setTimeout(r, 10));
	}
	
	// Send the end command
	await characteristic.writeValueWithResponse(END_DATA);
};
