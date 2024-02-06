const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { exec } = require('child_process');
const AdmZip = require('adm-zip');
const { parse } = require('subtitles-parser-vtt');

const configPath = path.join(require('os').homedir(), '.memesrc', 'config.yml');
const cfg = yaml.load(fs.readFileSync(configPath, 'utf8'));
const FFMPEG_PATH = cfg['ffmpeg_path'];

function getFramesDir(name) {
    return path.join(require('os').homedir(), `.memesrc/processing/${name}`);
}

function extractAllFrames(episodeFile, framesDir, fps = 10) {
    return new Promise((resolve, reject) => {
        const command = `${FFMPEG_PATH} -i "${episodeFile}" -r ${fps} -qscale:v 2 -start_number 0 "${path.join(framesDir, '%09d.jpg')}"`;
        exec(command, (error) => {
            if (error) {
                console.error(`exec error: ${error}`);
                return reject(error);
            }
            resolve();
        });
    });
}

function createZipFilesForFrames(framesDir) {
    const files = fs.readdirSync(framesDir).filter(file => file.endsWith('.jpg'));
    const zip = new AdmZip();

    files.forEach(file => {
        const filePath = path.join(framesDir, file);
        zip.addLocalFile(filePath);
    });

    const zipPath = path.join(framesDir, 'frames.zip');
    zip.writeZip(zipPath);

    files.forEach(file => {
        fs.unlinkSync(path.join(framesDir, file));
    });

    console.log('Frames zipped successfully');
}

async function main() {
    const episodeFile = '/path/to/video/file.mp4';
    const indexName = 'exampleIndex';
    const framesDir = getFramesDir(indexName);

    if (!fs.existsSync(framesDir)) {
        fs.mkdirSync(framesDir, { recursive: true });
    }

    try {
        await extractAllFrames(episodeFile, framesDir);
        createZipFilesForFrames(framesDir);
        console.log('Episode processed successfully');
    } catch (error) {
        console.error('Error processing episode:', error);
    }
}

main();
