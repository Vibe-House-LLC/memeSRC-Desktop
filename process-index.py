import os
import sys
import csv
import json
import re
import zipfile
from pathlib import Path
import subprocess
import yaml

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

def get_timecode_str(time_delta):
    total_seconds = int(time_delta.total_seconds())
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    seconds = total_seconds % 60
    milliseconds = int(time_delta.microseconds / 1000)
    return f"{hours:02}:{minutes:02}:{seconds:02}.{milliseconds:03}"

def extract_all_frames(episode_file, frames_dir, frame_prefix, fps=9):
    subprocess.run([FFMPEG_PATH, "-i", episode_file, "-r", str(fps), "-qscale:v", "5", 
                    f"{frames_dir}/{frame_prefix}%06d.jpg"])

def extract_season_episode(episode_file):
    SE_pattern = 'S[0-9]+\.E[0-9]+|S[0-9]+E[0-9]+|[0-9]+x[0-9]+|S[0-9]+E[0-9]+|[0-9]+\-[0-9]+'
    SE_str = re.findall(SE_pattern, episode_file, re.IGNORECASE)[-1]
    SE_nums = re.findall('[0-9]+', SE_str)
    season_num = int(SE_nums[0])
    episode_num = int(SE_nums[1])
    return (season_num, episode_num)

def list_content_files():
    content_files = {
        "videos": []
    }
    valid_video_extensions = {".mp4", ".mkv", ".avi", ".mov"}

    for (dirpath, dirnames, filenames) in os.walk(input_path):
        for file in filenames:
            if any(file.endswith(ext) for ext in valid_video_extensions):
                content_files["videos"].append(os.path.join(dirpath, file))
    return content_files

def create_zip_files_for_frames(frames_dir, batch_size=100):
    frame_files = sorted(f for f in os.listdir(frames_dir) if f.endswith('.jpg'))
    for i in range(0, len(frame_files), batch_size):
        batch_files = frame_files[i:i+batch_size]
        zip_file_path = os.path.join(frames_dir, f"frames_{i//batch_size:03}.zip")
        with zipfile.ZipFile(zip_file_path, 'w') as zipf:
            for file in batch_files:
                file_path = os.path.join(frames_dir, file)
                zipf.write(file_path, file)
                os.remove(file_path)  # Optional: remove the frame after adding to zip

def process_episode(episode_file, frames_base_dir):
    season_num, episode_num = extract_season_episode(episode_file)
    simplified_episode_name = f"{season_num}-{episode_num}"
    episode_dir = os.path.join(frames_base_dir, simplified_episode_name)
    os.makedirs(episode_dir, exist_ok=True)

    frame_prefix = f"episode_{season_num}-{episode_num}_frame"
    extract_all_frames(episode_file, episode_dir, frame_prefix)

    create_zip_files_for_frames(episode_dir)

def process_content(input_path_param, index_name):
    set_input_path(input_path_param)
    frames_base_dir = get_frames_dir(index_name)
    ensure_dir_exists(frames_base_dir)

    content_files = list_content_files()

    for episode_file in content_files["videos"]:
        process_episode(episode_file, frames_base_dir)

def ensure_dir_exists(directory):
    if not os.path.exists(directory):
        os.makedirs(directory)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: ingest.py [input path]")
        sys.exit(1)
    input_path_cli = sys.argv[1]
    index_name_cli = input("Enter the name for the index: ")
    process_content(input_path_cli, index_name_cli)
