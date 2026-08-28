"""
Download EMLAB REPORT.pdf and TRACES.xlsm attachments from Classic Outlook.

The script saves files only; it never opens attachments or executes macros.
It is intended to be run by Windows Task Scheduler under the logged-in user.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import shutil
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any


OUTLOOK_INBOX = 6
MAIL_ITEM_CLASS = 43
DEFAULT_CONFIG_FILE = Path(__file__).with_name("config.json")
PRODUCTION_ALLOWED_SENDERS = {"rajput@fev.com", "tandulkar@fev.com"}
DEFAULT_PROJECT_RULES = {
    "STLA": ["CITROEN", "AIRCROSS"],
    "RNTBCI": ["RNTBCI", "DUSTER", "TRIBER", "HR10", "HR13", "RBC", "R1324"],
}
DEFAULT_CONFIG: dict[str, Any] = {
    "output_root": r"%APPDATA%\EMLAB\Programs",
    "subject_keyword": "EM tests",
    "lookback_days": 14,
    "max_saved_files": 20,
    "allowed_senders": sorted(PRODUCTION_ALLOWED_SENDERS),
    "allowed_extensions": [".pdf", ".xlsm"],
    "create_missing_program_folders": False,
    "unmatched_folder": "_email_downloads_needs_program",
    "route_layout": "project/transmission/vehicle",
    "project_rules": DEFAULT_PROJECT_RULES,
    "dry_run": False,
}


@dataclass(frozen=True)
class Config:
    output_root: Path
    subject_keyword: str
    lookback_days: int
    max_saved_files: int | None
    allowed_senders: set[str]
    allowed_extensions: set[str]
    create_missing_program_folders: bool
    unmatched_folder: str
    route_layout: str
    project_rules: dict[str, list[str]]
    dry_run: bool


def expand_path(value: str) -> Path:
    return Path(os.path.expandvars(os.path.expanduser(value))).resolve()


def load_config(config_file: Path) -> Config:
    if not config_file.exists():
        config_file.parent.mkdir(parents=True, exist_ok=True)
        config_file.write_text(json.dumps(DEFAULT_CONFIG, indent=2), encoding="utf-8")

    with config_file.open("r", encoding="utf-8") as file:
        raw = json.load(file)

    allowed_extensions = {
        ext.lower() if str(ext).startswith(".") else f".{str(ext).lower()}"
        for ext in raw.get("allowed_extensions", [".pdf", ".xlsm"])
    }

    raw_rules: dict[str, Any] = dict(DEFAULT_PROJECT_RULES)
    for project, keywords in dict(raw.get("project_rules", {})).items():
        merged = list(raw_rules.get(str(project), []))
        if isinstance(keywords, list):
            for keyword in keywords:
                if str(keyword).strip() and str(keyword) not in merged:
                    merged.append(str(keyword))
        raw_rules[str(project)] = merged

    project_rules = {
        sanitize_name(str(project)): [normalize_key(str(keyword)) for keyword in keywords if str(keyword).strip()]
        for project, keywords in raw_rules.items()
        if str(project).strip() and isinstance(keywords, list)
    }

    max_saved_files = int(raw.get("max_saved_files", 0) or 0)

    return Config(
        output_root=expand_path(str(raw.get("output_root", r"%USERPROFILE%\Documents\EMLAB"))),
        subject_keyword=str(raw.get("subject_keyword", "EM tests")),
        lookback_days=int(raw.get("lookback_days", 7)),
        max_saved_files=max_saved_files if max_saved_files > 0 else None,
        allowed_senders=set(PRODUCTION_ALLOWED_SENDERS),
        allowed_extensions=allowed_extensions,
        create_missing_program_folders=bool(raw.get("create_missing_program_folders", False)),
        unmatched_folder=sanitize_name(str(raw.get("unmatched_folder", "_email_downloads_needs_program"))),
        route_layout=str(raw.get("route_layout", "project/transmission/vehicle")),
        project_rules=project_rules,
        dry_run=bool(raw.get("dry_run", False)),
    )


def validate_config(config: Config) -> None:
    if not config.allowed_senders:
        raise RuntimeError(
            "allowed_senders must contain at least one exact sender email before Outlook automation is enabled."
        )


def configure_logging(output_root: Path) -> None:
    log_dir = output_root / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
        handlers=[
            logging.FileHandler(log_dir / "emlab_outlook_downloader.log", encoding="utf-8"),
            logging.StreamHandler(),
        ],
    )


def sanitize_name(value: str) -> str:
    sanitized = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value)
    sanitized = re.sub(r"\s+", "_", sanitized.strip())
    sanitized = re.sub(r"_+", "_", sanitized)
    return sanitized.strip(" .") or "unnamed"


def normalize_key(value: str) -> str:
    return sanitize_name(value).upper()


def strip_known_suffix(file_name: str) -> str:
    stem = Path(file_name).stem
    upper_stem = stem.upper()
    for marker in ("_TRACES", "_REPORT"):
        marker_position = upper_stem.find(marker)
        if marker_position >= 0:
            stem = stem[:marker_position]
            break
    return stem


def filename_tokens(file_name: str) -> list[str]:
    return [token for token in re.split(r"[_\W]+", strip_known_suffix(file_name).upper()) if token]


def extract_vehicle_name(file_name: str) -> str:
    stem = strip_known_suffix(file_name)
    stem = re.sub(r"_?\d{4}-\d{2}-\d{2}[_-]\d{2}-\d{2}-\d{2}.*$", "", stem)
    parts = stem.split("_")
    if len(parts) >= 2 and parts[-1].isdigit() and parts[-2].isdigit():
        parts = parts[:-1]
    if len(parts) >= 2 and parts[-1].isdigit() and re.fullmatch(r"V?\d+", parts[-2], re.IGNORECASE):
        parts = parts[:-2]
    return sanitize_name("_".join(parts))


def extract_transmission_bucket(file_name: str) -> str:
    tokens = filename_tokens(file_name)
    if any(token in {"MT", "MB", "MANUAL"} for token in tokens):
        return "MT"
    if any(token in {"AT", "DCT", "CVT", "AUTOMATIC"} for token in tokens):
        return "AT"
    if any(token in {"DET"} for token in tokens):
        return "DET"
    return "UNKNOWN_TRANS"


def classify_project(config: Config, attachment_name: str) -> str:
    haystack = normalize_key(strip_known_suffix(attachment_name))
    tokens = set(filename_tokens(attachment_name))
    for project, keywords in config.project_rules.items():
        for keyword in keywords:
            if keyword in tokens or keyword in haystack:
                return sanitize_name(project)
    if config.output_root.exists():
        for child in config.output_root.iterdir():
            if not child.is_dir():
                continue
            project = sanitize_name(child.name)
            if project in {"logs", config.unmatched_folder}:
                continue
            keyword = normalize_key(project)
            if keyword in tokens or keyword in haystack:
                return project
    return "UNKNOWN_PROJECT"


def route_parts(config: Config, attachment_name: str) -> list[str]:
    values = {
        "project": classify_project(config, attachment_name),
        "transmission": extract_transmission_bucket(attachment_name),
        "vehicle": extract_vehicle_name(attachment_name),
    }
    parts = []
    for token in config.route_layout.split("/"):
        key = token.strip().lower()
        if key in values:
            parts.append(sanitize_name(values[key]))
    return parts or [values["project"]]


def resolve_program_folder(config: Config, attachment_name: str) -> Path:
    parts = route_parts(config, attachment_name)
    project_name = parts[0]
    project_folder = (config.output_root / project_name).resolve()
    destination = (config.output_root / Path(*parts)).resolve()
    root = config.output_root.resolve()

    if destination != root and root not in destination.parents:
        raise ValueError(f"Resolved destination escaped output root: {destination}")

    # EMLAB's watcher assigns a test to the registered program folder. The
    # top-level project folder must exist in EMLAB first; subfolders below it
    # are fine and keep the downloaded files tidy without changing ownership.
    if project_folder.exists():
        return destination

    if config.create_missing_program_folders:
        logging.warning(
            "Creating missing project folder %s. Create the same project in EMLAB so the watcher registers it.",
            project_folder,
        )
        return destination

    holding = (config.output_root / config.unmatched_folder / Path(*parts)).resolve()
    logging.warning(
        "Project folder %s does not exist. Saving to holding folder %s.",
        project_folder,
        holding,
    )
    return holding


def generate_unique_path(destination: Path) -> Path:
    if not destination.exists():
        return destination
    counter = 1
    while True:
        candidate = destination.with_name(f"{destination.stem}_{counter}{destination.suffix}")
        if not candidate.exists():
            return candidate
        counter += 1


def repair_holding_folder(config: Config) -> int:
    moved = 0
    holding_roots = []
    for folder_name in (config.unmatched_folder, "email_downloads_needs_program", "_email_downloads_needs_program"):
        candidate = config.output_root / sanitize_name(folder_name)
        if candidate.exists() and candidate not in holding_roots:
            holding_roots.append(candidate)

    files = [path for root in holding_roots for path in root.rglob("*") if path.is_file()]
    groups: dict[str, list[Path]] = {}
    for file_path in files:
        groups.setdefault(strip_known_suffix(file_path.name), []).append(file_path)

    for stem, group in groups.items():
        pdf = next((path for path in group if path.name.upper().endswith("_REPORT.PDF")), None)
        xlsm = next((path for path in group if path.name.upper().endswith("_TRACES.XLSM")), None)
        if pdf is None or xlsm is None:
            logging.warning("Holding folder still has incomplete pair for %s.", stem)
            continue

        route = route_parts(config, pdf.name)
        if not route or route[0] == "UNKNOWN_PROJECT":
            logging.warning("Holding folder pair still has unknown project: %s.", stem)
            continue

        destination_folder = (config.output_root / Path(*route)).resolve()
        if any(root.resolve() in destination_folder.parents for root in holding_roots):
            continue
        destination_folder.mkdir(parents=True, exist_ok=True)
        for source in (pdf, xlsm):
            destination = generate_unique_path(destination_folder / source.name)
            shutil.move(str(source), str(destination))
            logging.info("Moved holding attachment into watched project folder: %s", destination)
            moved += 1

    return moved


def processed_file(output_root: Path) -> Path:
    return output_root / "processed_outlook_messages.json"


def last_run_file(output_root: Path) -> Path:
    return output_root / "last_successful_run.json"


def warn_if_gap_exceeds_lookback(output_root: Path, lookback_days: int) -> None:
    path = last_run_file(output_root)
    if not path.exists():
        return
    try:
        completed_utc = datetime.fromisoformat(json.loads(path.read_text(encoding="utf-8"))["completed_utc"])
    except (json.JSONDecodeError, OSError, KeyError, ValueError) as error:
        logging.warning("Could not read %s: %s", path, error)
        return
    gap_days = (datetime.utcnow() - completed_utc.replace(tzinfo=None)).total_seconds() / 86400
    if gap_days > lookback_days:
        logging.warning(
            "Gap since last successful run was %.1f day(s), longer than the %d-day lookback_days window. "
            "Emails older than the lookback window were not scanned and will not be picked up automatically "
            "-- check Outlook manually for that period if needed.",
            gap_days,
            lookback_days,
        )


def save_last_run(output_root: Path) -> None:
    path = last_run_file(output_root)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(
        json.dumps({"completed_utc": datetime.utcnow().isoformat() + "Z"}), encoding="utf-8"
    )
    temporary.replace(path)


def load_processed_ids(output_root: Path) -> set[str]:
    path = processed_file(output_root)
    if not path.exists():
        return set()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as error:
        logging.error("Could not read %s: %s", path, error)
        return set()
    return set(data) if isinstance(data, list) else set()


def save_processed_ids(output_root: Path, processed_ids: set[str]) -> None:
    path = processed_file(output_root)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(sorted(processed_ids), indent=2), encoding="utf-8")
    temporary.replace(path)


def get_sender_address(message: Any) -> str:
    try:
        return str(message.SenderEmailAddress or "").strip().lower()
    except Exception:
        return ""


def message_matches(config: Config, message: Any) -> bool:
    subject = str(getattr(message, "Subject", "") or "")
    if config.subject_keyword.lower() not in subject.lower():
        return False
    if config.allowed_senders and get_sender_address(message) not in config.allowed_senders:
        return False
    return True


def import_outlook_client() -> Any:
    try:
        import win32com.client  # type: ignore
    except ImportError as error:
        raise RuntimeError("pywin32 is required. Install with: python -m pip install pywin32") from error
    return win32com.client


def acquire_lock(output_root: Path) -> Any:
    lock_path = output_root / "emlab_outlook_downloader.lock"
    try:
        handle = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError as error:
        raise RuntimeError(f"Another downloader run appears active: {lock_path}") from error
    os.write(handle, str(os.getpid()).encode("ascii", errors="ignore"))
    return handle, lock_path


def release_lock(lock: Any) -> None:
    handle, lock_path = lock
    os.close(handle)
    try:
        lock_path.unlink()
    except FileNotFoundError:
        pass


def process_inbox(
    config: Config,
    max_files_override: int | None = None,
    dry_run_override: bool | None = None,
) -> None:
    config.output_root.mkdir(parents=True, exist_ok=True)
    configure_logging(config.output_root)
    validate_config(config)
    lock = acquire_lock(config.output_root)
    try:
        processed_ids = load_processed_ids(config.output_root)
        warn_if_gap_exceeds_lookback(config.output_root, config.lookback_days)
        win32_client = import_outlook_client()
        logging.info("Connecting to Classic Outlook profile.")
        repaired = repair_holding_folder(config)
        if repaired:
            logging.info("Repaired holding folder attachments: moved=%d", repaired)
        outlook = win32_client.Dispatch("Outlook.Application").GetNamespace("MAPI")
        messages = outlook.GetDefaultFolder(OUTLOOK_INBOX).Items
        messages.Sort("[ReceivedTime]", True)

        cutoff_time = datetime.now() - timedelta(days=config.lookback_days)
        max_saved_files = max_files_override if max_files_override is not None else config.max_saved_files
        dry_run = dry_run_override if dry_run_override is not None else config.dry_run
        inspected = matched = saved = 0

        for message in messages:
            if max_saved_files is not None and saved >= max_saved_files:
                break
            inspected += 1
            try:
                if getattr(message, "Class", None) != MAIL_ITEM_CLASS:
                    continue
                received_time = message.ReceivedTime
                if getattr(received_time, "tzinfo", None) is not None:
                    received_time = received_time.replace(tzinfo=None)
                if received_time < cutoff_time:
                    break

                entry_id = str(message.EntryID)
                if entry_id in processed_ids or not message_matches(config, message):
                    continue

                matched += 1
                saved_from_message = 0
                complete_pairs = 0
                candidates: list[dict[str, Any]] = []
                attachments = message.Attachments
                for index in range(1, attachments.Count + 1):
                    attachment = attachments.Item(index)
                    original_name = str(attachment.FileName or "")
                    safe_name = sanitize_name(original_name)
                    extension = Path(safe_name).suffix.lower()
                    if extension not in config.allowed_extensions:
                        logging.info("Skipped unsupported attachment: %s", original_name)
                        continue

                    candidates.append(
                        {
                            "attachment": attachment,
                            "original_name": original_name,
                            "safe_name": safe_name,
                            "extension": extension,
                            "stem": strip_known_suffix(safe_name),
                        }
                    )

                groups: dict[str, list[dict[str, Any]]] = {}
                for candidate in candidates:
                    groups.setdefault(str(candidate["stem"]), []).append(candidate)

                for stem, group in groups.items():
                    pdf = next((candidate for candidate in group if candidate["extension"] == ".pdf"), None)
                    xlsm = next((candidate for candidate in group if candidate["extension"] == ".xlsm"), None)
                    if pdf is None or xlsm is None:
                        logging.warning("Skipped incomplete attachment set for %s. PDF and XLSM are both required.", stem)
                        continue

                    planned: list[dict[str, Any]] = []
                    for candidate in (pdf, xlsm):
                        destination_folder = resolve_program_folder(config, str(candidate["safe_name"]))
                        exact_destination = destination_folder / str(candidate["safe_name"])
                        planned.append(
                            {
                                "candidate": candidate,
                                "destination_folder": destination_folder,
                                "exact_destination": exact_destination,
                                "exists": exact_destination.exists(),
                            }
                        )

                    new_files = sum(1 for item in planned if not item["exists"])
                    if max_saved_files is not None and saved + new_files > max_saved_files:
                        logging.warning(
                            "Skipped complete attachment set for %s because max_saved_files would be exceeded.",
                            stem,
                        )
                        break

                    complete_pairs += 1
                    for item in planned:
                        if item["exists"]:
                            logging.info("Skipped existing attachment: %s", item["exact_destination"])
                            saved_from_message += 1
                            continue
                        destination = generate_unique_path(item["exact_destination"])
                        if dry_run:
                            logging.info("Dry run: would save %s", destination)
                        else:
                            item["destination_folder"].mkdir(parents=True, exist_ok=True)
                            item["candidate"]["attachment"].SaveAsFile(str(destination))
                            logging.info("Saved attachment: %s", destination)
                        saved += 1
                        saved_from_message += 1

                processed_ids.add(entry_id)
                if not dry_run:
                    save_processed_ids(config.output_root, processed_ids)
                if not candidates:
                    logging.warning("Matched message had no allowed PDF/XLSM attachments.")
                elif complete_pairs == 0:
                    logging.warning("Matched message had allowed attachments, but no complete PDF/XLSM pair.")
            except Exception:
                logging.exception("Failed while processing an Outlook message.")

        logging.info(
            "Completed. inspected=%d matched=%d attachments_saved=%d max_saved_files=%s",
            inspected,
            matched,
            saved,
            max_saved_files,
        )
        if not dry_run:
            save_last_run(config.output_root)
    finally:
        release_lock(lock)


def main() -> int:
    parser = argparse.ArgumentParser(description="Download EMLAB Outlook attachments into watched program folders.")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_FILE)
    parser.add_argument("--check-config", action="store_true", help="Validate config without connecting to Outlook.")
    parser.add_argument("--repair-holding-only", action="store_true", help="Move complete holding-folder pairs into routed project folders without connecting to Outlook.")
    parser.add_argument("--route-filename", help="Print the folder route for one attachment name without connecting to Outlook.")
    parser.add_argument("--max-files", type=int, help="Stop after saving this many allowed PDF/XLSM attachments.")
    parser.add_argument("--dry-run", action="store_true", help="Read Outlook and log planned saves without saving attachments.")
    args = parser.parse_args()

    try:
        config = load_config(args.config)
        if args.check_config:
            validate_config(config)
            print(f"Config OK: output_root={config.output_root}")
            return 0
        if args.route_filename:
            print(Path(*route_parts(config, args.route_filename)))
            return 0
        if args.repair_holding_only:
            config.output_root.mkdir(parents=True, exist_ok=True)
            configure_logging(config.output_root)
            moved = repair_holding_folder(config)
            print(f"Repair OK: moved={moved}")
            return 0

        process_inbox(config, args.max_files, True if args.dry_run else None)
        return 0
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
