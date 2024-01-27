const { ipcRenderer } = require("electron");
const os = require("os");
const path = require("path");
const { exec, spawn } = require("child_process");

let ipfsDaemon;
let isDaemonOperating = false;

// Function to determine the correct binary name
function getIpfsExecutable() {
  const arch = os.arch(); // will return 'arm64' for ARM-based 64-bit architectures and 'x64' for Intel-based 64-bit architectures
  let platform = os.platform(); // will return 'darwin' for macOS and 'win32' for Windows
  let binaryName = 'ipfs'; // default binary name

  if (platform === 'darwin' && arch === 'arm64') {
    // macOS with ARM64 architecture
    binaryName = 'kubo_v0.26.0_darwin-arm64';
  } else if (platform === 'darwin' && arch === 'x64') {
    // macOS with Intel architecture
    binaryName = 'kubo_v0.26.0_darwin-amd64';
  } else if (platform === 'win32' && arch === 'x64') {
    // Windows with Intel architecture
    binaryName = 'kubo_v0.26.0_windows-amd64.exe';
  }

  return path.join(__dirname, binaryName);
}

const ipfsExecutable = getIpfsExecutable();
console.log(ipfsExecutable);

function updateUIForStarting() {
  const statusElement = document.getElementById("daemonStatus");
  const toggleButton = document.getElementById("toggleDaemon");
  statusElement.innerHTML = "IPFS is starting";
  statusElement.className = "status-indicator changing";
  toggleButton.textContent = "Please wait...";
  toggleButton.disabled = true;
}

function updateUIForStopping() {
  const statusElement = document.getElementById("daemonStatus");
  const toggleButton = document.getElementById("toggleDaemon");
  statusElement.innerHTML = "IPFS is stopping";
  statusElement.className = "status-indicator changing";
  toggleButton.textContent = "Please wait...";
  toggleButton.disabled = true;
}

function ipfs(commandString, callback) {
  exec(`${ipfsExecutable} ${commandString}`, callback);
}

function startIpfsDaemon() {
  updateUIForStarting();
  isDaemonOperating = true;

  ipfsDaemon = spawn(ipfsExecutable, ["daemon"]);

  ipfsDaemon.stdout.on("data", (data) => {
    console.log(`stdout: ${data}`);
  });

  ipfsDaemon.stderr.on("data", (data) => {
    console.error(`stderr: ${data}`);
  });

  ipfsDaemon.on("close", (code) => {
    console.log(`IPFS daemon process exited with code ${code}`);
  });
}


// kubo_v0.26.0_darwin-arm64

function stopIpfsDaemon() {
  updateUIForStopping();
  isDaemonOperating = true;

  console.log(ipfsDaemon);
  if (ipfsDaemon) {
    console.log("Stopping IPFS Daemon");
    ipfsDaemon.kill();
  } else {
    console.log("Stopping IPFS Daemon via 'ipfs shutdown'");
    ipfs(`shutdown`, (error, stdout, stderr) => {
      if (error) {
        console.error(`exec error: ${error}`);
        return;
      }
      if (stdout) {
        console.log(`stdout: ${stdout}`);
      }
      if (stderr) {
        console.error(`stderr: ${stderr}`);
      }
    });
  }
}

let lastIpfsStatus = null;

function checkDaemonStatus() {
  return new Promise((resolve, reject) => {
    ipfs(`swarm peers`, (error, stdout, stderr) => {
      const statusElement = document.getElementById("daemonStatus");
      const toggleButton = document.getElementById("toggleDaemon");
      let currentStatus;

      if (error || stderr) {
        statusElement.innerHTML = "IPFS is not running";
        statusElement.className = "status-indicator not-running";
        toggleButton.textContent = "Turn on IPFS";
        currentStatus = false;
      } else {
        statusElement.innerHTML = "IPFS is running";
        statusElement.className = "status-indicator running";
        toggleButton.textContent = "Turn off IPFS";
        currentStatus = true;
      }

      // If the status has changed, update the list and the last known status
      if (lastIpfsStatus !== currentStatus) {
        lastIpfsStatus = currentStatus;
        listIPFSDirectory(); 
      }

      resolve(currentStatus);
    });
  });
}



function fetchMetadata(itemCid) {
  return new Promise((resolve, reject) => {
    ipfs(`cat ${itemCid}/00_metadata.json`, (error, stdout, stderr) => {
      if (error || stderr) {
        console.warn(
          `Error fetching metadata for CID ${itemCid}:`,
          error || stderr
        );
        resolve(null); // Resolve with null if there's an error
      } else {
        try {
          const metadata = JSON.parse(stdout);
          resolve(metadata);
        } catch (parseError) {
          console.error(
            `Error parsing metadata for CID ${itemCid}:`,
            parseError
          );
          resolve(null);
        }
      }
    });
  });
}

function listIPFSDirectory() {
  checkDaemonStatus().then((connected) => {
    const tableBody = document.getElementById("ipfsIndexesList");

    if (!connected) {
      console.log("IPFS daemon is not running - clearing index list");
      tableBody.innerHTML = ""; // Clear the list if the daemon is not running
    } else {
      // Function to create a directory if it doesn't exist
      function createDirIfNotExist(dir) {
        return new Promise((resolve, reject) => {
          ipfs(`files stat ${dir}`, (statError) => {
            if (statError) {
              // Directory does not exist, create it
              ipfs(`files mkdir ${dir}`, (mkdirError) => {
                if (mkdirError) {
                  return reject(
                    `Error creating directory ${dir}: ${mkdirError}`
                  );
                }
                resolve();
              });
            } else {
              // Directory exists
              resolve();
            }
          });
        });
      }

      // Ensure /memesrc directory exists
      createDirIfNotExist("/memesrc")
        .then(() => {
          // Now ensure /memesrc/index exists
          return createDirIfNotExist("/memesrc/index");
        })
        .then(() => {
          // Both directories exist, proceed with listing
          const ipfsDirectory = "/memesrc/index";

          ipfs(`files stat ${ipfsDirectory}`, (error, stdout, stderr) => {
            if (error || stderr) {
              return console.error(
                "Error listing IPFS directory:",
                error || stderr
              );
            }

            const cid = stdout.split("\n")[0];

            ipfs(
              `files stat /memesrc`,
              (memesrcError, memesrcStdout, memesrcStderr) => {
                if (memesrcError || memesrcStderr) {
                  return console.error(
                    "Error getting /memesrc CID:",
                    memesrcError || memesrcStderr
                  );
                }

                const memesrcCid = memesrcStdout.split("\n")[0];

                ipfs(`ls ${cid}`, (lsError, lsStdout, lsStderr) => {
                  if (lsError || lsStderr) {
                    return console.error(
                      "Error listing directory contents:",
                      lsError || lsStderr
                    );
                  }

                  const lines = lsStdout.trim().split("\n");
                  const directories = lines.map((line) => {
                    const parts = line.split(/\s+/);
                    if (parts.length >= 3) {
                      const itemCid = parts[0];
                      const name = parts[parts.length - 1];
                      return { name, cid: itemCid, index_name: null };
                    } else {
                      console.warn(`Unexpected format for line: ${line}`);
                      return null;
                    }
                  });

                  Promise.all(
                    directories
                      .filter((dir) => dir)
                      .map((dir) =>
                        fetchMetadata(dir.cid).then((metadata) => ({
                          ...dir,
                          index_name: metadata ? metadata.index_name : "N/A",
                        }))
                      )
                  ).then((completedDirectories) => {
                    updateIndexesTable(completedDirectories);
                    console.log({
                      memesrc_cid: memesrcCid,
                      directories: completedDirectories,
                    });
                  });
                });
              }
            );
          });
        })
        .catch((err) => {
          console.error(err);
        });
    }
  });
}

function fetchPinStatus(itemCid) {
  return new Promise((resolve, reject) => {
    ipfs(`pin ls --type=recursive ${itemCid}`, (error, stdout, stderr) => {
      if (error || stderr) {
        console.warn(
          `Error checking pin status for CID ${itemCid}:`,
          error || stderr
        );
        resolve(false); // If there's an error, assume it's not pinned
      } else {
        resolve(stdout.includes(itemCid)); // If the CID is listed, it's pinned
      }
    });
  });
}

function pinItem(cid) {
  ipfs(`pin add ${cid}`, (error, stdout, stderr) => {
    if (error || stderr) {
      console.error(`Error pinning CID ${cid}:`, error || stderr);
    } else {
      console.log(`Pinned CID ${cid}`);
    }
  });
}

function unpinItem(cid) {
  ipfs(`pin rm ${cid}`, (error, stdout, stderr) => {
    if (error || stderr) {
      console.error(`Error unpinning CID ${cid}:`, error || stderr);
    } else {
      console.log(`Unpinned CID ${cid}`);
    }
  });
}

function handlePinClick(cid, isChecked) {
  if (isChecked) {
    pinItem(cid);
  } else {
    unpinItem(cid);
  }
}

function updateIndexesTable(directories) {
  const tableBody = document.getElementById("ipfsIndexesList");
  tableBody.innerHTML = ""; // Clear existing rows

  directories.forEach((directory) => {
    const row = tableBody.insertRow();
    const pinCell = row.insertCell();
    const indexNameCell = row.insertCell();
    const cidCell = row.insertCell();

    // Set classes for styling
    indexNameCell.className = "name";
    cidCell.className = "cid";

    // Checkbox for pin status
    const pinCheckbox = document.createElement("input");
    pinCheckbox.type = "checkbox";
    pinCheckbox.onclick = () =>
      handlePinClick(directory.cid, pinCheckbox.checked);
    pinCheckbox.disabled = true; // Initially disabled, enabled when status is known
    pinCell.appendChild(pinCheckbox);

    indexNameCell.textContent = directory.index_name || "N/A";
    cidCell.textContent = directory.cid;

    // Fetch and update pin status
    fetchPinStatus(directory.cid).then((isPinned) => {
      pinCheckbox.checked = isPinned;
      pinCheckbox.disabled = false;
    });
  });
}

function handleCidSubmission() {
  const cidInput = document.getElementById("cidInput");
  const cid = cidInput.value.trim();

  if (!cid) {
    alert("Please enter a CID.");
    return;
  }

  addCidToIndex(cid);
}

function addCidToIndex(cid) {
  const destinationPath = `/memesrc/index/${cid}`;

  ipfs(`files cp /ipfs/${cid} ${destinationPath}`, (error, stdout, stderr) => {
    if (error || stderr) {
      console.error(`Error copying CID to /memesrc/index/:`, error || stderr);
    } else {
      console.log(`Copied CID ${cid} to ${destinationPath}`);
      listIPFSDirectory(); // Refresh the list
    }
  });

  // Clear the input field after submission
  document.getElementById("cidInput").value = '';
}


window.onload = () => {
  const toggleButton = document.getElementById("toggleDaemon");

  checkDaemonStatus();
  listIPFSDirectory();

  toggleButton.addEventListener("click", (e) => {
    e.preventDefault();
    if (!isDaemonOperating) {
      const statusElement = document.getElementById("daemonStatus");
      if (statusElement.className.includes("not-running")) {
        startIpfsDaemon();
      } else {
        stopIpfsDaemon();
      }
    }
  });

  const submitCidButton = document.getElementById("submitCid");
  submitCidButton.addEventListener("click", handleCidSubmission);

  // Keep things up to date
  setInterval(checkDaemonStatus, 5000);
  setInterval(listIPFSDirectory, 60000);
};