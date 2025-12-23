document.addEventListener('DOMContentLoaded', function() {
    const scanBtn = document.getElementById('scanBtn');
    const refreshBtn = document.getElementById('refreshBtn');
    const downloadBtn = document.getElementById('downloadSelected');
    const selectAllBtn = document.getElementById('selectAll');
    const clearAllBtn = document.getElementById('clearAll');
    const pdfList = document.getElementById('pdfList');
    const statusDiv = document.getElementById('status');
    const autoScanCheckbox = document.getElementById('autoScan');
    const notificationCheckbox = document.getElementById('showNotifications');

    // Load saved settings
    chrome.storage.local.get(['autoScan', 'showNotifications'], function(result) {
        autoScanCheckbox.checked = result.autoScan || false;
        notificationCheckbox.checked = result.showNotifications !== false;
    });

    // Save settings when changed
    autoScanCheckbox.addEventListener('change', function() {
        chrome.storage.local.set({ autoScan: this.checked });
    });
    
    notificationCheckbox.addEventListener('change', function() {
        chrome.storage.local.set({ showNotifications: this.checked });
    });

    // Scan for PDFs
    scanBtn.addEventListener('click', scanForPDFs);
    refreshBtn.addEventListener('click', scanForPDFs);

    // Select all / clear all
    selectAllBtn.addEventListener('click', function() {
        document.querySelectorAll('.pdf-checkbox').forEach(cb => cb.checked = true);
        updateDownloadButton();
    });

    clearAllBtn.addEventListener('click', function() {
        document.querySelectorAll('.pdf-checkbox').forEach(cb => cb.checked = false);
        updateDownloadButton();
    });

    // Download selected PDFs
    downloadBtn.addEventListener('click', downloadSelectedPDFs);

    // Initial scan if auto-scan is enabled
    chrome.storage.local.get(['autoScan'], function(result) {
        if (result.autoScan) {
            setTimeout(scanForPDFs, 100); // Small delay to ensure everything is ready
        }
    });

    async function scanForPDFs() {
        statusDiv.textContent = 'Scanning for PDFs...';
        statusDiv.className = 'status scanning';
        pdfList.innerHTML = '';

        try {
            // Get current tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (!tab) {
                throw new Error('No active tab found');
            }

            // Check if we can inject scripts (not on chrome:// pages)
            if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
                statusDiv.textContent = 'Cannot scan browser internal pages';
                statusDiv.className = 'status error';
                return;
            }

            // Ensure content script is injected
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['content.js']
                });
            } catch (e) {
                // Content script might already be injected, that's ok
                console.log('Content script injection note:', e.message);
            }

            // Wait a moment for script to be ready
            await new Promise(resolve => setTimeout(resolve, 100));

            // Send message to content script
            const response = await chrome.tabs.sendMessage(tab.id, { action: "scanPDFs" });

            if (response && response.pdfs && response.pdfs.length > 0) {
                displayPDFs(response.pdfs);
                statusDiv.textContent = `Found ${response.pdfs.length} PDF(s)`;
                statusDiv.className = 'status success';
            } else {
                statusDiv.textContent = 'No PDFs found on this page';
                statusDiv.className = 'status info';
            }
        } catch (error) {
            console.error('Scan error:', error);
            statusDiv.textContent = 'Error: ' + error.message;
            statusDiv.className = 'status error';
        }
    }

    function displayPDFs(pdfs) {
        pdfList.innerHTML = '';
        
        pdfs.forEach((pdf, index) => {
            const item = document.createElement('div');
            item.className = 'pdf-item';
            
            // Escape HTML in filenames and URLs
            const safeFilename = escapeHtml(pdf.filename);
            const safeUrl = escapeHtml(pdf.url);
            
            item.innerHTML = `
                <div class="pdf-info">
                    <input type="checkbox" class="pdf-checkbox" id="pdf-${index}" data-url="${safeUrl}" data-filename="${safeFilename}">
                    <label for="pdf-${index}">
                        <strong>${safeFilename}</strong>
                        <small>${safeUrl}</small>
                    </label>
                </div>
                <div class="pdf-size">${pdf.size || 'Unknown'}</div>
            `;
            
            pdfList.appendChild(item);
        });

        // Add event listeners to checkboxes
        document.querySelectorAll('.pdf-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', updateDownloadButton);
        });

        updateDownloadButton();
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function updateDownloadButton() {
        const checkboxes = document.querySelectorAll('.pdf-checkbox:checked');
        downloadBtn.disabled = checkboxes.length === 0;
        downloadBtn.textContent = `Download Selected (${checkboxes.length})`;
    }

    async function downloadSelectedPDFs() {
        const selectedPDFs = Array.from(document.querySelectorAll('.pdf-checkbox:checked'))
            .map(cb => ({
                url: cb.dataset.url,
                filename: cb.dataset.filename
            }));

        if (selectedPDFs.length === 0) return;

        try {
            // Send to background script for downloading
            const response = await chrome.runtime.sendMessage({
                action: "downloadPDFs",
                pdfs: selectedPDFs
            });

            if (response && response.success) {
                statusDiv.textContent = `Downloading ${selectedPDFs.length} PDF(s)...`;
                statusDiv.className = 'status success';
                
                // Clear selection after download starts
                document.querySelectorAll('.pdf-checkbox:checked').forEach(cb => cb.checked = false);
                updateDownloadButton();
            }
        } catch (error) {
            statusDiv.textContent = 'Download error: ' + error.message;
            statusDiv.className = 'status error';
        }
    }
});