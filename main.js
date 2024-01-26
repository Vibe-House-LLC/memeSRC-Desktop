const path = require('path');
const { app, BrowserWindow } = require('electron');
const { exec } = require('child_process');

const isDev = process.env.NODE_ENV !== 'production';
const isMac = process.platform === 'darwin';

function createMainWindow() {
    const mainWindow = new BrowserWindow({
        title: 'memeSRC', // Fixed typo here from 'titls' to 'title'
        width: isDev ? 1400 : 1250,
        height: 750,
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

    // Example command line interaction
    runSystemCommand();
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
