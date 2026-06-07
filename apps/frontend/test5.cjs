const electron = require('electron');
console.log('keys:', Object.keys(electron).slice(0, 15));
console.log('BrowserWindow:', typeof electron.BrowserWindow);
console.log('app:', typeof electron.app);
