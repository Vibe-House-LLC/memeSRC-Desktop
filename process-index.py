import os
import subprocess
import argparse
import yaml
import re
import csv
import base64
from pathlib import Path
import srt
import json
from datetime import timedelta

# Load configuration
with open(os.path.expanduser('~/.memesrc/config.yml'), 'r') as ymlfile:
    cfg = yaml.safe_load(ymlfile)

def get_frames_dir(id):
    return os.path.join(os.path.expanduser(f"~/.memesrc/processing/{id}"))

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
    
    filename_prefix = "%d"
    output_pattern = os.path.join(clips_dir, f"{filename_prefix}.mp4")
    
    command = [
        FFMPEG_PATH, "-y", "-i", episode_file,
        "-vf", f"fps={fps},scale='min(iw,1280)':min'(ih,720)':force_original_aspect_ratio=decrease",
        "-c:v", "libx264", "-an", "-crf", "31", "-preset", "ultrafast",
        "-force_key_frames", f"expr:gte(t,n_forced*{clip_duration})",
        "-map", "0:v",  # This ensures only video streams are processed
        "-segment_time", str(clip_duration),
        "-f", "segment",
        "-reset_timestamps", "1",
        output_pattern
    ]
    
    subprocess.run(command)

def extract_subtitle_clips(episode_file, subtitles, episode_dir, fps):
    for index, subtitle in enumerate(subtitles):
        # Convert subtitle start and end times to seconds
        start_time_seconds = subtitle.start.total_seconds()
        end_time_seconds = subtitle.end.total_seconds()

        # Add a buffer of 0.1 seconds before the start and after the end
        buffer = 0.1  # 100 milliseconds
        start_time_with_buffer = max(0, start_time_seconds - buffer)  # Ensure start time is not negative
        end_time_with_buffer = end_time_seconds + buffer

        # Calculate the new duration of the subtitle clip with added buffer
        clip_duration_with_buffer = end_time_with_buffer - start_time_with_buffer

        # Format the start time for FFMPEG
        start_time_ffmpeg = str(subtitle.start - timedelta(seconds=buffer)).replace(',', '.')

        output_file = os.path.join(episode_dir, f"s{index + 1}.mp4")  # Naming starts from s1.mp4

        command = [
            FFMPEG_PATH, "-y", "-ss", str(start_time_with_buffer), "-i", episode_file,
            "-t", str(clip_duration_with_buffer),  # Use the duration of the clip with buffer
            "-vf", f"fps={fps},scale='min(iw*min(500/iw,500/ih),500)':'min(ih*min(500/iw,500/ih),500)':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2",
            "-c:v", "libx264", "-crf", "35", "-preset", "ultrafast",  # Re-encode video to ensure compatibility
            "-c:a", "aac", "-strict", "-2",  # Re-encode audio to AAC for broad compatibility
            output_file
        ]
        
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

def update_processing_status(frames_base_dir, season_num, episode_num, status):
    status_file_path = os.path.join(frames_base_dir, 'processing_status.json')
    if os.path.exists(status_file_path):
        with open(status_file_path, 'r') as file:
            status_data = json.load(file)
    else:
        status_data = {}
    
    season_key = f"Season {season_num}"
    if season_key not in status_data:
        status_data[season_key] = {}
    status_data[season_key][f"Episode {episode_num}"] = status
    
    with open(status_file_path, 'w') as file:
        json.dump(status_data, file, indent=4)

def is_episode_processed(frames_base_dir, season_num, episode_num):
    status_file_path = os.path.join(frames_base_dir, 'processing_status.json')
    if not os.path.exists(status_file_path):
        return False
    
    with open(status_file_path, 'r') as file:
        status_data = json.load(file)
    
    season_key = f"Season {season_num}"
    if season_key in status_data:
        if f"Episode {episode_num}" in status_data[season_key]:
            return status_data[season_key][f"Episode {episode_num}"] == "completed"
    return False

def process_episode(episode_file, frames_base_dir, content_files, fps=10, clip_duration=10):
    season_num, episode_num = extract_season_episode(episode_file)
    
    # Check if the episode is already processed
    if is_episode_processed(frames_base_dir, season_num, episode_num):
        print(f"Skipping Season {season_num}, Episode {episode_num} (already processed).")
        return

    season_dir = os.path.join(frames_base_dir, str(season_num))
    ensure_dir_exists(season_dir)

    episode_dir = os.path.join(season_dir, str(episode_num))
    ensure_dir_exists(episode_dir)

    extract_video_clips(episode_file, episode_dir, fps, clip_duration)

    # New subtitle handling code
    matching_subtitle = find_matching_subtitle(episode_file, content_files["subtitles"], season_num, episode_num)
    if matching_subtitle:
        subtitles = parse_srt(matching_subtitle)
        extract_subtitle_clips(episode_file, subtitles, episode_dir, fps)  # Extract clips per subtitle
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
    # Mark the episode as completed after successful processing
    update_processing_status(frames_base_dir, season_num, episode_num, "completed")

def process_content(input_path_param, id, index_name, title, description, color_main, color_secondary, emoji, status, fps=10, clip_duration=10):
    set_input_path(input_path_param)
    frames_base_dir = get_frames_dir(id)
    ensure_dir_exists(frames_base_dir)

    metadata_content = {
        "id": id,
        "title": title,
        "description": description if description else None,
        "frameCount": 0,  # This should be updated with the actual frame count after processing
        "colorMain": color_main,
        "colorSecondary": color_secondary,
        "emoji": emoji if emoji else None,
        "status": status,
        "index_name": index_name  # Keep index_name for backward compatibility or additional indexing purposes
    }
    
    metadata_path = os.path.join(frames_base_dir, '00_metadata.json')
    with open(metadata_path, 'w') as metadata_file:
        json.dump(metadata_content, metadata_file)

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

def check_and_update_metadata(frames_base_dir, id_cli):
    metadata_path = os.path.join(frames_base_dir, '00_metadata.json')
    if os.path.exists(metadata_path):
        edit_metadata = input("Metadata file already exists. Do you want to edit it? [y/N]: ").lower()
        if edit_metadata == 'y':
            return collect_metadata(id_cli)
        else:
            with open(metadata_path, 'r') as metadata_file:
                return json.load(metadata_file)
    else:
        return collect_metadata(id_cli)

def collect_metadata(id_cli):
    # Collecting additional details for metadata, now in a separate function
    index_name_cli = input("Enter the name for the index: ")
    title_cli = input("Enter the title of the content: ")
    description_cli = input("Enter the description of the content (optional, press Enter to skip): ")
    color_main_cli = input("Enter the main color of the content (in HEX format, e.g., #FFFFFF): ")
    color_secondary_cli = input("Enter the secondary color of the content (in HEX format, e.g., #FFFFFF): ")
    emoji_cli = input("Enter an emoji representing the content (optional, press Enter to skip): ")
    status_cli = input("Enter the status of the content (as an integer): ")

    return {
        "id": id_cli,
        "title": title_cli,
        "description": description_cli if description_cli else None,
        "colorMain": color_main_cli,
        "colorSecondary": color_secondary_cli,
        "emoji": emoji_cli if emoji_cli else None,
        "status": status_cli,
    }

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Process video content into clips and index subtitles.')
    parser.add_argument('input_path', help='Input path of the videos and subtitles')
    parser.add_argument('--fps', type=int, default=10, help='Frames per second for the output clips')
    parser.add_argument('--clip_duration', type=int, default=10, help='Duration of each clip in seconds')
    args = parser.parse_args()

    id_cli = input("Enter the ID for the output folder: ")
    frames_base_dir = get_frames_dir(id_cli)
    ensure_dir_exists(frames_base_dir)

    # Check for existing metadata and update if necessary
    metadata_content = check_and_update_metadata(frames_base_dir, id_cli)

    # Provide default values for missing keys
    default_metadata = {
        'id': id_cli,  # Use the folder ID as a fallback
        'index_name': 'default_index',
        'title': 'Untitled',
        'description': '',
        'color_main': '#FFFFFF',  # Default white
        'color_secondary': '#000000',  # Default black
        'emoji': '',
        'status': '0',
    }

    # Update the default_metadata with the actual values from metadata_content
    default_metadata.update(metadata_content)

    # Prepare the arguments for process_content
    expected_keys = ['id', 'index_name', 'title', 'description', 'color_main', 'color_secondary', 'emoji', 'status']
    filtered_metadata_content = {k: default_metadata[k] for k in expected_keys}

    # Call process_content with the filtered metadata content
    process_content(args.input_path, **filtered_metadata_content, fps=args.fps, clip_duration=args.clip_duration)
