const { exec, spawn, app } = require("child_process");
const os = require("os");
const path = require("path");

let ipfsDaemon;
let isDaemonOperating = false;
let ipfsPath = null;

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
  const homeDirectory = os.homedir();
  const appDirectory = app.getAppPath();

  const possiblePaths = [
    path.join("/opt", "homebrew", "bin", "ipfs"),
    path.join("/usr", "local", "bin", "ipfs"),
    path.join("/usr", "bin", "ipfs"),
    path.join(homeDirectory, "Desktop", "ipfs", "kubo"),
    path.join(appDirectory, "ipfs"),
  ];

  let foundPath = null;
  let checksCompleted = 0;

  possiblePaths.forEach((path, index) => {
    exec(`"${path}" --version`, (error, stdout, stderr) => {
      checksCompleted++;
      if (!foundPath && !error && stdout.includes("ipfs version")) {
        foundPath = path;
      }
      if (checksCompleted === possiblePaths.length) {
        callback(foundPath);
      }
    });
  });
}

function startIpfsDaemon() {
  if (!ipfsPath) return; // Don't proceed if IPFS path is not found

  updateUIForStarting();
  isDaemonOperating = true;

  ipfsDaemon = spawn(ipfsPath, ["daemon"]);

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
  if (!ipfsPath) return; // Don't proceed if IPFS path is not found

  updateUIForStopping();
  isDaemonOperating = true;

  console.log(ipfsDaemon);
  if (ipfsDaemon) {
    console.log("Stopping IPFS Daemon");
    ipfsDaemon.kill();
  } else {
    console.log("Stopping IPFS Daemon via 'ipfs shutdown'");
    exec(`"${ipfsPath}" shutdown`, (error, stdout, stderr) => {
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
  if (!ipfsPath) return; // Don't proceed if IPFS path is not found

  exec(`"${ipfsPath}" swarm peers`, (error, stdout, stderr) => {
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

function fetchMetadata(ipfsPath, itemCid) {
  return new Promise((resolve, reject) => {
    exec(
      `"${ipfsPath}" cat ${itemCid}/00_metadata.json`,
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

  exec(`"${ipfsPath}" files stat ${ipfsDirectory}`, (error, stdout, stderr) => {
    if (error || stderr) {
      return console.error("Error listing IPFS directory:", error || stderr);
    }

    const cid = stdout.split("\n")[0];

    exec(
      `"${ipfsPath}" files stat /memesrc`,
      (memesrcError, memesrcStdout, memesrcStderr) => {
        if (memesrcError || memesrcStderr) {
          return console.error(
            "Error getting /memesrc CID:",
            memesrcError || memesrcStderr
          );
        }

        const memesrcCid = memesrcStdout.split("\n")[0];

        exec(`"${ipfsPath}" ls ${cid}`, (lsError, lsStdout, lsStderr) => {
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
                fetchMetadata(ipfsPath, dir.cid).then((metadata) => ({
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

function fetchPinStatus(ipfsPath, itemCid) {
  return new Promise((resolve, reject) => {
    exec(
      `"${ipfsPath}" pin ls --type=recursive ${itemCid}`,
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

function pinItem(ipfsPath, cid) {
  exec(`"${ipfsPath}" pin add ${cid}`, (error, stdout, stderr) => {
    if (error || stderr) {
      console.error(`Error pinning CID ${cid}:`, error || stderr);
    } else {
      console.log(`Pinned CID ${cid}`);
    }
  });
}

function unpinItem(ipfsPath, cid) {
  exec(`"${ipfsPath}" pin rm ${cid}`, (error, stdout, stderr) => {
    if (error || stderr) {
      console.error(`Error unpinning CID ${cid}:`, error || stderr);
    } else {
      console.log(`Unpinned CID ${cid}`);
    }
  });
}

function handlePinClick(cid, isChecked) {
  if (isChecked) {
    pinItem(ipfsPath, cid);
  } else {
    unpinItem(ipfsPath, cid);
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
    fetchPinStatus(ipfsPath, directory.cid).then((isPinned) => {
      pinCheckbox.checked = isPinned;
      pinCheckbox.disabled = false;
    });
  });
}

window.onload = () => {
  const toggleButton = document.getElementById("toggleDaemon");
  const findIpfsPathButton = document.getElementById("findIpfsPathButton");
  const ipfsPathResult = document.getElementById("ipfsPathResult");

  findIpfsLocation((path) => {
    if (path) {
      ipfsPath = path; // Set the global IPFS path
      // ipfsPathResult.innerHTML = `IPFS Path: ${path}`;
      checkDaemonStatus(); // Call checkDaemonStatus after setting ipfsPath
    } else {
      // ipfsPathResult.innerHTML = "IPFS Path not found.";
      checkDaemonStatus(); // Call checkDaemonStatus even if path not found
    }
    listIPFSDirectory();
  });

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

  findIpfsPathButton.addEventListener("click", () => {
    findIpfsLocation((path) => {
      if (path) {
        ipfsPath = path; // Update the global IPFS path
        ipfsPathResult.innerHTML = `IPFS Path: ${path}`;
      } else {
        ipfsPathResult.innerHTML = "IPFS Path not found.";
      }
    });
  });
};
