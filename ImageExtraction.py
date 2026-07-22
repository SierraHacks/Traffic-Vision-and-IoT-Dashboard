import cv2
from pathlib import Path
from ultralytics import YOLO

results_list=[]

model = YOLO("yolov8n.pt")   # Downloads automatically the first time

DATA_DIR = Path("Data Folder")

vehicle_count=0
pedestrian_count=0

for image_path in DATA_DIR.rglob("*"):
    if image_path.suffix.lower() in [".jpg", ".jpeg", ".png"]:
        image = cv2.imread(str(image_path))
        
        results=model(image)
        vehicle_count = 0
        pedestrian_count = 0
        for result in results:

            for box in result.boxes:

                class_id = int(box.cls[0])
                class_name = model.names[class_id]

                if class_name in ["car", "truck", "bus", "motorcycle"]:
                    vehicle_count += 1

                elif class_name == "person":
                    pedestrian_count += 1

            results_list.append({
                "image": image_path.name,
                "vehicles": vehicle_count,
                "pedestrians": pedestrian_count
            })
    print(f"{image_path.name}: {vehicle_count} vehicles, {pedestrian_count} pedestrians")

    for result in results_list:
        print(result)