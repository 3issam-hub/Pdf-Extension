// Prevent multiple injections
if (!window.pdfScannerInjected) {
    window.pdfScannerInjected = true;

    // Listen for scan request from popup
    chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
        if (request.action === "scanPDFs") {
            try {
                const pdfs = findPDFs();
                sendResponse({ pdfs: pdfs });
            } catch (error) {
                console.error('Error scanning PDFs:', error);
                sendResponse({ pdfs: [], error: error.message });
            }
        } else if (request.action === "downloadLocalFile") {
            try {
                const success = downloadLocalFile(request.url, request.filename);
                sendResponse({ success: success });
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }
        }
        return true; // Keep message channel open for async response
    });

    function findPDFs() {
        const pdfs = [];
        const seenURLs = new Set();
        
        // Method 1: Find all links to PDF files
        const links = document.querySelectorAll('a[href$=".pdf"], a[href*=".pdf?"], a[href*=".pdf#"]');
        
        links.forEach(link => {
            try {
                const url = link.href;
                if (!url || seenURLs.has(url)) return;
                
                const filename = extractFilenameFromURL(url) || link.textContent.trim() || 'document.pdf';
                
                pdfs.push({
                    url: url,
                    filename: sanitizeFilename(filename),
                    linkText: link.textContent.trim(),
                    size: null
                });
                
                seenURLs.add(url);
            } catch (e) {
                console.log('Skipping invalid link:', e.message);
            }
        });
        
        // Method 2: Find iframe and embed elements with PDFs
        const embeds = document.querySelectorAll('iframe[src*=".pdf"], embed[src*=".pdf"], object[data*=".pdf"]');
        
        embeds.forEach(embed => {
            try {
                const url = embed.src || embed.data;
                if (!url || !url.includes('.pdf') || seenURLs.has(url)) return;
                
                const filename = extractFilenameFromURL(url) || 'embedded.pdf';
                
                pdfs.push({
                    url: url,
                    filename: sanitizeFilename(filename),
                    linkText: 'Embedded PDF',
                    size: null
                });
                
                seenURLs.add(url);
            } catch (e) {
                console.log('Skipping invalid embed:', e.message);
            }
        });
        
        // Method 3: For file:// directory listings
        if (window.location.protocol === 'file:' && pdfs.length === 0) {
            const fileLinks = document.querySelectorAll('a[href]');
            fileLinks.forEach(link => {
                try {
                    const href = link.getAttribute('href');
                    if (href && href.toLowerCase().endsWith('.pdf')) {
                        const url = link.href;
                        if (!seenURLs.has(url)) {
                            pdfs.push({
                                url: url,
                                filename: sanitizeFilename(decodeURIComponent(href)),
                                linkText: link.textContent.trim() || href,
                                size: null
                            });
                            seenURLs.add(url);
                        }
                    }
                } catch (e) {
                    console.log('Skipping file link:', e.message);
                }
            });
        }
        
        return pdfs;
    }

    function extractFilenameFromURL(url) {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            let filename = pathname.split('/').pop();
            
            // Remove query parameters and hash
            filename = filename.split('?')[0].split('#')[0];
            
            if (!filename || filename === '') {
                return null;
            }
            
            return decodeURIComponent(filename);
        } catch (e) {
            // Fallback: try simple extraction
            const match = url.match(/\/([^/?#]+\.pdf)/i);
            return match ? decodeURIComponent(match[1]) : null;
        }
    }

    function sanitizeFilename(filename) {
        // Remove path separators and invalid characters
        return filename
            .replace(/[<>:"/\\|?*]/g, '_')
            .replace(/^\.+/, '') // Remove leading dots
            .trim();
    }

    function downloadLocalFile(url, filename) {
        try {
            const a = document.createElement('a');
            a.href = url;
            a.download = filename || 'document.pdf';
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            return true;
        } catch (error) {
            console.error('Local download error:', error);
            return false;
        }
    }

    // Optional: Auto-scan on page load
    chrome.storage.local.get(['autoScan'], function(result) {
        if (result.autoScan) {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', function() {
                    setTimeout(() => {
                        const pdfs = findPDFs();
                        console.log(`Auto-scan found ${pdfs.length} PDF(s)`);
                    }, 1000);
                });
            } else {
                setTimeout(() => {
                    const pdfs = findPDFs();
                    console.log(`Auto-scan found ${pdfs.length} PDF(s)`);
                }, 1000);
            }
        }
    });
}