const MAX_PDF_BYTES = 50 * 1024 * 1024;

let pdfModule;
export function loadPdfModule() {
    pdfModule ??= import('./pdf-support.js');
    return pdfModule;
}

function setStatus(el, text, isError = false) {
    el.hidden = !text;
    el.textContent = text;
    el.style.color = isError ? 'red' : '';
}

/**
 * Wire a PDF file input to a textarea: extracts the PDF's canonical text into the textarea
 * (read-only while loaded) and fires its `input` event so existing CID handlers run.
 */
export function attachPdfUpload({ fileInput, textarea, clearButton, status, onLoad, onClear }) {
    let current = null;
    let loadId = 0;

    function clear() {
        loadId++;
        current = null;
        fileInput.value = '';
        textarea.value = '';
        textarea.readOnly = false;
        textarea.dispatchEvent(new Event('input'));
        clearButton.hidden = true;
        setStatus(status, '');
        onClear?.();
    }

    fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0];
        if (!file) return;
        if (file.size > MAX_PDF_BYTES) {
            clear();
            setStatus(status, `PDF is too large (max ${MAX_PDF_BYTES / 1024 / 1024} MB).`, true);
            return;
        }

        const id = ++loadId;
        textarea.readOnly = true;
        setStatus(status, 'Loading PDF reader…');
        try {
            const pdf = await loadPdfModule();
            const bytes = new Uint8Array(await file.arrayBuffer());
            if (id !== loadId) return;
            setStatus(status, 'Extracting text…');
            const text = await pdf.extractPdfText(bytes);
            if (id !== loadId) return;
            if (!text) throw new Error('No text found in this PDF. Scanned/image-only PDFs are not supported.');

            current = { bytes, name: file.name };
            textarea.value = text;
            textarea.dispatchEvent(new Event('input'));
            clearButton.hidden = false;
            setStatus(status, `Loaded ${file.name}. The text shown is exactly what is hashed.`);
            await onLoad?.(current, pdf);
        } catch (err) {
            if (id !== loadId) return;
            console.error(err);
            clear();
            setStatus(status, 'Error: ' + err.message, true);
        }
    });

    clearButton.addEventListener('click', clear);

    return {
        get current() {
            return current;
        },
        setStatus: (text, isError) => setStatus(status, text, isError),
    };
}
