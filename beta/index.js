"use strict";

import { drawText } from "https://cdn.jsdelivr.net/npm/canvas-txt@4.1.1/+esm";
import { printCanvas } from "./src/printer.js";

const $ = document.querySelector.bind(document);
const $all = document.querySelectorAll.bind(document);

const canvasScale = 16; // Scale factor for canvas rendering (e.g., 40mm * 16 = 640px)
let labelSize = { width: 40, height: 12 }; // Label size in mm

let uploadedImage = null;
let processedImage = null;
let currentContentType = "text";
let previewRotation = -90; // Default rotation for the preview area
let offsetX = 0; // X offset for print positioning in dots
let offsetY = 0; // Y offset for print positioning in dots

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
    "Alex Brush": '"Alex Brush", "Brush Script MT", "Times New Roman", Times, serif',
};

/**
 * Handles Bluetooth, promise, or general errors by showing a toast notification.
 * @param {Error|string} error The error object or message.
 */
const handleError = (error) => {
    const errorText = typeof error === "string" ? error : error.message;
    console.error("An error occurred:", error);
    $("#errorText").textContent = errorText;
    const toast = new bootstrap.Toast($("#errorToast"));
    toast.show();
};

// --- Helper Functions for Drawing and UI Updates ---

/**
 * Updates the physical size of the canvas based on user input (mm) and scale factor.
 * @param {HTMLCanvasElement} canvas
 */
const updateLabelSize = (canvas) => {
    const inputWidth = $("#inputWidth").valueAsNumber;
    const inputHeight = $("#inputHeight").valueAsNumber;
    
    if (isNaN(inputWidth) || isNaN(inputHeight) || inputWidth <= 0 || inputHeight <= 0) {
        handleError("Label size invalid. Please enter positive numbers.");
        return;
    }

    labelSize.width = inputWidth;
    labelSize.height = inputHeight;

    // The printer prints perpendicular to the label feed.
    // The width of the image sent to the printer is the label's *height* in mm (for 200 DPI).
    // The height of the image sent to the printer is the label's *width* in mm.
    // The printer requires the image width (in dots) to be divisible by 8.
    // 1mm is approximately 8 dots (200 DPI).
    canvas.width = labelSize.height * canvasScale; // The width of the data image
    canvas.height = labelSize.width * canvasScale; // The height of the data image
    
    // Rerender content after size change
    updateCanvasContent(canvas);
};

/**
 * Resets the canvas context's transform before redrawing content.
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} canvas
 */
const resetContextTransform = (ctx, canvas) => {
    // Reset any previous transformations
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Fill background with specified color
    const bgColor = $("#backgroundColor") ? $("#backgroundColor").value : "#FFFFFF";
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
};

/**
 * Applies the core rotation (90 degrees CCW) required to print the content correctly.
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} canvas
 */
const applyPrintRotation = (ctx, canvas) => {
    // Translate to the center of the canvas
    ctx.translate(canvas.width / 2, canvas.height / 2);
    // Rotate 90 degrees CCW (for print orientation)
    ctx.rotate(-Math.PI / 2);
    // Translate back, adjusting for the swap of width/height after rotation
    ctx.translate(-canvas.height / 2, -canvas.width / 2);
    
    // Apply user-defined offsets in dots (scaled by canvasScale/8)
    const dotScale = canvasScale / 8;
    ctx.translate(offsetX * dotScale, offsetY * dotScale);
};

/**
 * Draws the current text content onto the canvas.
 * @param {HTMLCanvasElement} canvas
 */
const updateCanvasText = (canvas) => {
    currentContentType = "text";
    const ctx = canvas.getContext("2d");
    resetContextTransform(ctx, canvas);
    
    applyPrintRotation(ctx, canvas);

    const text = $("#inputText").value;
    const fontSize = $("#inputFontSize").valueAsNumber;
    const fontFamily = FONT_MAP[$("#fontFamily").value] || FONT_MAP.Inter;
    const margin = $("#advMargin").valueAsNumber;
    const align = $("#advAlign").value;
    const lineHeight = $("#advLineHeight").valueAsNumber;
    const letterSpacing = $("#advLetterSpacing").valueAsNumber;
    const bold = $("#advBold").checked ? "bold" : "normal";
    const italic = $("#advItalic").checked ? "italic" : "normal";
    const underline = $("#advUnderline").checked;
    const allCaps = $("#advUpper").checked;
    const textColor = $("#textColor").value;
    const useBorder = $("#useBorder").checked;
    
    // Adjust text if ALL CAPS is enabled
    const displayText = allCaps ? text.toUpperCase() : text;
    
    // Text drawing using canvas-txt library
    drawText(ctx, displayText, {
        x: margin,
        y: margin,
        width: canvas.height - 2 * margin, // Swapped due to rotation
        height: canvas.width - 2 * margin, // Swapped due to rotation
        fontSize: fontSize * canvasScale / 8, // Scale font size based on dot scale (8 dots/mm)
        fontFamily: fontFamily,
        align: align,
        vAlign: 'center', // Always center vertically
        lineHeight: lineHeight,
        letterSpacing: letterSpacing,
        fontWeight: bold,
        fontStyle: italic,
        textDecoration: underline ? "underline" : "none",
        fill: textColor,
    });

    // Draw border if requested
    if (useBorder) {
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 1 * canvasScale / 8; // 1 dot wide
        ctx.strokeRect(0, 0, canvas.height, canvas.width); // Stroke the rotated rect
    }
};

/**
 * Processes and draws the uploaded image onto the canvas.
 * @param {HTMLCanvasElement} canvas
 */
const updateCanvasImage = (canvas) => {
    currentContentType = "image";
    const ctx = canvas.getContext("2d");
    resetContextTransform(ctx, canvas);
    
    if (!uploadedImage) {
        // If no image is uploaded, just draw the background
        ctx.font = '16pt "Inter"';
        ctx.fillStyle = "#6c757d";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Upload an image to preview.", canvas.width / 2, canvas.height / 2);
        processedImage = null;
        return;
    }

    // --- Image Pre-processing and Rotation ---
    
    // 1. Create a temporary canvas for pre-processing
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = uploadedImage.width;
    tempCanvas.height = uploadedImage.height;

    // Apply brightness, contrast, and base drawing
    tempCtx.filter = `brightness(${$("#brightness").valueAsNumber}%) contrast(${$("#contrast").valueAsNumber}%)`;
    tempCtx.drawImage(uploadedImage, 0, 0);

    // 2. Apply Rotations (Image-specific rotation only)
    const imageRotation = parseInt($("#imageRotation").value);
    
    const rotatedCanvas = document.createElement('canvas');
    const rotatedCtx = rotatedCanvas.getContext('2d');
    
    let w = tempCanvas.width;
    let h = tempCanvas.height;

    if (imageRotation === 90 || imageRotation === 270) {
        rotatedCanvas.width = h;
        rotatedCanvas.height = w;
        rotatedCtx.translate(h / 2, w / 2);
        rotatedCtx.rotate(imageRotation * Math.PI / 180);
        rotatedCtx.drawImage(tempCanvas, -w / 2, -h / 2);
    } else if (imageRotation === 180) {
        rotatedCanvas.width = w;
        rotatedCanvas.height = h;
        rotatedCtx.translate(w / 2, h / 2);
        rotatedCtx.rotate(imageRotation * Math.PI / 180);
        rotatedCtx.drawImage(tempCanvas, -w / 2, -h / 2);
    } else {
        rotatedCanvas.width = w;
        rotatedCanvas.height = h;
        rotatedCtx.drawImage(tempCanvas, 0, 0);
    }
    
    const imageToDither = rotatedCanvas;

    // 3. Apply Print Rotation and Offsets to Final Canvas
    applyPrintRotation(ctx, canvas);

    // 4. Draw the (Rotated) Image, scaled to fit the label area (canvas.height x canvas.width due to print rotation)
    const maxWidth = canvas.height; // Max width of image content on rotated canvas
    const maxHeight = canvas.width; // Max height of image content on rotated canvas
    
    let scale = Math.min(maxWidth / imageToDither.width, maxHeight / imageToDither.height);
    if (scale > 1) scale = 1; // Don't upscale
    
    const imgW = imageToDither.width * scale;
    const imgH = imageToDither.height * scale;
    const imgX = (maxWidth - imgW) / 2;
    const imgY = (maxHeight - imgH) / 2;

    ctx.drawImage(imageToDither, imgX, imgY, imgW, imgH);
    
    // Draw border if requested
    if ($("#useBorder").checked) {
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 1 * canvasScale / 8; // 1 dot wide
        ctx.strokeRect(0, 0, maxHeight, maxWidth); // Note: maxHeight and maxWidth are effectively canvas.height and canvas.width here
    }

    // Since dithering is computationally intensive, we don't apply it to the *preview*.
    // The print function's getPrintData handles the final 1-bit conversion (including dithering).
    processedImage = ctx.getImageData(0, 0, canvas.width, canvas.height);
};

/**
 * Main function to select and draw the content based on the active tab.
 * @param {HTMLCanvasElement} canvas
 */
const updateCanvasContent = (canvas) => {
    // Determine the active tab ID
    const activeTab = $(".tab-pane.active");
    const activeTabId = activeTab ? activeTab.id : "nav-text";

    if (activeTabId === "nav-text") {
        updateCanvasText(canvas);
        currentContentType = "Text";
    } else if (activeTabId === "nav-image") {
        updateCanvasImage(canvas);
        currentContentType = "Image";
    }

    // Update the content type display
    $("#currentContentType").textContent = currentContentType;

    // Re-apply preview rotation (CSS class)
    updatePreviewRotation(canvas);
};

/**
 * Updates the CSS class for the preview card rotation.
 * @param {HTMLCanvasElement} canvas
 */
const updatePreviewRotation = (canvas) => {
    const card = $("#previewCard");
    card.className = "card shadow-sm"; // Reset classes
    
    // The canvas content is always drawn rotated 90 CCW for printing.
    // The preview rotation applies an *additional* CSS transform to orient the user's view.
    let finalRotation = (previewRotation + 90) % 360; // Start at -90 (90 CCW) for print, then add user rotation

    if (finalRotation === 90 || finalRotation === -270) {
        card.classList.add("rotate-90");
    } else if (finalRotation === 180 || finalRotation === -180) {
        card.classList.add("rotate-180");
    } else if (finalRotation === 270 || finalRotation === -90) {
        card.classList.add("rotate-270");
    }
};

/**
 * Updates the visual state of the rotation buttons.
 */
const updateRotationButtons = () => {
    $all("#previewRotation button").forEach(btn => {
        btn.classList.remove("btn-primary", "btn-outline-light");
        btn.classList.add("btn-outline-light");
        
        let targetRotation;
        if (btn.dataset.rotation === "cw90") targetRotation = 90;
        else if (btn.dataset.rotation === "ccw90") targetRotation = -90;
        else if (btn.dataset.rotation === "flip") targetRotation = 180;
        else targetRotation = 0;
        
        if (previewRotation === targetRotation) {
            btn.classList.remove("btn-outline-light");
            btn.classList.add("btn-primary");
        }
    });
};

/**
 * Updates the displayed X and Y offsets.
 */
const updateOffsetDisplay = () => {
	$("#offsetXValue").textContent = offsetX;
	$("#offsetYValue").textContent = offsetY;
};

// --- Initialization and Event Wiring ---

document.addEventListener("DOMContentLoaded", function () {
    const canvas = document.querySelector("#canvas");
    
    // 1. Wire Tab Change to Update Content
    document.addEventListener("shown.bs.tab", (e) => {
        updateCanvasContent(canvas);
    });

    // 2. Wire Label Size Updates
    $all("#inputWidth, #inputHeight").forEach((e) =>
        e.addEventListener("input", () => updateLabelSize(canvas))
    );
    updateLabelSize(canvas); // Initial size setup

    // 3. Wire Text Content Updates
    $all("#inputText, #inputFontSize, #fontFamily, #advAlign, #advLineHeight, #advMargin, #advBold, #advItalic, #advUpper, #advUnderline, #advLetterSpacing, #textColor, #backgroundColor").forEach((e) =>
        e.addEventListener("input", () => updateCanvasContent(canvas))
    );
    
    // 4. Wire Image Upload
    $("#inputImage").addEventListener("change", (e) => {
        if (e.target.files.length > 0) {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = (e) => {
                uploadedImage = new Image();
                uploadedImage.onload = () => updateCanvasContent(canvas);
                uploadedImage.onerror = () => handleError("Failed to load image.");
                uploadedImage.src = e.target.result;
            };
            reader.readAsDataURL(file);
        } else {
            uploadedImage = null;
            updateCanvasContent(canvas);
        }
    });

    // 5. Wire Image Processing Controls
    $all("#ditherAlgorithm, #threshold, #brightness, #contrast, #noise, #imageRotation").forEach((e) =>
        e.addEventListener("input", () => updateCanvasContent(canvas))
    );
    
    // Wire advanced image filters (Gamma/Pre-Filter) to enable/disable controls
    $("#useGammaCorrection").addEventListener("change", (e) => {
        $("#gamma").disabled = !e.target.checked;
        updateCanvasContent(canvas);
    });
    $("#gamma").addEventListener("input", () => updateCanvasContent(canvas));
    
    $("#usePreFiltering").addEventListener("change", (e) => {
        $("#preFilterType").disabled = !e.target.checked;
        updateCanvasContent(canvas);
    });
    $("#preFilterType").addEventListener("input", () => updateCanvasContent(canvas));
    
    // 6. Wire Border Toggle
    if ($("#useBorder")) {
        $("#useBorder").addEventListener("change", () => updateCanvasContent(canvas));
    } else {
        console.warn("Element #useBorder not found. Border feature not wired.");
    }

    // 7. Wire Offset Controls
    $("#offsetUp").addEventListener("click", () => {
        const step = parseInt($("#offsetStep").value);
        offsetY -= step;
        updateOffsetDisplay();
        updateCanvasContent(canvas);
    });

    $("#offsetDown").addEventListener("click", () => {
        const step = parseInt($("#offsetStep").value);
        offsetY += step;
        updateOffsetDisplay();
        updateCanvasContent(canvas);
    });

    $("#offsetLeft").addEventListener("click", () => {
        const step = parseInt($("#offsetStep").value);
        offsetX -= step;
        updateOffsetDisplay();
        updateCanvasContent(canvas);
    });

    $("#offsetRight").addEventListener("click", () => {
        const step = parseInt($("#offsetStep").value);
        offsetX += step;
        updateOffsetDisplay();
        updateCanvasContent(canvas);
    });

    $("#offsetReset").addEventListener("click", () => {
        offsetX = 0;
        offsetY = 0;
        updateOffsetDisplay();
        updateCanvasContent(canvas);
    });
    
    // 8. Wire Preview Rotation Controls
    $all("#previewRotation button").forEach(btn => {
        btn.addEventListener("click", () => {
            const rotation = btn.dataset.rotation;
            if (rotation === "cw90") previewRotation = 90;
            else if (rotation === "ccw90") previewRotation = -90;
            else if (rotation === "flip") previewRotation = 180;
            else previewRotation = 0;

            updateRotationButtons();
            updatePreviewRotation(canvas);
        });
    });

    // 9. Wire Bluetooth Printing
    $("form").addEventListener("submit", (e) => {
        e.preventDefault();
        
        // Ensure content is drawn before printing
        updateCanvasContent(canvas);
        
        navigator.bluetooth
            .requestDevice({
                acceptAllDevices: true,
                optionalServices: ["0000ff00-0000-1000-8000-00805f9b34fb"],
            })
            .then((device) => device.gatt.connect())
            .then((server) => server.getPrimaryService("0000ff00-0000-1000-8000-00805f9b34fb"))
            .then((service) => service.getCharacteristic("0000ff02-0000-1000-8000-00805f9b34fb"))
            .then((char) => {
                // Pass a dummy options object (offsets/rotation are pre-applied to canvas)
                return printCanvas(char, canvas, { offsetX, offsetY, rotation: previewRotation });
            })
            .catch(handleError);
    });

    // Initial drawing and UI setup
    updateOffsetDisplay();
    updateRotationButtons();
    updateCanvasContent(canvas);
});

// For better organization, the original project split files. 
// I have removed the now-unused index.core.js, index_v1.js, and index_v2.js, 
// consolidating necessary logic into this index.js.
