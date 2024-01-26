const path = require('path');
const { app, BrowserWindow } = require('electron');
const { exec } = require('child_process');
const windowStateKeeper = require('electron-window-state');

const isDev = process.env.NODE_ENV === 'dev';
const isMac = process.platform === 'darwin';

function createMainWindow() {
    let mainWindowState = windowStateKeeper({
        defaultWidth: 1000,
        defaultHeight: 800
    });

    const mainWindow = new BrowserWindow({
        title: 'memeSRC', // Fixed typo here from 'titls' to 'title'
        x: mainWindowState.x,
        y: mainWindowState.y,
        width: mainWindowState.width,
        height: mainWindowState.height,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            // enableRemoteModule: true, // Only if you need the remote module, which is not recommended for security reasons.
        },
    });

    // Open devtools if in dev env
    if (isDev) {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.loadFile(path.join(__dirname, './renderer/index.html'));
    // mainWindow.loadURL('https://beta.memesrc.com/')

    mainWindowState.manage(mainWindow);
}

function runSystemCommand() {
    exec('ls', (error, stdout, stderr) => {
        if (error) {
            console.error(`exec error: ${error}`);
            return;
        }

        console.log(`stdout: ${stdout}`);
        if (stderr) {
            console.error(`stderr: ${stderr}`);
        }
    });
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
