const { ipcRenderer } = require('electron');
const os = require('os');
const path = require('path');
const { exec, spawn } = require('child_process');

let ipfsDaemon;
let isDaemonOperating = false;

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

function findIpfsLocation(callback) {
  // Assuming that the IPFS executable is in the root directory of your Electron app
  const appRootPath = path.resolve(__dirname); // Use __dirname to get the path to your app's root directory
  const ipfsExecutablePath = path.join(appRootPath, 'ipfs'); // Assuming 'ipfs' is directly in the root

  exec(`"${ipfsExecutablePath}" --version`, (error, stdout, stderr) => {
    if (!error && stdout.includes("ipfs version")) {
      callback(ipfsExecutablePath); // IPFS executable found
    } else {
      callback(null); // IPFS executable not found
    }
  });
}

function startIpfsDaemon() {

  updateUIForStarting();
  isDaemonOperating = true;

  ipfsDaemon = spawn("ipfs", ["daemon"]);

  ipfsDaemon.stdout.on("data", (data) => {
    console.log(`stdout: ${data}`);
  });

  ipfsDaemon.stderr.on("data", (data) => {
    console.error(`stderr: ${data}`);
  });

  ipfsDaemon.on("close", (code) => {
    console.log(`IPFS daemon process exited with code ${code}`);
  });

  setTimeout(checkDaemonStatus, 3000); // Check status after a delay to allow for startup
}

function stopIpfsDaemon() {
  updateUIForStopping();
  isDaemonOperating = true;

  console.log(ipfsDaemon);
  if (ipfsDaemon) {
    console.log("Stopping IPFS Daemon");
    ipfsDaemon.kill();
  } else {
    console.log("Stopping IPFS Daemon via 'ipfs shutdown'");
    exec(`ipfs shutdown`, (error, stdout, stderr) => {
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
  setTimeout(checkDaemonStatus, 3000); // Check status after a delay to allow for shutdown
}

function checkDaemonStatus() {

  exec(`ipfs swarm peers`, (error, stdout, stderr) => {
    const statusElement = document.getElementById("daemonStatus");
    const toggleButton = document.getElementById("toggleDaemon");
    if (error || stderr) {
      statusElement.innerHTML = "IPFS is not running";
      statusElement.className = "status-indicator not-running";
      toggleButton.textContent = "Turn on IPFS";
    } else {
      statusElement.innerHTML = "IPFS is running";
      statusElement.className = "status-indicator running";
      toggleButton.textContent = "Turn off IPFS";
    }
    toggleButton.disabled = false;
    isDaemonOperating = false;
  });
}

function fetchMetadata(itemCid) {
  return new Promise((resolve, reject) => {
    exec(
      `ipfs cat ${itemCid}/00_metadata.json`,
      (error, stdout, stderr) => {
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
      }
    );
  });
}

function listIPFSDirectory() {
  const ipfsDirectory = "/memesrc/index/";

  exec(`ipfs files stat ${ipfsDirectory}`, (error, stdout, stderr) => {
    if (error || stderr) {
      return console.error("Error listing IPFS directory:", error || stderr);
    }

    const cid = stdout.split("\n")[0];

    exec(
      `ipfs files stat /memesrc`,
      (memesrcError, memesrcStdout, memesrcStderr) => {
        if (memesrcError || memesrcStderr) {
          return console.error(
            "Error getting /memesrc CID:",
            memesrcError || memesrcStderr
          );
        }

        const memesrcCid = memesrcStdout.split("\n")[0];

        exec(`ipfs ls ${cid}`, (lsError, lsStdout, lsStderr) => {
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
}

function fetchPinStatus(itemCid) {
  return new Promise((resolve, reject) => {
    exec(
      `ipfs pin ls --type=recursive ${itemCid}`,
      (error, stdout, stderr) => {
        if (error || stderr) {
          console.warn(
            `Error checking pin status for CID ${itemCid}:`,
            error || stderr
          );
          resolve(false); // If there's an error, assume it's not pinned
        } else {
          resolve(stdout.includes(itemCid)); // If the CID is listed, it's pinned
        }
      }
    );
  });
}

function pinItem(cid) {
  exec(`ipfs pin add ${cid}`, (error, stdout, stderr) => {
    if (error || stderr) {
      console.error(`Error pinning CID ${cid}:`, error || stderr);
    } else {
      console.log(`Pinned CID ${cid}`);
    }
  });
}

function unpinItem(cid) {
  exec(`ipfs pin rm ${cid}`, (error, stdout, stderr) => {
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
};
