import os
import subprocess
import argparse
import yaml
import re
import csv
import base64
from pathlib import Path
import srt

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

def extract_season_episode(file_path):
    filename = os.path.basename(file_path)
    SE_pattern = 'S[0-9]+E[0-9]+|S[0-9]+\.E[0-9]+|[0-9]+x[0-9]+|[0-9]+\-[0-9]+'
    SE_match = re.findall(SE_pattern, filename, re.IGNORECASE)
    if SE_match:
        SE_nums = re.findall('[0-9]+', SE_match[0])
        return int(SE_nums[0]), int(SE_nums[1])

    parts = Path(file_path).parts
    if len(parts) >= 2 and parts[-2].isdigit() and parts[-1].isdigit():
        return int(parts[-2]), int(parts[-1])

    return 1, 1

def list_content_files():
    content_files = {"videos": [], "subtitles": []}
    valid_video_extensions = {".mp4", ".mkv", ".avi", ".mov"}
    valid_subtitle_extensions = {".srt"}

    for (dirpath, dirnames, filenames) in os.walk(input_path):
        for file in filenames:
            if any(file.endswith(ext) for ext in valid_video_extensions):
                content_files["videos"].append(os.path.join(dirpath, file))
            elif any(file.endswith(ext) for ext in valid_subtitle_extensions):
                content_files["subtitles"].append(os.path.join(dirpath, file))
    return content_files

def extract_video_clips(episode_file, clips_dir, fps=10, clip_duration=10):
    filename_prefix = f"%d"
    output_pattern = os.path.join(clips_dir, f"{filename_prefix}.mp4")    
    command = [FFMPEG_PATH, "-i", episode_file, "-vf", f"fps={fps}", "-c:v", "libx264", "-an", "-crf", "23", "-preset", "ultrafast",
               "-force_key_frames", f"expr:gte(t,n_forced*{clip_duration})", "-map", "0", "-segment_time", str(clip_duration),
               "-f", "segment", "-reset_timestamps", "1", output_pattern]
    subprocess.run(command)

def ensure_dir_exists(directory):
    if not os.path.exists(directory):
        os.makedirs(directory)

# ==================
# SUBTITLE HANDLING
# ==================

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

def get_frame_index(time_delta, fps):
    starting_index = int(time_delta.total_seconds() * fps) - 1  # Adjust for zero-indexing
    return starting_index

def process_episode(episode_file, frames_base_dir, content_files, fps=10, clip_duration=10):
    season_num, episode_num = extract_season_episode(episode_file)
    season_dir = os.path.join(frames_base_dir, str(season_num))
    ensure_dir_exists(season_dir)

    episode_dir = os.path.join(season_dir, str(episode_num))
    ensure_dir_exists(episode_dir)

    extract_video_clips(episode_file, episode_dir, fps, clip_duration)

    # New subtitle handling code
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

def process_content(input_path_param, index_name, fps=10, clip_duration=30):
    set_input_path(input_path_param)
    frames_base_dir = get_frames_dir(index_name)
    ensure_dir_exists(frames_base_dir)

    content_files = list_content_files()
    for episode_file in content_files["videos"]:
        process_episode(episode_file, frames_base_dir, content_files, fps, clip_duration)

    # Process CSV data for subtitles at the end, if subtitles were found and processed
    for season_dir in os.listdir(frames_base_dir):
        season_path = os.path.join(frames_base_dir, season_dir)
        if os.path.isdir(season_path):
            season_data = aggregate_csv_data(season_path)
            write_aggregated_csv(season_data, os.path.join(season_path, '_docs.csv'))
    top_level_data = aggregate_csv_data(frames_base_dir)
    write_aggregated_csv(top_level_data, os.path.join(frames_base_dir, '_docs.csv'))

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Process video content into clips and index subtitles.')
    parser.add_argument('input_path', help='Input path of the videos and subtitles')
    parser.add_argument('--fps', type=int, default=10, help='Frames per second for the output clips')
    parser.add_argument('--clip_duration', type=int, default=10, help='Duration of each clip in seconds')
    args = parser.parse_args()

    index_name_cli = input("Enter the name for the index: ")
    process_content(args.input_path, index_name_cli, args.fps, args.clip_duration)
