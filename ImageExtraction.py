import cv2
from pathlib import Path
from ultralytics import YOLO
import requests

# Load the YOLO model
model = YOLO("yolov8n.pt")

# Path to your images
DATA_DIR = Path("Data Folder")

# Store results for each image
results_list = []

# Lists for averaging every 5 images
vehicle_counts = []
pedestrian_counts = []

average_counts = {}

starting_image=""
ending_image=""


# Process every image
for image_path in sorted(DATA_DIR.rglob("*")):

    if image_path.suffix.lower() not in [".jpg", ".jpeg", ".png"]:
        continue

    image = cv2.imread(str(image_path))
    results = model(image)

    vehicle_count = 0
    pedestrian_count = 0

    # Count detected objects
    for result in results:
        for box in result.boxes:

            class_id = int(box.cls[0])
            class_name = model.names[class_id]

            if class_name in ["car", "truck", "bus", "motorcycle"]:
                vehicle_count += 1

            elif class_name == "person":
                pedestrian_count += 1

    # Save the results
    results_list.append({
        "image": image_path.name,
        "vehicles": vehicle_count,
        "pedestrians": pedestrian_count
    })

    # Print results for this image
#    print(f"{image_path.name}: {vehicle_count} vehicles, {pedestrian_count} pedestrians")

    # Add counts to averaging lists
    vehicle_counts.append(vehicle_count)
    pedestrian_counts.append(pedestrian_count)

    # Every 5 images, compute averages
    if len(vehicle_counts) == 1:
        starting_image=image_path.name
    elif len(vehicle_counts) == 5:

        average_vehicle = int(sum(vehicle_counts) / 5)
        average_pedestrian = int(sum(pedestrian_counts) / 5)

        '''print("\n----- Average of Previous 5 Images -----")
        print(f"Average vehicles: {average_vehicle:.2f}")
        print(f"Average pedestrians: {average_pedestrian:.2f}")
        print("----------------------------------------\n")'''

        # Reset for the next group of five
        vehicle_counts.clear()
        pedestrian_counts.clear()
        ending_image=image_path.name
# If there are leftover images (not a multiple of 5)
    if vehicle_counts:

        average_vehicle = int(sum(vehicle_counts) / len(vehicle_counts))
        average_pedestrian = int(sum(pedestrian_counts) / len(pedestrian_counts))
        
        average_counts[f"average vehicles from {starting_image} to {ending_image}"] = average_vehicle
        average_counts[f"average pedestrians from {starting_image} to {ending_image}"] = average_pedestrian
        average_counts["Starting Image"] = starting_image
        average_counts["Ending Image"] = ending_image

        '''print("\n----- Final Partial Group -----")
        print(f"Average vehicles: {average_vehicle:.2f}")
        print(f"Average pedestrians: {average_pedestrian:.2f}")
        print("Starting Image:", starting_image)
        print("Ending Image:", ending_image)'''
        print(average_counts)
        response = requests.post("http://127.0.0.1:8000/traffic",json=average_counts)
        average_counts.clear()