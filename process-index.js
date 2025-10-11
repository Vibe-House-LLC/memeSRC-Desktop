// process-index.js

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const ffmpeg = require('ffmpeg-static');
const archiver = require('archiver');
const { exec } = require('child_process');
const { parse, stringify } = require('subtitle')
const sanitizeHtml = require('sanitize-html');

const mediaExtensions = new Set(['.mp4', '.mkv', '.avi', '.mov', '.m4v']);
const subtitleExtensions = new Set(['.srt']);

let ffprobePath = 'ffprobe';
try {
    // Optional dependency; falls back to system ffprobe when not available
    ffprobePath = require('ffprobe-static').path || ffprobePath;
} catch (err) {
    // Continue with default ffprobe path
}

const trackedChildProcesses = new Set();
const MIN_SUBTITLE_FILE_SIZE = 100;

function shellQuote(value) {
    if (typeof value !== 'string') {
        return value;
    }
    return `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
}

function trackChild(childProcess) {
    if (!childProcess) {
        return;
    }
    trackedChildProcesses.add(childProcess);
    const cleanup = () => {
        trackedChildProcesses.delete(childProcess);
    };
    childProcess.on('exit', cleanup);
    childProcess.on('close', cleanup);
    childProcess.on('error', cleanup);
}

function execWithTracking(command, options = {}) {
    return new Promise((resolve, reject) => {
        const child = exec(command, options, (error, stdout, stderr) => {
            if (error) {
                error.stdout = stdout;
                error.stderr = stderr;
                return reject(error);
            }
            resolve({ stdout, stderr });
        });
        trackChild(child);
    });
}

function terminateProcessingChildren(signal = 'SIGTERM') {
    trackedChildProcesses.forEach((child) => {
        if (child.killed) {
            return;
        }
        try {
            child.kill(signal);
        } catch (killError) {
            console.warn(`Failed to send ${signal} to process ${child.pid}:`, killError);
        }
    });
}

// Encode text to base64
function encodeBase64(text) {
    return Buffer.from(text, 'utf-8').toString('base64');
}

async function ensureMemesrcDir(id, season = '', episode = '') {
    const memesrcDir = path.join(os.homedir(), '.memesrc', 'processing', id, season, episode);
    await fsp.mkdir(memesrcDir, { recursive: true });
    return memesrcDir;
}

function getEpisodeKey(season, episode) {
    return `${season}-${episode}`;
}

async function isValidSubtitleFile(filePath) {
    try {
        const stats = await fsp.stat(filePath);
        return stats.size >= MIN_SUBTITLE_FILE_SIZE;
    } catch (err) {
        return false;
    }
}

async function probeSubtitleStreams(filePath) {
    const command = `${shellQuote(ffprobePath)} -v error -of json -show_streams ${shellQuote(filePath)}`;
    try {
        const { stdout } = await execWithTracking(command);
        const result = stdout ? JSON.parse(stdout) : {};
        return Array.isArray(result.streams) ? result.streams.filter(stream => stream.codec_type === 'subtitle') : [];
    } catch (error) {
        try {
            if (error && error.stdout) {
                const parsed = JSON.parse(error.stdout);
                return Array.isArray(parsed.streams) ? parsed.streams.filter(stream => stream.codec_type === 'subtitle') : [];
            }
        } catch (parseError) {
            // Ignore parse errors and fall through
        }
        console.warn(`Failed to probe subtitle streams for ${filePath}: ${error.stderr || error.message}`);
        return [];
    }
}

async function extractSubtitleTrack(filePath, streamIndex, outputPath, convertToSrt = true) {
    const codecOption = convertToSrt ? '-c:s srt' : '-c:s copy';
    const command = `${shellQuote(ffmpeg)} -y -i ${shellQuote(filePath)} -map 0:${streamIndex} ${codecOption} ${shellQuote(outputPath)}`;
    try {
        await execWithTracking(command);
        return await isValidSubtitleFile(outputPath);
    } catch (error) {
        if (error.stderr) {
            console.warn(`ffmpeg subtitle extract error: ${error.stderr}`);
        }
        return false;
    }
}

async function convertAssToSrt(assPath, srtPath) {
    const command = `${shellQuote(ffmpeg)} -y -i ${shellQuote(assPath)} -c:s srt ${shellQuote(srtPath)}`;
    try {
        await execWithTracking(command);
        return await isValidSubtitleFile(srtPath);
    } catch (error) {
        if (error.stderr) {
            console.warn(`ffmpeg ASS->SRT conversion error: ${error.stderr}`);
        }
        return false;
    }
}

async function extractSubtitlesFromMedia(filePath, id, season, episode) {
    const streams = await probeSubtitleStreams(filePath);
    if (!streams.length) {
        console.warn(`No subtitle streams detected for ${filePath}`);
        return null;
    }

    const prioritizedStream = streams.find(stream => {
        const language = (stream.tags && stream.tags.language) ? stream.tags.language.toLowerCase() : '';
        return language === 'eng';
    }) || streams[0];

    const streamIndex = prioritizedStream.index;
    const codecName = prioritizedStream.codec_name || '';

    const episodeDir = await ensureMemesrcDir(id, `${season}`, `${episode}`);
    const baseName = `${season}-${episode}`;
    const srtPath = path.join(episodeDir, `${baseName}.srt`);
    const assPath = path.join(episodeDir, `${baseName}.ass`);

    const srtExtracted = await extractSubtitleTrack(filePath, streamIndex, srtPath, true);
    if (srtExtracted) {
        return srtPath;
    }

    if (codecName === 'ass') {
        const assExtracted = await extractSubtitleTrack(filePath, streamIndex, assPath, false);
        if (assExtracted) {
            const converted = await convertAssToSrt(assPath, srtPath);
            await fsp.unlink(assPath).catch(() => {});
            if (converted) {
                return srtPath;
            }
        }
    }

    console.warn(`Failed to extract usable subtitles for Season ${season}, Episode ${episode} from ${filePath}`);
    return null;
}

async function captionsAlreadyProcessed(id, season, episode) {
    const episodeDir = path.join(os.homedir(), '.memesrc', 'processing', id, `${season}`, `${episode}`);
    const csvPath = path.join(episodeDir, '_docs.csv');
    try {
        const stats = await fsp.stat(csvPath);
        return stats.size > 0;
    } catch (err) {
        return false;
    }
}

async function ensureSubtitlesFromMedia(directoryPath, id, processedSubtitles) {
    const entries = await fsp.readdir(directoryPath, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            await ensureSubtitlesFromMedia(fullPath, id, processedSubtitles);
            continue;
        }

        const fileType = getFileType(entry.name);
        if (fileType !== 'media') {
            continue;
        }

        const seasonEpisode = await extractSeasonEpisode(entry.name);
        if (!seasonEpisode) {
            continue;
        }

        const { season, episode } = seasonEpisode;
        const episodeKey = getEpisodeKey(season, episode);

        if (processedSubtitles.has(episodeKey)) {
            continue;
        }

        if (await captionsAlreadyProcessed(id, season, episode)) {
            processedSubtitles.add(episodeKey);
            continue;
        }

        try {
            const srtPath = await extractSubtitlesFromMedia(fullPath, id, season, episode);
            if (!srtPath) {
                continue;
            }

            const captions = await parseSRT(srtPath);
            if (captions.length) {
                await writeCaptionsAsCSV(captions, season, episode, id);
                processedSubtitles.add(episodeKey);
            } else {
                console.warn(`No cues detected in extracted subtitles at ${srtPath}`);
            }
        } catch (error) {
            console.warn(`Failed to parse extracted subtitles for ${fullPath}: ${error.message}`);
        }
    }
}

async function parseSRT(filePath) {
    return new Promise((resolve, reject) => {
        const captions = [];
        fs.createReadStream(filePath)
            .pipe(parse())
            .on('data', node => {
                if (node.type === 'cue') {
                    const cleanedText = sanitizeHtml(node.data.text, {
                        allowedTags: [], // Allow no HTML tags
                        allowedAttributes: {}, // Allow no HTML attributes
                    }).trim();
                    
                    captions.push({
                        index: captions.length,
                        startTime: node.data.start,
                        endTime: node.data.end,
                        text: cleanedText
                    });
                }
            })
            .on('error', reject)
            .on('finish', () => resolve(captions));
    });
}

async function writeCaptionsAsCSV(captions, season, episode, id) {
    const csvFileName = `_docs.csv`;
    // Ensure directory for the episode
    const episodeDir = await ensureMemesrcDir(id, `${season}`, `${episode}`);
    const seasonDir = await ensureMemesrcDir(id, `${season}`); // Ensure directory for the season
    const seriesDir = await ensureMemesrcDir(id); // Ensure directory for the series
    
    // Filter out captions with blank startTime or endTime and map the rest
    const csvLines = captions.filter(({ startTime, endTime }) => startTime && endTime).map(({ index, startTime, endTime, text }) => {
        // Convert startTime and endTime to frame index (at 10 fps)
        const startFrame = timeToFrameIndex(startTime);
        const endFrame = timeToFrameIndex(endTime);
        return `${season},${episode},${index},${encodeBase64(text)},${startFrame},${endFrame}`;
    });

    // Proceed only if there are valid csvLines to write
    if (csvLines.length === 0) {
        console.log("No valid captions to write.");
        return; // Exit the function if no valid captions are available
    }

    const csvContent = csvLines.join('\n') + '\n'; // Prepare CSV content to append

    // Append to episode-specific CSV
    const episodeCSVPath = path.join(episodeDir, csvFileName);
    await appendToFileWithoutDuplicates(episodeCSVPath, csvContent, 'season,episode,subtitle_index,subtitle_text,start_frame,end_frame\n');

    // Append to season-level CSV
    const seasonCSVPath = path.join(seasonDir, csvFileName);
    await appendToFileWithoutDuplicates(seasonCSVPath, csvContent, 'season,episode,subtitle_index,subtitle_text,start_frame,end_frame\n');

    // Append to series-level CSV
    const seriesCSVPath = path.join(seriesDir, csvFileName);
    await appendToFileWithoutDuplicates(seriesCSVPath, csvContent, 'season,episode,subtitle_index,subtitle_text,start_frame,end_frame\n');
}

async function appendToFileWithoutDuplicates(filePath, content, headers) {
    try {
        const fileExists = await fsp.access(filePath).then(() => true).catch(() => false);
        let existingContent = '';

        if (fileExists) {
            existingContent = await fsp.readFile(filePath, 'utf-8');
        }

        const existingLines = existingContent.split('\n').filter(line => line.trim() !== '');
        const newLines = content.split('\n').filter(line => line.trim() !== '');
        const uniqueLines = [...new Set([...existingLines, ...newLines])];

        let outputContent = '';

        if (!fileExists || existingContent.trim() === '') {
            // Write the header row only if the file doesn't exist or is empty
            outputContent = headers;
        }

        outputContent += uniqueLines.join('\n') + '\n';

        await fsp.writeFile(filePath, outputContent, 'utf-8');
    } catch (error) {
        // If an error occurs, create the file with headers and content
        await fsp.writeFile(filePath, headers + content, 'utf-8');
    }
}

// New function to split media files into 25-second segments at 10 fps
async function splitMediaFileIntoSegments(filePath, id, season, episode) {
    const outputDir = await ensureMemesrcDir(id, season.toString(), episode.toString());
    const scaleAndFps = `fps=10,scale='min(iw\\,1280):2*trunc((min(iw\\,1280)/iw*ih)/2)'`;
    const crfValue = "-crf 31";
    const preset = "-preset fast";
    const segmentPattern = path.join(outputDir, '%d.mp4');
    const command = `${shellQuote(ffmpeg)} -i ${shellQuote(filePath)} -an -filter:v "${scaleAndFps}" ${crfValue} ${preset} -reset_timestamps 1 -sc_threshold 0 -g 5 -force_key_frames "expr:gte(t, n_forced * 5)" -profile:v high -pix_fmt yuv420p -segment_time 25 -f segment -y ${shellQuote(segmentPattern)}`;

    console.log("COMMAND: ", command)
    const { stdout, stderr } = await execWithTracking(command);
    if (stdout) {
        console.log(`ffmpeg stdout: ${stdout}`);
    }
    if (stderr) {
        console.error(`ffmpeg stderr: ${stderr}`);
    }
}

// Helper function to convert timecode to frame index
function timeToFrameIndex(milliseconds) {
    return Math.round(milliseconds / 100); // Convert milliseconds to frame index at 10 fps
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

async function createMetadataFile(id, title = "", description = "", frameCount = 10, colorMain = "", colorSecondary = "", emoji = "") {
    const metadataDir = path.join(os.homedir(), '.memesrc', 'processing', id);
    const metadataPath = path.join(metadataDir, '00_metadata.json');
    const metadataContent = {
        title: title,
        description: description,
        frameCount: frameCount,
        colorMain: colorMain,
        colorSecondary: colorSecondary,
        emoji: emoji
    };
    await fsp.mkdir(metadataDir, { recursive: true }); // Ensure the directory exists
    await fsp.writeFile(metadataPath, JSON.stringify(metadataContent, null, 2), 'utf-8'); // Write the JSON file
}

async function processMediaFiles(directoryPath, id, processedSubtitles, processedEpisodes = new Set()) {
    const entries = await fsp.readdir(directoryPath, { withFileTypes: true });
    let seasonEpisodes = [];

    for (let entry of entries) {
        const fullPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            const subDirectorySeasonEpisodes = await processMediaFiles(fullPath, id, processedSubtitles, processedEpisodes);
            seasonEpisodes.push(...subDirectorySeasonEpisodes);
        } else {
            const fileType = getFileType(entry.name);
            if (fileType === 'media') {
                const seasonEpisode = await extractSeasonEpisode(entry.name);
                if (seasonEpisode) {
                    const episodeKey = getEpisodeKey(seasonEpisode.season, seasonEpisode.episode);
                    if (processedEpisodes.has(episodeKey)) {
                        continue;
                    }

                    if (!processedSubtitles.has(episodeKey)) {
                        console.warn(`Skipping Season ${seasonEpisode.season}, Episode ${seasonEpisode.episode} - subtitles not available.`);
                        continue;
                    }
                    
                    // Skip processing with ffmpeg if it's already 'done' status
                    const status = await checkStatus(id, seasonEpisode.season, seasonEpisode.episode);
                    if (status === 'done') {
                        console.log(`Skipping Season ${seasonEpisode.season}, Episode ${seasonEpisode.episode} - already processed.`);
                        processedEpisodes.add(episodeKey);
                        continue; // Skip to the next file
                    }

                    await updateStatusFile(id, seasonEpisode.season, seasonEpisode.episode, 'indexing');

                    // First, split media files into segments
                    await splitMediaFileIntoSegments(fullPath, id, seasonEpisode.season, seasonEpisode.episode);

                    // Then, extract clips based on subtitles (now disabled)
                    await extractSubtitleClips(fullPath, id, seasonEpisode.season, seasonEpisode.episode);
                    
                    // Commented out: Zip up the subitle-based thumbnail vids
                    // const episodeDir = await ensureMemesrcDir(id, seasonEpisode.season.toString(), seasonEpisode.episode.toString());
                    // await zipVideoClips(episodeDir); // Zip the video clips

                    seasonEpisodes.push({ ...seasonEpisode, type: fileType, path: fullPath });

                    await updateStatusFile(id, seasonEpisode.season, seasonEpisode.episode, 'done'); // Update status to 'done' once processing is complete
                    processedEpisodes.add(episodeKey);
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
        // Commented out: const outputDir = await ensureMemesrcDir(id, season.toString(), episode.toString(), 'clips');

        // Process a single caption
        async function processCaption(caption, globalIndex) {
            // Commented out: await extractClipForSubtitle(filePath, caption.startFrame, caption.endFrame, outputDir, globalIndex);
            console.log(`Skipping clip extraction for caption ${globalIndex}`);
        }

        // Process captions in batches
        const promises = [];
        for (let i = 0; i < captions.length; i++) {
            promises.push(processCaption(captions[i], i));

            if (promises.length === 1 || i === captions.length - 1) {
                await Promise.all(promises);
                promises.length = 0; // Clear the array for the next batch
            }
        }
    } catch (error) {
        console.error(`Error extracting subtitle clips: ${error}`);
    }
}


async function processSubtitles(directoryPath, id, processedSubtitles) {
    const entries = await fsp.readdir(directoryPath, { withFileTypes: true });
    for (let entry of entries) {
        const fullPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            await processSubtitles(fullPath, id, processedSubtitles); // Recursive call for directories
        } else {
            const fileType = getFileType(entry.name);
            if (fileType === 'subtitle') {
                const seasonEpisode = await extractSeasonEpisode(entry.name);
                if (seasonEpisode) {
                    const episodeKey = getEpisodeKey(seasonEpisode.season, seasonEpisode.episode);
                    // Skip processing subtitles if it's already 'done' status
                    const status = await checkStatus(id, seasonEpisode.season, seasonEpisode.episode);
                    if (status === 'done') {
                        console.log(`Skipping Season ${seasonEpisode.season}, Episode ${seasonEpisode.episode} - already processed.`);
                        continue; // Skip to the next file
                    }
                    // Update the status to 'indexing' here, where season and episode are known
                    await updateStatusFile(id, seasonEpisode.season, seasonEpisode.episode, 'pending');
                    try {
                        const captions = await parseSRT(fullPath);
                        if (captions.length) {
                            await writeCaptionsAsCSV(captions, seasonEpisode.season, seasonEpisode.episode, id);
                            processedSubtitles.add(episodeKey);
                        } else {
                            console.warn(`No cues found in subtitle file: ${fullPath}`);
                        }
                    } catch (e) {
                        console.log(`WARNING: Skipped subtitle: ${fullPath}. Error: ${e}`)
                    }
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
    const scaleAndPad = `scale='min(iw*min(500/iw,500/ih),500)':'min(ih*min(500/iw,500/ih),500)':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2`;
    const fpsSetting = "fps=fps=10";
    const crfValue = "-crf 35";
    const preset = "-preset fast";
    
    // Assuming other variables (`ffmpeg`, `filePath`, `startTime`, `duration`, `outputFile`) are defined elsewhere in your code.
    const command = `${shellQuote(ffmpeg)} -ss ${startTime} -i ${shellQuote(filePath)} -filter:v "${fpsSetting},${scaleAndPad}" -t ${duration} -c:v libx264 -profile:v baseline -level 3.0 -pix_fmt yuv420p ${crfValue} ${preset} -an -y ${shellQuote(outputFile)}`;    
    
    // console.log("ABOUT TO RUN: ", command)

    const { stderr } = await execWithTracking(command);
    if (stderr) {
        console.error(`ffmpeg clip stderr: ${stderr}`);
    }
    return outputFile;
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

// Function to check the processing status of an episode
async function checkStatus(id, season, episode) {
    const statusFilePath = path.join(os.homedir(), '.memesrc', 'processing', id, 'status.json');
    try {
        const data = await fsp.readFile(statusFilePath, 'utf-8');
        const statusData = JSON.parse(data);
        if (statusData[season] && statusData[season][episode]) {
            return statusData[season][episode]; // Return the status ('pending', 'indexing', 'done')
        }
    } catch (error) {
        console.log("Status file does not exist or cannot be read. Assuming 'pending'.");
    }
    return 'pending'; // Default to 'pending' if no status found
}

async function collectEpisodeKeys(directoryPath, episodeKeys = new Set()) {
    const entries = await fsp.readdir(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            await collectEpisodeKeys(fullPath, episodeKeys);
            continue;
        }

        if (!getFileType(entry.name)) {
            continue;
        }

        const seasonEpisode = await extractSeasonEpisode(entry.name);
        if (seasonEpisode) {
            episodeKeys.add(getEpisodeKey(seasonEpisode.season, seasonEpisode.episode));
        }
    }
    return episodeKeys;
}

async function seedStatusFile(id, directoryPath) {
    const episodeKeys = await collectEpisodeKeys(directoryPath);
    if (!episodeKeys.size) {
        return;
    }

    const statusDir = path.join(os.homedir(), '.memesrc', 'processing', id);
    await fsp.mkdir(statusDir, { recursive: true });
    const statusFilePath = path.join(statusDir, 'status.json');

    let statusData = {};
    let writeNeeded = false;

    try {
        const data = await fsp.readFile(statusFilePath, 'utf-8');
        statusData = JSON.parse(data);
    } catch {
        writeNeeded = true;
    }

    episodeKeys.forEach((key) => {
        const [seasonRaw, episodeRaw] = key.split('-');
        const season = parseInt(seasonRaw, 10);
        const episode = parseInt(episodeRaw, 10);

        if (!statusData[season]) {
            statusData[season] = {};
        }

        if (!statusData[season][episode]) {
            statusData[season][episode] = 'pending';
            writeNeeded = true;
        }
    });

    if (writeNeeded) {
        await fsp.writeFile(statusFilePath, JSON.stringify(statusData, null, 2), 'utf-8');
    }
}

async function updateStatusFile(id, season, episode, status) {
    const statusFilePath = path.join(os.homedir(), '.memesrc', 'processing', id, 'status.json');
    let statusData = {};

    try {
        // Attempt to read the existing status file
        const data = await fsp.readFile(statusFilePath, 'utf-8');
        statusData = JSON.parse(data);
    } catch (error) {
        // If the file doesn't exist or there's an error, start with an empty object
        console.log("Status file does not exist or cannot be read. It will be created.");
    }

    // Update the status for the specific season and episode
    if (!statusData[season]) {
        statusData[season] = {};
    }
    statusData[season][episode] = status;

    // Write the updated status data back to the file
    await fsp.writeFile(statusFilePath, JSON.stringify(statusData, null, 2), 'utf-8');
}

async function processDirectory(directoryPath, id, title = "", description = "", frameCount = 10, colorMain = "", colorSecondary = "", emoji = "") {
    try {
        console.log("ID: ", id);
        await createMetadataFile(id, title, description, frameCount, colorMain, colorSecondary, emoji); // Updated call
        await seedStatusFile(id, directoryPath);
        
        // First, process all subtitles and collect their season-episode information
        const processedSubtitles = new Set();
        await processSubtitles(directoryPath, id, processedSubtitles);

        // Attempt to extract subtitles directly from media if standalone files were not found
        await ensureSubtitlesFromMedia(directoryPath, id, processedSubtitles);

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

module.exports = { processDirectory, terminateProcessingChildren };
