import json
import re

INPUT_FILE = "zebra_support_qa.json"
OUTPUT_FILE = "zebra_support_qa.json"

def clean_answer(text):
    # Remove 'האם המאמר עזר לך?' and following 'YesNo' and score fields
    text = re.sub(r"האם המאמר עזר לך\?\s*YesNo\s*\d+/\d+", "", text)
    # Remove any remaining 'YesNo' and score fields
    text = re.sub(r"YesNo\s*\d+/\d+", "", text)
    # Remove any trailing whitespace or newlines
    return text.strip()

def main():
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    for entry in data:
        entry["question"] = entry["question"].strip()
        entry["answer"] = clean_answer(entry["answer"])

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    main() 