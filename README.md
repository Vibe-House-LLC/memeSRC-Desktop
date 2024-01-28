# memeSRC Desktop

This is the starter project for the memeSRC Desktop app.

## Getting Started

**Prerequisite**: [Install Node.js](https://nodejs.org/en/download)

### Install memeSRC Desktop

```bash
git clone git@github.com:Vibe-House-LLC/memeSRC-Desktop.git
cd memeSRC-Desktop
npm install
```

### Start memeSRC Desktop

```bash
npm run start-prod
```

## Compiled Versions (optional)

**Optionally:** If you want to test building and running an executable version of the app, you can use `npm` to build it:

| Platform | Build Command |
|-----|-----|
| macOS (arm64) | `npm run package-mac-arm` |
| macOS (intel) | `npm run package-mac-intel` |
| Windows (x64) | `npm run package-win` |

Windows builds (unsigned) are currently available as [Action artifacts](https://github.com/Vibe-House-LLC/memeSRC-Desktop/actions).
