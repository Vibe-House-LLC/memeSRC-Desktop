const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { exec } = require('child_process');
const windowStateKeeper = require('electron-window-state');

const isDev = process.env.NODE_ENV === 'dev';
const isMac = process.platform === 'darwin';

const ipfsExecutable = path.join(__dirname, 'node_modules', 'kubo', 'bin', 'ipfs');

// IPFS functions

function ipfs(commandString, callback) {
  exec(`${ipfsExecutable} ${commandString}`, callback);
}

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
        ipfsDaemonProcess = spawn('ipfs', ['daemon']);

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

