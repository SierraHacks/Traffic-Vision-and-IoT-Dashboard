from fastapi import FastAPI
from pydantic import BaseModel
from datetime import datetime
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Traffic Vision & IoT Dashboard API",
    description="Backend API for traffic monitoring",
    version="1.0"
)

traffic_data = []
sensor_data = []

class TrafficData(BaseModel):
    camera_id: str
    starting_image: str
    ending_image: str
    average_vehicles: float
    average_pedestrians: float
    
@app.post("/traffic")
def receive_traffic(data: TrafficData):

    traffic_data.append(data.model_dump())

    print(traffic_data)

    return {
        "message": "Traffic data received",
    }

@app.get("/traffic")
def get_traffic():
    return traffic_data

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

