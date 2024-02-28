const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const ffmpeg = require('ffmpeg-static');
const archiver = require('archiver');
const { exec } = require('child_process');

const mediaExtensions = new Set(['.mp4', '.mkv', '.avi', '.mov']);
const subtitleExtensions = new Set(['.srt']);

// Encode text to base64
function encodeBase64(text) {
    return Buffer.from(text, 'utf-8').toString('base64');
}

async function ensureMemesrcDir(id, season = '', episode = '') {
    const memesrcDir = path.join(os.homedir(), '.memesrc', 'processing', id, season, episode);
    await fsp.mkdir(memesrcDir, { recursive: true });
    return memesrcDir;
}

async function parseSRT(filePath) {
    const content = await fsp.readFile(filePath, 'utf-8');
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
        return `${season},${episode},${index},${encodeBase64(text)},${startFrame},${endFrame}`;
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
        await fsp.access(filePath); // Check if file exists
        await fsp.appendFile(filePath, content, 'utf-8'); // Append if it exists
    } catch (error) {
        // If file does not exist, create it with headers
        await fsp.writeFile(filePath, headers + content, 'utf-8');
    }
}

// New function to split media files into 25-second segments at 10 fps
async function splitMediaFileIntoSegments(filePath, id, season, episode) {
    const outputDir = await ensureMemesrcDir(id, season.toString(), episode.toString());
    const command = `${ffmpeg} -i "${filePath}" -an -filter:v fps=fps=10 -segment_time 00:00:25 -f segment -c:v libx264 -reset_timestamps 1 "${outputDir}/%d.mp4"`;

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
    await fsp.mkdir(metadataDir, { recursive: true }); // Ensure the directory exists
    await fsp.writeFile(metadataPath, JSON.stringify(metadataContent, null, 2), 'utf-8'); // Write the JSON file
}

async function processMediaFiles(directoryPath, id, processedSubtitles) {
    const entries = await fsp.readdir(directoryPath, { withFileTypes: true });
    let seasonEpisodes = [];

    for (let entry of entries) {
        const fullPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            const subDirectorySeasonEpisodes = await processMediaFiles(fullPath, id, processedSubtitles);
            seasonEpisodes.push(...subDirectorySeasonEpisodes);
        } else {
            const fileType = getFileType(entry.name);
            if (fileType === 'media') {
                const seasonEpisode = await extractSeasonEpisode(entry.name);
                if (seasonEpisode && !processedSubtitles.has(`${seasonEpisode.season}-${seasonEpisode.episode}`)) {


                    // Then, extract clips based on subtitles
                    await extractSubtitleClips(fullPath, id, seasonEpisode.season, seasonEpisode.episode);
                    
                    // Zip up the subitle-based thumbnail vids
                    const episodeDir = await ensureMemesrcDir(id, seasonEpisode.season.toString(), seasonEpisode.episode.toString());
                    await zipVideoClips(episodeDir); // Zip the video clips

                    // First, split media files into segments
                    await splitMediaFileIntoSegments(fullPath, id, seasonEpisode.season, seasonEpisode.episode);

                    seasonEpisodes.push({ ...seasonEpisode, type: fileType, path: fullPath });
                }
            }
        }
    }

    return seasonEpisodes;
}

async function extractSubtitleClips(filePath, id, season, episode) {
    const episodeDir = await ensureMemesrcDir(id, season.toString(), episode.toString());
    const csvFilePath = path.join(episodeDir, '_docs.csv');
    try {
        const captions = await readCaptionsFromCSV(csvFilePath);
        const outputDir = await ensureMemesrcDir(id, season.toString(), episode.toString(), 'clips');

        // Process a single caption
        async function processCaption(caption, globalIndex) {
            // Corrected filename format here
            await extractClipForSubtitle(filePath, caption.startFrame, caption.endFrame, outputDir, globalIndex);
        }

        // Process captions in batches
        const promises = [];
        for (let i = 0; i < captions.length; i++) {
            promises.push(processCaption(captions[i], i));

            if (promises.length === 5 || i === captions.length - 1) {
                await Promise.all(promises);
                promises.length = 0; // Clear the array for the next batch
            }
        }
    } catch (error) {
        console.error(`Error extracting subtitle clips: ${error}`);
    }
}


async function processSubtitles(directoryPath, id) {
    const entries = await fsp.readdir(directoryPath, { withFileTypes: true });
    for (let entry of entries) {
        const fullPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            await processSubtitles(fullPath, id); // Recursive call for directories
        } else {
            const fileType = getFileType(entry.name);
            if (fileType === 'subtitle') {
                const seasonEpisode = await extractSeasonEpisode(entry.name);
                if (seasonEpisode) {
                    const captions = await parseSRT(fullPath);
                    await writeCaptionsAsCSV(captions, seasonEpisode.season, seasonEpisode.episode, id);
                }
            }
        }
    }
}

async function readCaptionsFromCSV(csvFilePath) {
    const content = await fsp.readFile(csvFilePath, 'utf-8');
    const lines = content.split('\n').filter(line => line && !line.startsWith('season')); // Skip header and empty lines
    const captions = lines.map(line => {
        const [season, episode, subtitleIndex, encodedText, startFrame, endFrame] = line.split(',');
        return {
            season,
            episode,
            subtitleIndex,
            text: Buffer.from(encodedText, 'base64').toString('utf-8'), // Decode base64 text
            startFrame: parseInt(startFrame, 10),
            endFrame: parseInt(endFrame, 10)
        };
    });
    return captions;
}

function frameToTime(frame) {
    const seconds = frame / 10;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds - (hours * 3600)) / 60);
    const secs = seconds - (hours * 3600) - (minutes * 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toFixed(3).padStart(6, '0')}`;
}

async function extractClipForSubtitle(filePath, startFrame, endFrame, outputDir, clipIndex) {
    const startTime = frameToTime(startFrame);
    const endTime = frameToTime(endFrame);
    const duration = (endFrame - startFrame) / 10;

    const outputFile = path.join(outputDir, `s${clipIndex}.mp4`);
    const command = `${ffmpeg} -i "${filePath}" -filter:v fps=fps=10 -ss ${startTime} -t ${duration} -c:v libx264 "${outputFile}"`;
    // console.log("ABOUT TO RUN: ", command)

    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`exec error: ${error}`);
                return reject(error);
            }
            resolve(outputFile);
        });
    });
}

async function zipVideoClips(clipsDir) {
    const files = await fsp.readdir(clipsDir);

    // Group files by their index
    const zipGroups = {};
    files.forEach(file => {
        console.log("Testing file for zipping: ", file)
        if (file.endsWith(".mp4") && file.startsWith("s")) {
            console.log("Passed the test for zipping: ", file)
            const number = parseInt(file.substring(1, file.length - 4));
            if (!isNaN(number)) {
                const groupNumber = Math.floor(number / 15);
                if (!zipGroups[groupNumber]) {
                    zipGroups[groupNumber] = [];
                }
                zipGroups[groupNumber].push(file);
            }
        }
    });

    // Create a zip file for each group
    for (const [groupNumber, filenames] of Object.entries(zipGroups)) {
        const zipFilename = `${clipsDir}/s${groupNumber}.zip`;
        const output = fs.createWriteStream(zipFilename);
        const archive = archiver('zip', {
            zlib: { level: 9 } // Sets the compression level.
        });

        output.on('close', function() {
            console.log(archive.pointer() + ' total bytes');
            console.log('Archiver has been finalized and the output file descriptor has closed.');
        });

        archive.on('error', function(err) {
            throw err;
        });

        archive.pipe(output);

        filenames.forEach(filename => {
            archive.file(`${clipsDir}/${filename}`, { name: filename });
        });

        await archive.finalize();

        // Optionally, delete the original mp4 files after zipping
        await Promise.all(filenames.map(async filename => {
            await fsp.unlink(`${clipsDir}/${filename}`);
        }));
    }
}

async function processDirectory(directoryPath, id) {
    try {
        console.log("ID: ", id);
        await createMetadataFile(id); // Create metadata file
        
        // First, process all subtitles and collect their season-episode information
        const processedSubtitles = new Set();
        await processSubtitles(directoryPath, id, processedSubtitles);

        // Now, process media files only after subtitles are processed
        const seasonEpisodes = await processMediaFiles(directoryPath, id, processedSubtitles);

        // Summarize the processing results
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
        console.error('Error processing directory:', err);
        throw err;
    }
}

module.exports = { processDirectory };
