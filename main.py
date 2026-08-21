from fastapi import FastAPI
from pydantic import BaseModel
from typing import Optional, List


app = FastAPI(
    title="Traffic Vision & IoT Dashboard API",
    description="Backend API for traffic monitoring",
    version="1.0"
)


# ---------------------------------------------------------
# Data models
# ---------------------------------------------------------

class VehicleSpeed(BaseModel):
    track_id: int
    speed_mph: float


class TrafficData(BaseModel):
    camera_id: str

    starting_image: str
    ending_image: str

    average_vehicles: float
    average_pedestrians: float

    average_speed_mph: Optional[float] = None

    congestion: str

    vehicle_speeds: List[VehicleSpeed] = []


# ---------------------------------------------------------
# Storage
# ---------------------------------------------------------

traffic_data = []


# ---------------------------------------------------------
# Routes
# ---------------------------------------------------------

@app.get("/")
def root():
    return {
        "message": "Traffic Vision API is running"
    }


@app.get("/traffic")
def get_traffic():
    return traffic_data


@app.post("/traffic")
def receive_traffic(data: TrafficData):

    traffic_data.append(data.model_dump())

    # Keep only the most recent 100 summaries
    if len(traffic_data) > 100:
        traffic_data.pop(0)

    print(
        f"[TRAFFIC] {data.camera_id} | "
        f"Vehicles: {data.average_vehicles:.1f} | "
        f"People: {data.average_pedestrians:.1f} | "
        f"Speed: {data.average_speed_mph} mph | "
        f"Congestion: {data.congestion}"
    )

    return {
        "message": "Traffic data received",
        "camera_id": data.camera_id
    }