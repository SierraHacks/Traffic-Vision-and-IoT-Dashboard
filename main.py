from fastapi import FastAPI
from models.post import UserPost

app = FastAPI(
    title="Traffic Vision & IoT Dashboard API",
    description="Backend API for traffic monitoring",
    version="1.0"
)

traffic_data = []
sensor_data = []

class TrafficData(BaseModel):
    camera_id: str
    average_vehicle = float
    average_pedestrians: float
    max_vehicles = str
    
@app.post("/traffic")
def receive_traffic(data: TrafficData):

    traffic_data.append(data)

    return {
        "message": "Traffic data received",
        "camera": data.camera_id
    }
