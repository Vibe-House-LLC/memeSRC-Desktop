const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const venvDir = path.join(__dirname, 'venv'); // Directory for the virtual environment
const configPath = path.join(__dirname, 'pythonPath.json');
const requirementsPath = path.join(__dirname, 'requirements.txt');

// Function to try executing a command using different Python aliases
function createVenvWithFallback(pythonAliases, venvDir) {
  const errors = [];
  for (const python of pythonAliases) {
    try {
      execSync(`${python} -m venv ${venvDir}`);
      return python; // Return the successful Python alias
    } catch (error) {
      errors.push(`Failed with ${python}: ${error.message}`);
    }
  }
  throw new Error(errors.join('\n'));
}

try {
  // Attempt to create a virtual environment with fallback Python aliases
  const pythonAlias = createVenvWithFallback(['python3', 'python', 'python3.10', 'python3.9', 'python3.8'], venvDir);
  console.log('Virtual environment created');

  // Adjust the Python path for executing further commands
  const pythonPath = path.join(venvDir, 'bin', pythonAlias);

  // Activate the virtual environment and install requirements
  execSync(`${pythonPath} -m pip install -r ${requirementsPath}`, { stdio: 'inherit', shell: '/bin/bash' });
  console.log('Dependencies installed');

  console.log(`Using Python at: ${pythonPath}`);

  // Write this path to pythonPath.json
  fs.writeFileSync(configPath, JSON.stringify({ pythonPath }));
  console.log('Python path saved to pythonPath.json');
} catch (error) {
  console.error('Failed to setup Python environment:', error);
  process.exit(1);
}
