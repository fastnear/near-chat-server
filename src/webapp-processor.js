import zlib from "zlib";

/**
 * Webapp/MiniApp processing utilities
 */

// Helper functions for file processing
export const isImageFile = (filename) => {
  return /\.(png|jpg|jpeg|gif|svg|webp|ico|bmp)$/i.test(filename);
};

export const getMimeType = (filename) => {
  const ext = filename.toLowerCase();
  if (ext.endsWith('.png')) return 'image/png';
  if (ext.endsWith('.jpg') || ext.endsWith('.jpeg')) return 'image/jpeg';
  if (ext.endsWith('.gif')) return 'image/gif';
  if (ext.endsWith('.svg')) return 'image/svg+xml';
  if (ext.endsWith('.webp')) return 'image/webp';
  return 'image/png'; // fallback
};

export const getMiniAppAPIScript = () => {
  return `<script>
// Mini-app API
window.MiniAppAPI = {
  readBlockchain: (contractId, method, params) => {
    console.log('MiniApp: readBlockchain called with', { contractId, method, params });
    return new Promise((resolve, reject) => {
      const requestId = Date.now() + Math.random();
      const handleResponse = (event) => {
        if (event.data.requestId === requestId) {
          window.removeEventListener('message', handleResponse);
          if (event.data.success) {
            resolve(event.data.data);
          } else {
            reject(new Error(event.data.error));
          }
        }
      };
      window.addEventListener('message', handleResponse);

      window.parent.postMessage({
        type: 'BLOCKCHAIN_READ',
        requestId,
        payload: {
          contractId,
          method,
          params
        }
      }, '*');
    });
  },

  writeBlockchain: (method, params) => {
    return new Promise((resolve, reject) => {
      const requestId = Date.now() + Math.random();
      const handleResponse = (event) => {
        if (event.data.requestId === requestId) {
          window.removeEventListener('message', handleResponse);
          if (event.data.success) {
            resolve(event.data.data);
          } else {
            reject(new Error(event.data.data || 'User rejected transaction'));
          }
        }
      };
      window.addEventListener('message', handleResponse);
      window.parent.postMessage({
        type: 'BLOCKCHAIN_WRITE',
        requestId,
        payload: { method, params }
      }, '*');
    });
  },

  requestResize: (height) => {
    window.parent.postMessage({
      type: 'RESIZE_REQUEST',
      payload: { height }
    }, '*');
  },

  getConfig: () => window.miniAppConfig || {},
  getUserAuth: () => window.miniAppConfig?.userAuth || null,
  getUserId: () => window.miniAppConfig?.userAuth?.accountId || null,

  getChatData: (key) => {
    return new Promise((resolve, reject) => {
      const requestId = Date.now() + Math.random();
      const handleResponse = (event) => {
        if (event.data.requestId === requestId) {
          window.removeEventListener('message', handleResponse);
          if (event.data.success) {
            resolve(event.data.data);
          } else {
            reject(new Error(event.data.error));
          }
        }
      };
      window.addEventListener('message', handleResponse);

      window.parent.postMessage({
        type: 'GET_CHAT_DATA',
        requestId,
        payload: { key }
      }, '*');
    });
  },

  verifyUserAuth: () => {
    console.log('MiniApp: Starting verifyUserAuth...');

    const userAuth = window.miniAppConfig?.userAuth;
    console.log('MiniApp: userAuth =', userAuth);

    if (!userAuth) {
      console.log('MiniApp: ❌ No userAuth found');
      return false;
    }

    console.log('MiniApp: Checking required fields...');
    console.log('MiniApp: accountId =', userAuth.accountId);
    console.log('MiniApp: signature =', userAuth.signature ? 'present' : 'missing');
    console.log('MiniApp: publicKey =', userAuth.publicKey ? 'present' : 'missing');

    if (!userAuth.accountId || !userAuth.signature || !userAuth.publicKey) {
      console.log('MiniApp: ❌ Missing required fields');
      return false;
    }

    const authData = userAuth.authData;
    console.log('MiniApp: authData =', authData);

    if (authData && authData.timestamp) {
      console.log('MiniApp: timestamp =', authData.timestamp);
      console.log('MiniApp: current time =', Date.now());

      const age = Date.now() - authData.timestamp;
      console.log('MiniApp: age =', age, 'ms');
      console.log('MiniApp: age limit =', 5 * 60 * 1000, 'ms');

      if (age > 5 * 60 * 1000) {
        console.log('MiniApp: ❌ Token expired');
        return false;
      }
    }

    console.log('MiniApp: ✅ All checks passed');
    return true;
  }
};

window.addEventListener('message', (event) => {
  if (event.data.type === 'INIT') {
    console.log('MiniApp: Received INIT message', event.data.payload);
    window.miniAppConfig = event.data.payload;
    console.log('MiniApp: Config set to', window.miniAppConfig);
    window.dispatchEvent(new CustomEvent('miniapp-init', {
      detail: event.data.payload
    }));
    console.log('MiniApp: miniapp-init event dispatched');
  } else {
    console.log('MiniApp: Received message', event.data);
  }
});
</script>`;
};

export const processMiniAppArchive = (base64Data) => {
  try {
    // Step 1: Decode base64 → binary → gzip decompress → JSON string
    const binaryData = Buffer.from(base64Data, 'base64');
    const decompressed = zlib.gunzipSync(binaryData).toString('utf8');
    const archiveJson = JSON.parse(decompressed);

    // Step 2: Extract files from JSON structure
    const files = archiveJson.files;
    if (!files || typeof files !== 'object') {
      throw new Error('Invalid archive structure: missing files');
    }

    // Step 3: Find main HTML file (index.html or first .html file)
    let htmlContent = files['index.html']?.content;
    if (!htmlContent) {
      // Find first .html file
      const htmlFiles = Object.entries(files).filter(([name]) => name.endsWith('.html'));
      if (htmlFiles.length > 0) {
        htmlContent = htmlFiles[0][1].content;
      }
    }

    if (!htmlContent) {
      throw new Error('No HTML file found in archive');
    }

    // Step 4: Ensure basic HTML structure
    if (!htmlContent.includes('<html')) {
      htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${htmlContent}</body></html>`;
    }

    // Step 5: Inline CSS files
    const cssFiles = Object.entries(files).filter(([name, data]) =>
      name.endsWith('.css') && data.encoding === 'utf8');
    if (cssFiles.length > 0) {
      const cssContent = cssFiles.map(([name, data]) => data.content).join('\n\n');
      const styleTag = `<style>\n/* Combined CSS */\n${cssContent}\n</style>`;
      htmlContent = htmlContent.replace('</head>', `${styleTag}\n</head>`);
    }

    // Step 6: Convert base64 images to data URLs
    const imageFiles = Object.entries(files).filter(([name, data]) =>
      data.encoding === 'base64' && isImageFile(name));
    for (const [filename, data] of imageFiles) {
      const mimeType = getMimeType(filename);
      const dataUrl = `data:${mimeType};base64,${data.content}`;

      // Replace image references in HTML
      htmlContent = htmlContent.replace(new RegExp(`src=['"]${filename}['"]`, 'g'), `src="${dataUrl}"`);
      htmlContent = htmlContent.replace(new RegExp(`url\\(['"]?${filename}['"]?\\)`, 'g'), `url(${dataUrl})`);
    }

    // Step 7: Inject MiniApp API script
    const apiScript = getMiniAppAPIScript();
    htmlContent = htmlContent.replace('</head>', `${apiScript}\n</head>`);

    // Step 8: Inline JavaScript files
    const jsFiles = Object.entries(files).filter(([name, data]) =>
      name.endsWith('.js') && data.encoding === 'utf8');
    if (jsFiles.length > 0) {
      const jsContent = jsFiles.map(([name, data]) => data.content).join('\n\n');
      const scriptTag = `<script>\n/* Combined JS */\n${jsContent}\n</script>`;
      htmlContent = htmlContent.replace('</body>', `${scriptTag}\n</body>`);
    }

    return htmlContent;
  } catch (error) {
    console.error('Error processing mini-app archive:', error);
    throw new Error(`Failed to process mini-app archive: ${error.message}`);
  }
};