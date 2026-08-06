import cv2
import numpy as np
from pathlib import Path
from ultralytics import YOLO
import supervision as sv
import requests

# ------------------------------------------------------------------
# Config
# ------------------------------------------------------------------

# Load the YOLO model
model = YOLO("yolov8n.pt")

# Path to your images
DATA_DIR = Path("Data Folder")

# Backend endpoint
BACKEND_URL = "http://127.0.0.1:8000/traffic"

VEHICLE_CLASS_NAMES = ["car", "truck", "bus", "motorcycle"]
VEHICLE_CLASS_IDS = [
    cid for cid, name in model.names.items() if name in VEHICLE_CLASS_NAMES
]

# --- Speed calibration ---

# Time between consecutive images from the SAME camera, in seconds.
# Assumes a fixed-interval snapshot system taking one frame every half
# second (a common rate for roadside detection cameras that sample
# stills rather than full video). If your capture system logs real
# timestamps (EXIF, or encoded in the filename), swap this constant
# out for the actual delta between each pair of images -- that will
# always be more accurate than an assumed constant.
SECONDS_PER_IMAGE = 0.5

# --- Perspective calibration (pixel space -> real-world bird's-eye space) ---
#
# A flat "pixels-per-meter" number only works if the camera looks straight
# down. This camera is mounted at an angle on a pedestrian overpass, so
# objects near the bottom of the frame (closer to the camera) cover more
# pixels per real-world meter than objects near the top (farther away).
# Left uncorrected, that perspective distortion makes cars moving away
# from the camera look like they're slowing down even at constant speed.
#
# SRC_POINTS below were picked directly off one of your actual frames
# (img00001__1_.jpg, 960x540) -- they trace the near-side travel lane the
# dark SUV is in, from where it's closest to the camera at the bottom of
# frame up to where that same lane is visible near the top of frame.
#
# DST_POINTS assign that lane a real-world width of 3.5 m (standard
# Chinese urban arterial lane width) and an estimated visible length of
# 40 m between the near and far points -- eyeballed from the elevated
# overpass vantage point, not surveyed. If you have an actual measurement
# for that stretch of road (Street View, satellite imagery, or a physical
# measurement), swap LANE_LENGTH_M for the real number -- it directly
# scales every speed reading.
FRAME_WIDTH, FRAME_HEIGHT = 960, 540

SRC_POINTS = np.float32([
    [595, 520],   # near-bottom-left corner of lane (closest to camera)
    [790, 520],   # near-bottom-right corner of lane
    [555, 145],   # far-top-left corner of lane (farthest from camera)
    [600, 145],   # far-top-right corner of lane
])

LANE_WIDTH_M = 3.5     # standard Chinese urban arterial lane width
LANE_LENGTH_M = 40.0   # estimated visible stretch of that lane in the frame

DST_POINTS = np.float32([
    [0.0, 0.0],
    [LANE_WIDTH_M, 0.0],
    [0.0, LANE_LENGTH_M],
    [LANE_WIDTH_M, LANE_LENGTH_M],
])

HOMOGRAPHY, _ = cv2.findHomography(SRC_POINTS, DST_POINTS)


def to_birdseye(cx, cy):
    """Map an image pixel coordinate to real-world (X, Y) meters."""
    pt = np.array([[[cx, cy]]], dtype=np.float32)
    transformed = cv2.perspectiveTransform(pt, HOMOGRAPHY)
    x_m, y_m = transformed[0][0]
    return float(x_m), float(y_m)


# The homography above is only valid *inside* the calibrated lane region --
# it was fit to that one trapezoid, so points outside it get extrapolated
# and the resulting "meters" become unreliable (this showed up as noisy,
# implausible speed spikes for distant/off-lane vehicles when testing
# against real frames). Only tracks whose centroid falls inside the
# calibrated lane get included in speed calculations; everything else
# still gets counted normally, just not speed-measured.
LANE_POLYGON = SRC_POINTS.reshape(-1, 1, 2)


def is_in_lane(cx, cy):
    return cv2.pointPolygonTest(LANE_POLYGON, (float(cx), float(cy)), False) >= 0


MPS_TO_MPH = 2.237

# ------------------------------------------------------------------
# State
# ------------------------------------------------------------------

results_list = []

# Per-camera state -- reset whenever we move to a new camera folder
trackers = {}          # camera_id -> sv.ByteTrack()
last_position = {}      # camera_id -> {track_id: (x_m, y_m, t)}
frame_counter = {}      # camera_id -> int, used as a simple clock

# Rolling buffers for the "every 5 images" summary
vehicle_counts = []
pedestrian_counts = []
frame_speeds = {}      # track_id -> list of instantaneous speed readings (mph)
                        # seen for that specific vehicle during this window

starting_image = ""
current_camera_id = None


def get_tracker(camera_id):
    if camera_id not in trackers:
        trackers[camera_id] = sv.ByteTrack()
        last_position[camera_id] = {}
        frame_counter[camera_id] = 0
    return trackers[camera_id]


def classify_congestion(avg_vehicles, avg_speed_mph):
    """
    Classify congestion as "low" / "medium" / "high" using two signals:
    how many vehicles are in frame, and how fast the ones we could
    actually measure are moving. Whichever signal looks worse wins,
    since either "lots of cars" or "cars barely moving" independently
    indicates congestion.

    These thresholds are placeholders -- tune them for your specific
    camera (how many lanes it sees, the road's actual speed limit, typical
    vehicle counts for that intersection at free-flowing traffic, etc).
    """
    if avg_vehicles >= 15:
        count_level = "high"
    elif avg_vehicles >= 8:
        count_level = "medium"
    else:
        count_level = "low"

    if avg_speed_mph is None:
        # No vehicles passed through the calibrated lane this window --
        # fall back to the count-based read entirely.
        return count_level

    if avg_speed_mph >= 25:
        speed_level = "low"
    elif avg_speed_mph >= 12:
        speed_level = "medium"
    else:
        speed_level = "high"

    order = {"low": 0, "medium": 1, "high": 2}
    return speed_level if order[speed_level] >= order[count_level] else count_level


def post_summary(camera_id, start_img, end_img, vcounts, pcounts, speeds_by_track):
    avg_vehicles = sum(vcounts) / len(vcounts)
    avg_pedestrians = sum(pcounts) / len(pcounts)

    # one entry per vehicle actually measured this window, not pooled
    vehicle_speeds = [
        {"track_id": int(tid), "speed_mph": round(sum(readings) / len(readings), 1)}
        for tid, readings in speeds_by_track.items()
    ]
    vehicle_speeds.sort(key=lambda v: v["track_id"])

    avg_speed = (
        sum(v["speed_mph"] for v in vehicle_speeds) / len(vehicle_speeds)
        if vehicle_speeds else None
    )

    congestion = classify_congestion(avg_vehicles, avg_speed)

    summary = {
        "camera_id": camera_id,
        "starting_image": start_img,
        "ending_image": end_img,
        "average_vehicles": avg_vehicles,
        "average_pedestrians": avg_pedestrians,
        "average_speed_mph": avg_speed,
        "congestion": congestion,
        "vehicle_speeds": vehicle_speeds,
    }
    try:
        response = requests.post(BACKEND_URL, json=summary)
        print("Status:", response.status_code)
    except Exception as e:
        print("Could not connect to backend:", e)


# ------------------------------------------------------------------
# Main loop
# ------------------------------------------------------------------

for image_path in sorted(DATA_DIR.rglob("*")):

    if image_path.suffix.lower() not in [".jpg", ".jpeg", ".png"]:
        continue

    camera_id = image_path.parent.name

    # If we've moved to a new camera, flush any partial group from the
    # previous camera and start fresh (new tracker, new buffers).
    if camera_id != current_camera_id:
        if vehicle_counts:
            post_summary(current_camera_id, starting_image, image_path.name,
                         vehicle_counts, pedestrian_counts, frame_speeds)
            vehicle_counts.clear()
            pedestrian_counts.clear()
            frame_speeds.clear()
        current_camera_id = camera_id
        starting_image = image_path.name

    image = cv2.imread(str(image_path))
    results = model(image)[0]

    vehicle_count = 0
    pedestrian_count = 0
    for box in results.boxes:
        class_id = int(box.cls[0])
        class_name = model.names[class_id]
        if class_name in VEHICLE_CLASS_NAMES:
            vehicle_count += 1
        elif class_name == "person":
            pedestrian_count += 1

    # --- Tracking + speed ---
    tracker = get_tracker(camera_id)
    detections = sv.Detections.from_ultralytics(results)
    vehicle_detections = detections[np.isin(detections.class_id, VEHICLE_CLASS_IDS)]
    tracked = tracker.update_with_detections(vehicle_detections)

    current_time = frame_counter[camera_id] * SECONDS_PER_IMAGE
    frame_counter[camera_id] += 1

    for box, track_id in zip(tracked.xyxy, tracked.tracker_id):
        cx = (box[0] + box[2]) / 2
        cy = (box[1] + box[3]) / 2

        in_lane = is_in_lane(cx, cy)
        prev = last_position[camera_id].get(track_id)

        if in_lane:
            x_m, y_m = to_birdseye(cx, cy)
            if prev is not None and prev[3]:
                # both this position and the last recorded one were
                # inside the calibrated lane -- safe to measure speed
                px, py, pt, _ = prev
                dt = current_time - pt
                if dt > 0:
                    dist_m = np.hypot(x_m - px, y_m - py)
                    speed_mph = (dist_m / dt) * MPS_TO_MPH
                    frame_speeds.setdefault(track_id, []).append(speed_mph)
            last_position[camera_id][track_id] = (x_m, y_m, current_time, True)
        else:
            # outside the calibrated region -- keep the track alive so we
            # don't lose it, but mark it as "not usable for speed" so we
            # don't measure a jump the next time it re-enters the lane
            last_position[camera_id][track_id] = (None, None, current_time, False)

    results_list.append({
        "image": image_path.name,
        "vehicles": vehicle_count,
        "pedestrians": pedestrian_count,
    })

    vehicle_counts.append(vehicle_count)
    pedestrian_counts.append(pedestrian_count)

    if len(vehicle_counts) == 5:
        post_summary(camera_id, starting_image, image_path.name,
                     vehicle_counts, pedestrian_counts, frame_speeds)
        vehicle_counts.clear()
        pedestrian_counts.clear()
        frame_speeds.clear()
        starting_image = image_path.name

# Flush any leftover partial group at the very end
if vehicle_counts:
    post_summary(current_camera_id, starting_image, image_path.name,
                 vehicle_counts, pedestrian_counts, frame_speeds)
