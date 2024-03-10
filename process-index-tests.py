import os
from pathlib import Path
import csv

def check_directory_structure(base_dir):
    success = True
    messages = []
    csv_files_with_duplicate_headers = []

    if not os.path.exists(base_dir):
        return False, [f"Base directory {base_dir} does not exist."], []

    # Check the top-level CSV file
    top_level_csv = os.path.join(base_dir, '_docs.csv')
    if not os.path.isfile(top_level_csv) or os.stat(top_level_csv).st_size == 0:
        success = False
        messages.append(f"Missing or empty _docs.csv in {base_dir}")
    else:
        if has_duplicate_headers(top_level_csv):
            csv_files_with_duplicate_headers.append(top_level_csv)

    for season_dir in sorted(Path(base_dir).iterdir(), key=lambda x: (x.name.isdigit(), int(x.name) if x.name.isdigit() else x.name)):
        if season_dir.is_dir():
            season_path = str(season_dir)
            docs_csv = os.path.join(season_path, '_docs.csv')
            if not os.path.isfile(docs_csv) or os.stat(docs_csv).st_size == 0:
                success = False
                messages.append(f"Missing or empty _docs.csv in {season_path}")
            else:
                if has_duplicate_headers(docs_csv):
                    csv_files_with_duplicate_headers.append(docs_csv)

            for episode_dir in sorted(season_dir.iterdir(), key=lambda x: (x.name.isdigit(), int(x.name) if x.name.isdigit() else x.name)):
                if episode_dir.is_dir():
                    episode_path = str(episode_dir)
                    episode_docs_csv = os.path.join(episode_path, '_docs.csv')
                    if not os.path.isfile(episode_docs_csv) or os.stat(episode_docs_csv).st_size == 0:
                        success = False
                        messages.append(f"Missing or empty _docs.csv in {episode_path}")
                    else:
                        if has_duplicate_headers(episode_docs_csv):
                            csv_files_with_duplicate_headers.append(episode_docs_csv)

                    video_clips = list(episode_dir.glob('*.mp4'))
                    if not video_clips:
                        success = False
                        messages.append(f"No video clips found in {episode_path}")
                    else:
                        for clip in video_clips:
                            if os.stat(clip).st_size == 0:
                                success = False
                                messages.append(f"Empty video clip found: {clip}")

    return success, messages, csv_files_with_duplicate_headers


def has_duplicate_headers(csv_file):
    with open(csv_file, 'r') as file:
        reader = csv.reader(file)
        headers = next(reader)
        return any(row == headers for row in reader)


def fix_duplicate_headers(csv_file):
    with open(csv_file, 'r') as file:
        lines = file.readlines()

    with open(csv_file, 'w') as file:
        file.write(lines[0])  # Write the header line
        file.writelines(lines[2:])  # Write the remaining lines, skipping the duplicate header


def run_checks(base_dir):
    print("Starting post-processing checks...\n")
    success, messages, csv_files_with_duplicate_headers = check_directory_structure(base_dir)

    if success:
        print("\033[92mAll good! The directory structure and file contents meet expectations.\033[0m")
    else:
        print("\033[91mIssues detected during the checks:\033[0m")
        for message in messages:
            print(message)

    if csv_files_with_duplicate_headers:
        print("\n\033[93mWarning: Duplicate headers found in the following CSV files:\033[0m")
        for file in csv_files_with_duplicate_headers:
            print(file)

        user_input = input("\nDo you want to fix the duplicate headers? (y/n): ")
        if user_input.lower() == 'y':
            for file in csv_files_with_duplicate_headers:
                fix_duplicate_headers(file)
            print("\033[92mDuplicate headers have been fixed.\033[0m")
        else:
            print("Duplicate headers will not be fixed.")

if __name__ == "__main__":
    id_input = input("Enter the ID for the output folder: ")  # Prompt the user for the ID
    base_dir = f"~/.memesrc/processing/{id_input}"
    base_dir = os.path.expanduser(base_dir)  # Ensure the path is expanded to the full path
    run_checks(base_dir)