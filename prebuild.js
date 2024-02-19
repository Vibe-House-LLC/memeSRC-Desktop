// prebuild.js
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'pythonPath.json');

try {
  // Attempt to find the Python path
  const pythonPath = execSync('which python3 || which python').toString().trim();
  console.log(`Found Python at: ${pythonPath}`);

  // Write this path to pythonPath.json
  fs.writeFileSync(configPath, JSON.stringify({ pythonPath }));
  console.log('Python path saved to pythonPath.json');
} catch (error) {
  console.error('Failed to find Python path:', error);
  process.exit(1);
}
