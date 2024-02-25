const fs = require('fs').promises;
const path = require('path');
const os = require('os');

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
  const memesrcDir = await ensureMemesrcDir(id, `${season}`, `${episode}`); // Ensure directory with season and episode
  const csvLines = captions.map(({ index, startTime, endTime, text }) => {
      // Convert startTime and endTime to frame index (at 10 fps)
      const startFrame = timeToFrameIndex(startTime);
      const endFrame = timeToFrameIndex(endTime);
      return `${season},${episode},${index},"${encodeBase64(text)}",${startFrame},${endFrame}`;
  });
  const csvContent = 'season,episode,subtitle_index,subtitle_text,start_frame,end_frame\n' + csvLines.join('\n');
  const finalOutputPath = path.join(memesrcDir, csvFileName); // Use the updated directory path
  await fs.writeFile(finalOutputPath, csvContent, 'utf-8');
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
