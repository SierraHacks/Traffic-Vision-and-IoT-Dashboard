from fastapi import FastAPI

app = FastAPI(
    title="Traffic Vision & IoT Dashboard API",
    description="Backend API for traffic monitoring",
    version="1.0"
)

traffic_data = []
sensor_data = []
