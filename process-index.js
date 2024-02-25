const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const ffmpeg = require('ffmpeg-static');
const { exec } = require('child_process');

const mediaExtensions = new Set(['.mp4', '.mkv', '.avi', '.mov']);
const subtitleExtensions = new Set(['.srt']);

// Encode text to base64
function encodeBase64(text) {
    return Buffer.from(text, 'utf-8').toString('base64');
}

async function ensureMemesrcDir(id, season = '', episode = '') {
    const memesrcDir = path.join(os.homedir(), '.memesrc', 'processing', id, season, episode);
    await fs.mkdir(memesrcDir, { recursive: true });
    return memesrcDir; // Return the directory path for further use
}

async function parseSRT(filePath) {
    const content = await fs.readFile(filePath, 'utf-8');
    const captions = content.split(/\r?\n\r?\n/).filter(Boolean).map((caption, index) => {
        const [indexLine, time, ...textLines] = caption.split(/\r?\n/);
        const [startTime, endTime] = time.split(' --> ');
        const text = textLines.join(' ');
        return { index, startTime, endTime, text };
    });
    return captions;
}

async function writeCaptionsAsCSV(captions, season, episode, id) {
    const csvFileName = `_docs.csv`;
    // Ensure directory for the episode
    const episodeDir = await ensureMemesrcDir(id, `${season}`, `${episode}`);
    const seasonDir = await ensureMemesrcDir(id, `${season}`); // Ensure directory for the season
    const seriesDir = await ensureMemesrcDir(id); // Ensure directory for the series
    
    const csvLines = captions.map(({ index, startTime, endTime, text }) => {
        // Convert startTime and endTime to frame index (at 10 fps)
        const startFrame = timeToFrameIndex(startTime);
        const endFrame = timeToFrameIndex(endTime);
        return `${season},${episode},${index},"${encodeBase64(text)}",${startFrame},${endFrame}`;
    });

    const csvContent = csvLines.join('\n') + '\n'; // Prepare CSV content to append

    // Append to episode-specific CSV
    const episodeCSVPath = path.join(episodeDir, csvFileName);
    await appendToFile(episodeCSVPath, csvContent, 'season,episode,subtitle_index,subtitle_text,start_frame,end_frame\n');

    // Append to season-level CSV
    const seasonCSVPath = path.join(seasonDir, csvFileName);
    await appendToFile(seasonCSVPath, csvContent, 'season,episode,subtitle_index,subtitle_text,start_frame,end_frame\n');

    // Append to series-level CSV
    const seriesCSVPath = path.join(seriesDir, csvFileName);
    await appendToFile(seriesCSVPath, csvContent, 'season,episode,subtitle_index,subtitle_text,start_frame,end_frame\n');
}

// Helper function to append content to a file, creating the file with headers if it does not exist
async function appendToFile(filePath, content, headers) {
    try {
        await fs.access(filePath); // Check if file exists
        await fs.appendFile(filePath, content, 'utf-8'); // Append if it exists
    } catch (error) {
        // If file does not exist, create it with headers
        await fs.writeFile(filePath, headers + content, 'utf-8');
    }
}

// New function to split media files into 25-second segments at 10 fps
async function splitMediaFileIntoSegments(filePath, id, season, episode) {
    const outputDir = await ensureMemesrcDir(id, season.toString(), episode.toString());
    const command = `${ffmpeg} -i "${filePath}" -an -filter:v fps=fps=10 -segment_time 00:00:25 -f segment -reset_timestamps 1 "${outputDir}/%d.mp4"`;

    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`exec error: ${error}`);
                return reject(error);
            }
            console.log(`stdout: ${stdout}`);
            console.error(`stderr: ${stderr}`);
            resolve();
        });
    });
}

// Helper function to convert timecode to frame index
function timeToFrameIndex(time) {
  const [hours, minutes, seconds] = time.split(':');
  const [sec, ms] = seconds.split(',');
  const totalSeconds = parseInt(hours, 10) * 3600 + parseInt(minutes, 10) * 60 + parseInt(sec, 10) + parseInt(ms, 10) / 1000;
  return Math.round(totalSeconds * 10); // Convert to frame index at 10 fps
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

async function createMetadataFile(id) {
    const metadataDir = path.join(os.homedir(), '.memesrc', 'processing', id);
    const metadataPath = path.join(metadataDir, '00_metadata.json');
    const metadataContent = {
        id: id,
        index_name: id,
        title: id
    };
    await fs.mkdir(metadataDir, { recursive: true }); // Ensure the directory exists
    await fs.writeFile(metadataPath, JSON.stringify(metadataContent, null, 2), 'utf-8'); // Write the JSON file
}


async function processDirectoryInternal(directoryPath, id) {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    let seasonEpisodes = [];

    for (let entry of entries) {
        const fullPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            const subDirectorySeasonEpisodes = await processDirectoryInternal(fullPath, id);
            seasonEpisodes.push(...subDirectorySeasonEpisodes);
        } else {
            const seasonEpisode = await extractSeasonEpisode(entry.name);
            if (seasonEpisode) {
                const fileType = getFileType(entry.name);
                if (fileType === 'subtitle') {
                    const captions = await parseSRT(fullPath);
                    await writeCaptionsAsCSV(captions, seasonEpisode.season, seasonEpisode.episode, id);
                } else if (fileType === 'media') {
                    await splitMediaFileIntoSegments(fullPath, id, seasonEpisode.season, seasonEpisode.episode);
                }
                if (fileType) {
                    seasonEpisodes.push({ ...seasonEpisode, type: fileType, path: fullPath });
                }
            }
        }
    }

    return seasonEpisodes;
}

async function processDirectory(directoryPath, id) {
    try {
        console.log("ID: ", id);
        await createMetadataFile(id); // Create metadata file
        const seasonEpisodes = await processDirectoryInternal(directoryPath, id);
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
