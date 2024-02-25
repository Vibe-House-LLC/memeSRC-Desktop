const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const mediaExtensions = new Set(['.mp4', '.mkv', '.avi', '.mov']);
const subtitleExtensions = new Set(['.srt']);
const memesrcDir = path.join(os.homedir(), '.memesrc');

async function ensureMemesrcDir() {
    await fs.mkdir(memesrcDir, { recursive: true });
}

async function parseSRT(filePath) {
    const content = await fs.readFile(filePath, 'utf-8');
    const captions = content.split(/\r?\n\r?\n/).filter(Boolean).map(caption => {
        const [index, time, ...textLines] = caption.split(/\r?\n/);
        const [startTime, endTime] = time.split(' --> ');
        const text = textLines.join(' ');
        return { startTime, endTime, text };
    });
    return captions;
}

async function writeCaptionsAsCSV(captions, outputPath) {
    const csvLines = captions.map(({ startTime, endTime, text }) =>
        `"${startTime}","${endTime}","${text.replace(/"/g, '""')}"`);
    const csvContent = 'Start Time,End Time,Text\n' + csvLines.join('\n');
    await fs.writeFile(outputPath, csvContent, 'utf-8');
}

async function extractSeasonEpisode(filename) {
    const SEPattern = /S(\d+)E(\d+)|S(\d+)\.E(\d+)|(\d+)x(\d+)|(\d+)-(\d+)/i;
    const match = filename.match(SEPattern);

    if (match) {
        for (let i = 1; i < match.length; i += 2) {
            if (match[i] && match[i + 1]) {
                return { season: parseInt(match[i], 10), episode: parseInt(match[i + 1], 10) };
            }
        }
    }

    return null;
}

function getFileType(filename) {
    const extension = path.extname(filename).toLowerCase();
    if (mediaExtensions.has(extension)) {
        return 'media';
    } else if (subtitleExtensions.has(extension)) {
        return 'subtitle';
    }
    return null;
}

async function processDirectoryInternal(directoryPath) {
    await ensureMemesrcDir();
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    let seasonEpisodes = [];

    for (let entry of entries) {
        const fullPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            const subDirectorySeasonEpisodes = await processDirectoryInternal(fullPath);
            seasonEpisodes.push(...subDirectorySeasonEpisodes);
        } else {
            const seasonEpisode = await extractSeasonEpisode(entry.name);
            if (seasonEpisode) {
                const fileType = getFileType(entry.name);
                if (fileType === 'subtitle') {
                    const captions = await parseSRT(fullPath);
                    const csvFileName = entry.name.replace(path.extname(entry.name), '.csv');
                    const csvPath = path.join(memesrcDir, csvFileName);
                    await writeCaptionsAsCSV(captions, csvPath);
                }
                if (fileType) {
                    seasonEpisodes.push({ ...seasonEpisode, type: fileType, path: fullPath });
                }
            }
        }
    }

    return seasonEpisodes;
}

async function processDirectory(directoryPath) {
    try {
        const seasonEpisodes = await processDirectoryInternal(directoryPath);

        const seasonEpisodeSummary = seasonEpisodes.reduce((acc, { season, episode, type }) => {
            const key = `Season ${season}, Episode ${episode}`;
            if (!acc[key]) {
                acc[key] = { media: false, subtitle: false };
            }
            acc[key][type] = true;
            return acc;
        }, {});

        console.log("Season-Episode Summary:");
        Object.entries(seasonEpisodeSummary).forEach(([key, { media, subtitle }]) => {
            console.log(`${key}: Media - ${media ? 'Yes' : 'No'}, Subtitle - ${subtitle ? 'Yes' : 'No'}`);
        });

        return seasonEpisodes;
    } catch (err) {
        console.error('Error reading directory:', err);
        throw err;
    }
}

module.exports = { processDirectory };
