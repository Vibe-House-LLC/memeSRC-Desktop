const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { exec, spawn } = require('child_process');
const windowStateKeeper = require('electron-window-state');

const isDev = process.env.NODE_ENV === 'dev';
const isMac = process.platform === 'darwin';

const ipfsExecutable = path.join(__dirname, 'node_modules', 'kubo', 'bin', 'ipfs');

// IPFS functions

function ipfs(commandString, callback) {
  exec(`${ipfsExecutable} ${commandString}`, callback);
}

let ipfsDaemonProcess = null;

function checkDaemonStatus() {
    console.log("TRYING TO CHECK THE IPFS STATUS");
    return new Promise((resolve, reject) => {
        ipfs(`swarm peers`, (error, stdout, stderr) => {
            let currentStatus = !(error || stderr); // true if connected, false otherwise
            console.log(currentStatus)
            // Instead of manipulating DOM, we resolve with the status
            resolve(currentStatus);
        });
    });
}

function toggleIpfsDaemon() {
    if (!ipfsDaemonProcess) {
        console.log('Starting IPFS daemon...');
        ipfsDaemonProcess = spawn(ipfsExecutable, ['daemon']);

        ipfsDaemonProcess.stdout.on('data', (data) => {
            console.log(`stdout: ${data}`);
        });

        ipfsDaemonProcess.stderr.on('data', (data) => {
            console.error(`stderr: ${data}`);
        });

        ipfsDaemonProcess.on('close', (code) => {
            console.log(`IPFS daemon process exited with code ${code}`);
            ipfsDaemonProcess = null;
        });
    } else {
        console.log('Stopping IPFS daemon...');
        ipfsDaemonProcess.kill();
        ipfsDaemonProcess = null;
    }
}

// IPC handler definitions

ipcMain.handle('check-daemon-status', async (event) => {
    try {
        const status = await checkDaemonStatus(); 
        return status; 
    } catch (error) {
        console.error('Failed to check daemon status:', error);
        return false;
    }
});

ipcMain.handle('toggle-ipfs-daemon', async (event) => {
    try {
        toggleIpfsDaemon();
        return { success: true, message: "IPFS daemon toggled successfully." };
    } catch (error) {
        console.error('Failed to toggle IPFS daemon:', error);
        return { success: false, message: `Error toggling IPFS daemon: ${error}` };
    }
});

ipcMain.handle('fetch-metadata', (event, itemCid) => {
    return new Promise((resolve, reject) => {
        exec(`${ipfsExecutable} cat ${itemCid}/00_metadata.json`, (error, stdout, stderr) => {
            if (error || stderr) {
                console.warn(`Error fetching metadata for CID ${itemCid}:`, error || stderr);
                resolve(null); // Resolve with null if there's an error
            } else {
                try {
                    const metadata = JSON.parse(stdout);
                    resolve(metadata);
                } catch (parseError) {
                    console.error(`Error parsing metadata for CID ${itemCid}:`, parseError);
                    resolve(null);
                }
            }
        });
    });
});

ipcMain.handle('pin-item', (event, cid) => {
    exec(`${ipfsExecutable} pin add ${cid}`, (error, stdout, stderr) => {
        if (error || stderr) {
            console.error(`Error pinning CID ${cid}:`, error || stderr);
            return { success: false, message: stderr || error.message };
        } else {
            console.log(`Pinned CID ${cid}`);
            return { success: true, message: stdout };
        }
    });
});

// Unpin Item IPC Handler
ipcMain.handle('unpin-item', (event, cid) => {
    exec(`${ipfsExecutable} pin rm ${cid}`, (error, stdout, stderr) => {
        if (error || stderr) {
            console.error(`Error unpinning CID ${cid}:`, error || stderr);
            return { success: false, message: stderr || error.message };
        } else {
            console.log(`Unpinned CID ${cid}`);
            return { success: true, message: stdout };
        }
    });
});

// List Directory Contents IPC Handler
ipcMain.handle('list-directory-contents', (event, directory) => {
    return new Promise((resolve, reject) => {
        exec(`${ipfsExecutable} files ls ${directory}`, (error, stdout, stderr) => {
            if (error || stderr) {
                console.error(`Error listing directory contents:`, error || stderr);
                reject(stderr || error);
            } else {
                const items = stdout.split('\n').filter(line => line.trim() !== '');
                resolve(items);
            }
        });
    });
});

ipcMain.on('load-index-html', () => {
    mainWindow.loadFile(path.join(__dirname, './index.html'));
});

function createMainWindow() {
    let mainWindowState = windowStateKeeper({
        defaultWidth: 1000,
        defaultHeight: 800
    });

    const mainWindow = new BrowserWindow({
        title: 'memeSRC',
        x: mainWindowState.x,
        y: mainWindowState.y,
        width: mainWindowState.width,
        height: mainWindowState.height,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
    });

    if (isDev) {
        mainWindow.webContents.openDevTools();
    }

    // mainWindow.loadFile(path.join(__dirname, './index.html'));
    // mainWindow.loadFile('video-image-test.html')
    mainWindow.loadURL('http://localhost:3000')

    mainWindowState.manage(mainWindow);
}



app.whenReady().then(() => {
    createMainWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (!isMac) {
        app.quit();
    }
});

