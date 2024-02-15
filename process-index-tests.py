import os
from pathlib import Path

def check_directory_structure(base_dir):
    success = True
    messages = []

    if not os.path.exists(base_dir):
        return False, [f"Base directory {base_dir} does not exist."]

    # Adjusted sorting to handle both integers and strings by comparing tuples
    for season_dir in sorted(Path(base_dir).iterdir(), key=lambda x: (x.name.isdigit(), int(x.name) if x.name.isdigit() else x.name)):
        if season_dir.is_dir():
            season_path = str(season_dir)
            docs_csv = os.path.join(season_path, '_docs.csv')
            if not os.path.isfile(docs_csv) or os.stat(docs_csv).st_size == 0:
                success = False
                messages.append(f"Missing or empty _docs.csv in {season_path}")

            for episode_dir in sorted(season_dir.iterdir(), key=lambda x: (x.name.isdigit(), int(x.name) if x.name.isdigit() else x.name)):
                if episode_dir.is_dir():
                    episode_path = str(episode_dir)
                    episode_docs_csv = os.path.join(episode_path, '_docs.csv')
                    if not os.path.isfile(episode_docs_csv) or os.stat(episode_docs_csv).st_size == 0:
                        success = False
                        messages.append(f"Missing or empty _docs.csv in {episode_path}")

                    video_clips = list(episode_dir.glob('*.mp4'))
                    if not video_clips:
                        success = False
                        messages.append(f"No video clips found in {episode_path}")
                    else:
                        for clip in video_clips:
                            if os.stat(clip).st_size == 0:
                                success = False
                                messages.append(f"Empty video clip found: {clip}")

    return success, messages


def run_checks(base_dir):
    print("Starting post-processing checks...\n")
    success, messages = check_directory_structure(base_dir)

    if success:
        print("\033[92mAll good! The directory structure and file contents meet expectations.\033[0m")
    else:
        print("\033[91mIssues detected during the checks:\033[0m")
        for message in messages:
            print(message)

if __name__ == "__main__":
    id_input = input("Enter the ID for the output folder: ")  # Prompt the user for the ID
    base_dir = f"~/.memesrc/processing/{id_input}"
    base_dir = os.path.expanduser(base_dir)  # Ensure the path is expanded to the full path
    run_checks(base_dir)
