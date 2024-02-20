const os = require('os');
const fs = require('fs').promises;
const path = require('path');
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { exec, spawn } = require('child_process');
const windowStateKeeper = require('electron-window-state');
const { promisify } = require('util');
const { PythonShell } = require('python-shell');

const execAsync = promisify(exec);

const isDev = process.env.NODE_ENV === 'dev';
const isMac = process.platform === 'darwin';

const ipfsExecutable = path.join(__dirname, 'node_modules', 'kubo', 'bin', 'ipfs');

// IPFS functions

function ipfs(commandString, callback) {
  exec(`${ipfsExecutable} ${commandString}`, callback);
}

let ipfsDaemonProcess = null;

function checkDaemonStatus() {
    return new Promise((resolve, reject) => {
        ipfs(`swarm peers`, (error, stdout, stderr) => {
            let currentStatus = !(error || stderr); // true if connected, false otherwise
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

function fetchBandwidthStats() {
    return new Promise((resolve, reject) => {
        exec(`${ipfsExecutable} stats bw`, (error, stdout, stderr) => {
            if (error || stderr) {
                console.error("Error fetching bandwidth stats:", error || stderr);
                reject(stderr || error);
            } else {
                const stats = parseBandwidthStats(stdout);
                resolve(stats);
            }
        });
    });
}

function parseBandwidthStats(output) {
    const stats = {};
    const lines = output.split("\n");
    lines.forEach((line) => {
        if (line.includes(":")) {
            let [key, value] = line.split(":").map((item) => item.trim());
            // Convert value to bytes
            value = convertToBytes(value);
            stats[key] = value;
        }
    });
    return stats;
}

// Helper function to convert values with units to bytes
function convertToBytes(valueWithUnit) {
    const units = { kB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 };
    const match = valueWithUnit.match(/([\d.]+)\s*(kB|MB|GB|B)?/);
    if (!match) return null;
    const value = parseFloat(match[1]);
    const unit = match[2];
    const multiplier = units[unit] || 1;
    return value * multiplier;
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

ipcMain.handle('fetch-bandwidth-stats', async (event) => {
    try {
        const stats = await fetchBandwidthStats();
        // Assuming you want to include a simplified response with only byte values
        return { success: true, stats: stats };
    } catch (error) {
        console.error('Failed to fetch bandwidth stats:', error);
        return { success: false, message: `Error fetching bandwidth stats: ${error}` };
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

ipcMain.handle('fetch-processing-status', async (event, id) => {
    const statusPath = path.join(os.homedir(), '.memesrc', 'processing', id, 'processing_status.json');
    try {
        // Correctly using fs.promises.readFile with 'utf8' encoding
        const data = await fs.readFile(statusPath, 'utf8');
        const status = JSON.parse(data);
        return { success: true, status };
    } catch (error) {
        console.error(`Failed to fetch processing status for ID ${id}:`, error);
        return { success: false, message: `Error fetching processing status for ID ${id}: ${error.message}` };
    }
});

ipcMain.handle('check-pin-status', (event, cid) => {
    return new Promise((resolve, reject) => {
        exec(`${ipfsExecutable} pin ls --type=recursive ${cid}`, (error, stdout, stderr) => {
            if (error || stderr) {
                console.error(`Error checking pin status for CID ${cid}:`, error || stderr);
                resolve({ success: false, isPinned: false, message: stderr || error.message });
            } else {
                // If the CID is found in the output, it's considered pinned
                const isPinned = stdout.includes(cid);
                resolve({ success: true, isPinned: isPinned, message: `CID ${cid} is ${isPinned ? 'pinned' : 'not pinned'}.` });
            }
        });
    });
});

ipcMain.handle('pin-item', async (event, cid) => {
    try {
        const { stdout, stderr } = await execAsync(`${ipfsExecutable} pin add ${cid}`);
        if (stderr) {
            console.error(`Error pinning CID ${cid}:`, stderr);
            return { success: false, message: stderr };
        } else {
            console.log(`Pinned CID ${cid}:`, stdout);
            return { success: true, message: stdout };
        }
    } catch (error) {
        console.error(`Error pinning CID ${cid}:`, error);
        return { success: false, message: error.message };
    }
});

ipcMain.handle('unpin-item', async (event, cid) => {
    try {
        const { stdout, stderr } = await execAsync(`${ipfsExecutable} pin rm ${cid}`);
        if (stderr) {
            console.error(`Error unpinning CID ${cid}:`, stderr);
            return { success: false, message: stderr };
        } else {
            console.log(`Unpinned CID ${cid}:`, stdout);
            return { success: true, message: stdout };
        }
    } catch (error) {
        console.error(`Error unpinning CID ${cid}:`, error);
        return { success: false, message: error.message };
    }
});

ipcMain.handle('list-directory-contents', (event, directory) => {
    return new Promise((resolve, reject) => {
        exec(`${ipfsExecutable} files ls ${directory}`, async (error, stdout, stderr) => {
            if (error || stderr) {
                console.error(`Error listing directory contents:`, error || stderr);
                reject(stderr || error);
            } else {
                const itemNames = stdout.split('\n').filter(line => line.trim() !== '');
                const itemsDetailsPromises = itemNames.map(name => fetchItemDetails(directory, name));
                Promise.all(itemsDetailsPromises)
                    .then(itemsDetails => {
                        resolve(itemsDetails);
                    })
                    .catch(err => {
                        console.error("Error fetching item details:", err);
                        reject(err);
                    });
            }
        });
    });
});

ipcMain.handle('add-cid-to-index', async (event, cid) => {
    try {
        const destinationPath = `/memesrc/index/${cid}`;
        await execAsync(`${ipfsExecutable} files cp /ipfs/${cid} ${destinationPath}`);
        console.log(`Copied CID ${cid} to ${destinationPath}`);
        // You might want to refresh or update some UI element or data structure here
        return { success: true, message: `Copied CID ${cid} to ${destinationPath}` };
    } catch (error) {
        console.error(`Error copying CID to /memesrc/index/:`, error);
        return { success: false, message: `Error copying CID to /memesrc/index/: ${error.message}` };
    }
});

ipcMain.on('start-python-script', async (event, args) => { // Mark the callback as async
    // Async function to load the pythonExecutable path from the configuration file
    const loadPythonExecutable = async () => {
        try {
            const configPath = path.join(process.resourcesPath, 'pythonPath.json');
            const configData = await fs.readFile(configPath, 'utf-8'); // Use await to handle the promise
            const config = JSON.parse(configData);
            if (!config.pythonPath) {
                throw new Error('pythonPath is not defined in the configuration.');
            }
            return config.pythonPath;
        } catch (error) {
            console.warn('Could not load Python path from configuration or file not found. Using default path. Error:', error);
            // If the file can't be found or another error occurs, use 'python' as the default
            return 'python'; // Return the default python path
        }
    };

    try {
        // Await the loading of the pythonExecutable path
        const pythonExecutable = await loadPythonExecutable();

        console.log("Python executable:", pythonExecutable);

        // Proceed with the rest of the script only if pythonExecutable is successfully retrieved
        const scriptPath = path.join(__dirname, 'process-index.py'); // Adjust script path as needed
        const { inputPath, id } = args;

        const ffmpegPath = require('ffmpeg-static');
        console.log("FFmpeg path:", ffmpegPath);

        // Construct the command to run the Python script with arguments
        const command = `${pythonExecutable} "${scriptPath}" "${inputPath}" "${ffmpegPath}" "${id}"`;

        // Execute the Python script
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`Exec error: ${error}`);
                event.sender.send('python-script-response', { success: false, error: stderr });
                return;
            }
            console.log(`Stdout: ${stdout}`);
            event.sender.send('python-script-response', { success: true, output: stdout });
        });

        event.sender.send('python-script-started', { started: true });
    } catch (error) {
        // Handle errors, such as file not found or pythonPath not defined
        event.sender.send('python-script-response', { success: false, error: error.toString() });
    }
});

ipcMain.handle('add-processed-index-to-ipfs', async (event, input) => {
    console.log("Adding processed index to ipfs:")
    console.log("input", input)
    return new Promise((resolve, reject) => {
        ipfs(`add -r ${input}`, (error, stdout, stderr) => {
            console.log(stdout)
            // Parse stdout to find the CID of the directory
            const lines = stdout.split('\n');
            // Extract the directory name from the input path
            const directoryName = input.split('/').pop();
            const directoryLine = lines.find(line => line.endsWith(`${directoryName}`));
            console.log("directoryLine", directoryLine)
            if (directoryLine) {
                const cidMatch = directoryLine.match(/added (\w+) /);
                if (cidMatch && cidMatch[1]) {
                    const cid = cidMatch[1];
                    console.log(`Added processed index to IPFS with CID: ${cid}`);

                    // Next, copy the directory to /memesrc/index/{CID}
                    ipfs(`files cp /ipfs/${cid} /memesrc/index/${cid}`, (cpError, cpStdout, cpStderr) => {
                        resolve(cid); // Resolve with the CID of the directory after copying
                    });
                } else {
                    reject('CID of the directory could not be parsed from the output.');
                }
            } else {
                reject(`No directory entry found in the output for ${input}.`);
            }
        });
    });
});

ipcMain.handle("open-directory-dialog", async (event) => {
  const { filePaths } = await dialog.showOpenDialog({
    properties: ["openDirectory"],
  });
    return filePaths[0];
});

function fetchItemDetails(directory, name) {
    return new Promise((resolve, reject) => {
        exec(`${ipfsExecutable} files stat ${path.join(directory, name)}`, (error, stdout, stderr) => {
            if (error || stderr) {
                console.error(`Error fetching details for ${name}:`, error || stderr);
                reject(stderr || error);
            } else {
                const details = stdout.split('\n').reduce((acc, line) => {
                    if (line.includes('Size:')) acc.size = line.split(':')[1].trim();
                    if (line.includes('CumulativeSize:')) acc.cumulative_size = line.split(':')[1].trim();
                    return acc;
                }, { name, cid: stdout.split('\n')[0].trim() });
                resolve(details);
            }
        });
    });
}

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
        mainWindow.loadURL('http://localhost:3000');
    } else {
        mainWindow.loadURL('https://dev.memesrc.com/');
    }

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

