// Handle download requests
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === "downloadPDFs") {
        downloadPDFs(request.pdfs);
        sendResponse({ success: true });
    }
    return true;
});

async function downloadPDFs(pdfs) {
    const results = [];
    
    for (const pdf of pdfs) {
        try {
            const result = await downloadSinglePDF(pdf);
            results.push({ pdf, success: true, result });
        } catch (error) {
            console.error('Download failed for:', pdf.filename, error);
            results.push({ pdf, success: false, error: error.message });
            
            // Show error notification
            chrome.storage.local.get(['showNotifications'], function(settings) {
                if (settings.showNotifications !== false) {
                    chrome.notifications.create({
                        type: 'basic',
                        iconUrl: 'icons/icon128.png',
                        title: 'Download Failed',
                        message: `Failed to download: ${pdf.filename}`
                    });
                }
            });
        }
    }
    
    // Show success notification
    const successfulDownloads = results.filter(r => r.success).length;
    if (successfulDownloads > 0) {
        chrome.storage.local.get(['showNotifications'], function(settings) {
            if (settings.showNotifications !== false) {
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icons/icon128.png',
                    title: 'Download Complete',
                    message: `Successfully downloaded ${successfulDownloads} PDF(s)`
                });
            }
        });
    }
    
    return results;
}

async function downloadSinglePDF(pdf) {
    const downloadUrl = pdf.url;
    
    // Check if it's a file:// URL
    if (downloadUrl.startsWith('file://')) {
        return await handleLocalFileDownload(pdf);
    }
    
    // For HTTP/HTTPS URLs, use the standard download API
    return new Promise((resolve, reject) => {
        chrome.downloads.download({
            url: downloadUrl,
            filename: sanitizeFilename(pdf.filename),
            saveAs: false,
            conflictAction: 'uniquify'
        }, function(downloadId) {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
            } else {
                resolve({ downloadId, filename: pdf.filename });
            }
        });
    });
}

async function handleLocalFileDownload(pdf) {
    try {
        // Method 1: Try to fetch the file and create a blob URL
        const response = await fetch(pdf.url);
        
        if (!response.ok) {
            throw new Error(`Fetch failed: ${response.status}`);
        }
        
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        
        return new Promise((resolve, reject) => {
            chrome.downloads.download({
                url: blobUrl,
                filename: sanitizeFilename(pdf.filename),
                saveAs: false,
                conflictAction: 'uniquify'
            }, function(downloadId) {
                // Clean up blob URL after a delay
                setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
                
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve({ downloadId, filename: pdf.filename, method: 'blob' });
                }
            });
        });
    } catch (fetchError) {
        // Method 2: Fallback - use content script to trigger download
        console.log('Fetch failed, trying content script method...', fetchError);
        return await useContentScriptDownload(pdf);
    }
}

async function useContentScriptDownload(pdf) {
    // Get the active tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tabs[0]) {
        throw new Error('No active tab found');
    }
    
    // Send message to content script
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabs[0].id, {
            action: "downloadLocalFile",
            url: pdf.url,
            filename: pdf.filename
        }, function(response) {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else if (!response || !response.success) {
                reject(new Error('Content script download failed'));
            } else {
                resolve({ filename: pdf.filename, method: 'content-script' });
            }
        });
    });
}

function sanitizeFilename(filename) {
    // Remove illegal characters for filenames
    return filename
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/^\.+/, '')
        .trim();
}

// Listen for completed downloads
chrome.downloads.onChanged.addListener(function(delta) {
    if (delta.state && delta.state.current === 'complete') {
        console.log('Download completed:', delta.id);
    }
    if (delta.error) {
        console.error('Download error:', delta.error);
    }
});

// Create context menu for PDFs
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: 'download-pdf',
        title: 'Download PDF with PDF Downloader',
        contexts: ['link'],
        targetUrlPatterns: ['*://*/*.pdf', '*://*/*.pdf?*', 'file:///*.pdf']
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'download-pdf' && info.linkUrl) {
        const filename = extractFilenameFromURL(info.linkUrl) || 'document.pdf';
        downloadPDFs([{ url: info.linkUrl, filename }]);
    }
});

function extractFilenameFromURL(url) {
    try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        let filename = pathname.split('/').pop();
        filename = filename.split('?')[0].split('#')[0];
        return decodeURIComponent(filename);
    } catch (e) {
        const match = url.match(/\/([^\/?#]+\.pdf)/i);
        return match ? decodeURIComponent(match[1]) : null;
    }
}