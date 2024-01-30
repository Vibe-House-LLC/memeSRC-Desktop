import os
import sys
import csv
import re
import base64
import zipfile
import subprocess
import yaml
import srt
from pathlib import Path

# Load configuration
with open(os.path.expanduser('~/.memesrc/config.yml'), 'r') as ymlfile:
    cfg = yaml.safe_load(ymlfile)

# Define the paths from the config file
FFMPEG_PATH = cfg['ffmpeg_path']

def set_input_path(path):
    global input_path
    input_path = path

def get_frames_dir(name):
    return os.path.join(os.path.expanduser(f"~/.memesrc/{name}/processed"))

def get_frame_index(time_delta, fps):
    return int(time_delta.total_seconds() * fps)

def extract_all_frames(episode_file, frames_dir, fps=10):
    subprocess.run([FFMPEG_PATH, "-i", episode_file, "-r", str(fps), "-qscale:v", "5", 
                    "-start_number", "0",
                    os.path.join(frames_dir, "%09d.jpg")])

def extract_season_episode(episode_file):
    SE_pattern = 'S[0-9]+\.E[0-9]+|S[0-9]+E[0-9]+|[0-9]+x[0-9]+|S[0-9]+E[0-9]+|[0-9]+\-[0-9]+'
    SE_str = re.findall(SE_pattern, episode_file, re.IGNORECASE)[-1]
    SE_nums = re.findall('[0-9]+', SE_str)
    season_num = int(SE_nums[0])
    episode_num = int(SE_nums[1])
    return (season_num, episode_num)

def extract_season_episode_from_path(path):
    parts = Path(path).parts
    season_num, episode_num = None, None

    # Assuming the last two parts are season and episode numbers respectively
    if len(parts) >= 2:
        season_num = parts[-2].isdigit() and int(parts[-2]) or None
        episode_num = parts[-1].isdigit() and int(parts[-1]) or None

    return season_num, episode_num

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

    # Thumbnail renaming without zero padding
    for i, thumbnail in enumerate(sorted(thumbnails)):
        old_path = os.path.join(frames_dir, thumbnail)
        new_name = f"t{i}.jpg"
        new_path = os.path.join(frames_dir, new_name)
        os.rename(old_path, new_path)

def parse_srt(srt_file):
    with open(srt_file, 'r', encoding='utf-8') as f:
        subtitles = list(srt.parse(f.read()))
    return subtitles

def find_matching_subtitle(episode_file, subtitles):
    episode_season_episode = extract_season_episode(episode_file)
    for subtitle_file in subtitles:
        subtitle_season_episode = extract_season_episode(subtitle_file)
        if episode_season_episode == subtitle_season_episode:
            return subtitle_file
    return None

def calculate_related_files(start_index, end_index, fps, batch_size):
    thumbnails = [f"t{i}.jpg" for i in range(start_index // fps, end_index // fps + 1)]
    bundles = [f"b{i}.zip" for i in range(start_index // batch_size, end_index // batch_size + 1)]
    start_frame = start_index
    end_frame = end_index
    return thumbnails, bundles, start_frame, end_frame

def process_episode(episode_file, frames_base_dir, content_files, fps=10, batch_size=100):
    season_num, episode_num = extract_season_episode(episode_file)
    season_dir = os.path.join(frames_base_dir, str(season_num))
    os.makedirs(season_dir, exist_ok=True)

    episode_dir = os.path.join(season_dir, str(episode_num))
    os.makedirs(episode_dir, exist_ok=True)

    extract_all_frames(episode_file, episode_dir)

    create_zip_files_for_frames(episode_dir, fps, batch_size)

    matching_subtitle = find_matching_subtitle(episode_file, content_files["subtitles"])
    if matching_subtitle:
        subtitles = parse_srt(matching_subtitle)
        csv_path = os.path.join(episode_dir, "_docs.csv")
        with open(csv_path, 'w', newline='', encoding='utf-8') as csvfile:
            fieldnames = ['subtitle_index', 'subtitle_text', 'start_frame', 'end_frame']
            csv_writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
            csv_writer.writeheader()
            for index, subtitle in enumerate(subtitles):
                start_index = get_frame_index(subtitle.start, fps)
                end_index = get_frame_index(subtitle.end, fps)

                encoded_subtitle = base64.b64encode(subtitle.content.encode()).decode()
                csv_writer.writerow({
                    "subtitle_index": index,
                    "subtitle_text": encoded_subtitle,
                    "start_frame": start_index,
                    "end_frame": end_index
                })

def aggregate_csv_data(directory):
    aggregated_data = []
    for subdir, dirs, files in os.walk(directory):
        season_num, episode_num = extract_season_episode_from_path(subdir)
        for file in files:
            if file.endswith('_docs.csv'):
                with open(os.path.join(subdir, file), 'r', encoding='utf-8') as csvfile:
                    csv_reader = csv.DictReader(csvfile)
                    for row in csv_reader:
                        if season_num is not None:
                            row['season'] = season_num
                        if episode_num is not None:
                            row['episode'] = episode_num
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

def process_content(input_path_param, index_name):
    set_input_path(input_path_param)
    frames_base_dir = get_frames_dir(index_name)
    ensure_dir_exists(frames_base_dir)

    content_files = list_content_files()

    for episode_file in content_files["videos"]:
        process_episode(episode_file, frames_base_dir, content_files)

    # Aggregate and write CSV data for each season
    for season_dir in os.listdir(frames_base_dir):
        season_path = os.path.join(frames_base_dir, season_dir)
        if os.path.isdir(season_path):
            season_data = aggregate_csv_data(season_path)
            write_aggregated_csv(season_data, os.path.join(season_path, '_docs.csv'))

    # Aggregate and write CSV data for top level
    top_level_data = aggregate_csv_data(frames_base_dir)
    write_aggregated_csv(top_level_data, os.path.join(frames_base_dir, '_docs.csv'))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: ingest.py [input path]")
        sys.exit(1)
    input_path_cli = sys.argv[1]
    index_name_cli = input("Enter the name for the index: ")
    process_content(input_path_cli, index_name_cli)
