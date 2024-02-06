import os
import sys
import csv
import re
import base64
import zipfile
import subprocess
import argparse
import yaml
import srt
from pathlib import Path

# Load configuration
with open(os.path.expanduser('~/.memesrc/config.yml'), 'r') as ymlfile:
    cfg = yaml.safe_load(ymlfile)

def get_frames_dir(name):
    return os.path.join(os.path.expanduser(f"~/.memesrc/processing/{name}"))

# Define the paths from the config file
FFMPEG_PATH = cfg['ffmpeg_path']

def set_input_path(path):
    global input_path
    input_path = path

def get_frame_index(time_delta, fps):
    starting_index = int(time_delta.total_seconds() * fps) - 1  # Adjust for zero-indexing
    return starting_index

def extract_all_frames(episode_file, frames_dir, fps=10):
    subprocess.run([FFMPEG_PATH, "-i", episode_file, "-r", str(fps), "-qscale:v", "5", 
                    "-start_number", "0",
                    os.path.join(frames_dir, "%09d.jpg")])

def extract_season_episode(file_path):
    # Attempt to extract from filename
    filename = os.path.basename(file_path)
    SE_pattern = 'S[0-9]+E[0-9]+|S[0-9]+\.E[0-9]+|[0-9]+x[0-9]+|[0-9]+\-[0-9]+'
    SE_match = re.findall(SE_pattern, filename, re.IGNORECASE)
    if SE_match:
        SE_nums = re.findall('[0-9]+', SE_match[0])
        return int(SE_nums[0]), int(SE_nums[1])

    # Attempt to extract from directory path
    parts = Path(file_path).parts
    if len(parts) >= 2 and parts[-2].isdigit() and parts[-1].isdigit():
        return int(parts[-2]), int(parts[-1])

    # Default to season 1, episode 1 for files with no clear season/episode info
    return 1, 1

def list_content_files():
    content_files = {
        "videos": [],
        "subtitles": []
    }
    valid_video_extensions = {".mp4", ".mkv", ".avi", ".mov"}
    valid_subtitle_extensions = {".srt"}

    for (dirpath, dirnames, filenames) in os.walk(input_path):
        for file in filenames:
            if any(file.endswith(ext) for ext in valid_video_extensions):
                content_files["videos"].append(os.path.join(dirpath, file))
            elif any(file.endswith(ext) for ext in valid_subtitle_extensions):
                content_files["subtitles"].append(os.path.join(dirpath, file))
    return content_files

def zip_thumbnails(frames_dir, batch_size=10):
    # Identify all thumbnails by their naming convention
    thumbnail_files = sorted(f for f in os.listdir(frames_dir) if f.startswith('t') and f.endswith('.jpg'))
    
    # Zip thumbnails in batches
    for i in range(0, len(thumbnail_files), batch_size):
        batch_files = thumbnail_files[i:i+batch_size]
        batch_index = i // batch_size
        zip_file_path = os.path.join(frames_dir, f"thumbnails_{batch_index}.zip")
        with zipfile.ZipFile(zip_file_path, 'w') as zipf:
            for file in batch_files:
                file_path = os.path.join(frames_dir, file)
                zipf.write(file_path, file)
                os.remove(file_path)  # Remove the original jpg file after zipping

def create_zip_files_for_frames(frames_dir, fps=10, batch_size=100):
    frame_files = sorted(f for f in os.listdir(frames_dir) if f.endswith('.jpg'))
    thumbnails = set(frame_files[::fps])

    for i in range(0, len(frame_files), batch_size):
        batch_files = frame_files[i:i+batch_size]
        batch_index = i // batch_size
        zip_file_path = os.path.join(frames_dir, f"b{batch_index}.zip")
        with zipfile.ZipFile(zip_file_path, 'w') as zipf:
            for file in batch_files:
                file_path = os.path.join(frames_dir, file)
                zipf.write(file_path, file)
                if file not in thumbnails:
                    os.remove(file_path)

    for i, thumbnail in enumerate(sorted(thumbnails)):
        old_path = os.path.join(frames_dir, thumbnail)
        new_name = f"t{i}.jpg"
        new_path = os.path.join(frames_dir, new_name)
        os.rename(old_path, new_path)

def parse_srt(srt_file):
    with open(srt_file, 'r', encoding='utf-8') as f:
        subtitles = list(srt.parse(f.read()))
    return subtitles

def find_matching_subtitle(episode_file, subtitles, season_num, episode_num):
    for subtitle_file in subtitles:
        subtitle_season, subtitle_episode = extract_season_episode(subtitle_file)
        if (season_num, episode_num) == (subtitle_season, subtitle_episode):
            return subtitle_file
    return None

def process_episode(episode_file, frames_base_dir, content_files, fps=10, batch_size=100):
    season_num, episode_num = extract_season_episode(episode_file)
    season_dir = os.path.join(frames_base_dir, str(season_num))
    os.makedirs(season_dir, exist_ok=True)

    episode_dir = os.path.join(season_dir, str(episode_num))
    os.makedirs(episode_dir, exist_ok=True)

    extract_all_frames(episode_file, episode_dir)

    create_zip_files_for_frames(episode_dir, fps, batch_size)
    zip_thumbnails(episode_dir, batch_size=10)

    matching_subtitle = find_matching_subtitle(episode_file, content_files["subtitles"], season_num, episode_num)

    if matching_subtitle:
        subtitles = parse_srt(matching_subtitle)
        csv_path = os.path.join(episode_dir, "_docs.csv")
        with open(csv_path, 'w', newline='', encoding='utf-8') as csvfile:
            fieldnames = ['season', 'episode', 'subtitle_index', 'subtitle_text', 'start_frame', 'end_frame']
            csv_writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
            csv_writer.writeheader()
            for index, subtitle in enumerate(subtitles):
                start_index = get_frame_index(subtitle.start, fps)
                end_index = get_frame_index(subtitle.end, fps)

                encoded_subtitle = base64.b64encode(subtitle.content.encode()).decode()
                csv_writer.writerow({
                    "season": season_num,
                    "episode": episode_num,
                    "subtitle_index": index,
                    "subtitle_text": encoded_subtitle,
                    "start_frame": start_index,
                    "end_frame": end_index
                })

def aggregate_csv_data(directory):
    aggregated_data = []
    unique_keys = set()  # Set to store unique (season, episode, subtitle_index) tuples

    for subdir, dirs, files in os.walk(directory):
        for file in files:
            if file.endswith('_docs.csv'):
                with open(os.path.join(subdir, file), 'r', encoding='utf-8') as csvfile:
                    csv_reader = csv.DictReader(csvfile)
                    for row in csv_reader:
                        # Create a unique key for each row
                        key = (row['season'], row['episode'], row['subtitle_index'])
                        if key not in unique_keys:
                            unique_keys.add(key)
                            aggregated_data.append(row)
    return aggregated_data

def write_aggregated_csv(data, path):
    if data:
        with open(path, 'w', newline='', encoding='utf-8') as csvfile:
            fieldnames = ['season', 'episode', 'subtitle_index', 'subtitle_text', 'start_frame', 'end_frame']
            csv_writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
            csv_writer.writeheader()
            for row in data:
                csv_writer.writerow(row)

def ensure_dir_exists(directory):
    if not os.path.exists(directory):
        os.makedirs(directory)

def process_content(input_path_param, index_name, subtitles_only=False):
    set_input_path(input_path_param)
    frames_base_dir = get_frames_dir(index_name)
    ensure_dir_exists(frames_base_dir)

    content_files = list_content_files()
    is_single_file = len(content_files["videos"]) == 1

    if not subtitles_only:
        for episode_file in content_files["videos"]:
            process_episode(episode_file, frames_base_dir, content_files)

    for season_dir in os.listdir(frames_base_dir):
        season_path = os.path.join(frames_base_dir, season_dir)
        if os.path.isdir(season_path):
            season_data = aggregate_csv_data(season_path)
            write_aggregated_csv(season_data, os.path.join(season_path, '_docs.csv'))
    top_level_data = aggregate_csv_data(frames_base_dir)
    write_aggregated_csv(top_level_data, os.path.join(frames_base_dir, '_docs.csv'))

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Process video content.')
    parser.add_argument('input_path', help='Input path of the videos and subtitles')
    parser.add_argument('--subtitles-only', action='store_true', help='Process subtitles only, skip image extraction')
    args = parser.parse_args()

    index_name_cli = input("Enter the name for the index: ")
    process_content(args.input_path, index_name_cli, args.subtitles_only)
