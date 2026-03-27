#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.parse
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path


PPRO_TICKS_PER_SECOND = 254_016_000_000


def strip_tag(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def parse_time(value: str | None) -> Fraction:
    if not value:
        return Fraction(0, 1)
    if not value.endswith("s"):
        raise ValueError(f"Unsupported time value: {value}")
    raw = value[:-1]
    if "/" in raw:
        numerator, denominator = raw.split("/", 1)
        return Fraction(int(numerator), int(denominator))
    return Fraction(raw)


def xml_bool(value: bool) -> str:
    return "TRUE" if value else "FALSE"


def ffprobe_json(path: Path) -> dict:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)


def pathurl(path: Path) -> str:
    encoded = urllib.parse.quote(path.as_posix(), safe="/")
    return f"file://localhost{encoded}"


def ensure_text(parent: ET.Element, tag: str, value: str) -> ET.Element:
    elem = ET.SubElement(parent, tag)
    elem.text = value
    return elem


def add_rate(parent: ET.Element, timebase: int, ntsc: bool) -> ET.Element:
    rate = ET.SubElement(parent, "rate")
    ensure_text(rate, "timebase", str(timebase))
    ensure_text(rate, "ntsc", xml_bool(ntsc))
    return rate


def add_timecode(parent: ET.Element, timebase: int, ntsc: bool) -> ET.Element:
    tc = ET.SubElement(parent, "timecode")
    add_rate(tc, timebase, ntsc)
    ensure_text(tc, "string", "00:00:00:00")
    ensure_text(tc, "frame", "0")
    ensure_text(tc, "displayformat", "NDF")
    return tc


def nominal_rate(frame_duration: Fraction) -> tuple[int, bool]:
    fps = Fraction(1, 1) / frame_duration
    ntsc_rates = {
        Fraction(24000, 1001): 24,
        Fraction(30000, 1001): 30,
        Fraction(60000, 1001): 60,
    }
    if fps in ntsc_rates:
        return ntsc_rates[fps], True
    if fps.denominator == 1:
        return fps.numerator, False
    return round(float(fps)), False


@dataclass
class FormatDef:
    id: str
    frame_duration: Fraction | None
    width: int | None
    height: int | None


@dataclass
class AssetDef:
    id: str
    name: str
    path: Path
    has_video: bool
    has_audio: bool
    format_id: str | None
    start: Fraction
    duration: Fraction
    audio_channels: int
    audio_rate: int


@dataclass
class MediaInfo:
    duration_seconds: Fraction
    has_video: bool
    has_audio: bool
    video_width: int | None
    video_height: int | None
    video_rate: tuple[int, bool] | None
    audio_channels: int | None
    audio_rate: int | None
    audio_depth: int | None


@dataclass
class TimelineClip:
    kind: str
    asset_id: str
    track_index: int
    name: str
    seq_start_frames: int
    seq_end_frames: int
    source_in_frames: int
    source_out_frames: int
    enabled: bool
    gain_db: float | None


def frames_from_time(value: Fraction, frame_duration: Fraction) -> int:
    return int(round(float(value / frame_duration)))


def ticks_from_frames(frame_count: int, frame_duration: Fraction) -> int:
    ticks = Fraction(frame_count, 1) * frame_duration * PPRO_TICKS_PER_SECOND
    return int(round(float(ticks)))


def parse_gain_db(node: ET.Element) -> float | None:
    for child in node:
        if strip_tag(child.tag) != "adjust-volume":
            continue
        amount = child.get("amount")
        if not amount or not amount.endswith("dB"):
            return None
        return float(amount[:-2])
    return None


def build_media_info(asset: AssetDef, formats: dict[str, FormatDef], sequence_rate: tuple[int, bool]) -> MediaInfo:
    probe = ffprobe_json(asset.path)
    streams = probe.get("streams", [])
    format_info = probe.get("format", {})

    video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)

    duration_seconds = asset.duration
    if format_info.get("duration"):
        duration_seconds = Fraction(format_info["duration"])

    video_rate = None
    if video_stream:
        rate_raw = video_stream.get("avg_frame_rate") or video_stream.get("r_frame_rate")
        if rate_raw and rate_raw != "0/0":
            fps = Fraction(rate_raw)
            if fps in (Fraction(24000, 1001), Fraction(30000, 1001), Fraction(60000, 1001)):
                timebase = {Fraction(24000, 1001): 24, Fraction(30000, 1001): 30, Fraction(60000, 1001): 60}[fps]
                video_rate = (timebase, True)
            elif fps.denominator == 1:
                video_rate = (fps.numerator, False)
    if not video_rate:
        video_rate = sequence_rate

    video_width = None
    video_height = None
    if video_stream:
        video_width = int(video_stream["width"])
        video_height = int(video_stream["height"])
    elif asset.format_id and asset.format_id in formats:
        video_width = formats[asset.format_id].width
        video_height = formats[asset.format_id].height

    audio_channels = None
    audio_rate = None
    audio_depth = None
    if audio_stream:
        audio_channels = int(audio_stream.get("channels") or 2)
        audio_rate = int(audio_stream.get("sample_rate") or asset.audio_rate or 48000)
        bits = audio_stream.get("bits_per_sample") or audio_stream.get("bits_per_raw_sample")
        if bits:
            audio_depth = int(bits)
    if asset.has_audio:
        audio_channels = audio_channels or asset.audio_channels or 2
        audio_rate = audio_rate or asset.audio_rate or 48000
        audio_depth = audio_depth or 16

    return MediaInfo(
        duration_seconds=duration_seconds,
        has_video=bool(video_stream) or asset.has_video,
        has_audio=bool(audio_stream) or asset.has_audio,
        video_width=video_width,
        video_height=video_height,
        video_rate=video_rate,
        audio_channels=audio_channels,
        audio_rate=audio_rate,
        audio_depth=audio_depth,
    )


def flatten_timeline(
    container: ET.Element,
    assets: dict[str, AssetDef],
    frame_duration: Fraction,
    clips: list[TimelineClip],
    parent_seq_start: Fraction | None = None,
    parent_source_start: Fraction | None = None,
) -> None:
    for child in container:
        tag = strip_tag(child.tag)
        if tag != "asset-clip":
            continue

        asset = assets[child.attrib["ref"]]
        clip_offset = parse_time(child.get("offset"))
        clip_source_start = parse_time(child.get("start")) if child.get("start") else asset.start
        clip_duration = parse_time(child.get("duration"))
        if parent_seq_start is None:
            sequence_start = clip_offset
        else:
            sequence_start = parent_seq_start + clip_offset - parent_source_start

        enabled = child.get("enabled", "1") != "0"
        gain_db = parse_gain_db(child)
        seq_start_frames = frames_from_time(sequence_start, frame_duration)
        duration_frames = frames_from_time(clip_duration, frame_duration)
        seq_end_frames = seq_start_frames + duration_frames
        source_in_frames = frames_from_time(clip_source_start, frame_duration)
        source_out_frames = source_in_frames + duration_frames

        if asset.has_video:
            clips.append(
                TimelineClip(
                    kind="video",
                    asset_id=asset.id,
                    track_index=1,
                    name=asset.name,
                    seq_start_frames=seq_start_frames,
                    seq_end_frames=seq_end_frames,
                    source_in_frames=source_in_frames,
                    source_out_frames=source_out_frames,
                    enabled=enabled,
                    gain_db=None,
                )
            )
            if asset.has_audio:
                clips.append(
                    TimelineClip(
                        kind="audio",
                        asset_id=asset.id,
                        track_index=1,
                        name=asset.name,
                        seq_start_frames=seq_start_frames,
                        seq_end_frames=seq_end_frames,
                        source_in_frames=source_in_frames,
                        source_out_frames=source_out_frames,
                        enabled=enabled,
                        gain_db=gain_db,
                    )
                )
        elif asset.has_audio:
            lane = int(child.get("lane") or "-1")
            track_index = 1 + abs(lane)
            clips.append(
                TimelineClip(
                    kind="audio",
                    asset_id=asset.id,
                    track_index=track_index,
                    name=asset.name,
                    seq_start_frames=seq_start_frames,
                    seq_end_frames=seq_end_frames,
                    source_in_frames=source_in_frames,
                    source_out_frames=source_out_frames,
                    enabled=enabled,
                    gain_db=gain_db,
                )
            )

        flatten_timeline(
            child,
            assets=assets,
            frame_duration=frame_duration,
            clips=clips,
            parent_seq_start=sequence_start,
            parent_source_start=clip_source_start,
        )


def add_audio_gain_filter(parent: ET.Element, gain_db: float) -> None:
    filt = ET.SubElement(parent, "filter")
    effect = ET.SubElement(filt, "effect")
    ensure_text(effect, "name", "Gain")
    ensure_text(effect, "effectid", "{61756678, 4761696e, 4b657947}")
    ensure_text(effect, "effecttype", "filter")
    ensure_text(effect, "mediatype", "audio")
    parameter = ET.SubElement(effect, "parameter", {"authoringApp": "PremierePro"})
    ensure_text(parameter, "parameterid", "Gain(dB)")
    ensure_text(parameter, "name", "Gain(dB)")
    ensure_text(parameter, "valuemin", "-96")
    ensure_text(parameter, "valuemax", "96")
    ensure_text(parameter, "value", f"{gain_db:g}")


def append_file_ref(
    parent: ET.Element,
    file_id: str,
    asset: AssetDef,
    media_info: MediaInfo,
    file_duration_frames: int,
    file_written: set[str],
) -> None:
    if file_id in file_written:
        ET.SubElement(parent, "file", {"id": file_id})
        return

    file_elem = ET.SubElement(parent, "file", {"id": file_id})
    ensure_text(file_elem, "name", asset.path.name)
    ensure_text(file_elem, "pathurl", pathurl(asset.path))
    timebase, ntsc = media_info.video_rate or (24, True)
    add_rate(file_elem, timebase, ntsc)
    ensure_text(file_elem, "duration", str(file_duration_frames))
    add_timecode(file_elem, timebase, ntsc)

    media = ET.SubElement(file_elem, "media")
    if media_info.has_video:
        video = ET.SubElement(media, "video")
        sample = ET.SubElement(video, "samplecharacteristics")
        add_rate(sample, *(media_info.video_rate or (24, True)))
        if media_info.video_width:
            ensure_text(sample, "width", str(media_info.video_width))
        if media_info.video_height:
            ensure_text(sample, "height", str(media_info.video_height))
        ensure_text(sample, "anamorphic", "FALSE")
        ensure_text(sample, "pixelaspectratio", "square")
        ensure_text(sample, "fielddominance", "none")
    if media_info.has_audio and media_info.audio_channels and media_info.audio_rate:
        audio = ET.SubElement(media, "audio")
        sample = ET.SubElement(audio, "samplecharacteristics")
        ensure_text(sample, "depth", str(media_info.audio_depth or 16))
        ensure_text(sample, "samplerate", str(media_info.audio_rate))
        ensure_text(audio, "channelcount", str(media_info.audio_channels))

    file_written.add(file_id)


def add_clipitem(
    track: ET.Element,
    clip: TimelineClip,
    clip_id: str,
    masterclip_id: str,
    file_id: str,
    asset: AssetDef,
    media_info: MediaInfo,
    file_duration_frames: int,
    sequence_rate: tuple[int, bool],
    frame_duration: Fraction,
    file_written: set[str],
) -> None:
    attrib = {}
    if clip.kind == "audio" and media_info.audio_channels and media_info.audio_channels > 1:
        attrib["premiereChannelType"] = "stereo"
    clipitem = ET.SubElement(track, "clipitem", {"id": clip_id, **attrib})
    ensure_text(clipitem, "masterclipid", masterclip_id)
    ensure_text(clipitem, "name", clip.name)
    ensure_text(clipitem, "enabled", xml_bool(clip.enabled))
    ensure_text(clipitem, "duration", str(file_duration_frames))
    add_rate(clipitem, *sequence_rate)
    ensure_text(clipitem, "start", str(clip.seq_start_frames))
    ensure_text(clipitem, "end", str(clip.seq_end_frames))
    ensure_text(clipitem, "in", str(clip.source_in_frames))
    ensure_text(clipitem, "out", str(clip.source_out_frames))
    ensure_text(clipitem, "pproTicksIn", str(ticks_from_frames(clip.source_in_frames, frame_duration)))
    ensure_text(clipitem, "pproTicksOut", str(ticks_from_frames(clip.source_out_frames, frame_duration)))
    if clip.kind == "video":
        ensure_text(clipitem, "alphatype", "none")
        ensure_text(clipitem, "pixelaspectratio", "square")
        ensure_text(clipitem, "anamorphic", "FALSE")

    append_file_ref(
        clipitem,
        file_id=file_id,
        asset=asset,
        media_info=media_info,
        file_duration_frames=file_duration_frames,
        file_written=file_written,
    )

    if clip.kind == "audio":
        sourcetrack = ET.SubElement(clipitem, "sourcetrack")
        ensure_text(sourcetrack, "mediatype", "audio")
        ensure_text(sourcetrack, "trackindex", "1")
        if clip.gain_db is not None and abs(clip.gain_db) > 1e-9:
            add_audio_gain_filter(clipitem, clip.gain_db)


def main() -> int:
    parser = argparse.ArgumentParser(description="Convert an FCPXML package into Premiere-friendly xmeml XML.")
    parser.add_argument("input", help="Path to .fcpxmld package or an Info.fcpxml file")
    parser.add_argument("-o", "--output", help="Output XML path")
    args = parser.parse_args()

    input_path = Path(args.input).expanduser().resolve()
    if input_path.is_dir():
        fcpxml_path = input_path / "Info.fcpxml"
    else:
        fcpxml_path = input_path
    if not fcpxml_path.exists():
        raise FileNotFoundError(f"Could not find {fcpxml_path}")

    tree = ET.parse(fcpxml_path)
    root = tree.getroot()

    resources = root.find("resources")
    if resources is None:
        raise ValueError("Missing <resources> section")

    formats: dict[str, FormatDef] = {}
    assets: dict[str, AssetDef] = {}

    for child in resources:
        tag = strip_tag(child.tag)
        if tag == "format":
            formats[child.attrib["id"]] = FormatDef(
                id=child.attrib["id"],
                frame_duration=parse_time(child.get("frameDuration")) if child.get("frameDuration") else None,
                width=int(child.get("width")) if child.get("width") else None,
                height=int(child.get("height")) if child.get("height") else None,
            )
        elif tag == "asset":
            media_rep = child.find("media-rep")
            if media_rep is None or not media_rep.get("src"):
                continue
            src = urllib.parse.unquote(urllib.parse.urlparse(media_rep.get("src")).path)
            assets[child.attrib["id"]] = AssetDef(
                id=child.attrib["id"],
                name=child.get("name") or Path(src).name,
                path=Path(src),
                has_video=child.get("hasVideo") == "1",
                has_audio=child.get("hasAudio") == "1",
                format_id=child.get("format"),
                start=parse_time(child.get("start")),
                duration=parse_time(child.get("duration")),
                audio_channels=int(child.get("audioChannels") or 2),
                audio_rate=int(child.get("audioRate") or 48000),
            )

    library = root.find("library")
    if library is None:
        raise ValueError("Missing <library> section")

    project = library.find("./event/project")
    if project is None:
        raise ValueError("Missing <project> section")

    sequence = project.find("sequence")
    if sequence is None:
        raise ValueError("Missing <sequence> section")

    seq_format_id = sequence.get("format")
    if not seq_format_id or seq_format_id not in formats or not formats[seq_format_id].frame_duration:
        raise ValueError("Sequence format is missing frameDuration")

    frame_duration = formats[seq_format_id].frame_duration
    sequence_rate = nominal_rate(frame_duration)
    sequence_duration_frames = frames_from_time(parse_time(sequence.get("duration")), frame_duration)
    sequence_name = project.get("name") or "Converted Sequence"

    spine = sequence.find("spine")
    if spine is None:
        raise ValueError("Missing <spine> section")

    clips: list[TimelineClip] = []
    flatten_timeline(spine, assets=assets, frame_duration=frame_duration, clips=clips)

    media_infos = {
        asset_id: build_media_info(asset, formats, sequence_rate)
        for asset_id, asset in assets.items()
    }
    file_durations = {
        asset_id: frames_from_time(media_infos[asset_id].duration_seconds, frame_duration)
        for asset_id in assets
    }

    xmeml = ET.Element("xmeml", {"version": "4"})
    sequence_elem = ET.SubElement(xmeml, "sequence", {"id": "sequence-1"})
    ensure_text(sequence_elem, "duration", str(sequence_duration_frames))
    add_rate(sequence_elem, *sequence_rate)
    ensure_text(sequence_elem, "name", sequence_name)
    add_timecode(sequence_elem, *sequence_rate)

    media = ET.SubElement(sequence_elem, "media")
    video = ET.SubElement(media, "video")
    video_format = ET.SubElement(video, "format")
    sample = ET.SubElement(video_format, "samplecharacteristics")
    add_rate(sample, *sequence_rate)
    ensure_text(sample, "width", str(formats[seq_format_id].width or 1920))
    ensure_text(sample, "height", str(formats[seq_format_id].height or 1080))
    ensure_text(sample, "anamorphic", "FALSE")
    ensure_text(sample, "pixelaspectratio", "square")
    ensure_text(sample, "fielddominance", "none")

    audio = ET.SubElement(media, "audio")
    ensure_text(audio, "numOutputChannels", "2")
    audio_format = ET.SubElement(audio, "format")
    audio_sample = ET.SubElement(audio_format, "samplecharacteristics")
    ensure_text(audio_sample, "depth", "16")
    ensure_text(audio_sample, "samplerate", "48000")
    outputs = ET.SubElement(audio, "outputs")
    group = ET.SubElement(outputs, "group")
    ensure_text(group, "index", "1")
    ensure_text(group, "numchannels", "2")
    ensure_text(group, "downmix", "0")
    ch1 = ET.SubElement(group, "channel")
    ensure_text(ch1, "index", "1")
    ch2 = ET.SubElement(group, "channel")
    ensure_text(ch2, "index", "2")

    file_written: set[str] = set()
    clip_counter = 1

    video_track = ET.SubElement(video, "track")
    for clip in sorted((c for c in clips if c.kind == "video"), key=lambda c: (c.track_index, c.seq_start_frames, c.source_in_frames)):
        asset = assets[clip.asset_id]
        add_clipitem(
            video_track,
            clip=clip,
            clip_id=f"clipitem-{clip_counter}",
            masterclip_id=f"masterclip-{clip.asset_id}",
            file_id=f"file-{clip.asset_id}",
            asset=asset,
            media_info=media_infos[clip.asset_id],
            file_duration_frames=file_durations[clip.asset_id],
            sequence_rate=sequence_rate,
            frame_duration=frame_duration,
            file_written=file_written,
        )
        clip_counter += 1
    ensure_text(video_track, "enabled", "TRUE")
    ensure_text(video_track, "locked", "FALSE")

    audio_clips = sorted((c for c in clips if c.kind == "audio"), key=lambda c: (c.track_index, c.seq_start_frames, c.source_in_frames))
    for track_index in sorted({clip.track_index for clip in audio_clips}):
        track = ET.SubElement(audio, "track")
        for clip in (c for c in audio_clips if c.track_index == track_index):
            asset = assets[clip.asset_id]
            add_clipitem(
                track,
                clip=clip,
                clip_id=f"clipitem-{clip_counter}",
                masterclip_id=f"masterclip-{clip.asset_id}",
                file_id=f"file-{clip.asset_id}",
                asset=asset,
                media_info=media_infos[clip.asset_id],
                file_duration_frames=file_durations[clip.asset_id],
                sequence_rate=sequence_rate,
                frame_duration=frame_duration,
                file_written=file_written,
            )
            clip_counter += 1
        ensure_text(track, "enabled", "TRUE")
        ensure_text(track, "locked", "FALSE")

    ET.indent(ET.ElementTree(xmeml), space="  ")
    xml_text = ET.tostring(xmeml, encoding="unicode")
    output_path = Path(args.output).expanduser().resolve() if args.output else fcpxml_path.with_suffix(".xml")
    output_path.write_text('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n' + xml_text + "\n", encoding="utf-8")

    print(output_path)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise
